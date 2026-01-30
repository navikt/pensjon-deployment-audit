import { pool } from './connection.server'

export interface UnverifiedCommit {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string // 'no_pr' | 'pr_not_approved' | 'pr_not_found'
}

export interface Deployment {
  id: number
  monitored_app_id: number
  nais_deployment_id: string
  created_at: Date
  deployer_username: string | null
  commit_sha: string | null
  trigger_url: string | null
  detected_github_owner: string
  detected_github_repo_name: string
  has_four_eyes: boolean
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_url: string | null
  github_pr_data: GitHubPRData | null
  branch_name: string | null
  parent_commits: Array<{ sha: string }> | null
  unverified_commits: UnverifiedCommit[] | null
  resources: any // JSONB
  synced_at: Date
}

export interface GitHubPRData {
  title: string
  body: string | null
  labels: string[]
  created_at: string
  merged_at: string | null
  base_branch: string
  base_sha: string // Base commit SHA that PR branched from
  commits_count: number
  changed_files: number
  additions: number
  deletions: number
  draft: boolean
  creator: {
    username: string
    avatar_url: string
  }
  merger: {
    username: string
    avatar_url: string
  } | null
  reviewers: Array<{
    username: string
    avatar_url: string
    state: string // 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'
    submitted_at: string
  }>
  checks_passed: boolean | null
  checks: Array<{
    name: string
    status: string // 'queued', 'in_progress', 'completed'
    conclusion: string | null // 'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral'
    started_at: string | null
    completed_at: string | null
    html_url: string | null
  }>
  commits: Array<{
    sha: string
    message: string
    author: {
      username: string
      avatar_url: string
    }
    date: string
    html_url: string
  }>
  unreviewed_commits?: Array<{
    sha: string
    message: string
    author: string
    date: string
    html_url: string
    reason: string // Why it's unreviewed: 'no_pr', 'pr_not_approved', etc
  }>
}

export interface DeploymentWithApp extends Deployment {
  team_slug: string
  environment_name: string
  app_name: string
}

export interface CreateDeploymentParams {
  monitoredApplicationId: number
  naisDeploymentId: string
  createdAt: Date
  deployerUsername: string | null
  commitSha: string | null
  triggerUrl: string | null
  detectedGithubOwner: string
  detectedGithubRepoName: string
  resources?: any
}

export interface DeploymentFilters {
  monitored_app_id?: number
  team_slug?: string
  environment_name?: string
  start_date?: Date
  end_date?: Date
  four_eyes_status?: string
  only_missing_four_eyes?: boolean
  only_repository_mismatch?: boolean
}

export async function getAllDeployments(filters?: DeploymentFilters): Promise<DeploymentWithApp[]> {
  let sql = `
    SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE 1=1
  `
  const params: any[] = []
  let paramIndex = 1

  if (filters?.monitored_app_id) {
    sql += ` AND d.monitored_app_id = $${paramIndex}`
    params.push(filters.monitored_app_id)
    paramIndex++
  }

  if (filters?.team_slug) {
    sql += ` AND ma.team_slug = $${paramIndex}`
    params.push(filters.team_slug)
    paramIndex++
  }

  if (filters?.environment_name) {
    sql += ` AND ma.environment_name = $${paramIndex}`
    params.push(filters.environment_name)
    paramIndex++
  }

  if (filters?.start_date) {
    sql += ` AND d.created_at >= $${paramIndex}`
    params.push(filters.start_date)
    paramIndex++
  }

  if (filters?.end_date) {
    sql += ` AND d.created_at <= $${paramIndex}`
    params.push(filters.end_date)
    paramIndex++
  }

  if (filters?.four_eyes_status) {
    sql += ` AND d.four_eyes_status = $${paramIndex}`
    params.push(filters.four_eyes_status)
    paramIndex++
  }

  if (filters?.only_missing_four_eyes) {
    sql += ' AND d.has_four_eyes = false'
  }

  if (filters?.only_repository_mismatch) {
    sql += ` AND d.four_eyes_status = $${paramIndex}`
    params.push('repository_mismatch')
    paramIndex++
  }

  sql += ' ORDER BY d.created_at DESC'

  const result = await pool.query(sql, params)
  return result.rows
}

export async function getDeploymentById(id: number): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.id = $1`,
    [id],
  )
  return result.rows[0] || null
}

export async function getDeploymentByNaisId(naisDeploymentId: string): Promise<Deployment | null> {
  const result = await pool.query('SELECT * FROM deployments WHERE nais_deployment_id = $1', [naisDeploymentId])
  return result.rows[0] || null
}

export async function getDeploymentsByMonitoredApp(monitoredAppId: number, limit?: number): Promise<Deployment[]> {
  let sql = 'SELECT * FROM deployments WHERE monitored_app_id = $1 ORDER BY created_at DESC'
  const params: any[] = [monitoredAppId]

  if (limit) {
    sql += ' LIMIT $2'
    params.push(limit)
  }

  const result = await pool.query(sql, params)
  return result.rows
}

export async function createDeployment(data: CreateDeploymentParams): Promise<Deployment> {
  // Check if this is a legacy deployment (before 2025-01-01) without commit SHA
  const legacyCutoffDate = new Date('2025-01-01T00:00:00Z')
  const isLegacyDeployment = data.createdAt < legacyCutoffDate && !data.commitSha

  const result = await pool.query(
    `INSERT INTO deployments 
      (monitored_app_id, nais_deployment_id, created_at, deployer_username, commit_sha, trigger_url,
       detected_github_owner, detected_github_repo_name, resources, has_four_eyes, four_eyes_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      isLegacyDeployment, // has_four_eyes = true for legacy
      isLegacyDeployment ? 'legacy' : 'pending', // four_eyes_status
    ],
  )
  return result.rows[0]
}

