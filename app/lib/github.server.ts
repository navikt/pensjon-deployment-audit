import { Octokit } from '@octokit/rest'
import type { GitHubPRData } from '~/db/deployments.server'

let octokit: Octokit | null = null
let requestCount = 0

export function getGitHubRequestCount(): number {
  return requestCount
}

export function resetGitHubRequestCount(): void {
  requestCount = 0
}

export function getGitHubClient(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN

    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is not set')
    }

    octokit = new Octokit({
      auth: token,
      log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error,
      },
    })

    // Add request hook for logging
    octokit.hook.before('request', (options) => {
      requestCount++
      const method = options.method || 'GET'
      const url = options.url?.replace('https://api.github.com', '') || options.baseUrl
      console.log(`🌐 [GitHub #${requestCount}] ${method} ${url}`)
    })

    // Add response hook for rate limit info
    octokit.hook.after('request', (response, _options) => {
      const remaining = response.headers['x-ratelimit-remaining']
      const limit = response.headers['x-ratelimit-limit']
      if (remaining && parseInt(remaining, 10) < 100) {
        console.warn(`⚠️  GitHub rate limit: ${remaining}/${limit} remaining`)
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

export interface NavIdentity {
  github_username: string
  nav_username: string | null
  nav_email: string | null
  display_name: string | null
}

// Cache for SAML identities to avoid repeated API calls
const samlIdentityCache = new Map<string, NavIdentity>()

/**
 * Get Nav identity for a GitHub user via SAML SSO
 * Requires org:read or admin:org scope on the token
 */
export async function getNavIdentityForGitHubUser(
  githubUsername: string,
  org: string = 'navikt',
): Promise<NavIdentity> {
  // Check cache first
  const cached = samlIdentityCache.get(githubUsername)
  if (cached) {
    return cached
  }

  const client = getGitHubClient()

  try {
    // Try to get SAML identity via org membership
    // This requires the token to have org:read or admin:org scope
    const response = await client.request('GET /orgs/{org}/members/{username}', {
      org,
      username: githubUsername,
    })

    // The SAML identity is in the response if the org uses SAML SSO
    // @ts-expect-error - SAML fields not in types
    const samlIdentity = response.data?.saml_identity
    // @ts-expect-error - email/name might be in response
    const email = samlIdentity?.email || response.data?.email || null
    // @ts-expect-error - name might be in response
    const name = response.data?.name || null

    const identity: NavIdentity = {
      github_username: githubUsername,
      nav_username: samlIdentity?.username || null,
      nav_email: email,
      display_name: name,
    }

    samlIdentityCache.set(githubUsername, identity)
    console.log(`👤 SAML identity for ${githubUsername}: ${identity.nav_username || 'not found'}`)

    return identity
  } catch (error) {
    // If we can't get SAML identity, return what we have
    console.log(
      `⚠️  Could not get SAML identity for ${githubUsername}: ${error instanceof Error ? error.message : 'unknown error'}`,
    )

    const identity: NavIdentity = {
      github_username: githubUsername,
      nav_username: null,
      nav_email: null,
      display_name: null,
    }

    samlIdentityCache.set(githubUsername, identity)
    return identity
  }
}

/**
 * Get Nav identities for multiple GitHub users (batch)
 */
export async function getNavIdentitiesForGitHubUsers(
  githubUsernames: string[],
  org: string = 'navikt',
): Promise<Map<string, NavIdentity>> {
  const results = new Map<string, NavIdentity>()

  for (const username of githubUsernames) {
    const identity = await getNavIdentityForGitHubUser(username, org)
    results.set(username, identity)
  }

  return results
}

export async function getPullRequestForCommit(
  owner: string,
  repo: string,
  sha: string,
  verifyCommitIsInPR: boolean = false,
): Promise<PullRequest | null> {
  const client = getGitHubClient()

  try {
    console.log(`🔎 Searching for PRs associated with commit ${sha} in ${owner}/${repo}`)

    const response = await client.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: sha,
    })

    console.log(`📊 Found ${response.data.length} PR(s) associated with commit ${sha}`)

    if (response.data.length === 0) {
      console.log(`❌ No PRs found for commit ${sha}`)
      return null
    }

    // Log all PRs found
    response.data.forEach((pr, index) => {
      console.log(
        `   PR ${index + 1}: #${pr.number} - ${pr.title} (${pr.state}, merged: ${pr.merged_at ? 'yes' : 'no'})`,
      )
    })

    // When verifyCommitIsInPR is true, we need to check that the commit is actually
    // part of the PR's original commits, not just reachable via merge from main.
    // This is important to detect commits pushed directly to main that get
    // "smuggled" into a PR when the PR merges main into its branch.
    if (verifyCommitIsInPR) {
      for (const pr of response.data) {
        // Only check merged PRs
        if (!pr.merged_at) continue

        // Fetch the PR's commits
        try {
          const prCommitsResponse = await client.pulls.listCommits({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          })

          // Check if our commit is in the PR's commit list
          const isInPR = prCommitsResponse.data.some((c) => c.sha === sha)

          if (isInPR) {
            console.log(`✅ Commit ${sha.substring(0, 7)} is an original commit in PR #${pr.number}`)
            return {
              number: pr.number,
              title: pr.title,
              html_url: pr.html_url,
              merged_at: pr.merged_at,
              state: pr.state,
            }
          } else {
            console.log(
              `⚠️  Commit ${sha.substring(0, 7)} is NOT in PR #${pr.number}'s original commits (likely merged from main)`,
            )
          }
        } catch (err) {
          console.warn(`Could not fetch commits for PR #${pr.number}:`, err)
        }
      }

      // None of the associated PRs contain this commit as an original commit
      console.log(`❌ Commit ${sha.substring(0, 7)} was not an original commit in any associated PR`)
      return null
    }

    // Return the first (most relevant) PR (default behavior for backward compatibility)
    const pr = response.data[0]
    console.log(`✅ Using PR #${pr.number} for verification`)

    return {
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      merged_at: pr.merged_at,
      state: pr.state,
    }
  } catch (error) {
    console.error(`❌ Error fetching PR for commit ${sha}:`, error)

    // Re-throw rate limit errors so they can be handled properly upstream
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw error
    }

    return null
  }
}

