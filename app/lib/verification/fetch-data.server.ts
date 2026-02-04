/**
 * Fetch Verification Data
 *
 * This module handles fetching all data needed for verification.
 * Flow: GitHub API → Database → VerificationInput
 *
 * Key features:
 * - Checks database for cached data first
 * - Fetches from GitHub only if needed (outdated schema or forced refresh)
 * - Stores all fetched data to database before returning
 * - Handles GitHub retention (404/410) gracefully
 */

import { pool } from '~/db/connection.server'
import {
  getAllLatestPrSnapshots,
  getLatestCommitSnapshot,
  markPrDataUnavailable,
  saveCommitSnapshot,
  savePrSnapshotsBatch,
} from '~/db/github-data.server'
import { getCommitsBetween, getDetailedPullRequestInfo, getPullRequestForCommit } from '~/lib/github.server'
import {
  CURRENT_SCHEMA_VERSION,
  type ImplicitApprovalSettings,
  type PrCommit,
  type PrMetadata,
  type PrReview,
  type VerificationInput,
} from './types'

// =============================================================================
// Main Fetch Function
// =============================================================================

export interface FetchOptions {
  forceRefresh?: boolean
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
}

/**
 * Fetch all data needed for verifying a deployment.
 * Always stores data to database before returning.
 */
export async function fetchVerificationData(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  baseBranch: string,
  monitoredAppId: number,
  options?: FetchOptions,
): Promise<VerificationInput> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}`)
  }

  // Get app settings
  const appSettings = await getAppSettings(monitoredAppId)

  // Get previous deployment
  const previousDeployment = await getPreviousDeployment(
    deploymentId,
    owner,
    repo,
    environmentName,
    appSettings.auditStartYear,
  )

  // Get deployed commit's PR
  const deployedPr = await fetchDeployedPrData(owner, repo, commitSha, baseBranch, options)

  // Get commits between deployments
  let commitsBetween: VerificationInput['commitsBetween'] = []
  if (previousDeployment) {
    commitsBetween = await fetchCommitsBetween(
      owner,
      repo,
      previousDeployment.commitSha,
      commitSha,
      baseBranch,
      previousDeployment.createdAt,
      options,
    )
  }

  return {
    deploymentId,
    commitSha,
    repository,
    environmentName,
    baseBranch,
    auditStartYear: appSettings.auditStartYear,
    implicitApprovalSettings: appSettings.implicitApprovalSettings,
    previousDeployment,
    deployedPr,
    commitsBetween,
    dataFreshness: {
      deployedPrFetchedAt: deployedPr ? new Date() : null,
      commitsFetchedAt: commitsBetween.length > 0 ? new Date() : null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
  }
}

// =============================================================================
// App Settings
// =============================================================================

async function getAppSettings(monitoredAppId: number): Promise<{
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings
}> {
  const result = await pool.query(
    `SELECT 
       ma.audit_start_year,
       COALESCE(aps.implicit_approval_mode, 'off') as implicit_approval_mode
     FROM monitored_applications ma
     LEFT JOIN app_settings aps ON aps.monitored_app_id = ma.id
     WHERE ma.id = $1`,
    [monitoredAppId],
  )

  if (result.rows.length === 0) {
    return {
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off', requireMergerDifferentFromAuthor: true },
    }
  }

  const row = result.rows[0]
  return {
    auditStartYear: row.audit_start_year,
    implicitApprovalSettings: {
      mode: row.implicit_approval_mode || 'off',
      requireMergerDifferentFromAuthor: true,
    },
  }
}

// =============================================================================
// Previous Deployment
// =============================================================================

async function getPreviousDeployment(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  environmentName: string,
  auditStartYear: number | null,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.id < $1
      AND ma.environment_name = $2
      AND d.detected_github_owner = $3
      AND d.detected_github_repo_name = $4
      AND d.commit_sha IS NOT NULL
  `
  const params: (number | string)[] = [currentDeploymentId, environmentName, owner, repo]

  if (auditStartYear) {
    query += ` AND d.created_at >= $5`
    params.push(`${auditStartYear}-01-01`)
  }

  query += ` ORDER BY d.created_at DESC LIMIT 1`

  const result = await pool.query(query, params)

  if (result.rows.length === 0) {
    return null
  }

  return {
    id: result.rows[0].id,
    commitSha: result.rows[0].commit_sha,
    createdAt: result.rows[0].created_at.toISOString(),
  }
}

