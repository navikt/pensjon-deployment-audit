import { pool } from './connection';

export interface MonitoredApplication {
  id: number;
  team_slug: string;
  environment_name: string;
  app_name: string;
  approved_github_owner: string;
  approved_github_repo_name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function getAllMonitoredApplications(): Promise<MonitoredApplication[]> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE is_active = true ORDER BY team_slug, environment_name, app_name'
  );
  return result.rows;
}

export async function getMonitoredApplicationById(id: number): Promise<MonitoredApplication | null> {
  const result = await pool.query('SELECT * FROM monitored_applications WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getMonitoredApplicationsByTeam(teamSlug: string): Promise<MonitoredApplication[]> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE team_slug = $1 AND is_active = true ORDER BY environment_name, app_name',
    [teamSlug]
  );
  return result.rows;
}

export async function getMonitoredApplicationByIdentity(
  teamSlug: string,
  environmentName: string,
  appName: string
): Promise<MonitoredApplication | null> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE team_slug = $1 AND environment_name = $2 AND app_name = $3',
    [teamSlug, environmentName, appName]
  );
  return result.rows[0] || null;
}

export async function createMonitoredApplication(data: {
  team_slug: string;
  environment_name: string;
  app_name: string;
  approved_github_owner: string;
  approved_github_repo_name: string;
}): Promise<MonitoredApplication> {
  const result = await pool.query(
    `INSERT INTO monitored_applications 
      (team_slug, environment_name, app_name, approved_github_owner, approved_github_repo_name)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (team_slug, environment_name, app_name) 
    DO UPDATE SET 
      approved_github_owner = EXCLUDED.approved_github_owner,
      approved_github_repo_name = EXCLUDED.approved_github_repo_name,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      data.team_slug,
      data.environment_name,
      data.app_name,
      data.approved_github_owner,
      data.approved_github_repo_name,
    ]
  );
  return result.rows[0];
}

export async function updateMonitoredApplication(
  id: number,
  data: {
    approved_github_owner?: string;
    approved_github_repo_name?: string;
    is_active?: boolean;
  }
): Promise<MonitoredApplication> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (data.approved_github_owner !== undefined) {
    updates.push(`approved_github_owner = $${paramCount++}`);
    values.push(data.approved_github_owner);
  }
  if (data.approved_github_repo_name !== undefined) {
    updates.push(`approved_github_repo_name = $${paramCount++}`);
    values.push(data.approved_github_repo_name);
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${paramCount++}`);
    values.push(data.is_active);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE monitored_applications SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Application not found');
  }

  return result.rows[0];
}

export async function deleteMonitoredApplication(id: number): Promise<void> {
  await pool.query('DELETE FROM monitored_applications WHERE id = $1', [id]);
}

export async function deactivateMonitoredApplication(id: number): Promise<MonitoredApplication> {
  const result = await pool.query(
    'UPDATE monitored_applications SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error('Application not found');
  }

  return result.rows[0];
}
