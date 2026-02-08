/**
 * GitHub Data Storage Module
 *
 * Handles versioned, granular storage of GitHub data with history.
 * All GitHub API data flows through here before being used for verification.
 *
 * Key features:
 * - Schema versioning for data migration
 * - Historical snapshots (never overwrites, always appends)
 * - Granular data types (metadata, reviews, commits, etc.)
 * - GitHub retention handling (marks data as unavailable)
 */

import { pool } from '~/db/connection.server'
import {
  type CommitDataType,
  type CommitSnapshot,
  type CompareData,
  type CompareSnapshot,
  CURRENT_SCHEMA_VERSION,
  type PrDataType,
  type PrSnapshot,
} from '~/lib/verification/types'

// =============================================================================
// PR Snapshots
// =============================================================================

/**
 * Save a PR data snapshot to the database
 */
export async function savePrSnapshot(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
  data: unknown,
  options?: {
    source?: 'github' | 'cached'
    githubAvailable?: boolean
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_pr_snapshots 
       (owner, repo, pr_number, data_type, schema_version, data, source, github_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      owner,
      repo,
      prNumber,
      dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(data),
      options?.source ?? 'github',
      options?.githubAvailable ?? true,
    ],
  )
  return result.rows[0].id
}

/**
 * Get the latest snapshot for a PR data type
 * Returns null if no snapshot exists or if schema version is outdated
 */
export async function getLatestPrSnapshot(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
  options?: {
    requireCurrentSchema?: boolean
  },
): Promise<PrSnapshot | null> {
  const requireCurrent = options?.requireCurrentSchema ?? true

  const result = await pool.query(
    `SELECT id, owner, repo, pr_number, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_pr_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3 AND data_type = $4
       ${requireCurrent ? `AND schema_version = ${CURRENT_SCHEMA_VERSION}` : ''}
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, prNumber, dataType],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    prNumber: row.pr_number,
    dataType: row.data_type,
    schemaVersion: row.schema_version,
    fetchedAt: row.fetched_at,
    source: row.source,
    githubAvailable: row.github_available,
    data: row.data,
  }
}

/**
 * Get all snapshots for a PR data type (history)
 */
export async function getPrSnapshotHistory(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
  options?: {
    limit?: number
  },
): Promise<PrSnapshot[]> {
  const limit = options?.limit ?? 100

  const result = await pool.query(
    `SELECT id, owner, repo, pr_number, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_pr_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3 AND data_type = $4
     ORDER BY fetched_at DESC
     LIMIT $5`,
    [owner, repo, prNumber, dataType, limit],
  )

  return result.rows.map(
    (row: {
      id: number
      owner: string
      repo: string
      pr_number: number
      data_type: string
      schema_version: number
      fetched_at: Date
      source: string
      github_available: boolean
      data: unknown
    }) => ({
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      prNumber: row.pr_number,
      dataType: row.data_type as PrDataType,
      schemaVersion: row.schema_version,
      fetchedAt: row.fetched_at,
      source: row.source as 'github' | 'cached',
      githubAvailable: row.github_available,
      data: row.data,
    }),
  )
}

/**
 * Get all latest snapshots for a PR (all data types)
 */
export async function getAllLatestPrSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Map<PrDataType, PrSnapshot>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (data_type) 
            id, owner, repo, pr_number, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_pr_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3
       AND schema_version = $4
     ORDER BY data_type, fetched_at DESC`,
    [owner, repo, prNumber, CURRENT_SCHEMA_VERSION],
  )

  const snapshots = new Map<PrDataType, PrSnapshot>()
  for (const row of result.rows) {
    snapshots.set(row.data_type as PrDataType, {
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      prNumber: row.pr_number,
      dataType: row.data_type,
      schemaVersion: row.schema_version,
      fetchedAt: row.fetched_at,
      source: row.source,
      githubAvailable: row.github_available,
      data: row.data,
    })
  }
  return snapshots
}

/**
 * Save multiple PR snapshots in a batch
 */
export async function savePrSnapshotsBatch(
  owner: string,
  repo: string,
  prNumber: number,
  snapshots: Array<{ dataType: PrDataType; data: unknown }>,
): Promise<number[]> {
  if (snapshots.length === 0) return []

  const values: unknown[] = []
  const placeholders: string[] = []

  snapshots.forEach((snapshot, idx) => {
    const offset = idx * 7
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
    )
    values.push(
      owner,
      repo,
      prNumber,
      snapshot.dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(snapshot.data),
      'github',
    )
  })

  const result = await pool.query(
    `INSERT INTO github_pr_snapshots 
       (owner, repo, pr_number, data_type, schema_version, data, source)
     VALUES ${placeholders.join(', ')}
     RETURNING id`,
    values,
  )

  return result.rows.map((row: { id: number }) => row.id)
}

