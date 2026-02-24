import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import type { GitHubPRData } from '~/db/deployments.server'
import { logger } from '~/lib/logger.server'

let octokit: Octokit | null = null
let requestCount = 0

// Cache for PR commits to avoid repeated API calls for same PR
const prCommitsCache = new Map<string, string[]>()

export function clearPrCommitsCache(): void {
  prCommitsCache.clear()
}

/**
 * Get GitHub client - supports both GitHub App and PAT authentication
 * GitHub App is preferred (higher rate limits, better security)
 */
export function getGitHubClient(): Octokit {
  if (!octokit) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID
    const pat = process.env.GITHUB_TOKEN

    // Prefer GitHub App authentication
    if (appId && privateKey && installationId) {
      logger.info('🔐 Using GitHub App authentication')

      // Handle private key - can be base64 encoded or raw PEM
      let decodedPrivateKey = privateKey
      if (!privateKey.includes('-----BEGIN')) {
        // Assume base64 encoded
        decodedPrivateKey = Buffer.from(privateKey, 'base64').toString('utf-8')
      }

      octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: parseInt(appId, 10),
          privateKey: decodedPrivateKey,
          installationId: parseInt(installationId, 10),
        },
        log: {
          debug: () => {},
          info: () => {},
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
        },
      })
    } else if (pat) {
      // Fallback to Personal Access Token
      logger.info('🔑 Using Personal Access Token authentication')

      octokit = new Octokit({
        auth: pat,
        log: {
          debug: () => {},
          info: () => {},
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
        },
      })
    } else {
      throw new Error(
        'GitHub authentication not configured. Set either GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID, or GITHUB_TOKEN',
      )
    }

    // Add request hook for logging
    octokit.hook.before('request', (options) => {
      requestCount++
      const method = options.method || 'GET'
      let url = options.url?.replace('https://api.github.com', '') || options.baseUrl || ''

      // Replace template variables with actual values for debug logging
      if (options.owner) url = url.replace('{owner}', options.owner as string)
      if (options.repo) url = url.replace('{repo}', options.repo as string)
      if (options.pull_number) url = url.replace('{pull_number}', String(options.pull_number))
      if (options.commit_sha) url = url.replace('{commit_sha}', (options.commit_sha as string).substring(0, 7))
      if (options.ref) url = url.replace('{ref}', (options.ref as string).substring(0, 7))
      if (options.issue_number) url = url.replace('{issue_number}', String(options.issue_number))
      if (options.base && options.head) {
        url = url.replace('{base}', (options.base as string).substring(0, 7))
        url = url.replace('{head}', (options.head as string).substring(0, 7))
      }

      // Add page number if paginating
      const pageInfo = options.page ? ` (page ${options.page})` : ''

      logger.info(`🌐 [GitHub #${requestCount}] ${method} ${url}${pageInfo}`)
    })

    // Add response hook for rate limit info
    octokit.hook.after('request', (response, _options) => {
      const remaining = response.headers['x-ratelimit-remaining']
      const limit = response.headers['x-ratelimit-limit']
      if (remaining && parseInt(remaining, 10) < 100) {
        logger.warn(`⚠️  GitHub rate limit: ${remaining}/${limit} remaining`)
      }
    })
  }

  return octokit
}

export interface PullRequest {
  number: number
  title: string
  html_url: string
  merged_at: string | null
  state: string
}

