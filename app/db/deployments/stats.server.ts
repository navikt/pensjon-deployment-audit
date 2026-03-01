import { NOT_APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { pool } from '../connection.server'
import type { AppDeploymentStats } from '../deployments.server'

export async function getAppDeploymentStats(
  monitoredAppId: number,
  startDate?: Date,
  endDate?: Date,
  auditStartYear?: number | null,
): Promise<AppDeploymentStats> {
  let sql = `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN has_four_eyes = true THEN 1 ELSE 0 END) as with_four_eyes,
      SUM(CASE WHEN four_eyes_status = ANY($2) THEN 1 ELSE 0 END) as without_four_eyes,
      SUM(CASE WHEN four_eyes_status = ANY($3) THEN 1 ELSE 0 END) as pending_verification,
      MAX(created_at) as last_deployment,
      (SELECT id FROM deployments WHERE monitored_app_id = $1 ORDER BY created_at DESC LIMIT 1) as last_deployment_id
    FROM deployments
    WHERE monitored_app_id = $1`

  const params: any[] = [monitoredAppId, NOT_APPROVED_STATUSES, PENDING_STATUSES]
  let paramIndex = 4

  // Filter by audit start year if specified
  if (auditStartYear) {
    sql += ` AND EXTRACT(YEAR FROM created_at) >= $${paramIndex}`
    params.push(auditStartYear)
    paramIndex++
  }

  if (startDate) {
    sql += ` AND created_at >= $${paramIndex}`
    params.push(startDate)
    paramIndex++
  }

  if (endDate) {
    sql += ` AND created_at <= $${paramIndex}`
    params.push(endDate)
  }

  const result = await pool.query(sql, params)

  const row = result.rows[0]
  const total = parseInt(row.total, 10) || 0
  const withFourEyes = parseInt(row.with_four_eyes, 10) || 0
  const percentage = total > 0 ? Math.round((withFourEyes / total) * 100) : 0

  return {
    total,
    with_four_eyes: withFourEyes,
    without_four_eyes: parseInt(row.without_four_eyes, 10) || 0,
    pending_verification: parseInt(row.pending_verification, 10) || 0,
    last_deployment: row.last_deployment ? new Date(row.last_deployment) : null,
    last_deployment_id: row.last_deployment_id ? parseInt(row.last_deployment_id, 10) : null,
    four_eyes_percentage: percentage,
  }
}

/**
 * Get deployment stats for multiple apps in a single query
 * Returns a Map of appId -> AppDeploymentStats
 */
export async function getAppDeploymentStatsBatch(
  apps: Array<{ id: number; audit_start_year?: number | null }>,
): Promise<Map<number, AppDeploymentStats>> {
  if (apps.length === 0) {
    return new Map()
  }

  const appIds = apps.map((a) => a.id)

  // Build the audit year filter as a CASE expression
  const auditYearCases = apps
    .filter((a) => a.audit_start_year)
    .map((a) => `WHEN monitored_app_id = ${a.id} THEN EXTRACT(YEAR FROM created_at) >= ${a.audit_start_year}`)
    .join(' ')

  const auditYearFilter = auditYearCases ? `AND (CASE ${auditYearCases} ELSE true END)` : ''

  const result = await pool.query(
    `SELECT 
      monitored_app_id,
      COUNT(*) as total,
      SUM(CASE WHEN has_four_eyes = true THEN 1 ELSE 0 END) as with_four_eyes,
      SUM(CASE WHEN four_eyes_status = ANY($2) THEN 1 ELSE 0 END) as without_four_eyes,
      SUM(CASE WHEN four_eyes_status = ANY($3) THEN 1 ELSE 0 END) as pending_verification,
      MAX(created_at) as last_deployment
    FROM deployments
    WHERE monitored_app_id = ANY($1) ${auditYearFilter}
    GROUP BY monitored_app_id`,
    [appIds, NOT_APPROVED_STATUSES, PENDING_STATUSES],
  )

  // Get last deployment IDs in a separate query for simplicity
  const lastDeploymentResult = await pool.query(
    `SELECT DISTINCT ON (monitored_app_id) monitored_app_id, id
     FROM deployments
     WHERE monitored_app_id = ANY($1)
     ORDER BY monitored_app_id, created_at DESC`,
    [appIds],
  )

  const lastDeploymentIds = new Map<number, number>()
  for (const row of lastDeploymentResult.rows) {
    lastDeploymentIds.set(row.monitored_app_id, row.id)
  }

  const statsMap = new Map<number, AppDeploymentStats>()

  // Initialize with empty stats for all apps
  for (const app of apps) {
    statsMap.set(app.id, {
      total: 0,
      with_four_eyes: 0,
      without_four_eyes: 0,
      pending_verification: 0,
      last_deployment: null,
      last_deployment_id: lastDeploymentIds.get(app.id) || null,
      four_eyes_percentage: 0,
    })
  }

  // Fill in actual stats
  for (const row of result.rows) {
    const appId = row.monitored_app_id
    const total = parseInt(row.total, 10) || 0
    const withFourEyes = parseInt(row.with_four_eyes, 10) || 0
    const percentage = total > 0 ? Math.round((withFourEyes / total) * 100) : 0

    statsMap.set(appId, {
      total,
      with_four_eyes: withFourEyes,
      without_four_eyes: parseInt(row.without_four_eyes, 10) || 0,
      pending_verification: parseInt(row.pending_verification, 10) || 0,
      last_deployment: row.last_deployment ? new Date(row.last_deployment) : null,
      last_deployment_id: lastDeploymentIds.get(appId) || null,
      four_eyes_percentage: percentage,
    })
  }

  return statsMap
}