export async function getDeploymentStats(monitoredAppId?: number): Promise<{
  total: number
  with_four_eyes: number
  without_four_eyes: number
  repository_mismatch: number
  percentage: number
}> {
  let sql = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN has_four_eyes = true THEN 1 END) as with_four_eyes,
      COUNT(CASE WHEN has_four_eyes = false THEN 1 END) as without_four_eyes,
      COUNT(CASE WHEN four_eyes_status = 'repository_mismatch' THEN 1 END) as repository_mismatch
    FROM deployments
  `

  const params: any[] = []
  if (monitoredAppId) {
    sql += ' WHERE monitored_app_id = $1'
    params.push(monitoredAppId)
  }

  const result = await pool.query(sql, params)
  const total = parseInt(result.rows[0].total, 10)
  const withFourEyes = parseInt(result.rows[0].with_four_eyes, 10)
  const percentage = total > 0 ? Math.round((withFourEyes / total) * 100) : 0

  return {
    total,
    with_four_eyes: withFourEyes,
    without_four_eyes: parseInt(result.rows[0].without_four_eyes, 10),
    repository_mismatch: parseInt(result.rows[0].repository_mismatch, 10),
    percentage,
  }
}

export async function updateDeploymentFourEyes(
  deploymentId: number,
  data: {
    hasFourEyes: boolean
    fourEyesStatus: string
    githubPrNumber: number | null
    githubPrUrl: string | null
    githubPrData?: GitHubPRData | null
    branchName?: string | null
    parentCommits?: Array<{ sha: string }> | null
    unverifiedCommits?: UnverifiedCommit[] | null
  },
): Promise<Deployment> {
  const result = await pool.query(
    `UPDATE deployments 
     SET has_four_eyes = $1,
         four_eyes_status = $2,
         github_pr_number = $3,
         github_pr_url = $4,
         github_pr_data = $5,
         branch_name = $6,
         parent_commits = $7,
         unverified_commits = $8
     WHERE id = $9
     RETURNING *`,
    [
      data.hasFourEyes,
      data.fourEyesStatus,
      data.githubPrNumber,
      data.githubPrUrl,
      data.githubPrData ? JSON.stringify(data.githubPrData) : null,
      data.branchName || null,
      data.parentCommits ? JSON.stringify(data.parentCommits) : null,
      data.unverifiedCommits ? JSON.stringify(data.unverifiedCommits) : null,
      deploymentId,
    ],
  )

  if (result.rows.length === 0) {
    throw new Error('Deployment not found')
  }

  return result.rows[0]
}

/**
 * Get the deployment that happened before this one for the same repo/environment
 * Uses created_at for ordering (not id, which isn't guaranteed chronological)
 */
export async function getPreviousDeployment(
  currentDeploymentId: number,
  repoOwner: string,
  repoName: string,
  environmentName: string,
): Promise<Deployment | null> {
  const result = await pool.query(
    `SELECT prev_dep.* FROM deployments prev_dep
     CROSS JOIN deployments curr_dep
     JOIN monitored_applications ma ON prev_dep.monitored_app_id = ma.id
     WHERE prev_dep.detected_github_owner = $1
       AND prev_dep.detected_github_repo_name = $2
       AND ma.environment_name = $3
       AND curr_dep.id = $4
       AND prev_dep.created_at < curr_dep.created_at
       AND prev_dep.commit_sha IS NOT NULL
     ORDER BY prev_dep.created_at DESC
     LIMIT 1`,
    [repoOwner, repoName, environmentName, currentDeploymentId],
  )

  return result.rows[0] || null
}

/**
 * Get the next deployment (chronologically newer) for navigation
 * Next = deployment that happened AFTER this one (newer created_at)
 */
export async function getNextDeployment(
  currentDeploymentId: number,
  monitoredAppId: number,
): Promise<Deployment | null> {
  const result = await pool.query(
    `SELECT next_dep.* FROM deployments next_dep
     CROSS JOIN deployments curr_dep
     WHERE next_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND next_dep.created_at > curr_dep.created_at
     ORDER BY next_dep.created_at ASC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId],
  )

  return result.rows[0] || null
}

/**
 * Get the previous deployment (chronologically older) for navigation
 * Previous = deployment that happened BEFORE this one (older created_at)
 */
export async function getPreviousDeploymentForNav(
  currentDeploymentId: number,
  monitoredAppId: number,
): Promise<Deployment | null> {
  const result = await pool.query(
    `SELECT prev_dep.* FROM deployments prev_dep
     CROSS JOIN deployments curr_dep
     WHERE prev_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND prev_dep.created_at < curr_dep.created_at
     ORDER BY prev_dep.created_at DESC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId],
  )

  return result.rows[0] || null
}

export interface AppDeploymentStats {
  total: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  last_deployment: Date | null
  four_eyes_percentage: number
}

export async function getAppDeploymentStats(
  monitoredAppId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<AppDeploymentStats> {
  let sql = `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN has_four_eyes = true THEN 1 ELSE 0 END) as with_four_eyes,
      SUM(CASE WHEN has_four_eyes = false THEN 1 ELSE 0 END) as without_four_eyes,
      SUM(CASE WHEN four_eyes_status = 'pending' THEN 1 ELSE 0 END) as pending_verification,
      MAX(created_at) as last_deployment
    FROM deployments
    WHERE monitored_app_id = $1`

  const params: any[] = [monitoredAppId]
  let paramIndex = 2

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
    four_eyes_percentage: percentage,
  }
}