export interface PullRequestReview {
  id: number
  user: {
    login: string
  } | null
  state: string
  submitted_at: string | null
}

export async function getPullRequestReviews(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<PullRequestReview[]> {
  const client = getGitHubClient()

  const response = await client.pulls.listReviews({
    owner,
    repo,
    pull_number,
  })

  return response.data as PullRequestReview[]
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

  const response = await client.pulls.listCommits({
    owner,
    repo,
    pull_number,
    per_page: 100,
  })

  return response.data as PullRequestCommit[]
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
    console.log(`🔍 Verifying four-eyes for PR #${pull_number} in ${owner}/${repo}`)

    const client = getGitHubClient()

    // Fetch PR details to check creator
    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number,
    })

    const prCreator = prResponse.data.user?.login || ''
    const isDependabotPR = prCreator === 'dependabot[bot]' || prCreator.includes('dependabot')

    console.log(`   🤖 PR creator: ${prCreator} (Dependabot: ${isDependabotPR})`)

    const [reviews, commits] = await Promise.all([
      getPullRequestReviews(owner, repo, pull_number),
      getPullRequestCommits(owner, repo, pull_number),
    ])

    console.log(`   📝 Found ${reviews.length} review(s) and ${commits.length} commit(s)`)

    if (commits.length === 0) {
      console.log(`   ❌ No commits found in PR`)
      return { hasFourEyes: false, reason: 'No commits found in PR' }
    }

    // Get the timestamp of the last commit
    const lastCommit = commits[commits.length - 1]
    const lastCommitDate = new Date(lastCommit.commit.author.date)
    console.log(`   📅 Last commit: ${lastCommit.sha.substring(0, 7)} at ${lastCommitDate.toISOString()}`)
    console.log(`   📝 Last commit message: ${lastCommit.commit.message.split('\n')[0].substring(0, 80)}`)

    // Find approved reviews that came after the last commit
    const approvedReviewsAfterLastCommit = reviews.filter((review) => {
      if (review.state !== 'APPROVED' || !review.submitted_at) {
        return false
      }
      const reviewDate = new Date(review.submitted_at)
      return reviewDate > lastCommitDate
    })

    console.log(`   ✅ ${approvedReviewsAfterLastCommit.length} approved review(s) after last commit`)

    if (approvedReviewsAfterLastCommit.length > 0) {
      const result = {
        hasFourEyes: true,
        reason: `Approved by ${approvedReviewsAfterLastCommit[0].user?.login || 'unknown'} after last commit`,
      }
      console.log(`   ✅ Result: ${result.reason}`)
      return result
    }

    // Check if there are any approved reviews (even before last commit)
    const approvedReviews = reviews.filter((r) => r.state === 'APPROVED')
    console.log(`   ✅ ${approvedReviews.length} total approved review(s) found`)

    if (approvedReviews.length === 0) {
      console.log(`   ❌ No approved reviews found`)
      return { hasFourEyes: false, reason: 'No approved reviews found' }
    }

    // Find the most recent approved review
    const mostRecentApproval = approvedReviews.reduce((latest, current) => {
      const currentDate = new Date(current.submitted_at || 0)
      const latestDate = new Date(latest.submitted_at || 0)
      return currentDate > latestDate ? current : latest
    })

    const approvalDate = new Date(mostRecentApproval.submitted_at || 0)
    console.log(
      `   📅 Most recent approval: ${mostRecentApproval.user?.login || 'unknown'} at ${approvalDate.toISOString()}`,
    )

    // Get all commits that came after the approval
    const commitsAfterApproval = commits.filter((commit) => {
      const commitDate = new Date(commit.commit.author.date)
      return commitDate > approvalDate
    })

    console.log(`   📊 ${commitsAfterApproval.length} commit(s) after most recent approval`)

    if (commitsAfterApproval.length === 0) {
      // This shouldn't happen since we already checked approvedReviewsAfterLastCommit
      console.log(`   ✅ Approval was after last commit`)
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
      console.log(
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

      console.log(`   🤖 All commits after approval are by Dependabot or main merges: ${allCommitsAreBotOrMainMerge}`)

      if (allCommitsAreBotOrMainMerge) {
        const result = {
          hasFourEyes: true,
          reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'}, Dependabot PR with bot commits after approval`,
        }
        console.log(`   ✅ Result: ${result.reason}`)
        return result
      }
    }

    // Check if ALL commits after approval are merges from main/master
    const allCommitsAreMainMerges = commitsAfterApproval.every((commit) => isMergeFromMainBranch(commit))

    console.log(`   🔀 All commits after approval are main/master merges: ${allCommitsAreMainMerges}`)

    if (allCommitsAreMainMerges) {
      const result = {
        hasFourEyes: true,
        reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'}, only main/master merges after approval`,
      }
      console.log(`   ✅ Result: ${result.reason}`)
      return result
    }

    // There are commits after approval that are not merges from main
    const result = {
      hasFourEyes: false,
      reason: 'Approved review exists but came before the last commit (non-merge commits after approval)',
    }
    console.log(`   ❌ Result: ${result.reason}`)
    return result
  } catch (error) {
    console.error('Error verifying PR four eyes:', error)
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

    // Fetch reviews
    const reviewsResponse = await client.pulls.listReviews({
      owner,
      repo,
      pull_number,
    })

    // Group reviews by user (latest review per user)
    const reviewsByUser = new Map<
      string,
      { username: string; avatar_url: string; state: string; submitted_at: string }
    >()

    for (const review of reviewsResponse.data) {
      if (review.user && review.submitted_at) {
        const existing = reviewsByUser.get(review.user.login)
        // Keep the latest review from each user
        if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
          reviewsByUser.set(review.user.login, {
            username: review.user.login,
            avatar_url: review.user.avatar_url,
            state: review.state,
            submitted_at: review.submitted_at,
          })
        }
      }
    }

    // Fetch check runs details
    let checks_passed: boolean | null = null
    const checks: Array<{
      name: string
      status: string
      conclusion: string | null
      started_at: string | null
      completed_at: string | null
      html_url: string | null
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
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            started_at: check.started_at,
            completed_at: check.completed_at,
            html_url: check.html_url,
          })
        }
      }
    } catch (error) {
      console.warn('Could not fetch check runs:', error)
    }

    // Fetch commits
    const commitsResponse = await client.pulls.listCommits({
      owner,
      repo,
      pull_number,
      per_page: 100,
    })

    const commits = commitsResponse.data.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        username: commit.author?.login || commit.commit.author?.name || 'unknown',
        avatar_url: commit.author?.avatar_url || '',
      },
      date: commit.commit.author?.date || '',
      html_url: commit.html_url,
    }))

    return {
      title: pr.title,
      body: pr.body,
      labels: pr.labels.map((label) => (typeof label === 'string' ? label : label.name || '')),
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      base_branch: pr.base.ref,
      base_sha: pr.base.sha,
      commits_count: pr.commits,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      draft: pr.draft || false,
      creator: {
        username: pr.user?.login || 'unknown',
        avatar_url: pr.user?.avatar_url || '',
      },
      merger: pr.merged_by
        ? {
            username: pr.merged_by.login,
            avatar_url: pr.merged_by.avatar_url,
          }
        : null,
      reviewers: Array.from(reviewsByUser.values()),
      checks_passed,
      checks,
      commits,
    }
  } catch (error) {
    console.error('Error fetching detailed PR info:', error)
    return null
  }
}