export async function getPullRequestForCommit(
  owner: string,
  repo: string,
  sha: string,
  verifyCommitIsInPR: boolean = false,
  baseBranch?: string,
): Promise<PullRequest | null> {
  const client = getGitHubClient()

  try {
    logger.info(
      `🔎 Searching for PRs associated with commit ${sha} in ${owner}/${repo}${baseBranch ? ` (base: ${baseBranch})` : ''}`,
    )

    const response = await client.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: sha,
    })

    logger.info(`📊 Found ${response.data.length} PR(s) associated with commit ${sha}`)

    if (response.data.length === 0) {
      logger.info(`❌ No PRs found for commit ${sha}`)
      return null
    }

    // Filter to only PRs targeting the base branch if specified
    const filteredPRs = baseBranch ? response.data.filter((pr) => pr.base.ref === baseBranch) : response.data

    if (baseBranch && filteredPRs.length !== response.data.length) {
      logger.info(`   🔍 Filtered to ${filteredPRs.length} PR(s) targeting ${baseBranch}`)
    }

    // Log all PRs found
    filteredPRs.forEach((pr, index) => {
      logger.info(
        `   PR ${index + 1}: #${pr.number} - ${pr.title} (${pr.state}, merged: ${pr.merged_at ? 'yes' : 'no'}, base: ${pr.base.ref})`,
      )
    })

    if (filteredPRs.length === 0) {
      logger.info(`❌ No PRs found for commit ${sha} targeting ${baseBranch}`)
      return null
    }

    // When verifyCommitIsInPR is true, we need to check that the commit is actually
    // part of the PR's original commits, not just reachable via merge from main.
    // This is important to detect commits pushed directly to main that get
    // "smuggled" into a PR when the PR merges main into its branch.
    if (verifyCommitIsInPR) {
      for (const pr of filteredPRs) {
        // Only check merged PRs
        if (!pr.merged_at) continue

        // Check if this commit is the PR's merge/squash commit
        // For squash merges, the merge_commit_sha is the squashed commit
        if (pr.merge_commit_sha === sha) {
          logger.info(`✅ Commit ${sha.substring(0, 7)} is the merge/squash commit for PR #${pr.number}`)
          return {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            merged_at: pr.merged_at,
            state: pr.state,
          }
        }

        // Check cache first
        const cacheKey = `${owner}/${repo}#${pr.number}`
        let prCommitShas = prCommitsCache.get(cacheKey)

        // Also get metadata cache for rebase matching
        const metadataCacheKey = `${owner}/${repo}#${pr.number}-metadata`
        let prCommitsMetadata = prCommitsMetadataCache.get(metadataCacheKey)

        if (!prCommitShas || !prCommitsMetadata) {
          // Fetch the PR's commits (with pagination for PRs with 100+ commits)
          try {
            let allPrCommits: Awaited<ReturnType<typeof client.pulls.listCommits>>['data'] = []
            let prCommitsPage = 1

            while (true) {
              const prCommitsResponse = await client.pulls.listCommits({
                owner,
                repo,
                pull_number: pr.number,
                per_page: 100,
                page: prCommitsPage,
              })

              allPrCommits = allPrCommits.concat(prCommitsResponse.data)

              if (prCommitsResponse.data.length < 100) {
                break
              }
              prCommitsPage++
            }

            prCommitShas = allPrCommits.map((c) => c.sha)
            prCommitsCache.set(cacheKey, prCommitShas)

            // Also cache metadata for rebase matching
            prCommitsMetadata = allPrCommits.map((c) => ({
              sha: c.sha,
              author: (c.commit.author?.name || c.author?.login || 'unknown').toLowerCase(),
              authorDate: c.commit.author?.date || '',
              messageFirstLine: c.commit.message.split('\n')[0].trim(),
            }))
            prCommitsMetadataCache.set(metadataCacheKey, prCommitsMetadata)
          } catch (err) {
            logger.warn(`Could not fetch commits for PR #${pr.number}: ${err}`)
            continue
          }
        } else {
          logger.info(`   📋 Using cached commits for PR #${pr.number} (${prCommitShas.length} commits)`)
        }

        // Check if our commit is in the PR's commit list (exact SHA match)
        const isInPR = prCommitShas.includes(sha)

        if (isInPR) {
          logger.info(`✅ Commit ${sha.substring(0, 7)} is an original commit in PR #${pr.number}`)
          return {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            merged_at: pr.merged_at,
            state: pr.state,
          }
        }

        // Not an exact SHA match - try rebase matching via metadata
        // This handles "rebase and merge" where commits get new SHAs
        if (prCommitsMetadata) {
          // Fetch the commit details to get metadata for matching
          try {
            const commitResponse = await client.repos.getCommit({
              owner,
              repo,
              ref: sha,
            })
            const commitData = commitResponse.data

            const commitAuthor = (commitData.commit.author?.name || commitData.author?.login || 'unknown').toLowerCase()
            const commitAuthorDate = commitData.commit.author?.date || ''
            const commitMessageFirstLine = commitData.commit.message.split('\n')[0].trim()

            // Try to match against PR commits by metadata
            for (const prCommit of prCommitsMetadata) {
              const authorMatch = prCommit.author === commitAuthor

              // Date match within 1 second
              let dateMatch = false
              if (prCommit.authorDate && commitAuthorDate) {
                const prDate = new Date(prCommit.authorDate)
                const mainDate = new Date(commitAuthorDate)
                const dateDiffMs = Math.abs(prDate.getTime() - mainDate.getTime())
                dateMatch = dateDiffMs < 1000
              }

              const messageMatch = prCommit.messageFirstLine === commitMessageFirstLine

              if (authorMatch && dateMatch && messageMatch) {
                logger.info(
                  `✅ Commit ${sha.substring(0, 7)} matches PR #${pr.number} via rebase (original: ${prCommit.sha.substring(0, 7)})`,
                )
                return {
                  number: pr.number,
                  title: pr.title,
                  html_url: pr.html_url,
                  merged_at: pr.merged_at,
                  state: pr.state,
                  _rebase_matched: true,
                  _matched_original_sha: prCommit.sha,
                } as PullRequestWithMatchInfo
              }
            }
          } catch (err) {
            logger.warn(`Could not fetch commit ${sha} for rebase matching: ${err}`)
          }
        }

        logger.info(
          `⚠️  Commit ${sha.substring(0, 7)} is NOT in PR #${pr.number}'s original commits and no rebase match found`,
        )
      }

      // None of the associated PRs contain this commit as an original commit
      logger.info(`❌ Commit ${sha.substring(0, 7)} was not an original commit in any associated PR`)
      return null
    }

    // Return the first (most relevant) PR (default behavior for backward compatibility)
    const pr = filteredPRs[0]
    logger.info(`✅ Using PR #${pr.number} for verification`)

    return {
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      merged_at: pr.merged_at,
      state: pr.state,
    }
  } catch (error) {
    logger.error(`❌ Error fetching PR for commit ${sha}:`, error)

    // Re-throw rate limit errors so they can be handled properly upstream
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw error
    }

    return null
  }
}

