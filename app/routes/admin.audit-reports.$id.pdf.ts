import type { LoaderFunctionArgs } from 'react-router'
import { getAuditReportById } from '~/db/audit-reports.server'
import { getAllUserMappings } from '~/db/user-mappings.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'

export async function loader({ params }: LoaderFunctionArgs) {
  const reportId = Number(params.id)

  if (!reportId) {
    throw new Response('Ugyldig rapport-ID', { status: 400 })
  }

  const report = await getAuditReportById(reportId)

  if (!report) {
    throw new Response('Rapport ikke funnet', { status: 404 })
  }

  // Check if we have cached PDF
  if (report.pdf_data) {
    return new Response(new Uint8Array(report.pdf_data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${report.report_id}.pdf"`,
      },
    })
  }

  // Get user mappings for display names
  const mappingsArray = await getAllUserMappings()
  const userMappings = Object.fromEntries(
    mappingsArray.map((m) => [m.github_username, { display_name: m.display_name, nav_ident: m.nav_ident }]),
  )

  // Generate PDF on-the-fly
  const pdfBuffer = await generateAuditReportPdf({
    appName: report.app_name,
    repository: report.repository,
    teamSlug: report.team_slug,
    environmentName: report.environment_name,
    year: report.year,
    periodStart: new Date(report.period_start),
    periodEnd: new Date(report.period_end),
    reportData: report.report_data,
    contentHash: report.content_hash,
    reportId: report.report_id,
    generatedAt: new Date(report.generated_at),
    userMappings,
  })

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${report.report_id}.pdf"`,
    },
  })
}