/**
 * Get branch name from GitHub Actions workflow run URL
 * Example URL: https://github.com/navikt/pensjon-pen/actions/runs/21433252772
 */
export async function getBranchFromWorkflowRun(triggerUrl: string): Promise<string | null> {
  try {
    // Parse workflow run ID from URL
    const match = triggerUrl.match(/\/actions\/runs\/(\d+)/)
    if (!match) {
      console.warn(`Could not extract workflow run ID from URL: ${triggerUrl}`)
      return null
    }

    const runId = parseInt(match[1], 10)

    // Extract owner/repo from URL
    const repoMatch = triggerUrl.match(/github\.com\/([^/]+)\/([^/]+)\//)
    if (!repoMatch) {
      console.warn(`Could not extract owner/repo from URL: ${triggerUrl}`)
      return null
    }

    const [, owner, repo] = repoMatch
    const client = getGitHubClient()

    console.log(`🔍 Fetching workflow run ${runId} for ${owner}/${repo}`)

    const response = await client.actions.getWorkflowRun({
      owner,
      repo,
      run_id: runId,
    })

    console.log(`✅ Workflow run branch: ${response.data.head_branch}`)
    return response.data.head_branch
  } catch (error) {
    console.error('Error fetching workflow run:', error)
    return null
  }
}

/**
 * Get commit details including parent commits for merge commits
 */
export async function getCommitDetails(
  owner: string,
  repo: string,
  sha: string,
): Promise<{
  parents: Array<{ sha: string }>
  message: string
} | null> {
  try {
    const client = getGitHubClient()

    console.log(`🔍 Fetching commit details for ${sha} in ${owner}/${repo}`)

    const response = await client.repos.getCommit({
      owner,
      repo,
      ref: sha,
    })

    const parents = response.data.parents.map((p) => ({ sha: p.sha }))

    console.log(`✅ Commit has ${parents.length} parent(s)`)
    if (parents.length > 1) {
      console.log(`   🔀 Merge commit with parents: ${parents.map((p) => p.sha.substring(0, 7)).join(', ')}`)
    }

    return {
      parents,
      message: response.data.commit.message,
    }
  } catch (error) {
    console.error(`Error fetching commit details for ${sha}:`, error)
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

    console.log(`🔍 Comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)} in ${owner}/${repo}`)

    const response = await client.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    })

    console.log(`   📊 GitHub API response:`)
    console.log(`      - Status: ${response.data.status}`)
    console.log(`      - Ahead by: ${response.data.ahead_by} commits`)
    console.log(`      - Behind by: ${response.data.behind_by} commits`)
    console.log(`      - Total commits: ${response.data.total_commits}`)

    // Handle case where commits array might be undefined or empty
    const rawCommits = response.data.commits || []
    console.log(`      - Commits array length: ${rawCommits.length}`)

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

    console.log(`✅ Found ${commits.length} commit(s) between ${base.substring(0, 7)} and ${head.substring(0, 7)}`)

    if (commits.length > 0 && commits.length <= 10) {
      console.log(`   📝 Commits:`)
      commits.forEach((c, idx) => {
        console.log(
          `      ${idx + 1}. ${c.sha.substring(0, 7)} by ${c.author}: ${c.message.split('\n')[0].substring(0, 50)}`,
        )
      })
    }

    return commits
  } catch (error) {
    console.error(`❌ Error comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)}:`, error)
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`)
    }
    return null
  }
}

/**
 * DEPRECATED: Use between-deployment verification instead
 * Check if commits in a merge are all from approved PRs
 * Returns list of unreviewed commits (if any)
 * @param prBranchTip - Tip of PR branch before merge
 * @param mainBeforeMerge - Main branch tip before merge
 * @param prCommitShas - SHAs of commits in the PR being merged
 * @param currentPrNumber - PR number being merged (to avoid checking same PR twice)
 */
export async function findUnreviewedCommitsInMerge(
  owner: string,
  repo: string,
  prBranchTip: string,
  mainBeforeMerge: string,
  prCommitShas: string[],
  currentPrNumber?: number,
): Promise<
  Array<{
    sha: string
    message: string
    author: string
    date: string
    html_url: string
    reason: string
  }>
> {
  try {
    console.log(`🔍 Checking for unreviewed commits between PR branch and main`)
    console.log(`   PR branch tip: ${prBranchTip.substring(0, 7)}`)
    console.log(`   Main before merge: ${mainBeforeMerge.substring(0, 7)}`)
    if (currentPrNumber) {
      console.log(`   Current PR being merged: #${currentPrNumber}`)
    }

    // Get commits on main that are not in PR branch
    const commitsBetween = await getCommitsBetween(owner, repo, prBranchTip, mainBeforeMerge)

    if (!commitsBetween) {
      console.warn('   ⚠️  Could not fetch commits between PR branch and main')
      return []
    }

    console.log(`   📊 Found ${commitsBetween.length} commit(s) on main not in PR branch (before merge)`)

    // Filter out commits that are in the PR itself (edge case: cherry-picks, rebases)
    const commitsNotInPR = commitsBetween.filter((commit) => !prCommitShas.includes(commit.sha))

    console.log(`   🔎 ${commitsNotInPR.length} commit(s) to check for approval (after excluding PR commits)`)

    const unreviewedCommits: Array<{
      sha: string
      message: string
      author: string
      date: string
      html_url: string
      reason: string
    }> = []

    // Cache for PR approvals to avoid checking same PR multiple times
    const prApprovalCache = new Map<number, { hasFourEyes: boolean; reason: string }>()
    const prCheckedCount = new Map<number, number>() // Track how many commits per PR

    // Check each commit that's not in the PR
    for (const commit of commitsNotInPR) {
      // Check if this commit has an associated PR where it's an original commit
      // Using verifyCommitIsInPR=true to detect commits pushed directly to main
      const commitPR = await getPullRequestForCommit(owner, repo, commit.sha, true)

      if (!commitPR) {
        console.log(`   🔍 Commit ${commit.sha.substring(0, 7)}: ${commit.message.split('\n')[0].substring(0, 60)}`)
        console.log(`      ❌ No PR found (or not an original PR commit) - marking as unreviewed`)
        unreviewedCommits.push({
          ...commit,
          reason: 'Direct push to main (no PR)',
        })
        continue
      }

      // Skip checking same PR we're already verifying (avoids infinite loop on merge commits)
      if (currentPrNumber && commitPR.number === currentPrNumber) {
        console.log(`   🔍 Commit ${commit.sha.substring(0, 7)}: belongs to current PR #${commitPR.number} - skipping`)
        continue
      }

      // Check cache first
      let prApproval = prApprovalCache.get(commitPR.number)
      const isFirstCheckOfThisPR = !prApproval

      if (isFirstCheckOfThisPR) {
        // First time seeing this PR - log and check it
        console.log(`   🔍 Commit ${commit.sha.substring(0, 7)}: ${commit.message.split('\n')[0].substring(0, 60)}`)
        console.log(`      📝 Found PR #${commitPR.number} - checking approval`)
        prApproval = await verifyPullRequestFourEyes(owner, repo, commitPR.number)
        prApprovalCache.set(commitPR.number, prApproval)
        prCheckedCount.set(commitPR.number, 1)
      } else {
        // Already checked this PR - just count it
        const count = prCheckedCount.get(commitPR.number) || 0
        prCheckedCount.set(commitPR.number, count + 1)
      }

      // prApproval is guaranteed to be defined here
      if (!prApproval?.hasFourEyes) {
        if (isFirstCheckOfThisPR) {
          console.log(`      ❌ PR #${commitPR.number} not approved - marking as unreviewed`)
        }
        unreviewedCommits.push({
          ...commit,
          reason: `PR #${commitPR.number} not approved: ${prApproval?.reason}`,
        })
      } else if (isFirstCheckOfThisPR) {
        console.log(`      ✅ PR #${commitPR.number} is approved`)
      }
    }

    // Log summary of cached checks
    const cachedPRs = Array.from(prCheckedCount.entries()).filter(([_, count]) => count > 1)
    if (cachedPRs.length > 0) {
      console.log(`   💾 Used cached results for ${cachedPRs.length} PR(s):`)
      for (const [prNumber, count] of cachedPRs) {
        console.log(`      PR #${prNumber}: ${count} commits (checked once, cached ${count - 1} times)`)
      }
    }

    if (unreviewedCommits.length > 0) {
      console.log(`   ⚠️  Found ${unreviewedCommits.length} unreviewed commit(s)`)
    } else {
      console.log(`   ✅ All commits on main (not in PR branch) are from approved PRs`)
    }

    return unreviewedCommits
  } catch (error) {
    console.error('Error finding unreviewed commits:', error)
    return []
  }
}