// Extended PR type that includes rebase match info
export interface PullRequestWithMatchInfo extends PullRequest {
  _rebase_matched?: boolean
  _matched_original_sha?: string
}

// Cache for PR commits with metadata for rebase matching
interface PRCommitMetadata {
  sha: string
  author: string
  authorDate: string
  messageFirstLine: string
}
const prCommitsMetadataCache = new Map<string, PRCommitMetadata[]>()

/**
 * Find a PR for a rebased commit by matching metadata.
 * When commits are rebased, they get new SHAs but preserve:
 * - author name
 * - author date (NOT committer date)
 * - commit message
 *
 * This function searches recently merged PRs for commits with matching metadata.
 */
export async function findPRForRebasedCommit(
  owner: string,
  repo: string,
  commitSha: string,
  commitAuthor: string,
  commitAuthorDate: string,
  commitMessage: string,
  sinceDate?: Date,
  baseBranch: string = 'main',
): Promise<PullRequestWithMatchInfo | null> {
  const client = getGitHubClient()

  // Normalize inputs for comparison
  const normalizedAuthor = commitAuthor.toLowerCase()
  const normalizedAuthorDate = new Date(commitAuthorDate).toISOString()
  const normalizedMessageFirstLine = commitMessage.split('\n')[0].trim()

  logger.info(
    `🔄 Attempting rebase match for commit ${commitSha.substring(0, 7)} (author: ${normalizedAuthor}, date: ${normalizedAuthorDate.substring(0, 19)}, base: ${baseBranch})`,
  )

  try {
    // Get recently merged PRs targeting the base branch
    const mergedPRs = await client.pulls.list({
      owner,
      repo,
      state: 'closed',
      base: baseBranch,
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    })

    // Filter to only merged PRs, optionally since a date
    const relevantPRs = mergedPRs.data.filter((pr) => {
      if (!pr.merged_at) return false
      if (sinceDate) {
        const mergedAt = new Date(pr.merged_at)
        return mergedAt >= sinceDate
      }
      return true
    })

    logger.info(`   📋 Checking ${relevantPRs.length} recently merged PRs for rebase match`)

    for (const pr of relevantPRs) {
      const cacheKey = `${owner}/${repo}#${pr.number}-metadata`
      let prCommits = prCommitsMetadataCache.get(cacheKey)

      if (!prCommits) {
        // Fetch PR commits with full metadata (with pagination for PRs with 100+ commits)
        try {
          const allPrCommitsData: Array<{
            sha: string
            author: string
            authorDate: string
            messageFirstLine: string
          }> = []
          let prCommitsPage = 1

          while (true) {
            const prCommitsResponse = await client.pulls.listCommits({
              owner,
              repo,
              pull_number: pr.number,
              per_page: 100,
              page: prCommitsPage,
            })

            for (const c of prCommitsResponse.data) {
              allPrCommitsData.push({
                sha: c.sha,
                author: (c.commit.author?.name || c.author?.login || 'unknown').toLowerCase(),
                authorDate: c.commit.author?.date || '',
                messageFirstLine: c.commit.message.split('\n')[0].trim(),
              })
            }

            if (prCommitsResponse.data.length < 100) {
              break
            }
            prCommitsPage++
          }

          prCommits = allPrCommitsData
          prCommitsMetadataCache.set(cacheKey, prCommits)
        } catch (err) {
          logger.warn(`   Could not fetch commits for PR #${pr.number}:: ${err}`)
          continue
        }
      }

      // Look for metadata match
      for (const prCommit of prCommits) {
        const authorMatch = prCommit.author === normalizedAuthor
        const messageMatch = prCommit.messageFirstLine === normalizedMessageFirstLine

        // Date match: within 1 second tolerance
        let dateMatch = false
        if (prCommit.authorDate) {
          const prDate = new Date(prCommit.authorDate)
          const commitDate = new Date(normalizedAuthorDate)
          const dateDiffMs = Math.abs(prDate.getTime() - commitDate.getTime())
          dateMatch = dateDiffMs < 1000 // Within 1 second
        }

        if (authorMatch && dateMatch && messageMatch) {
          logger.info(
            `   ✅ Rebase match found! Commit ${commitSha.substring(0, 7)} matches PR #${pr.number} commit ${prCommit.sha.substring(0, 7)}`,
          )
          logger.info(`      Original: ${prCommit.sha.substring(0, 7)} → Rebased: ${commitSha.substring(0, 7)}`)

          return {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            merged_at: pr.merged_at,
            state: pr.state,
            _rebase_matched: true,
            _matched_original_sha: prCommit.sha,
          }
        }
      }
    }

    logger.info(`   ❌ No rebase match found for commit ${commitSha.substring(0, 7)}`)
    return null
  } catch (error) {
    logger.error(`❌ Error finding PR for rebased commit ${commitSha}:`, error)

    if (error instanceof Error && error.message.includes('rate limit')) {
      throw error
    }

    return null
  }
}