// =============================================================================
// Commit Snapshots
// =============================================================================

/**
 * Save a commit data snapshot to the database
 */
export async function saveCommitSnapshot(
  owner: string,
  repo: string,
  sha: string,
  dataType: CommitDataType,
  data: unknown,
  options?: {
    source?: 'github' | 'cached'
    githubAvailable?: boolean
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_commit_snapshots 
       (owner, repo, sha, data_type, schema_version, data, source, github_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      owner,
      repo,
      sha,
      dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(data),
      options?.source ?? 'github',
      options?.githubAvailable ?? true,
    ],
  )
  return result.rows[0].id
}

/**
 * Get the latest snapshot for a commit data type
 */
export async function getLatestCommitSnapshot(
  owner: string,
  repo: string,
  sha: string,
  dataType: CommitDataType,
  options?: {
    requireCurrentSchema?: boolean
  },
): Promise<CommitSnapshot | null> {
  const requireCurrent = options?.requireCurrentSchema ?? true

  const result = await pool.query(
    `SELECT id, owner, repo, sha, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_commit_snapshots
     WHERE owner = $1 AND repo = $2 AND sha = $3 AND data_type = $4
       ${requireCurrent ? `AND schema_version = ${CURRENT_SCHEMA_VERSION}` : ''}
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, sha, dataType],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    sha: row.sha,
    dataType: row.data_type,
    schemaVersion: row.schema_version,
    fetchedAt: row.fetched_at,
    source: row.source,
    githubAvailable: row.github_available,
    data: row.data,
  }
}

/**
 * Get all latest snapshots for a commit (all data types)
 */
export async function getAllLatestCommitSnapshots(
  owner: string,
  repo: string,
  sha: string,
): Promise<Map<CommitDataType, CommitSnapshot>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (data_type) 
            id, owner, repo, sha, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_commit_snapshots
     WHERE owner = $1 AND repo = $2 AND sha = $3
       AND schema_version = $4
     ORDER BY data_type, fetched_at DESC`,
    [owner, repo, sha, CURRENT_SCHEMA_VERSION],
  )

  const snapshots = new Map<CommitDataType, CommitSnapshot>()
  for (const row of result.rows) {
    snapshots.set(row.data_type as CommitDataType, {
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      sha: row.sha,
      dataType: row.data_type,
      schemaVersion: row.schema_version,
      fetchedAt: row.fetched_at,
      source: row.source,
      githubAvailable: row.github_available,
      data: row.data,
    })
  }
  return snapshots
}

/**
 * Save multiple commit snapshots in a batch
 */
export async function saveCommitSnapshotsBatch(
  snapshots: Array<{
    owner: string
    repo: string
    sha: string
    dataType: CommitDataType
    data: unknown
  }>,
): Promise<number[]> {
  if (snapshots.length === 0) return []

  const values: unknown[] = []
  const placeholders: string[] = []

  snapshots.forEach((snapshot, idx) => {
    const offset = idx * 7
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
    )
    values.push(
      snapshot.owner,
      snapshot.repo,
      snapshot.sha,
      snapshot.dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(snapshot.data),
      'github',
    )
  })

  const result = await pool.query(
    `INSERT INTO github_commit_snapshots 
       (owner, repo, sha, data_type, schema_version, data, source)
     VALUES ${placeholders.join(', ')}
     RETURNING id`,
    values,
  )

  return result.rows.map((row: { id: number }) => row.id)
}

// =============================================================================
// GitHub Retention Handling
// =============================================================================

/**
 * Mark PR data as unavailable from GitHub (404/410 response)
 * Copies the last known good data with github_available = false
 */
export async function markPrDataUnavailable(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
): Promise<void> {
  // Get the last known good data
  const lastGood = await getLatestPrSnapshot(owner, repo, prNumber, dataType, {
    requireCurrentSchema: false,
  })

  if (lastGood) {
    // Save a new snapshot marking it as unavailable
    await savePrSnapshot(owner, repo, prNumber, dataType, lastGood.data, {
      source: 'cached',
      githubAvailable: false,
    })
  }
}

/**
 * Mark commit data as unavailable from GitHub
 */
export async function markCommitDataUnavailable(
  owner: string,
  repo: string,
  sha: string,
  dataType: CommitDataType,
): Promise<void> {
  const lastGood = await getLatestCommitSnapshot(owner, repo, sha, dataType, {
    requireCurrentSchema: false,
  })

  if (lastGood) {
    await saveCommitSnapshot(owner, repo, sha, dataType, lastGood.data, {
      source: 'cached',
      githubAvailable: false,
    })
  }
}

