import { createHash } from 'node:crypto'
import { type ActionFunctionArgs, data } from 'react-router'
import { buildReportData, getAuditReportData } from '~/db/audit-reports.server'
import { createReportJob, updateReportJobStatus } from '~/db/report-jobs.server'
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

  const jobId = await createReportJob(monitoredAppId, year)

  // Start async processing (fire and forget)
  processReportJob(jobId, monitoredAppId, year).catch((err) => {
    console.error(`Report job ${jobId} failed:`, err)
  })

  return data({ jobId })
}

// Async function to process the report job
async function processReportJob(jobId: string, monitoredAppId: number, year: number) {
  try {
    await updateReportJobStatus(jobId, 'processing')

    const rawData = await getAuditReportData(monitoredAppId, year)
    const reportData = buildReportData(rawData)

    const reportId = `${rawData.app.app_name}-${year}-${Date.now()}`
    const contentHash = createHash('sha256').update(JSON.stringify(reportData)).digest('hex')
    const generatedAt = new Date()

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
      testRequirement: rawData.app.test_requirement as 'none' | 'unit_tests' | 'integration_tests',
    })

    await updateReportJobStatus(jobId, 'completed', pdfBuffer)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await updateReportJobStatus(jobId, 'failed', undefined, errorMessage)
    throw err
  }
}
