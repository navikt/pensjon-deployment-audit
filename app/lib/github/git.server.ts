import { logger } from '~/lib/logger.server'
import { getGitHubClient } from './client.server'

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
 * Check if a commit SHA exists on a given branch.
 * Uses the compare API: if the branch is identical to or ahead of the commit,
 * the commit is reachable from the branch.
 *
 * Returns null on API error (fail-open: caller should treat as unknown).
 */
export async function isCommitOnBranch(
  owner: string,
  repo: string,
  commitSha: string,
  branch: string,
): Promise<boolean | null> {
  try {
    const client = getGitHubClient()

    const response = await client.repos.compareCommits({
      owner,
      repo,
      base: commitSha,
      head: branch,
    })

    // If branch is identical or ahead of commit, the commit is on the branch
    const status = response.data.status
    return status === 'identical' || status === 'ahead'
  } catch (error) {
    logger.warn(
      `⚠️ Failed to check if ${commitSha.substring(0, 7)} is on ${branch} in ${owner}/${repo}:`,
      error as Record<string, unknown>,
    )
    return null
  }
}
