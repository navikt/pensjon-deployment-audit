import { pool } from '~/db/connection.server'
import { isGcsConfigured, logExists, uploadLog } from '~/lib/gcs.server'
import { getGitHubClient } from '~/lib/github.server'
import { logger } from '~/lib/logger.server'

interface CheckToCache {
  deployment_id: number
  owner: string
  repo: string
  check_id: number
  check_name: string
}

/**
 * Find recent deployments with completed checks whose logs haven't been cached yet.
 * Limits to deployments from the last 7 days to stay within API quotas.
 */
async function getUncachedChecks(): Promise<CheckToCache[]> {
  const result = await pool.query<{
    id: number
    github_pr_data: {
      checks: Array<{
        id?: number
        name: string
        status: string
        conclusion: string | null
        log_cached?: boolean
      }>
    }
    repository_full_name: string | null
  }>(`
    SELECT d.id, d.github_pr_data,
           ar.full_name as repository_full_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    LEFT JOIN application_repositories ar ON ar.monitored_app_id = ma.id
    WHERE d.created_at >= NOW() - INTERVAL '7 days'
      AND d.github_pr_data IS NOT NULL
      AND d.github_pr_data->'checks' IS NOT NULL
      AND ma.is_active = true
    ORDER BY d.created_at DESC
    LIMIT 100
  `)

  const checks: CheckToCache[] = []
  for (const row of result.rows) {
    if (!row.github_pr_data?.checks || !row.repository_full_name) continue
    const [owner, repo] = row.repository_full_name.split('/')
    if (!owner || !repo) continue

    for (const check of row.github_pr_data.checks) {
      if (!check.id) continue
      if (check.log_cached) continue
      if (check.status !== 'completed') continue

      checks.push({
        deployment_id: row.id,
        owner,
        repo,
        check_id: check.id,
        check_name: check.name,
      })
    }
  }

  return checks
}

/**
 * Cache logs for all completed checks to GCS.
 * Returns the number of logs successfully cached.
 */
export async function cacheCheckLogs(): Promise<number> {
  if (!isGcsConfigured()) return 0

  const checks = await getUncachedChecks()
  if (checks.length === 0) return 0

  logger.info(`Found ${checks.length} check logs to cache`)

  let cached = 0
  const client = getGitHubClient()

  for (const check of checks) {
    try {
      // Skip if already in GCS
      if (await logExists(check.owner, check.repo, check.check_id)) {
        await markLogCached(check.deployment_id, check.check_id)
        cached++
        continue
      }

      const response = await client.actions.downloadJobLogsForWorkflowRun({
        owner: check.owner,
        repo: check.repo,
        job_id: check.check_id,
      })

      await uploadLog(check.owner, check.repo, check.check_id, response.data as string)
      await markLogCached(check.deployment_id, check.check_id)
      cached++
    } catch (error) {
      logger.warn(
        `Could not cache log for ${check.owner}/${check.repo} check ${check.check_name} (${check.check_id}): ${error}`,
      )
    }
  }

  return cached
}

/**
 * Mark a check's log as cached in the deployment's github_pr_data.
 */
async function markLogCached(deploymentId: number, checkId: number): Promise<void> {
  await pool.query(
    `UPDATE deployments
     SET github_pr_data = jsonb_set(
       github_pr_data,
       (
         SELECT ARRAY['checks', (idx - 1)::text, 'log_cached']
         FROM jsonb_array_elements(github_pr_data->'checks') WITH ORDINALITY AS c(elem, idx)
         WHERE (elem->>'id')::int = $2
         LIMIT 1
       ),
       'true'::jsonb
     )
     WHERE id = $1
       AND github_pr_data->'checks' IS NOT NULL`,
    [deploymentId, checkId],
  )
}
