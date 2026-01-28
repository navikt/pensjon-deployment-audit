import { pool } from './connection';

export interface Deployment {
  id: number;
  monitored_app_id: number;
  nais_deployment_id: string;
  created_at: Date;
  deployer_username: string | null;
  commit_sha: string | null;
  trigger_url: string | null;
  detected_github_owner: string;
  detected_github_repo_name: string;
  has_four_eyes: boolean;
  four_eyes_status: string;
  github_pr_number: number | null;
  github_pr_url: string | null;
  resources: any; // JSONB
  synced_at: Date;
}

export interface DeploymentWithApp extends Deployment {
  team_slug: string;
  environment_name: string;
  app_name: string;
  approved_github_owner: string;
  approved_github_repo_name: string;
}

export interface CreateDeploymentParams {
  monitoredApplicationId: number;
  naisDeploymentId: string;
  createdAt: Date;
  deployerUsername: string | null;
  commitSha: string | null;
  triggerUrl: string | null;
  detectedGithubOwner: string;
  detectedGithubRepoName: string;
  resources?: any;
}

export interface DeploymentFilters {
  monitored_app_id?: number;
  team_slug?: string;
  environment_name?: string;
  start_date?: Date;
  end_date?: Date;
  four_eyes_status?: string;
  only_missing_four_eyes?: boolean;
  only_repository_mismatch?: boolean;
}

export async function getAllDeployments(filters?: DeploymentFilters): Promise<DeploymentWithApp[]> {
  let sql = `
    SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.approved_github_owner,
      ma.approved_github_repo_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE 1=1
  `;
  const params: any[] = [];
  let paramIndex = 1;

  if (filters?.monitored_app_id) {
    sql += ` AND d.monitored_app_id = $${paramIndex}`;
    params.push(filters.monitored_app_id);
    paramIndex++;
  }

  if (filters?.team_slug) {
    sql += ` AND ma.team_slug = $${paramIndex}`;
    params.push(filters.team_slug);
    paramIndex++;
  }

  if (filters?.environment_name) {
    sql += ` AND ma.environment_name = $${paramIndex}`;
    params.push(filters.environment_name);
    paramIndex++;
  }

  if (filters?.start_date) {
    sql += ` AND d.created_at >= $${paramIndex}`;
    params.push(filters.start_date);
    paramIndex++;
  }

  if (filters?.end_date) {
    sql += ` AND d.created_at <= $${paramIndex}`;
    params.push(filters.end_date);
    paramIndex++;
  }

  if (filters?.four_eyes_status) {
    sql += ` AND d.four_eyes_status = $${paramIndex}`;
    params.push(filters.four_eyes_status);
    paramIndex++;
  }

  if (filters?.only_missing_four_eyes) {
    sql += ' AND d.has_four_eyes = false';
  }

  if (filters?.only_repository_mismatch) {
    sql += ` AND d.four_eyes_status = $${paramIndex}`;
    params.push('repository_mismatch');
    paramIndex++;
  }

  sql += ' ORDER BY d.created_at DESC';

  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getDeploymentById(id: number): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.approved_github_owner,
      ma.approved_github_repo_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getDeploymentByNaisId(naisDeploymentId: string): Promise<Deployment | null> {
  const result = await pool.query('SELECT * FROM deployments WHERE nais_deployment_id = $1', [
    naisDeploymentId,
  ]);
  return result.rows[0] || null;
}

export async function getDeploymentsByMonitoredApp(
  monitoredAppId: number,
  limit?: number
): Promise<Deployment[]> {
  let sql = 'SELECT * FROM deployments WHERE monitored_app_id = $1 ORDER BY created_at DESC';
  const params: any[] = [monitoredAppId];

  if (limit) {
    sql += ' LIMIT $2';
    params.push(limit);
  }

  const result = await pool.query(sql, params);
  return result.rows;
}

export async function createDeployment(data: CreateDeploymentParams): Promise<Deployment> {
  const result = await pool.query(
    `INSERT INTO deployments 
      (monitored_app_id, nais_deployment_id, created_at, deployer_username, commit_sha, trigger_url,
       detected_github_owner, detected_github_repo_name, resources)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (nais_deployment_id) 
    DO UPDATE SET
      resources = EXCLUDED.resources,
      synced_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      data.monitoredApplicationId,
      data.naisDeploymentId,
      data.createdAt,
      data.deployerUsername,
      data.commitSha,
      data.triggerUrl,
      data.detectedGithubOwner,
      data.detectedGithubRepoName,
      data.resources ? JSON.stringify(data.resources) : null,
    ]
  );
  return result.rows[0];
}

export async function getDeploymentStats(monitoredAppId?: number): Promise<{
  total: number;
  with_four_eyes: number;
  without_four_eyes: number;
  repository_mismatch: number;
  percentage: number;
}> {
  let sql = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN has_four_eyes = true THEN 1 END) as with_four_eyes,
      COUNT(CASE WHEN has_four_eyes = false THEN 1 END) as without_four_eyes,
      COUNT(CASE WHEN four_eyes_status = 'repository_mismatch' THEN 1 END) as repository_mismatch
    FROM deployments
  `;

  const params: any[] = [];
  if (monitoredAppId) {
    sql += ' WHERE monitored_app_id = $1';
    params.push(monitoredAppId);
  }

  const result = await pool.query(sql, params);
  const total = parseInt(result.rows[0].total);
  const withFourEyes = parseInt(result.rows[0].with_four_eyes);
  const percentage = total > 0 ? Math.round((withFourEyes / total) * 100) : 0;

  return {
    total,
    with_four_eyes: withFourEyes,
    without_four_eyes: parseInt(result.rows[0].without_four_eyes),
    repository_mismatch: parseInt(result.rows[0].repository_mismatch),
    percentage,
  };
}

export async function updateDeploymentFourEyes(
  deploymentId: number,
  data: {
    hasFourEyes: boolean;
    fourEyesStatus: string;
    githubPrNumber: number | null;
    githubPrUrl: string | null;
  }
): Promise<Deployment> {
  const result = await pool.query(
    `UPDATE deployments 
     SET has_four_eyes = $1,
         four_eyes_status = $2,
         github_pr_number = $3,
         github_pr_url = $4
     WHERE id = $5
     RETURNING *`,
    [data.hasFourEyes, data.fourEyesStatus, data.githubPrNumber, data.githubPrUrl, deploymentId]
  );

  if (result.rows.length === 0) {
    throw new Error('Deployment not found');
  }

  return result.rows[0];
}
