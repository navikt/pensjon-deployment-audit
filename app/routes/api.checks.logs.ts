import { getGitHubClient } from '~/lib/github.server'
import { logger } from '~/lib/logger.server'
import type { Route } from './+types/api.checks.logs'

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

  try {
    const client = getGitHubClient()
    const response = await client.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: jobIdNum,
    })

    return Response.json({ logs: response.data as string })
  } catch (error) {
    logger.warn(`Could not fetch logs for job ${jobId}: ${error}`)

    if (error instanceof Error && (error.message.includes('404') || error.message.includes('410'))) {
      return Response.json(
        { error: 'Logger er ikke tilgjengelige. De kan ha utløpt (GitHub beholder logger i ~90 dager).' },
        { status: 404 },
      )
    }

    return Response.json({ error: 'Kunne ikke hente logger.' }, { status: 500 })
  }
}
