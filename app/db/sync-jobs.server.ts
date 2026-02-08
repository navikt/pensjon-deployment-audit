import { pool } from './connection.server'

// =============================================================================
// Sync Job Types and Statuses
// =============================================================================

export const SYNC_JOB_TYPES = ['nais_sync', 'github_verify', 'fetch_verification_data', 'reverify_app'] as const
export type SyncJobType = (typeof SYNC_JOB_TYPES)[number]

export const SYNC_JOB_TYPE_LABELS: Record<SyncJobType, string> = {
  nais_sync: 'NAIS Sync',
  github_verify: 'GitHub Verifisering',
  fetch_verification_data: 'Hent verifiseringsdata',
  reverify_app: 'Reverifisering',
}

export const SYNC_JOB_STATUSES = ['pending', 'running', 'completed', 'failed'] as const
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number]

export const SYNC_JOB_STATUS_LABELS: Record<SyncJobStatus, string> = {
  pending: 'Venter',
  running: 'Kjører',
  completed: 'Fullført',
  failed: 'Feilet',
}

export interface SyncJob {
  id: number
  job_type: SyncJobType
  monitored_app_id: number
  status: SyncJobStatus
  started_at: string | null
  completed_at: string | null
  locked_by: string | null
  lock_expires_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
}

// Get pod identifier from environment or generate one
const POD_ID = process.env.HOSTNAME || `local-${process.pid}`

/**
 * Release expired locks - should be called periodically
 */
export async function releaseExpiredLocks(): Promise<number> {
  const result = await pool.query(
    `UPDATE sync_jobs 
     SET status = 'failed', 
         error = 'Lock timeout - automatically released',
         completed_at = NOW()
     WHERE status = 'running' AND lock_expires_at < NOW()
     RETURNING id`,
  )
  return result.rowCount || 0
}

/**
 * Try to acquire a lock for a sync job
 * Returns job ID if successful, null if lock is already held
 */
export async function acquireSyncLock(
  jobType: SyncJobType,
  appId: number,
  timeoutMinutes: number = 10,
): Promise<number | null> {
  // First: Release any expired locks
  const released = await releaseExpiredLocks()
  if (released > 0) {
    console.log(`🔓 Released ${released} expired lock(s)`)
  }

  // Try to create a new job with lock
  try {
    const result = await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at)
       VALUES ($1, $2, 'running', NOW(), $3, NOW() + INTERVAL '1 minute' * $4)
       RETURNING id`,
      [jobType, appId, POD_ID, timeoutMinutes],
    )
    console.log(`🔒 Acquired ${jobType} lock for app ${appId} (job ${result.rows[0].id})`)
    return result.rows[0].id
  } catch (e: unknown) {
    // Unique constraint violation = lock already held
    if (e instanceof Error && 'code' in e && e.code === '23505') {
      console.log(`⏳ ${jobType} lock for app ${appId} already held by another process`)
      return null
    }
    throw e
  }
}

/**
 * Release a sync job lock
 */
export async function releaseSyncLock(
  jobId: number,
  status: 'completed' | 'failed',
  result?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await pool.query(
    `UPDATE sync_jobs 
     SET status = $2, 
         completed_at = NOW(),
         result = $3,
         error = $4
     WHERE id = $1`,
    [jobId, status, result ? JSON.stringify(result) : null, error || null],
  )
  console.log(`🔓 Released lock for job ${jobId} with status ${status}`)
}

/**
 * Clean up old sync jobs (keep last N per app)
 */
export async function cleanupOldSyncJobs(keepPerApp: number = 50): Promise<number> {
  const result = await pool.query(
    `DELETE FROM sync_jobs 
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY monitored_app_id ORDER BY created_at DESC) as rn
         FROM sync_jobs
       ) ranked
       WHERE rn <= $1
     )
     RETURNING id`,
    [keepPerApp],
  )
  return result.rowCount || 0
}

export interface SyncJobWithApp extends SyncJob {
  app_name: string
  team_slug: string
  environment_name: string
}

/**
 * Get all sync jobs with app information for admin view
 */
export async function getAllSyncJobs(filters?: {
  status?: SyncJobStatus
  jobType?: SyncJobType
  limit?: number
}): Promise<SyncJobWithApp[]> {
  const whereClauses: string[] = []
  const params: (string | number)[] = []
  let paramIndex = 1

  if (filters?.status) {
    whereClauses.push(`sj.status = $${paramIndex}`)
    params.push(filters.status)
    paramIndex++
  }

  if (filters?.jobType) {
    whereClauses.push(`sj.job_type = $${paramIndex}`)
    params.push(filters.jobType)
    paramIndex++
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const limit = filters?.limit || 100

  const result = await pool.query(
    `SELECT 
       sj.*,
       ma.app_name,
       ma.team_slug,
       ma.environment_name
     FROM sync_jobs sj
     JOIN monitored_applications ma ON sj.monitored_app_id = ma.id
     ${whereClause}
     ORDER BY sj.created_at DESC
     LIMIT $${paramIndex}`,
    [...params, limit],
  )
  return result.rows
}

/**
 * Get sync job stats
 */
export async function getSyncJobStats(): Promise<{
  total: number
  running: number
  completed: number
  failed: number
  lastHour: number
}> {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour
    FROM sync_jobs
  `)
  return {
    total: parseInt(result.rows[0].total, 10),
    running: parseInt(result.rows[0].running, 10),
    completed: parseInt(result.rows[0].completed, 10),
    failed: parseInt(result.rows[0].failed, 10),
    lastHour: parseInt(result.rows[0].last_hour, 10),
  }
}

/**
 * Get the latest job of a specific type for an app
 */
export async function getLatestSyncJob(appId: number, jobType: SyncJobType): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, created_at
     FROM sync_jobs
     WHERE monitored_app_id = $1 AND job_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [appId, jobType],
  )
  return result.rows[0] || null
}

/**
 * Get a sync job by ID
 */
export async function getSyncJobById(jobId: number): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, created_at
     FROM sync_jobs
     WHERE id = $1`,
    [jobId],
  )
  return result.rows[0] || null
}