/**
 * Clear the PR commits metadata cache (for testing)
 */
export function clearPrCommitsMetadataCache(): void {
  prCommitsMetadataCache.clear()
}

export interface PullRequestReview {
  id: number
  user: {
    login: string
  } | null
  state: string
  submitted_at: string | null
}

async function getPullRequestReviews(owner: string, repo: string, pull_number: number): Promise<PullRequestReview[]> {
  const client = getGitHubClient()

  // Use paginate to get all reviews (PRs with many comments can have 30+ reviews)
  const allReviews = await client.paginate(client.pulls.listReviews, {
    owner,
    repo,
    pull_number,
    per_page: 100,
  })

  return allReviews as PullRequestReview[]
}

export interface PullRequestCommit {
  sha: string
  commit: {
    author: {
      date: string
      name?: string
    }
    message: string
  }
  author?: {
    login: string
  } | null
  parents: Array<{
    sha: string
  }>
}

export async function getPullRequestCommits(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<PullRequestCommit[]> {
  const client = getGitHubClient()

  logger.info(`   📄 Fetching commits for PR #${pull_number}...`)

  // Use paginate to automatically handle all pages efficiently
  const allCommits = await client.paginate(client.pulls.listCommits, {
    owner,
    repo,
    pull_number,
    per_page: 100,
  })

  logger.info(`      Total: ${allCommits.length} commits`)

  return allCommits as PullRequestCommit[]
}

/**
 * Check if a commit is a merge commit from main/master branch
 */
function isMergeFromMainBranch(commit: PullRequestCommit): boolean {
  // A merge commit has 2+ parents
  if (commit.parents.length < 2) {
    return false
  }

  const message = commit.commit.message.toLowerCase()

  // Check for common merge commit patterns from main/master
  // Examples:
  // - "Merge branch 'main' into feature-branch"
  // - "Merge remote-tracking branch 'origin/main' into feature"
  // - "Merge branch 'master' into ..."
  const mainBranchPatterns = [
    /merge\s+branch\s+['"]main['"]/i,
    /merge\s+branch\s+['"]master['"]/i,
    /merge\s+remote-tracking\s+branch\s+['"]origin\/main['"]/i,
    /merge\s+remote-tracking\s+branch\s+['"]origin\/master['"]/i,
    /merge\s+branch\s+['"]origin\/main['"]/i,
    /merge\s+branch\s+['"]origin\/master['"]/i,
  ]

  return mainBranchPatterns.some((pattern) => pattern.test(message))
}

/**
 * Verifies if a PR has "four eyes" (two sets of eyes):
 * - At least one APPROVED review
 * - The approval came after the last commit in the PR, OR
 * - The approval came before the last commit, but all commits after approval are merges from main/master, OR
 * - Special case for Dependabot: commits by dependabot[bot] after approval are allowed
 */
export async function verifyPullRequestFourEyes(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<{ hasFourEyes: boolean; reason: string }> {
  try {
    logger.info(`🔍 Verifying four-eyes for PR #${pull_number} in ${owner}/${repo}`)

    const client = getGitHubClient()

    // Fetch PR details to check creator
    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number,
    })

    const prCreator = prResponse.data.user?.login || ''
    const isDependabotPR = prCreator === 'dependabot[bot]' || prCreator.includes('dependabot')

    logger.info(`   🤖 PR creator: ${prCreator} (Dependabot: ${isDependabotPR})`)

    const [reviews, commits] = await Promise.all([
      getPullRequestReviews(owner, repo, pull_number),
      getPullRequestCommits(owner, repo, pull_number),
    ])

    logger.info(`   📝 Found ${reviews.length} review(s) and ${commits.length} commit(s)`)

    if (commits.length === 0) {
      logger.info(`   ❌ No commits found in PR`)
      return { hasFourEyes: false, reason: 'No commits found in PR' }
    }

    // Get the timestamp of the last commit
    const lastCommit = commits[commits.length - 1]
    const lastCommitDate = new Date(lastCommit.commit.author.date)
    logger.info(`   📅 Last commit: ${lastCommit.sha.substring(0, 7)} at ${lastCommitDate.toISOString()}`)
    logger.info(`   📝 Last commit message: ${lastCommit.commit.message.split('\n')[0].substring(0, 80)}`)

    // Find approved reviews that came after the last commit
    const approvedReviewsAfterLastCommit = reviews.filter((review) => {
      if (review.state !== 'APPROVED' || !review.submitted_at) {
        return false
      }
      const reviewDate = new Date(review.submitted_at)
      return reviewDate > lastCommitDate
    })

    logger.info(`   ✅ ${approvedReviewsAfterLastCommit.length} approved review(s) after last commit`)

    if (approvedReviewsAfterLastCommit.length > 0) {
      const result = {
        hasFourEyes: true,
        reason: `Approved by ${approvedReviewsAfterLastCommit[0].user?.login || 'unknown'} after last commit`,
      }
      logger.info(`   ✅ Result: ${result.reason}`)
      return result
    }

    // Check if there are any approved reviews (even before last commit)
    const approvedReviews = reviews.filter((r) => r.state === 'APPROVED')
    logger.info(`   ✅ ${approvedReviews.length} total approved review(s) found`)

    if (approvedReviews.length === 0) {
      logger.info(`   ❌ No approved reviews found`)
      return { hasFourEyes: false, reason: 'No approved reviews found' }
    }

    // Find the most recent approved review
    const mostRecentApproval = approvedReviews.reduce((latest, current) => {
      const currentDate = new Date(current.submitted_at || 0)
      const latestDate = new Date(latest.submitted_at || 0)
      return currentDate > latestDate ? current : latest
    })

    const approvalDate = new Date(mostRecentApproval.submitted_at || 0)
    logger.info(
      `   📅 Most recent approval: ${mostRecentApproval.user?.login || 'unknown'} at ${approvalDate.toISOString()}`,
    )

    // Get all commits that came after the approval
    const commitsAfterApproval = commits.filter((commit) => {
      const commitDate = new Date(commit.commit.author.date)
      return commitDate > approvalDate
    })

    logger.info(`   📊 ${commitsAfterApproval.length} commit(s) after most recent approval`)

    if (commitsAfterApproval.length === 0) {
      // This shouldn't happen since we already checked approvedReviewsAfterLastCommit
      logger.info(`   ✅ Approval was after last commit`)
      return {
        hasFourEyes: true,
        reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'} after last commit`,
      }
    }

    // Log commits after approval
    commitsAfterApproval.forEach((commit, index) => {
      const isMainMerge = isMergeFromMainBranch(commit)
      const commitAuthor = commit.author?.login || commit.commit.author?.name || 'unknown'
      const message = commit.commit.message.split('\n')[0].substring(0, 80)
      logger.info(
        `   📝 Commit ${index + 1} after approval: ${commit.sha.substring(0, 7)} by ${commitAuthor} - ${message} (${commit.parents.length} parent(s), main merge: ${isMainMerge})`,
      )
    })

    // Special case for Dependabot PRs: Allow commits by dependabot after approval
    if (isDependabotPR) {
      const allCommitsAreBotOrMainMerge = commitsAfterApproval.every((commit) => {
        const commitAuthor = commit.author?.login || commit.commit.author?.name || ''
        const isDependabotCommit = commitAuthor === 'dependabot[bot]' || commitAuthor.includes('dependabot')
        const isMainMerge = isMergeFromMainBranch(commit)
        return isDependabotCommit || isMainMerge
      })

      logger.info(`   🤖 All commits after approval are by Dependabot or main merges: ${allCommitsAreBotOrMainMerge}`)

      if (allCommitsAreBotOrMainMerge) {
        const result = {
          hasFourEyes: true,
          reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'}, Dependabot PR with bot commits after approval`,
        }
        logger.info(`   ✅ Result: ${result.reason}`)
        return result
      }
    }

    // Check if ALL commits after approval are merges from main/master
    const allCommitsAreMainMerges = commitsAfterApproval.every((commit) => isMergeFromMainBranch(commit))

    logger.info(`   🔀 All commits after approval are main/master merges: ${allCommitsAreMainMerges}`)

    if (allCommitsAreMainMerges) {
      const result = {
        hasFourEyes: true,
        reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'}, only main/master merges after approval`,
      }
      logger.info(`   ✅ Result: ${result.reason}`)
      return result
    }

    // There are commits after approval that are not merges from main
    const result = {
      hasFourEyes: false,
      reason: 'Approved review exists but came before the last commit (non-merge commits after approval)',
    }
    logger.info(`   ❌ Result: ${result.reason}`)
    return result
  } catch (error) {
    logger.error('Error verifying PR four eyes:', error)
    return { hasFourEyes: false, reason: 'Error checking reviews' }
  }
}

/**
 * Get detailed PR information including metadata, reviewers, and checks
 */
export async function getDetailedPullRequestInfo(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<GitHubPRData | null> {
  const client = getGitHubClient()

  try {
    // Fetch PR details
    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number,
    })

    const pr = prResponse.data

    // Fetch reviews with pagination to get all reviews
    const allReviews = await client.paginate(client.pulls.listReviews, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    })

    // Group reviews by user - prioritize APPROVED state, then latest timestamp
    // This ensures a later COMMENTED review doesn't overwrite an earlier APPROVED
    const reviewsByUser = new Map<
      string,
      { username: string; avatar_url: string; state: string; submitted_at: string }
    >()

    // Collect review comments (the body text from reviews)
    const reviewBodyComments: Array<{
      id: number
      body: string
      user: { username: string; avatar_url: string }
      created_at: string
      html_url: string
    }> = []

    for (const review of allReviews) {
      if (review.user && review.submitted_at) {
        const existing = reviewsByUser.get(review.user.login)

        // Determine if we should update the stored review
        let shouldUpdate = false
        if (!existing) {
          shouldUpdate = true
        } else if (review.state === 'APPROVED' && existing.state !== 'APPROVED') {
          // New review is APPROVED but existing is not - always prefer APPROVED
          shouldUpdate = true
        } else if (review.state === 'APPROVED' && existing.state === 'APPROVED') {
          // Both are APPROVED - keep the latest one
          shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
        } else if (review.state !== 'APPROVED' && existing.state !== 'APPROVED') {
          // Neither is APPROVED - keep the latest one
          shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
        }
        // If existing is APPROVED and new is not, don't update (shouldUpdate stays false)

        if (shouldUpdate) {
          reviewsByUser.set(review.user.login, {
            username: review.user.login,
            avatar_url: review.user.avatar_url,
            state: review.state,
            submitted_at: review.submitted_at,
          })
        }
        // If review has a body comment, add it to comments
        if (review.body?.trim()) {
          reviewBodyComments.push({
            id: review.id,
            body: review.body,
            user: {
              username: review.user.login,
              avatar_url: review.user.avatar_url,
            },
            created_at: review.submitted_at,
            html_url: review.html_url,
          })
        }
      }
    }

    // Fetch check runs details
    let checks_passed: boolean | null = null
    const checks: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      started_at: string | null
      completed_at: string | null
      html_url: string | null
      head_sha: string
      details_url: string | null
      external_id: string | null
      check_suite_id: number | null
      app: { name: string; slug: string | null } | null
      output: {
        title: string | null
        summary: string | null
        text: string | null
        annotations_count: number
      } | null
    }> = []

    try {
      const checksResponse = await client.checks.listForRef({
        owner,
        repo,
        ref: pr.head.sha,
      })

      if (checksResponse.data.total_count > 0) {
        // All checks must have conclusion 'success' or 'skipped'
        checks_passed = checksResponse.data.check_runs.every(
          (check) => check.conclusion === 'success' || check.conclusion === 'skipped',
        )

        // Store detailed check info
        for (const check of checksResponse.data.check_runs) {
          checks.push({
            id: check.id,
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            started_at: check.started_at,
            completed_at: check.completed_at,
            html_url: check.html_url,
            head_sha: check.head_sha,
            details_url: check.details_url ?? null,
            external_id: check.external_id ?? null,
            check_suite_id: check.check_suite?.id ?? null,
            app: check.app ? { name: check.app.name, slug: check.app.slug ?? null } : null,
            output: check.output
              ? {
                  title: check.output.title,
                  summary: check.output.summary,
                  text: check.output.text,
                  annotations_count: check.output.annotations_count,
                }
              : null,
          })
        }
      }
    } catch (error) {
      logger.warn(`Could not fetch check runs: ${error}`)
    }

    // Fetch commits (with pagination for PRs with 100+ commits)
    let allCommitsData: Awaited<ReturnType<typeof client.pulls.listCommits>>['data'] = []
    let commitsPage = 1

    while (true) {
      const commitsResponse = await client.pulls.listCommits({
        owner,
        repo,
        pull_number,
        per_page: 100,
        page: commitsPage,
      })

      allCommitsData = allCommitsData.concat(commitsResponse.data)

      if (commitsResponse.data.length < 100) {
        break
      }
      commitsPage++
    }

    const commits = allCommitsData.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        username: commit.author?.login || commit.commit.author?.name || 'unknown',
        avatar_url: commit.author?.avatar_url || '',
      },
      date: commit.commit.author?.date || '',
      html_url: commit.html_url,
    }))

    // Fetch issue comments (general PR discussion comments) with pagination
    const allIssueComments = await client.paginate(client.issues.listComments, {
      owner,
      repo,
      issue_number: pull_number,
      per_page: 100,
    })

    // Fetch review comments (comments on code lines) with pagination
    const allReviewComments = await client.paginate(client.pulls.listReviewComments, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    })

    // Combine both types of comments
    const issueComments = allIssueComments.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        username: comment.user?.login || 'unknown',
        avatar_url: comment.user?.avatar_url || '',
      },
      created_at: comment.created_at,
      html_url: comment.html_url,
    }))

    const reviewComments = allReviewComments.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        username: comment.user?.login || 'unknown',
        avatar_url: comment.user?.avatar_url || '',
      },
      created_at: comment.created_at,
      html_url: comment.html_url,
    }))

    // Merge and sort by created_at
    const comments = [...issueComments, ...reviewComments, ...reviewBodyComments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )

    return {
      title: pr.title,
      body: pr.body,
      labels: pr.labels.map((label) => (typeof label === 'string' ? label : label.name || '')),
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      base_branch: pr.base.ref,
      base_sha: pr.base.sha,
      head_branch: pr.head.ref,
      head_sha: pr.head.sha,
      merge_commit_sha: pr.merge_commit_sha,
      commits_count: pr.commits,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      comments_count: pr.comments,
      review_comments_count: pr.review_comments,
      draft: pr.draft || false,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      rebaseable: pr.rebaseable ?? null,
      locked: pr.locked,
      maintainer_can_modify: pr.maintainer_can_modify,
      auto_merge: pr.auto_merge
        ? {
            enabled_by: pr.auto_merge.enabled_by?.login || 'unknown',
            merge_method: pr.auto_merge.merge_method,
          }
        : null,
      creator: {
        username: pr.user?.login || 'unknown',
        avatar_url: pr.user?.avatar_url || '',
      },
      merged_by: pr.merged_by
        ? {
            username: pr.merged_by.login,
            avatar_url: pr.merged_by.avatar_url,
          }
        : null,
      merger: pr.merged_by
        ? {
            username: pr.merged_by.login,
            avatar_url: pr.merged_by.avatar_url,
          }
        : null,
      assignees: (pr.assignees || []).map((a) => ({
        username: a.login,
        avatar_url: a.avatar_url,
      })),
      requested_reviewers: (pr.requested_reviewers || []).map((r) => ({
        username: r.login,
        avatar_url: r.avatar_url,
      })),
      requested_teams: (pr.requested_teams || []).map((t) => ({
        name: t.name,
        slug: t.slug,
      })),
      milestone: pr.milestone
        ? {
            title: pr.milestone.title,
            number: pr.milestone.number,
            state: pr.milestone.state,
          }
        : null,
      reviewers: Array.from(reviewsByUser.values()),
      checks_passed,
      checks,
      commits,
      comments,
    }
  } catch (error) {
    logger.error('Error fetching detailed PR info:', error)
    return null
  }
}

