import { createHash } from 'node:crypto'
import { type ActionFunctionArgs, data } from 'react-router'
import { buildReportData, getAuditReportData } from '~/db/audit-reports.server'
import { pool } from '~/db/connection.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { requireAdmin } from '~/lib/auth.server'

// POST: Create a new report generation job
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const monitoredAppId = Number(formData.get('monitoredAppId'))
  const year = Number(formData.get('year'))

  if (!monitoredAppId || !year) {
    return data({ error: 'Missing monitoredAppId or year' }, { status: 400 })
  }

  // Create job in database
  const result = await pool.query(
    `INSERT INTO report_jobs (monitored_app_id, year, status)
     VALUES ($1, $2, 'pending')
     RETURNING job_id`,
    [monitoredAppId, year],
  )
  const jobId = result.rows[0].job_id

  // Start async processing (fire and forget)
  processReportJob(jobId, monitoredAppId, year).catch((err) => {
    console.error(`Report job ${jobId} failed:`, err)
  })

  return data({ jobId })
}

// Async function to process the report job
async function processReportJob(jobId: string, monitoredAppId: number, year: number) {
  try {
    // Mark as processing
    await pool.query(`UPDATE report_jobs SET status = 'processing' WHERE job_id = $1`, [jobId])

    // Get report data
    const rawData = await getAuditReportData(monitoredAppId, year)
    const reportData = buildReportData(rawData)

    // Generate report ID and content hash
    const reportId = `${rawData.app.app_name}-${year}-${Date.now()}`
    const contentHash = createHash('sha256').update(JSON.stringify(reportData)).digest('hex')
    const generatedAt = new Date()

    // Generate PDF
    const pdfBuffer = await generateAuditReportPdf({
      appName: rawData.app.app_name,
      repository: rawData.repository,
      teamSlug: rawData.app.team_slug,
      environmentName: rawData.app.environment_name,
      year,
      periodStart: new Date(year, 0, 1),
      periodEnd: new Date(year, 11, 31, 23, 59, 59),
      reportData,
      contentHash,
      reportId,
      generatedAt,
    })

    // Save completed job with PDF data
    await pool.query(
      `UPDATE report_jobs 
       SET status = 'completed', pdf_data = $2, completed_at = NOW()
       WHERE job_id = $1`,
      [jobId, pdfBuffer],
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await pool.query(`UPDATE report_jobs SET status = 'failed', error = $2 WHERE job_id = $1`, [jobId, errorMessage])
    throw err
  }
}