// =============================================================================
// Verification Runs
// =============================================================================

/**
 * Save a verification run
 */
export async function saveVerificationRun(
  deploymentId: number,
  result: {
    hasFourEyes: boolean
    status: string
    result: unknown
  },
  snapshotIds: {
    prSnapshotIds: number[]
    commitSnapshotIds: number[]
  },
): Promise<number> {
  const queryResult = await pool.query(
    `INSERT INTO verification_runs 
       (deployment_id, schema_version, pr_snapshot_ids, commit_snapshot_ids, result, status, has_four_eyes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      deploymentId,
      CURRENT_SCHEMA_VERSION,
      snapshotIds.prSnapshotIds,
      snapshotIds.commitSnapshotIds,
      JSON.stringify(result.result),
      result.status,
      result.hasFourEyes,
    ],
  )
  return queryResult.rows[0].id
}

/**
 * Get the latest verification run for a deployment
 */
export async function getLatestVerificationRun(deploymentId: number): Promise<{
  id: number
  schemaVersion: number
  runAt: Date
  prSnapshotIds: number[]
  commitSnapshotIds: number[]
  result: unknown
  status: string
  hasFourEyes: boolean
} | null> {
  const result = await pool.query(
    `SELECT id, schema_version, run_at, pr_snapshot_ids, commit_snapshot_ids, 
            result, status, has_four_eyes
     FROM verification_runs
     WHERE deployment_id = $1
     ORDER BY run_at DESC
     LIMIT 1`,
    [deploymentId],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    runAt: row.run_at,
    prSnapshotIds: row.pr_snapshot_ids,
    commitSnapshotIds: row.commit_snapshot_ids,
    result: row.result,
    status: row.status,
    hasFourEyes: row.has_four_eyes,
  }
}

/**
 * Get verification run history for a deployment
 */
export async function getVerificationRunHistory(
  deploymentId: number,
  options?: { limit?: number },
): Promise<
  Array<{
    id: number
    schemaVersion: number
    runAt: Date
    status: string
    hasFourEyes: boolean
  }>
> {
  const limit = options?.limit ?? 10

  const result = await pool.query(
    `SELECT id, schema_version, run_at, status, has_four_eyes
     FROM verification_runs
     WHERE deployment_id = $1
     ORDER BY run_at DESC
     LIMIT $2`,
    [deploymentId, limit],
  )

  return result.rows.map(
    (row: { id: number; schema_version: number; run_at: Date; status: string; has_four_eyes: boolean }) => ({
      id: row.id,
      schemaVersion: row.schema_version,
      runAt: row.run_at,
      status: row.status,
      hasFourEyes: row.has_four_eyes,
    }),
  )
}

// =============================================================================
// Cleanup / Maintenance
// =============================================================================

/**
 * Delete old snapshots (keep only the latest N per PR/commit + data type)
 * Used for periodic maintenance to control database size
 */
export async function cleanupOldSnapshots(options?: {
  keepCount?: number
  olderThanDays?: number
}): Promise<{ prSnapshotsDeleted: number; commitSnapshotsDeleted: number }> {
  const keepCount = options?.keepCount ?? 5
  const olderThanDays = options?.olderThanDays ?? 90

  // Delete old PR snapshots
  const prResult = await pool.query(
    `DELETE FROM github_pr_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY owner, repo, pr_number, data_type 
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_pr_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  // Delete old commit snapshots
  const commitResult = await pool.query(
    `DELETE FROM github_commit_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY owner, repo, sha, data_type 
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_commit_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  return {
    prSnapshotsDeleted: prResult.rowCount ?? 0,
    commitSnapshotsDeleted: commitResult.rowCount ?? 0,
  }
}

// =============================================================================
// Compare Snapshots (commits between two SHAs)
// =============================================================================

/**
 * Save a compare snapshot (commits between two SHAs)
 */
export async function saveCompareSnapshot(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  data: CompareData,
  options?: {
    source?: 'github' | 'cached'
    githubAvailable?: boolean
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_compare_snapshots 
       (owner, repo, base_sha, head_sha, schema_version, data, source, github_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      owner,
      repo,
      baseSha,
      headSha,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(data),
      options?.source ?? 'github',
      options?.githubAvailable ?? true,
    ],
  )
  return result.rows[0].id
}

/**
 * Get the latest compare snapshot for a base/head SHA pair
 */
export async function getLatestCompareSnapshot(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  options?: {
    requireCurrentSchema?: boolean
  },
): Promise<CompareSnapshot | null> {
  const requireCurrent = options?.requireCurrentSchema ?? true

  const result = await pool.query(
    `SELECT id, owner, repo, base_sha, head_sha, schema_version, 
            fetched_at, source, github_available, data
     FROM github_compare_snapshots
     WHERE owner = $1 AND repo = $2 AND base_sha = $3 AND head_sha = $4
       ${requireCurrent ? `AND schema_version = ${CURRENT_SCHEMA_VERSION}` : ''}
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, baseSha, headSha],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    schemaVersion: row.schema_version,
    fetchedAt: row.fetched_at,
    source: row.source,
    githubAvailable: row.github_available,
    data: row.data,
  }
}

