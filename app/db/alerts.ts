import { pool } from './connection';

export interface RepositoryAlert {
  id: number;
  monitored_app_id: number;
  deployment_id: number;
  alert_type: string;
  expected_github_owner: string;
  expected_github_repo_name: string;
  detected_github_owner: string;
  detected_github_repo_name: string;
  resolved: boolean;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: Date;
}

export interface RepositoryAlertWithContext extends RepositoryAlert {
  team_slug: string;
  environment_name: string;
  app_name: string;
  deployment_created_at: Date;
  deployer_username: string;
  commit_sha: string;
}

export async function getAllUnresolvedAlerts(): Promise<RepositoryAlertWithContext[]> {
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
    WHERE ra.resolved = false
    ORDER BY ra.created_at DESC`
  );
  return result.rows;
}

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
    [monitoredAppId]
  );
  return result.rows;
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
    [id]
  );
  return result.rows[0] || null;
}

export async function createRepositoryAlert(data: {
  monitored_app_id: number;
  deployment_id: number;
  alert_type: string;
  expected_github_owner: string;
  expected_github_repo_name: string;
  detected_github_owner: string;
  detected_github_repo_name: string;
}): Promise<RepositoryAlert> {
  const result = await pool.query(
    `INSERT INTO repository_alerts 
      (monitored_app_id, deployment_id, alert_type, expected_github_owner, expected_github_repo_name, detected_github_owner, detected_github_repo_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      data.monitored_app_id,
      data.deployment_id,
      data.alert_type,
      data.expected_github_owner,
      data.expected_github_repo_name,
      data.detected_github_owner,
      data.detected_github_repo_name,
    ]
  );
  return result.rows[0];
}

export async function resolveAlert(
  id: number,
  resolvedBy: string,
  resolutionNote: string
): Promise<RepositoryAlert> {
  const result = await pool.query(
    `UPDATE repository_alerts 
    SET resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = $2, resolution_note = $3
    WHERE id = $1
    RETURNING *`,
    [id, resolvedBy, resolutionNote]
  );

  if (result.rows.length === 0) {
    throw new Error('Alert not found');
  }

  return result.rows[0];
}

export async function getAlertStats(): Promise<{
  total: number;
  unresolved: number;
  resolved: number;
}> {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN resolved = false THEN 1 END) as unresolved,
      COUNT(CASE WHEN resolved = true THEN 1 END) as resolved
    FROM repository_alerts
  `);
  return {
    total: parseInt(result.rows[0].total),
    unresolved: parseInt(result.rows[0].unresolved),
    resolved: parseInt(result.rows[0].resolved),
  };
}
