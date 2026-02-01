import { pool } from './connection.server'

export interface RepositoryAlert {
  id: number
  monitored_app_id: number
  deployment_id: number
  alert_type: string
  expected_github_owner: string
  expected_github_repo_name: string
  detected_github_owner: string
  detected_github_repo_name: string
  resolved: boolean
  resolved_at: Date | null
  resolved_by: string | null
  resolution_note: string | null
  created_at: Date
}

export interface RepositoryAlertWithContext extends RepositoryAlert {
  team_slug: string
  environment_name: string
  app_name: string
  deployment_nais_id: string
  deployment_created_at: Date
  deployer_username: string
  commit_sha: string
}

export async function getAllUnresolvedAlerts(): Promise<RepositoryAlertWithContext[]> {
  const result = await pool.query(
    `SELECT 
      ra.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      d.nais_deployment_id as deployment_nais_id,
      d.created_at as deployment_created_at,
      d.deployer_username,
      d.commit_sha
    FROM repository_alerts ra
    JOIN monitored_applications ma ON ra.monitored_app_id = ma.id
    JOIN deployments d ON ra.deployment_id = d.id
    WHERE ra.resolved_at IS NULL
    ORDER BY ra.created_at DESC`,
  )
  return result.rows
}

// Alias for convenience
export const getUnresolvedAlertsWithContext = getAllUnresolvedAlerts
export const getUnresolvedAlerts = getAllUnresolvedAlerts

export async function getAlertsByMonitoredApp(monitoredAppId: number): Promise<RepositoryAlertWithContext[]> {
  const result = await pool.query(
    `SELECT 
      ra.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      d.created_at as deployment_created_at,
      d.deployer_username,
      d.commit_sha
    FROM repository_alerts ra
    JOIN monitored_applications ma ON ra.monitored_app_id = ma.id
    JOIN deployments d ON ra.deployment_id = d.id
    WHERE ra.monitored_app_id = $1
    ORDER BY ra.created_at DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function getAlertById(id: number): Promise<RepositoryAlertWithContext | null> {
  const result = await pool.query(
    `SELECT 
      ra.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      d.created_at as deployment_created_at,
      d.deployer_username,
      d.commit_sha
    FROM repository_alerts ra
    JOIN monitored_applications ma ON ra.monitored_app_id = ma.id
    JOIN deployments d ON ra.deployment_id = d.id
    WHERE ra.id = $1`,
    [id],
  )
  return result.rows[0] || null
}

export async function createRepositoryAlert(data: {
  monitoredApplicationId: number
  deploymentNaisId: string
  detectedGithubOwner: string
  detectedGithubRepoName: string
  expectedGithubOwner?: string
  expectedGithubRepoName?: string
  alertType?: string
}): Promise<RepositoryAlert> {
  // First, find the deployment ID from nais_deployment_id
  const depResult = await pool.query('SELECT id, monitored_app_id FROM deployments WHERE nais_deployment_id = $1', [
    data.deploymentNaisId,
  ])

  if (depResult.rows.length === 0) {
    throw new Error(`Deployment not found with nais_deployment_id: ${data.deploymentNaisId}`)
  }

  const deployment = depResult.rows[0]

  // Use provided expected repo or default to detected (for pending/historical alerts)
  const expectedOwner = data.expectedGithubOwner || data.detectedGithubOwner
  const expectedRepoName = data.expectedGithubRepoName || data.detectedGithubRepoName
  const alertType = data.alertType || 'repository_mismatch'

  const result = await pool.query(
    `INSERT INTO repository_alerts 
      (monitored_app_id, deployment_id, alert_type, expected_github_owner, expected_github_repo_name, detected_github_owner, detected_github_repo_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING
    RETURNING *`,
    [
      deployment.monitored_app_id,
      deployment.id,
      alertType,
      expectedOwner,
      expectedRepoName,
      data.detectedGithubOwner,
      data.detectedGithubRepoName,
    ],
  )
  return result.rows[0]
}

export async function resolveAlert(id: number, resolvedBy: string, resolutionNote: string): Promise<RepositoryAlert> {
  const result = await pool.query(
    `UPDATE repository_alerts 
    SET resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2, resolution_note = $3
    WHERE id = $1
    RETURNING *`,
    [id, resolvedBy, resolutionNote],
  )

  if (result.rows.length === 0) {
    throw new Error('Alert not found')
  }

  return result.rows[0]
}

// Simpler version without requiring resolved_by
export async function resolveRepositoryAlert(id: number, resolutionNote: string): Promise<RepositoryAlert> {
  return resolveAlert(id, 'web-user', resolutionNote)
}

export async function getAlertStats(): Promise<{
  total: number
  unresolved: number
  resolved: number
}> {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN resolved = false THEN 1 END) as unresolved,
      COUNT(CASE WHEN resolved = true THEN 1 END) as resolved
    FROM repository_alerts
  `)
  return {
    total: parseInt(result.rows[0].total, 10),
    unresolved: parseInt(result.rows[0].unresolved, 10),
    resolved: parseInt(result.rows[0].resolved, 10),
  }
}

export async function getAlertCountsByApp(): Promise<Map<number, number>> {
  const result = await pool.query(`
    SELECT monitored_app_id, COUNT(*) as count
    FROM repository_alerts
    WHERE resolved_at IS NULL
    GROUP BY monitored_app_id
  `)
  const map = new Map<number, number>()
  for (const row of result.rows) {
    map.set(row.monitored_app_id, parseInt(row.count, 10))
  }
  return map
}

export async function getUnresolvedAlertsByApp(monitoredAppId: number): Promise<RepositoryAlertWithContext[]> {
  const result = await pool.query(
    `SELECT 
      ra.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      d.nais_deployment_id as deployment_nais_id,
      d.created_at as deployment_created_at,
      d.deployer_username,
      d.commit_sha
    FROM repository_alerts ra
    JOIN monitored_applications ma ON ra.monitored_app_id = ma.id
    JOIN deployments d ON ra.deployment_id = d.id
    WHERE ra.resolved_at IS NULL AND ra.monitored_app_id = $1
    ORDER BY ra.created_at DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function resolveAlertsForLegacyDeployments(): Promise<{
  deploymentsUpdated: number
  alertsResolved: number
}> {
  // Calculate one year ago
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  // First, update deployments that should now be considered legacy
  const deploymentResult = await pool.query(
    `UPDATE deployments
     SET 
       has_four_eyes = true,
       four_eyes_status = 'legacy'
     WHERE created_at < $1
       AND commit_sha IS NULL
       AND four_eyes_status != 'legacy'
     RETURNING id`,
    [oneYearAgo],
  )

  // Then resolve any alerts for these legacy deployments
  const alertResult = await pool.query(
    `UPDATE repository_alerts ra
     SET 
       resolved = true,
       resolved_at = CURRENT_TIMESTAMP,
       resolved_by = 'system',
       resolution_note = 'Legacy deployment (eldre enn 1 år, mangler commit SHA) - automatisk løst'
     FROM deployments d
     WHERE ra.deployment_id = d.id
       AND ra.resolved_at IS NULL
       AND d.created_at < $1
       AND d.commit_sha IS NULL
     RETURNING ra.id`,
    [oneYearAgo],
  )

  return {
    deploymentsUpdated: deploymentResult.rowCount || 0,
    alertsResolved: alertResult.rowCount || 0,
  }
}
