import { data, type LoaderFunctionArgs } from 'react-router'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'

// GET: Check status of a report generation job
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return data({ error: 'Missing jobId' }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT status, error, created_at, completed_at
     FROM report_jobs
     WHERE job_id = $1`,
    [jobId],
  )

  if (result.rows.length === 0) {
    return data({ error: 'Job not found' }, { status: 404 })
  }

  const job = result.rows[0]

  return data({
    status: job.status,
    error: job.error,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    downloadUrl: job.status === 'completed' ? `/api/reports/download?jobId=${jobId}` : null,
  })
}