// =============================================================================
// PR Data Fetching
// =============================================================================

async function fetchDeployedPrData(
  owner: string,
  repo: string,
  commitSha: string,
  baseBranch: string,
  options?: FetchOptions,
): Promise<VerificationInput['deployedPr']> {
  // First, find PR number for this commit
  const prNumber = await findPrForCommit(owner, repo, commitSha, baseBranch)
  if (!prNumber) {
    return null
  }

  // Check if we have cached data
  if (!options?.forceRefresh) {
    const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

    if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
      const metadata = cachedData.get('metadata')?.data as PrMetadata
      const reviews = cachedData.get('reviews')?.data as PrReview[]
      const commits = cachedData.get('commits')?.data as PrCommit[]

      return {
        number: prNumber,
        url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        metadata,
        reviews,
        commits,
      }
    }
  }

  // Fetch from GitHub
  const { metadata, reviews, commits } = await fetchPrFromGitHub(owner, repo, prNumber)

  // Store to database
  await savePrSnapshotsBatch(owner, repo, prNumber, [
    { dataType: 'metadata', data: metadata },
    { dataType: 'reviews', data: reviews },
    { dataType: 'commits', data: commits },
  ])

  return {
    number: prNumber,
    url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    metadata,
    reviews,
    commits,
  }
}

async function findPrForCommit(
  owner: string,
  repo: string,
  commitSha: string,
  baseBranch?: string,
): Promise<number | null> {
  // First check our cached PR associations
  const cached = await getLatestCommitSnapshot(owner, repo, commitSha, 'prs')
  if (cached && cached.schemaVersion >= CURRENT_SCHEMA_VERSION) {
    const prs = (cached.data as { prs: Array<{ number: number; baseBranch: string }> }).prs
    // Filter by base branch if specified
    const matchingPrs = baseBranch ? prs.filter((pr) => pr.baseBranch === baseBranch) : prs
    if (matchingPrs.length > 0) {
      return matchingPrs[0].number
    }
  }

  // Fetch from GitHub API
  const prInfo = await getPullRequestForCommit(owner, repo, commitSha, true, baseBranch)

  if (prInfo) {
    // Store the result to database for future lookups
    await saveCommitSnapshot(owner, repo, commitSha, 'prs', {
      prs: [{ number: prInfo.number, baseBranch: baseBranch || 'unknown' }],
    })
    return prInfo.number
  }

  // No PR found - also cache this negative result
  await saveCommitSnapshot(owner, repo, commitSha, 'prs', { prs: [] })
  return null
}

