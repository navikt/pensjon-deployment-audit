import type { LoaderFunctionArgs } from 'react-router'
import { getAuditReportById } from '~/db/audit-reports.server'
import { requireAdmin } from '~/lib/auth.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  requireAdmin(request)

  const reportId = Number(params.id)

  if (!reportId) {
    throw new Response('Ugyldig rapport-ID', { status: 400 })
  }

  const report = await getAuditReportById(reportId)

  if (!report) {
    throw new Response('Rapport ikke funnet', { status: 404 })
  }

  if (!report.pdf_data) {
    throw new Response('PDF ikke generert ennå. Generer rapporten på nytt.', { status: 404 })
  }

  // Return PDF for inline viewing (not as attachment)
  return new Response(new Uint8Array(report.pdf_data), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${report.report_id}.pdf"`,
    },
  })
}
