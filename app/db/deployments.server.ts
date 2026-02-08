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
  title: string | null
  slack_message_ts: string | null
  slack_channel_id: string | null
}

export interface GitHubPRData {
  title: string
  body: string | null
  labels: string[]
  created_at: string
  merged_at: string | null
  base_branch: string
  base_sha: string // Base commit SHA that PR branched from
  head_branch: string // PR branch name
  head_sha: string // Latest commit SHA in PR
  merge_commit_sha: string | null // SHA of merge/squash commit
  commits_count: number
  changed_files: number
  additions: number
  deletions: number
  comments_count: number
  review_comments_count: number
  draft: boolean
  mergeable: boolean | null
  mergeable_state: string | null // 'clean', 'dirty', 'blocked', 'behind', 'unstable'
  rebaseable: boolean | null
  locked: boolean
  maintainer_can_modify: boolean
  auto_merge: {
    enabled_by: string
    merge_method: string // 'merge', 'squash', 'rebase'
  } | null
  creator: {
    username: string
    avatar_url: string
  }
  merged_by: {
    username: string
    avatar_url: string
  } | null
  merger: {
    username: string
    avatar_url: string
  } | null
  assignees: Array<{
    username: string
    avatar_url: string
  }>
  requested_reviewers: Array<{
    username: string
    avatar_url: string
  }>
  requested_teams: Array<{
    name: string
    slug: string
  }>
  milestone: {
    title: string
    number: number
    state: string
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
  comments: Array<{
    id: number
    body: string
    user: {
      username: string
      avatar_url: string
    }
    created_at: string
    html_url: string
  }>
}

export interface DeploymentWithApp extends Deployment {
  team_slug: string
  environment_name: string
  app_name: string
  default_branch: string
}

export interface CreateDeploymentParams {
  monitoredApplicationId: number
  naisDeploymentId: string
  createdAt: Date
  teamSlug: string
  environmentName: string
  appName: string
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
  deployer_username?: string
  commit_sha?: string
  method?: 'pr' | 'direct_push' | 'legacy'
  page?: number
  per_page?: number
  audit_start_year?: number | null
}

export interface PaginatedDeployments {
  deployments: DeploymentWithApp[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export async function getAllDeployments(filters?: DeploymentFilters): Promise<DeploymentWithApp[]> {
  const result = await getDeploymentsPaginated(filters)
  return result.deployments
}

export async function getDeploymentsPaginated(filters?: DeploymentFilters): Promise<PaginatedDeployments> {
  let whereSql = ' WHERE 1=1'
  const params: any[] = []
  let paramIndex = 1

  if (filters?.monitored_app_id) {
    whereSql += ` AND d.monitored_app_id = $${paramIndex}`
    params.push(filters.monitored_app_id)
    paramIndex++
  }

  if (filters?.team_slug) {
    whereSql += ` AND ma.team_slug = $${paramIndex}`
    params.push(filters.team_slug)
    paramIndex++
  }

  if (filters?.environment_name) {
    whereSql += ` AND ma.environment_name = $${paramIndex}`
    params.push(filters.environment_name)
    paramIndex++
  }

  // Filter by audit start year
  if (filters?.audit_start_year) {
    whereSql += ` AND EXTRACT(YEAR FROM d.created_at) >= $${paramIndex}`
    params.push(filters.audit_start_year)
    paramIndex++
  }

  if (filters?.start_date) {
    whereSql += ` AND d.created_at >= $${paramIndex}`
    params.push(filters.start_date)
    paramIndex++
  }

  if (filters?.end_date) {
    whereSql += ` AND d.created_at <= $${paramIndex}`
    params.push(filters.end_date)
    paramIndex++
  }

  if (filters?.four_eyes_status) {
    if (filters.four_eyes_status === 'not_approved') {
      whereSql += ` AND d.four_eyes_status IN ('direct_push', 'unverified_commits', 'approved_pr_with_unreviewed')`
    } else {
      whereSql += ` AND d.four_eyes_status = $${paramIndex}`
      params.push(filters.four_eyes_status)
      paramIndex++
    }
  }

  if (filters?.only_repository_mismatch) {
    whereSql += ` AND d.four_eyes_status = 'repository_mismatch'`
  }

  if (filters?.deployer_username) {
    whereSql += ` AND d.deployer_username ILIKE $${paramIndex}`
    params.push(`%${filters.deployer_username}%`)
    paramIndex++
  }

  if (filters?.commit_sha) {
    whereSql += ` AND d.commit_sha ILIKE $${paramIndex}`
    params.push(`%${filters.commit_sha}%`)
    paramIndex++
  }

  if (filters?.method === 'pr') {
    whereSql += ' AND d.github_pr_number IS NOT NULL'
  } else if (filters?.method === 'direct_push') {
    whereSql += ` AND d.github_pr_number IS NULL AND d.four_eyes_status != 'legacy'`
  } else if (filters?.method === 'legacy') {
    whereSql += ` AND d.four_eyes_status = 'legacy'`
  }

  // Count total
  const countSql = `
    SELECT COUNT(*) as total
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    ${whereSql}
  `
  const countResult = await pool.query(countSql, params)
  const total = parseInt(countResult.rows[0].total, 10)

  // Pagination
  const page = filters?.page || 1
  const per_page = filters?.per_page || 20
  const offset = (page - 1) * per_page

  const dataSql = `
    SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.default_branch
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    ${whereSql}
    ORDER BY d.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `
  params.push(per_page, offset)

  const result = await pool.query(dataSql, params)

  return {
    deployments: result.rows,
    total,
    page,
    per_page,
    total_pages: Math.ceil(total / per_page),
  }
}

export async function getDeploymentById(id: number): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.default_branch
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

export async function createDeployment(data: CreateDeploymentParams): Promise<Deployment> {
  // Check if this is a legacy deployment:
  // - Before 2025-01-01 without commit SHA, OR
  // - Any deployment without commit SHA (cannot be verified)
  const legacyCutoffDate = new Date('2025-01-01T00:00:00Z')
  const isLegacyDeployment = !data.commitSha || (data.createdAt < legacyCutoffDate && !data.commitSha)

  const result = await pool.query(
    `INSERT INTO deployments 
      (monitored_app_id, nais_deployment_id, created_at, team_slug, environment_name, app_name,
       deployer_username, commit_sha, trigger_url,
       detected_github_owner, detected_github_repo_name, resources, has_four_eyes, four_eyes_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (nais_deployment_id) 
    DO UPDATE SET
      resources = EXCLUDED.resources,
      synced_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      data.monitoredApplicationId,
      data.naisDeploymentId,
      data.createdAt,
      data.teamSlug,
      data.environmentName,
      data.appName,
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

/**
 * Get the latest (most recent) deployment for an app by Nais deployment ID
 * Used for incremental sync to know where to stop
 */
export async function getLatestDeploymentForApp(
  monitoredAppId: number,
): Promise<{ nais_deployment_id: string; created_at: string } | null> {
  const result = await pool.query(
    `SELECT nais_deployment_id, created_at 
     FROM deployments 
     WHERE monitored_app_id = $1 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [monitoredAppId],
  )
  return result.rows[0] || null
}

export async function getVerificationStats(monitoredAppId?: number): Promise<{
  total: number
  needsVerification: number
  pending: number
  error: number
}> {
  let sql = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN four_eyes_status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN four_eyes_status = 'error' THEN 1 END) as error
    FROM deployments
  `

  const params: any[] = []
  if (monitoredAppId) {
    sql += ' WHERE monitored_app_id = $1'
    params.push(monitoredAppId)
  }

  const result = await pool.query(sql, params)
  const pending = parseInt(result.rows[0].pending, 10)
  const error = parseInt(result.rows[0].error, 10)

  return {
    total: parseInt(result.rows[0].total, 10),
    needsVerification: pending + error,
    pending,
    error,
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
    title?: string | null
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
         unverified_commits = $8,
         title = $9
     WHERE id = $10
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
      data.title || null,
      deploymentId,
    ],
  )

  if (result.rows.length === 0) {
    throw new Error('Deployment not found')
  }

  return result.rows[0]
}

/**
 * Update deployment with data fetched from GitHub for legacy verification
 */
export async function updateDeploymentLegacyData(
  deploymentId: number,
  data: {
    commitSha: string | null
    commitMessage: string | null
    deployer: string | null
    mergedBy: string | null
    prNumber: number | null
    prUrl: string | null
    prTitle: string | null
    prAuthor: string | null
    prMergedAt: string | null
    reviewers: Array<{ username: string; state: string }>
  },
): Promise<Deployment> {
  // Use mergedBy as deployer if available, otherwise fall back to deployer/commitAuthor
  const effectiveDeployer = data.mergedBy || data.deployer

  // For legacy, we store reviewers directly in a simplified github_pr_data
  // Build a minimal structure that matches type requirements
  let githubPrDataStr: string | null = null
  if (data.prNumber || data.reviewers.length > 0) {
    // Store all available data for legacy verification
    const prData = {
      title: data.prTitle || data.commitMessage || '',
      number: data.prNumber,
      html_url: data.prUrl,
      user: data.prAuthor ? { login: data.prAuthor } : null,
      merged_by: data.mergedBy ? { login: data.mergedBy } : null,
      merged_at: data.prMergedAt,
      reviewers: data.reviewers.map((r) => ({
        username: r.username,
        avatar_url: '',
        state: r.state,
        submitted_at: new Date().toISOString(),
      })),
      // Mark as legacy-verified data
      _legacy_verified: true,
    }
    githubPrDataStr = JSON.stringify(prData)
  }

  const result = await pool.query(
    `UPDATE deployments 
     SET commit_sha = COALESCE($1, commit_sha),
         deployer_username = COALESCE($2, deployer_username),
         github_pr_number = $3,
         github_pr_url = $4,
         github_pr_data = COALESCE($5::jsonb, github_pr_data),
         title = COALESCE($6, title)
     WHERE id = $7
     RETURNING *`,
    [
      data.commitSha,
      effectiveDeployer,
      data.prNumber,
      data.prUrl,
      githubPrDataStr,
      data.prTitle || data.commitMessage,
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
  auditStartYear?: number | null,
): Promise<Deployment | null> {
  let sql = `SELECT prev_dep.* FROM deployments prev_dep
     CROSS JOIN deployments curr_dep
     JOIN monitored_applications ma ON prev_dep.monitored_app_id = ma.id
     WHERE prev_dep.detected_github_owner = $1
       AND prev_dep.detected_github_repo_name = $2
       AND ma.environment_name = $3
       AND curr_dep.id = $4
       AND prev_dep.created_at < curr_dep.created_at
       AND prev_dep.commit_sha IS NOT NULL`

  const params: any[] = [repoOwner, repoName, environmentName, currentDeploymentId]

  // Filter out deployments before audit start year
  if (auditStartYear) {
    sql += ` AND EXTRACT(YEAR FROM prev_dep.created_at) >= $5`
    params.push(auditStartYear)
  }

  sql += ` ORDER BY prev_dep.created_at DESC LIMIT 1`

  const result = await pool.query(sql, params)

  return result.rows[0] || null
}

/**
 * Navigation filter options for prev/next deployment
 */
export interface DeploymentNavFilters {
  four_eyes_status?: string
  method?: 'pr' | 'direct_push' | 'legacy'
  deployer_username?: string
  commit_sha?: string
  start_date?: Date
  end_date?: Date
  audit_start_year?: number | null
}

/**
 * Build WHERE clause conditions for navigation filters
 */
function buildNavFilterConditions(
  filters: DeploymentNavFilters,
  startParamIndex: number,
): { conditions: string[]; params: any[]; nextIndex: number } {
  const conditions: string[] = []
  const params: any[] = []
  let idx = startParamIndex

  if (filters.four_eyes_status) {
    // Handle meta-statuses that map to multiple four_eyes_status values
    if (filters.four_eyes_status === 'not_approved') {
      conditions.push(
        "nav_dep.four_eyes_status IN ('direct_push', 'unverified_commits', 'approved_pr_with_unreviewed')",
      )
    } else {
      conditions.push(`nav_dep.four_eyes_status = $${idx}`)
      params.push(filters.four_eyes_status)
      idx++
    }
  }

  if (filters.method === 'pr') {
    conditions.push('nav_dep.github_pr_number IS NOT NULL')
  } else if (filters.method === 'direct_push') {
    conditions.push("nav_dep.github_pr_number IS NULL AND nav_dep.four_eyes_status != 'legacy'")
  } else if (filters.method === 'legacy') {
    conditions.push("nav_dep.four_eyes_status = 'legacy'")
  }

  if (filters.deployer_username) {
    conditions.push(`nav_dep.deployer_username ILIKE $${idx}`)
    params.push(`%${filters.deployer_username}%`)
    idx++
  }

  if (filters.commit_sha) {
    conditions.push(`nav_dep.commit_sha ILIKE $${idx}`)
    params.push(`%${filters.commit_sha}%`)
    idx++
  }

  if (filters.start_date) {
    conditions.push(`nav_dep.created_at >= $${idx}`)
    params.push(filters.start_date)
    idx++
  }

  if (filters.end_date) {
    conditions.push(`nav_dep.created_at <= $${idx}`)
    params.push(filters.end_date)
    idx++
  }

  if (filters.audit_start_year) {
    conditions.push(`EXTRACT(YEAR FROM nav_dep.created_at) >= $${idx}`)
    params.push(filters.audit_start_year)
    idx++
  }

  return { conditions, params, nextIndex: idx }
}

/**
 * Get the next deployment (chronologically newer) for navigation
 * Next = deployment that happened AFTER this one (newer created_at)
 */
export async function getNextDeployment(
  currentDeploymentId: number,
  monitoredAppId: number,
  filters: DeploymentNavFilters = {},
): Promise<Deployment | null> {
  const { conditions, params } = buildNavFilterConditions(filters, 3)

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT nav_dep.* FROM deployments nav_dep
     CROSS JOIN deployments curr_dep
     WHERE nav_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND nav_dep.created_at > curr_dep.created_at
       ${whereClause}
     ORDER BY nav_dep.created_at ASC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId, ...params],
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
  filters: DeploymentNavFilters = {},
): Promise<Deployment | null> {
  const { conditions, params } = buildNavFilterConditions(filters, 3)

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT nav_dep.* FROM deployments nav_dep
     CROSS JOIN deployments curr_dep
     WHERE nav_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND nav_dep.created_at < curr_dep.created_at
       ${whereClause}
     ORDER BY nav_dep.created_at DESC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId, ...params],
  )

  return result.rows[0] || null
}

export interface AppDeploymentStats {
  total: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  last_deployment: Date | null
  last_deployment_id: number | null
  four_eyes_percentage: number
}

export async function getAppDeploymentStats(
  monitoredAppId: number,
  startDate?: Date,
  endDate?: Date,
  auditStartYear?: number | null,
): Promise<AppDeploymentStats> {
  let sql = `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN has_four_eyes = true THEN 1 ELSE 0 END) as with_four_eyes,
      SUM(CASE WHEN has_four_eyes = false OR four_eyes_status IN ('legacy_pending', 'pending_baseline') THEN 1 ELSE 0 END) as without_four_eyes,
      SUM(CASE WHEN four_eyes_status = 'pending' THEN 1 ELSE 0 END) as pending_verification,
      MAX(created_at) as last_deployment,
      (SELECT id FROM deployments WHERE monitored_app_id = $1 ORDER BY created_at DESC LIMIT 1) as last_deployment_id
    FROM deployments
    WHERE monitored_app_id = $1`

  const params: any[] = [monitoredAppId]
  let paramIndex = 2

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
      SUM(CASE WHEN has_four_eyes = false OR four_eyes_status IN ('legacy_pending', 'pending_baseline') THEN 1 ELSE 0 END) as without_four_eyes,
      SUM(CASE WHEN four_eyes_status = 'pending' THEN 1 ELSE 0 END) as pending_verification,
      MAX(created_at) as last_deployment
    FROM deployments
    WHERE monitored_app_id = ANY($1) ${auditYearFilter}
    GROUP BY monitored_app_id`,
    [appIds],
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

/**
 * Get deployment count for a specific deployer
 */
export async function getDeploymentCountByDeployer(deployerUsername: string): Promise<number> {
  const result = await pool.query('SELECT COUNT(*) as count FROM deployments WHERE deployer_username = $1', [
    deployerUsername,
  ])
  return parseInt(result.rows[0].count, 10) || 0
}

/**
 * Get recent deployments for a specific deployer
 */
export async function getDeploymentsByDeployer(deployerUsername: string, limit = 5): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.deployer_username = $1
    ORDER BY d.created_at DESC
    LIMIT $2`,
    [deployerUsername, limit],
  )
  return result.rows
}

/**
 * Search result types for global search
 */
export interface SearchResult {
  type: 'deployment' | 'user'
  id?: number
  url: string
  title: string
  subtitle?: string
}

/**
 * Search deployments by ID, commit SHA, or deployer username
 */
export async function searchDeployments(query: string, limit = 10): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return results

  // Check if query is a Nais deployment ID (starts with DI_)
  if (/^DI_/i.test(trimmedQuery)) {
    const naisResult = await pool.query(
      `SELECT d.id, d.nais_deployment_id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.nais_deployment_id ILIKE $1
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [`${trimmedQuery}%`, limit],
    )
    for (const row of naisResult.rows) {
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `Deployment #${row.id}`,
        subtitle: `${row.app_name} • ${row.nais_deployment_id.substring(0, 20)}...`,
      })
    }
    return results
  }

  // Check if query is a deployment ID (pure number)
  if (/^\d+$/.test(trimmedQuery)) {
    const deploymentId = parseInt(trimmedQuery, 10)
    const result = await pool.query(
      `SELECT d.id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.id = $1`,
      [deploymentId],
    )
    if (result.rows.length > 0) {
      const row = result.rows[0]
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `Deployment #${row.id}`,
        subtitle: `${row.app_name} • ${row.commit_sha?.substring(0, 7) || 'ukjent SHA'}`,
      })
    }
    return results
  }

  // Check if query looks like a SHA (hex characters only, at least 3 chars for typeahead)
  const looksLikeSha = /^[0-9a-f]{3,40}$/i.test(trimmedQuery)

  if (looksLikeSha) {
    const shaResult = await pool.query(
      `SELECT d.id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.commit_sha ILIKE $1
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [`${trimmedQuery}%`, limit],
    )
    for (const row of shaResult.rows) {
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `${row.commit_sha?.substring(0, 7)}`,
        subtitle: `${row.app_name} • ${row.deployer_username || 'ukjent'}`,
      })
    }
    // If we found SHA matches, return them (don't mix with user results)
    if (results.length > 0) {
      return results
    }
  }

  // Otherwise, search by deployer username OR user mapping fields (nav_ident, nav_email, display_name, slack_member_id)
  const userResult = await pool.query(
    `SELECT DISTINCT d.deployer_username, 
            um.display_name, um.nav_email, um.nav_ident, um.slack_member_id,
            COUNT(*) as deployment_count
     FROM deployments d
     LEFT JOIN user_mappings um ON d.deployer_username = um.github_username
     WHERE d.deployer_username ILIKE $1
        OR um.display_name ILIKE $1
        OR um.nav_email ILIKE $1
        OR um.nav_ident ILIKE $1
        OR um.slack_member_id ILIKE $1
     GROUP BY d.deployer_username, um.display_name, um.nav_email, um.nav_ident, um.slack_member_id
     ORDER BY deployment_count DESC
     LIMIT $2`,
    [`%${trimmedQuery}%`, limit],
  )
  for (const row of userResult.rows) {
    // Show the most relevant matching field in the subtitle
    let matchInfo = ''
    const queryLower = trimmedQuery.toLowerCase()
    if (row.display_name?.toLowerCase().includes(queryLower)) {
      matchInfo = row.display_name
    } else if (row.nav_ident?.toLowerCase().includes(queryLower)) {
      matchInfo = `NAV-ident: ${row.nav_ident}`
    } else if (row.nav_email?.toLowerCase().includes(queryLower)) {
      matchInfo = row.nav_email
    } else if (row.slack_member_id?.toLowerCase().includes(queryLower)) {
      matchInfo = `Slack: ${row.slack_member_id}`
    }

    results.push({
      type: 'user',
      url: `/users/${row.deployer_username}`,
      title: row.display_name || row.deployer_username,
      subtitle: matchInfo
        ? `${row.deployer_username} • ${matchInfo} • ${row.deployment_count} deployment(s)`
        : `${row.deployer_username} • ${row.deployment_count} deployment(s)`,
    })
  }

  return results
}

/**
 * Atomically claim a deployment for Slack notification.
 * Returns the deployment only if this call successfully claimed it (no prior slack_message_ts).
 * This ensures only one pod sends the notification even with multiple replicas.
 */
export async function claimDeploymentForSlackNotification(
  deploymentId: number,
  channelId: string,
  messageTs: string,
): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `UPDATE deployments 
     SET slack_message_ts = $1, slack_channel_id = $2
     WHERE id = $3 AND slack_message_ts IS NULL
     RETURNING *`,
    [messageTs, channelId, deploymentId],
  )

  if (result.rows.length === 0) {
    return null // Already claimed by another pod
  }

  // Get the full deployment with app info
  return getDeploymentById(deploymentId)
}

/**
 * Get deployments that need Slack notification (no slack_message_ts set)
 * for apps that have Slack notifications enabled
 */
export async function getDeploymentsNeedingSlackNotification(limit = 50): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*, 
            ma.team_slug, ma.environment_name, ma.app_name, ma.default_branch,
            ma.slack_channel_id as app_slack_channel_id,
            ma.slack_notifications_enabled
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.slack_message_ts IS NULL
       AND ma.slack_notifications_enabled = true
       AND ma.slack_channel_id IS NOT NULL
       AND d.created_at > NOW() - INTERVAL '7 days'
     ORDER BY d.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Get recent deployments for Slack Home Tab
 */
export async function getRecentDeploymentsForHomeTab(limit = 10): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*, 
            ma.team_slug, ma.environment_name, ma.app_name
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ma.is_active = true
     ORDER BY d.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Get summary stats for Slack Home Tab
 */
export async function getHomeTabSummaryStats(): Promise<{
  totalApps: number
  totalDeployments: number
  withoutFourEyes: number
  pendingVerification: number
}> {
  const result = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM monitored_applications WHERE is_active = true) as total_apps,
      (SELECT COUNT(*) FROM deployments d 
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id 
       WHERE ma.is_active = true) as total_deployments,
      (SELECT COUNT(*) FROM deployments d 
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id 
       WHERE ma.is_active = true AND d.has_four_eyes = false 
       AND d.four_eyes_status NOT IN ('legacy', 'pending')) as without_four_eyes,
      (SELECT COUNT(*) FROM deployments d 
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id 
       WHERE ma.is_active = true AND d.four_eyes_status = 'pending') as pending_verification
  `)
  const row = result.rows[0]
  return {
    totalApps: parseInt(row.total_apps, 10) || 0,
    totalDeployments: parseInt(row.total_deployments, 10) || 0,
    withoutFourEyes: parseInt(row.without_four_eyes, 10) || 0,
    pendingVerification: parseInt(row.pending_verification, 10) || 0,
  }
}