async function fetchPrFromGitHub(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{
  metadata: PrMetadata
  reviews: PrReview[]
  commits: PrCommit[]
}> {
  const prData = await getDetailedPullRequestInfo(owner, repo, prNumber)

  if (!prData) {
    throw new Error(`Failed to fetch PR #${prNumber} from ${owner}/${repo}`)
  }

  // Transform to our schema types
  const metadata: PrMetadata = {
    number: prNumber,
    title: prData.title,
    body: prData.body || null,
    state: prData.merged_at ? 'closed' : 'open',
    merged: !!prData.merged_at,
    draft: prData.draft,
    createdAt: prData.created_at,
    updatedAt: prData.created_at, // Not available in getDetailedPullRequestInfo
    mergedAt: prData.merged_at || null,
    closedAt: prData.merged_at || null,
    baseBranch: prData.base_branch,
    baseSha: prData.base_sha,
    headBranch: prData.head_branch,
    headSha: prData.head_sha,
    mergeCommitSha: prData.merge_commit_sha || null,
    author: {
      username: prData.creator.username,
      avatarUrl: prData.creator.avatar_url,
    },
    mergedBy: prData.merged_by
      ? {
          username: prData.merged_by.username,
          avatarUrl: prData.merged_by.avatar_url,
        }
      : null,
    labels: prData.labels,
    commitsCount: prData.commits_count,
    changedFiles: prData.changed_files,
    additions: prData.additions,
    deletions: prData.deletions,
  }

  const reviews: PrReview[] = prData.reviewers.map((r, index) => ({
    id: index + 1, // GitHub doesn't provide review ID in this response
    username: r.username,
    state: r.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED',
    submittedAt: r.submitted_at,
    body: null,
  }))

  const commits: PrCommit[] = prData.commits.map((c) => ({
    sha: c.sha,
    message: c.message,
    authorUsername: c.author.username,
    authorDate: c.date,
    committerDate: c.date,
    isMergeCommit: false,
    parentShas: [],
  }))

  return { metadata, reviews, commits }
}

// =============================================================================
// Commits Between Deployments
// =============================================================================

async function fetchCommitsBetween(
  owner: string,
  repo: string,
  fromSha: string,
  toSha: string,
  baseBranch: string,
  _previousDeploymentDate: string,
  options?: FetchOptions,
): Promise<VerificationInput['commitsBetween']> {
  // Fetch commits between the two SHAs from GitHub
  const commitsRaw = await getCommitsBetween(owner, repo, fromSha, toSha)

  if (!commitsRaw) {
    console.warn(`Could not fetch commits between ${fromSha} and ${toSha}`)
    return []
  }

  // Store each commit to database
  for (const commit of commitsRaw) {
    await saveCommitSnapshot(owner, repo, commit.sha, 'metadata', {
      sha: commit.sha,
      message: commit.message,
      authorUsername: commit.author,
      authorDate: commit.date,
      committerUsername: commit.author,
      committerDate: commit.committer_date,
      parentShas: commit.parent_shas,
      isMergeCommit: commit.parents_count > 1,
      htmlUrl: commit.html_url,
    })
  }

  // For each commit, find its associated PR
  const result: VerificationInput['commitsBetween'] = []

  for (const commit of commitsRaw) {
    const prNumber = await findPrForCommit(owner, repo, commit.sha, baseBranch)

    let prData: VerificationInput['commitsBetween'][0]['pr'] = null

    if (prNumber && !options?.forceRefresh) {
      // Try to get PR data from cache first
      const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

      if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
        const metadata = cachedData.get('metadata')?.data as PrMetadata
        const reviews = cachedData.get('reviews')?.data as PrReview[]
        const prCommits = cachedData.get('commits')?.data as PrCommit[]

        prData = {
          number: prNumber,
          title: metadata.title,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          reviews,
          commits: prCommits,
          baseBranch: metadata.baseBranch,
        }
      }
    }

    if (prNumber && !prData) {
      // Fetch from GitHub
      try {
        const { metadata, reviews, commits: prCommits } = await fetchPrFromGitHub(owner, repo, prNumber)

        // Store to database
        await savePrSnapshotsBatch(owner, repo, prNumber, [
          { dataType: 'metadata', data: metadata },
          { dataType: 'reviews', data: reviews },
          { dataType: 'commits', data: prCommits },
        ])

        prData = {
          number: prNumber,
          title: metadata.title,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          reviews,
          commits: prCommits,
          baseBranch: metadata.baseBranch,
        }
      } catch (error) {
        console.warn(`Failed to fetch PR #${prNumber} for commit ${commit.sha}:`, error)
      }
    }

    result.push({
      sha: commit.sha,
      message: commit.message,
      authorUsername: commit.author,
      authorDate: commit.date,
      isMergeCommit: commit.parents_count > 1,
      parentShas: commit.parent_shas,
      htmlUrl: commit.html_url,
      pr: prData,
    })
  }

  return result
}

// =============================================================================
// GitHub API Integration (to be connected)
// =============================================================================

/**
 * These functions will be connected to the existing github.server.ts module.
 * They handle the actual GitHub API calls and error handling.
 */

export async function refreshPrData(
  owner: string,
  repo: string,
  prNumber: number,
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[],
): Promise<void> {
  const typesToFetch = dataTypes ?? ['metadata', 'reviews', 'commits']

  try {
    // Fetch from GitHub
    const { metadata, reviews, commits } = await fetchPrFromGitHub(owner, repo, prNumber)

    // Store to database
    const snapshots: Array<{ dataType: 'metadata' | 'reviews' | 'commits'; data: unknown }> = []

    if (typesToFetch.includes('metadata')) {
      snapshots.push({ dataType: 'metadata', data: metadata })
    }
    if (typesToFetch.includes('reviews')) {
      snapshots.push({ dataType: 'reviews', data: reviews })
    }
    if (typesToFetch.includes('commits')) {
      snapshots.push({ dataType: 'commits', data: commits })
    }

    await savePrSnapshotsBatch(owner, repo, prNumber, snapshots)
  } catch (error) {
    // Handle GitHub 404/410 - data no longer available
    if (error instanceof Error && (error.message.includes('404') || error.message.includes('410'))) {
      for (const dataType of typesToFetch) {
        await markPrDataUnavailable(owner, repo, prNumber, dataType)
      }
    }
    throw error
  }
}
