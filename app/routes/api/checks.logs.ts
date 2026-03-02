import { downloadLog, isGcsConfigured, logExists, uploadLog } from '~/lib/gcs.server'
import { getGitHubClient } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import type { Route } from './+types/checks.logs'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const owner = url.searchParams.get('owner')
  const repo = url.searchParams.get('repo')
  const jobId = url.searchParams.get('job_id')

  if (!owner || !repo || !jobId) {
    return Response.json({ error: 'Missing required parameters: owner, repo, job_id' }, { status: 400 })
  }

  const jobIdNum = Number.parseInt(jobId, 10)
  if (Number.isNaN(jobIdNum)) {
    return Response.json({ error: 'job_id must be a number' }, { status: 400 })
  }

  // Try GCS first (cached logs)
  if (isGcsConfigured()) {
    try {
      if (await logExists(owner, repo, jobIdNum)) {
        const logs = await downloadLog(owner, repo, jobIdNum)
        if (logs) {
          return Response.json({ logs, source: 'cached' })
        }
      }
    } catch (error) {
      logger.warn(`GCS read failed, falling back to GitHub: ${error}`)
    }
  }

  // Fetch from GitHub API
  try {
    const client = getGitHubClient()

    // Use manual redirect to log the target hostname (helps diagnose outbound policy issues)
    const redirectResponse = await client.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
      owner,
      repo,
      job_id: jobIdNum,
      request: { redirect: 'manual' },
    })

    const redirectUrl = redirectResponse.headers.location
    if (redirectUrl) {
      const targetHost = new URL(redirectUrl).hostname
      logger.info(`GitHub log redirect for job ${jobId}: ${targetHost}`)
    }

    // Follow the redirect to download the actual logs
    const response = await client.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobIdNum,
    })

    const logs = response.data as string

    // Store to GCS in background (don't block response)
    if (isGcsConfigured()) {
      uploadLog(owner, repo, jobIdNum, logs).catch((err) => {
        logger.warn(`Failed to cache log to GCS: ${err}`)
      })
    }

    return Response.json({ logs, source: 'github' })
  } catch (error) {
    logger.warn(`Could not fetch logs for job ${jobId}: ${error}`)

    const isNotFound =
      error instanceof Error &&
      'status' in error &&
      ((error as { status: number }).status === 404 || (error as { status: number }).status === 410)

    if (isNotFound) {
      return Response.json(
        {
          error:
            'Logger er ikke tilgjengelige for denne sjekken. Sjekken kan mangle logger fordi den ikke er en vanlig workflow-jobb, eller fordi loggene har utløpt.',
          errorType: 'not_found',
        },
        { status: 404 },
      )
    }

    return Response.json({ error: 'Kunne ikke hente logger.', errorType: 'server_error' }, { status: 500 })
  }
}