/**
 * Compare two commits and get the commits between them
 * Returns commits that are in 'head' but not in 'base'
 */
export async function getCommitsBetween(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<Array<{
  sha: string
  message: string
  author: string
  date: string
  committer_date: string
  html_url: string
  parents_count: number
  parent_shas: string[]
}> | null> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)} in ${owner}/${repo}`)

    const response = await client.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    })

    logger.info(`   📊 GitHub API response:`)
    logger.info(`      - Status: ${response.data.status}`)
    logger.info(`      - Ahead by: ${response.data.ahead_by} commits`)
    logger.info(`      - Behind by: ${response.data.behind_by} commits`)
    logger.info(`      - Total commits: ${response.data.total_commits}`)

    // Handle case where commits array might be undefined or empty
    const rawCommits = response.data.commits || []
    logger.info(`      - Commits array length: ${rawCommits.length}`)

    const commits = rawCommits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.author?.login || commit.commit.author?.name || 'unknown',
      date: commit.commit.author?.date || '',
      committer_date: commit.commit.committer?.date || commit.commit.author?.date || '',
      html_url: commit.html_url,
      parents_count: commit.parents?.length || 0,
      parent_shas: commit.parents?.map((p) => p.sha) || [],
    }))

    logger.info(`✅ Found ${commits.length} commit(s) between ${base.substring(0, 7)} and ${head.substring(0, 7)}`)

    if (commits.length > 0 && commits.length <= 10) {
      logger.info(`   📝 Commits:`)
      commits.forEach((c, idx) => {
        logger.info(
          `      ${idx + 1}. ${c.sha.substring(0, 7)} by ${c.author}: ${c.message.split('\n')[0].substring(0, 50)}`,
        )
      })
    }

    return commits
  } catch (error) {
    logger.error(`❌ Error comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)}:`, error)
    return null
  }
}

/**
 * Result of looking up GitHub data for a legacy deployment
 */
export interface LegacyLookupResult {
  success: boolean
  error?: string
  data?: {
    commitSha: string
    commitMessage: string
    commitDate: Date
    commitAuthor: string
    prNumber?: number
    prTitle?: string
    prUrl?: string
    prMergedAt?: Date
    prAuthor?: string
    mergedBy?: string
    reviewers?: Array<{ username: string; state: string }>
    timeDifferenceMinutes: number
    isWithinThreshold: boolean
  }
}

/**
 * Look up GitHub data for a legacy deployment by commit SHA
 */
export async function lookupLegacyByCommit(
  owner: string,
  repo: string,
  sha: string,
  deploymentTime: Date,
): Promise<LegacyLookupResult> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Legacy lookup: Fetching commit ${sha} in ${owner}/${repo}`)

    // Get commit details
    const commitResponse = await client.repos.getCommit({
      owner,
      repo,
      ref: sha,
    })

    const commit = commitResponse.data
    const commitDate = new Date(commit.commit.author?.date || commit.commit.committer?.date || '')
    const commitAuthor = commit.author?.login || commit.commit.author?.name || 'unknown'

    // Calculate time difference
    const timeDiffMs = Math.abs(deploymentTime.getTime() - commitDate.getTime())
    const timeDifferenceMinutes = Math.round(timeDiffMs / (1000 * 60))
    const isWithinThreshold = timeDifferenceMinutes <= 30

    logger.info(`   📅 Commit date: ${commitDate.toISOString()}`)
    logger.info(`   📅 Deployment date: ${deploymentTime.toISOString()}`)
    logger.info(`   ⏱️  Time difference: ${timeDifferenceMinutes} minutes (threshold: 30)`)

    // Try to find associated PR
    const prInfo = await getPullRequestForCommit(owner, repo, sha, true)

    let reviewers: Array<{ username: string; state: string }> | undefined
    let prMergedAt: Date | undefined

    if (prInfo?.number) {
      const reviews = await getPullRequestReviews(owner, repo, prInfo.number)
      reviewers = reviews.map((r) => ({ username: r.user?.login || 'unknown', state: r.state }))
      if (prInfo.merged_at) {
        prMergedAt = new Date(prInfo.merged_at)
      }
    }

    return {
      success: true,
      data: {
        commitSha: sha,
        commitMessage: commit.commit.message.split('\n')[0], // First line only
        commitDate,
        commitAuthor,
        prNumber: prInfo?.number,
        prTitle: prInfo?.title,
        prUrl: prInfo?.html_url,
        prMergedAt,
        prAuthor: commit.author?.login,
        reviewers,
        timeDifferenceMinutes,
        isWithinThreshold,
      },
    }
  } catch (error) {
    logger.error(`Error looking up commit ${sha}:`, error)
    return {
      success: false,
      error: `Kunne ikke finne commit: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
    }
  }
}

/**
 * Look up GitHub data for a legacy deployment by PR number
 */
export async function lookupLegacyByPR(
  owner: string,
  repo: string,
  prNumber: number,
  deploymentTime: Date,
): Promise<LegacyLookupResult> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Legacy lookup: Fetching PR #${prNumber} in ${owner}/${repo}`)

    // Get PR details
    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    })

    const pr = prResponse.data

    if (!pr.merged_at) {
      return {
        success: false,
        error: `PR #${prNumber} er ikke merget`,
      }
    }

    const prMergedAt = new Date(pr.merged_at)

    // Calculate time difference from merge
    const timeDiffMs = Math.abs(deploymentTime.getTime() - prMergedAt.getTime())
    const timeDifferenceMinutes = Math.round(timeDiffMs / (1000 * 60))
    const isWithinThreshold = timeDifferenceMinutes <= 30

    logger.info(`   📅 PR merged at: ${prMergedAt.toISOString()}`)
    logger.info(`   📅 Deployment date: ${deploymentTime.toISOString()}`)
    logger.info(`   ⏱️  Time difference: ${timeDifferenceMinutes} minutes (threshold: 30)`)

    // Get reviews
    const reviews = await getPullRequestReviews(owner, repo, prNumber)
    const reviewers = reviews.map((r) => ({ username: r.user?.login || 'unknown', state: r.state }))

    // Get merge commit SHA
    const commitSha = pr.merge_commit_sha || ''
    const mergedBy = pr.merged_by?.login

    return {
      success: true,
      data: {
        commitSha,
        commitMessage: pr.title,
        commitDate: prMergedAt,
        commitAuthor: pr.user?.login || 'unknown',
        prNumber,
        prTitle: pr.title,
        prUrl: pr.html_url,
        prMergedAt,
        prAuthor: pr.user?.login,
        mergedBy,
        reviewers,
        timeDifferenceMinutes,
        isWithinThreshold,
      },
    }
  } catch (error) {
    logger.error(`Error looking up PR #${prNumber}:`, error)
    return {
      success: false,
      error: `Kunne ikke finne PR: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
    }
  }
}
