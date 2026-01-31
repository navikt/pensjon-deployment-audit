import { pool } from './connection.server'

export type SyncJobType = 'nais_sync' | 'github_verify'
export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed'

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
 * Check if a job is currently running for an app
 */
export async function isJobRunning(jobType: SyncJobType, appId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM sync_jobs 
     WHERE job_type = $1 
       AND monitored_app_id = $2 
       AND status = 'running'
       AND lock_expires_at > NOW()`,
    [jobType, appId],
  )
  return (result.rowCount || 0) > 0
}

/**
 * Get recent sync jobs for an app
 */
export async function getRecentSyncJobs(appId: number, limit: number = 10): Promise<SyncJob[]> {
  const result = await pool.query(
    `SELECT * FROM sync_jobs 
     WHERE monitored_app_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [appId, limit],
  )
  return result.rows
}

/**
 * Get the latest completed sync job for an app
 */
export async function getLatestCompletedJob(jobType: SyncJobType, appId: number): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT * FROM sync_jobs 
     WHERE job_type = $1 
       AND monitored_app_id = $2
       AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [jobType, appId],
  )
  return result.rows[0] || null
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
