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
  getLatestPrSnapshot,
  markPrDataUnavailable,
  saveCommitSnapshot,
  savePrSnapshotsBatch,
} from '~/db/github-data.server'
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
  const deployedPr = await fetchDeployedPrData(owner, repo, commitSha, options)

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
  options?: FetchOptions,
): Promise<VerificationInput['deployedPr']> {
  // First, find PR number for this commit
  const prNumber = await findPrForCommit(owner, repo, commitSha)
  if (!prNumber) {
    return null
  }

  // Check if we have cached data
  if (!options?.forceRefresh) {
    const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

    if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
      const metadata = cachedData.get('metadata')!.data as PrMetadata
      const reviews = cachedData.get('reviews')!.data as PrReview[]
      const commits = cachedData.get('commits')!.data as PrCommit[]

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

async function findPrForCommit(owner: string, repo: string, commitSha: string): Promise<number | null> {
  // First check our cached PR associations
  const cached = await getLatestCommitSnapshot(owner, repo, commitSha, 'prs')
  if (cached) {
    const prs = (cached.data as { prs: Array<{ number: number }> }).prs
    if (prs.length > 0) {
      return prs[0].number
    }
  }

  // Fetch from GitHub
  // Note: This uses the GitHub API to find PRs associated with a commit
  // For now, return null - this will be connected to github.server.ts
  // TODO: Implement actual GitHub API call
  return null
}

async function fetchPrFromGitHub(
  _owner: string,
  _repo: string,
  _prNumber: number,
): Promise<{
  metadata: PrMetadata
  reviews: PrReview[]
  commits: PrCommit[]
}> {
  // TODO: Implement actual GitHub API calls
  // This will connect to getDetailedPullRequestInfo from github.server.ts
  throw new Error('Not implemented - connect to github.server.ts')
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
  previousDeploymentDate: string,
  options?: FetchOptions,
): Promise<VerificationInput['commitsBetween']> {
  // TODO: Implement fetching commits between two SHAs
  // 1. Check database cache for commit list
  // 2. If not cached or forceRefresh, fetch from GitHub
  // 3. Store to database
  // 4. For each commit, check if it has an associated PR
  // 5. Return enriched commit data

  // Placeholder implementation
  return []
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
