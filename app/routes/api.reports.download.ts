import { data, type LoaderFunctionArgs } from 'react-router'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'

// GET: Download a completed report PDF
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return data({ error: 'Missing jobId' }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT rj.pdf_data, rj.status, ma.app_name, rj.year
     FROM report_jobs rj
     JOIN monitored_applications ma ON rj.monitored_app_id = ma.id
     WHERE rj.job_id = $1`,
    [jobId],
  )

  if (result.rows.length === 0) {
    return data({ error: 'Job not found' }, { status: 404 })
  }

  const job = result.rows[0]

  if (job.status !== 'completed') {
    return data({ error: 'Report not ready' }, { status: 400 })
  }

  if (!job.pdf_data) {
    return data({ error: 'PDF data not found' }, { status: 500 })
  }

  const filename = `${job.app_name}-rapport-${job.year}.pdf`

  return new Response(job.pdf_data, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