export interface AppWithIssues {
  app_name: string
  team_slug: string
  environment_name: string
  without_four_eyes: number
  pending_verification: number
  alert_count: number
}

/**
 * Get apps that have issues (missing approval, pending verification, or repo alerts)
 */
export async function getAppsWithIssues(): Promise<AppWithIssues[]> {
  const result = await pool.query(`
    SELECT 
      ma.app_name,
      ma.team_slug,
      ma.environment_name,
      COALESCE(dep.without_four_eyes, 0)::integer as without_four_eyes,
      COALESCE(dep.pending_verification, 0)::integer as pending_verification,
      COALESCE(alerts.count, 0)::integer as alert_count
    FROM monitored_applications ma
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN d.has_four_eyes = false AND d.four_eyes_status NOT IN ('legacy', 'pending', 'legacy_pending', 'pending_baseline') THEN 1 ELSE 0 END) as without_four_eyes,
        SUM(CASE WHEN d.four_eyes_status = 'pending' THEN 1 ELSE 0 END) as pending_verification
      FROM deployments d
      WHERE d.monitored_app_id = ma.id
        AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
    ) dep ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as count
      FROM repository_alerts ra
      WHERE ra.monitored_app_id = ma.id AND ra.resolved_at IS NULL
    ) alerts ON true
    WHERE ma.is_active = true
      AND (COALESCE(dep.without_four_eyes, 0) > 0 
        OR COALESCE(dep.pending_verification, 0) > 0 
        OR COALESCE(alerts.count, 0) > 0)
    ORDER BY COALESCE(dep.without_four_eyes, 0) DESC, COALESCE(alerts.count, 0) DESC
  `)
  return result.rows
}