// =============================================================================
// Statistics
// =============================================================================

export interface GitHubDataStats {
  total: number
  withCurrentData: number
  withOutdatedData: number
  withoutData: number
}

/**
 * Get statistics on GitHub data coverage for an app's deployments
 * Based on current schema version
 */
export async function getGitHubDataStatsForApp(
  appId: number,
  auditStartYear?: number | null,
): Promise<GitHubDataStats> {
  // Get all deployments for the app (with optional audit start year filter)
  const deploymentsResult = await pool.query(
    `SELECT d.id, d.github_pr_number, d.commit_sha, d.detected_github_owner, d.detected_github_repo_name
     FROM deployments d
     WHERE d.monitored_app_id = $1
       ${auditStartYear ? `AND EXTRACT(YEAR FROM d.created_at) >= ${auditStartYear}` : ''}`,
    [appId],
  )

  const deployments = deploymentsResult.rows
  const total = deployments.length

  if (total === 0) {
    return { total: 0, withCurrentData: 0, withOutdatedData: 0, withoutData: 0 }
  }

  // Check which deployments have PR snapshots with current schema
  const prDeploymentIds = deployments
    .filter((d: { github_pr_number: number | null }) => d.github_pr_number)
    .map((d: { id: number }) => d.id)

  // Build lookup for PR snapshots
  const prSnapshotResult =
    prDeploymentIds.length > 0
      ? await pool.query(
          `SELECT DISTINCT ON (d.id) d.id, gps.schema_version
         FROM deployments d
         INNER JOIN github_pr_snapshots gps 
           ON gps.owner = d.detected_github_owner 
           AND gps.repo = d.detected_github_repo_name 
           AND gps.pr_number = d.github_pr_number
           AND gps.data_type = 'reviews'
         WHERE d.id = ANY($1)
         ORDER BY d.id, gps.fetched_at DESC`,
          [prDeploymentIds],
        )
      : { rows: [] }

  // Build lookup for commit snapshots (for non-PR deployments)
  const nonPrDeployments = deployments.filter(
    (d: { github_pr_number: number | null; commit_sha: string | null }) => !d.github_pr_number && d.commit_sha,
  )
  const commitLookup =
    nonPrDeployments.length > 0
      ? await pool.query(
          `SELECT DISTINCT ON (d.id) d.id, gcs.schema_version
         FROM deployments d
         INNER JOIN github_commit_snapshots gcs 
           ON gcs.owner = d.detected_github_owner 
           AND gcs.repo = d.detected_github_repo_name 
           AND gcs.sha = d.commit_sha
           AND gcs.data_type = 'prs_for_commit'
         WHERE d.id = ANY($1)
         ORDER BY d.id, gcs.fetched_at DESC`,
          [nonPrDeployments.map((d: { id: number }) => d.id)],
        )
      : { rows: [] }

  // Build maps
  const prSchemaMap = new Map<number, number>()
  for (const row of prSnapshotResult.rows) {
    prSchemaMap.set(row.id, row.schema_version)
  }

  const commitSchemaMap = new Map<number, number>()
  for (const row of commitLookup.rows) {
    commitSchemaMap.set(row.id, row.schema_version)
  }

  // Count categories
  let withCurrentData = 0
  let withOutdatedData = 0
  let withoutData = 0

  for (const d of deployments) {
    let schemaVersion: number | undefined

    if (d.github_pr_number) {
      schemaVersion = prSchemaMap.get(d.id)
    } else if (d.commit_sha) {
      schemaVersion = commitSchemaMap.get(d.id)
    }

    if (schemaVersion === undefined) {
      withoutData++
    } else if (schemaVersion >= CURRENT_SCHEMA_VERSION) {
      withCurrentData++
    } else {
      withOutdatedData++
    }
  }

  return { total, withCurrentData, withOutdatedData, withoutData }
}
