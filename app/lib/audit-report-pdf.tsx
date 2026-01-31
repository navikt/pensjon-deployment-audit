import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { AuditReportData, ContributorEntry, ManualApprovalEntry, ReviewerEntry } from '~/db/audit-reports.server'

// Register a font that supports Norwegian characters (using TTF format for compatibility)
Font.register({
  family: 'Source Sans Pro',
  fonts: [
    {
      src: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-normal.ttf',
      fontWeight: 400,
    },
    {
      src: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-italic.ttf',
      fontWeight: 400,
      fontStyle: 'italic',
    },
    {
      src: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-600-normal.ttf',
      fontWeight: 600,
    },
  ],
})

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Source Sans Pro',
    fontSize: 10,
    padding: 40,
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2px solid #005B82',
    paddingBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    color: '#005B82',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#262626',
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#005B82',
    marginBottom: 8,
    borderBottom: '1px solid #C6C2BF',
    paddingBottom: 4,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  infoItem: {
    width: '50%',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 9,
    color: '#595959',
  },
  infoValue: {
    fontSize: 10,
    fontWeight: 600,
  },
  summaryBox: {
    backgroundColor: '#E6F0F5',
    padding: 15,
    borderRadius: 4,
    marginBottom: 15,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 10,
    color: '#005B82',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 10,
  },
  summaryValue: {
    fontSize: 10,
    fontWeight: 600,
  },
  statusApproved: {
    color: '#06893A',
    fontSize: 14,
    fontWeight: 600,
  },
  table: {
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#E6E3E1',
    padding: 6,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 600,
    color: '#262626',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 6,
    borderBottom: '1px solid #E6E3E1',
  },
  tableRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  tableCell: {
    fontSize: 8,
  },
  col1: { width: '8%' },
  col2: { width: '15%' },
  col3: { width: '12%' },
  col4: { width: '10%' },
  col5: { width: '18%' },
  col6: { width: '18%' },
  col7: { width: '19%' },
  manualBox: {
    backgroundColor: '#FFF4E0',
    padding: 10,
    borderRadius: 4,
    marginBottom: 8,
    borderLeft: '3px solid #D47500',
  },
  manualTitle: {
    fontSize: 9,
    fontWeight: 600,
    marginBottom: 4,
  },
  manualDetail: {
    fontSize: 8,
    marginBottom: 2,
  },
  contributorTable: {
    marginBottom: 10,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTop: '1px solid #C6C2BF',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#595959',
  },
  hashText: {
    fontSize: 7,
    fontFamily: 'Courier',
    color: '#595959',
    marginTop: 5,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 30,
    right: 40,
    fontSize: 8,
    color: '#595959',
  },
  methodologyBox: {
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 4,
    marginBottom: 10,
  },
  methodologyTitle: {
    fontSize: 10,
    fontWeight: 600,
    marginBottom: 6,
  },
  methodologyText: {
    fontSize: 9,
    lineHeight: 1.4,
    marginBottom: 4,
  },
})

interface AuditReportPdfProps {
  appName: string
  repository: string
  teamSlug: string
  environmentName: string
  year: number
  periodStart: Date
  periodEnd: Date
  reportData: AuditReportData
  contentHash: string
  reportId: string
  generatedAt: Date
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AuditReportPdfDocument(props: AuditReportPdfProps) {
  const {
    appName,
    repository,
    teamSlug,
    environmentName,
    periodStart,
    periodEnd,
    reportData,
    contentHash,
    reportId,
    generatedAt,
  } = props

  const totalDeployments = reportData.deployments.length
  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length
  const legacyCount = reportData.legacy_count || 0
  const prPercentage = totalDeployments > 0 ? Math.round((prApprovedCount / totalDeployments) * 100) : 0
  const manualPercentage = totalDeployments > 0 ? Math.round((manuallyApprovedCount / totalDeployments) * 100) : 0
  const legacyPercentage = totalDeployments > 0 ? Math.round((legacyCount / totalDeployments) * 100) : 0

  // Group deployments by month
  const deploymentsByMonth = new Map<string, typeof reportData.deployments>()
  for (const d of reportData.deployments) {
    const date = new Date(d.date)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!deploymentsByMonth.has(monthKey)) {
      deploymentsByMonth.set(monthKey, [])
    }
    deploymentsByMonth.get(monthKey)?.push(d)
  }

  // Sort months chronologically
  const sortedMonths = Array.from(deploymentsByMonth.keys()).sort()

  const formatMonthName = (monthKey: string) => {
    const [year, month] = monthKey.split('-')
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1)
    return date.toLocaleDateString('no-NO', { month: 'long', year: 'numeric' })
  }

  return (
    <Document>
      {/* Page 1: Summary */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>REVISJONSBEVIS</Text>
          <Text style={styles.subtitle}>Four-Eyes Principle Compliance Report</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dokumentinformasjon</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Applikasjon</Text>
              <Text style={styles.infoValue}>{appName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Repository</Text>
              <Text style={styles.infoValue}>{repository}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Team</Text>
              <Text style={styles.infoValue}>{teamSlug}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Miljø</Text>
              <Text style={styles.infoValue}>{environmentName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Periode</Text>
              <Text style={styles.infoValue}>
                {formatDate(periodStart)} - {formatDate(periodEnd)}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Dokument-ID</Text>
              <Text style={styles.infoValue}>{reportId}</Text>
            </View>
          </View>
        </View>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryTitle}>Sammendrag</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Status:</Text>
            <Text style={styles.statusApproved}>✓ GODKJENT</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Totalt antall deployments:</Text>
            <Text style={styles.summaryValue}>{totalDeployments}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Via Pull Request:</Text>
            <Text style={styles.summaryValue}>
              {prApprovedCount} ({prPercentage}%)
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Manuelt godkjent:</Text>
            <Text style={styles.summaryValue}>
              {manuallyApprovedCount} ({manualPercentage}%)
            </Text>
          </View>
          {legacyCount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Legacy (se forklaring):</Text>
              <Text style={styles.summaryValue}>
                {legacyCount} ({legacyPercentage}%)
              </Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Unike bidragsytere:</Text>
            <Text style={styles.summaryValue}>{reportData.contributors.length} personer</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Unike reviewers:</Text>
            <Text style={styles.summaryValue}>{reportData.reviewers.length} personer</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Godkjenningsmetoder</Text>
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>A. Pull Request (automatisk verifisert)</Text>
            <Text style={styles.methodologyText}>• PR må være godkjent (approved) av minst én annen person</Text>
            <Text style={styles.methodologyText}>• Siste commit må være før godkjenning (ingen post-commits)</Text>
            <Text style={styles.methodologyText}>• Alle commits i PR må være fra PR-forfatteren</Text>
          </View>
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>B. Manuell godkjenning (etterkontroll)</Text>
            <Text style={styles.methodologyText}>• Krever kommentar med begrunnelse</Text>
            <Text style={styles.methodologyText}>• Krever lenke til Slack-samtale som dokumenterer review</Text>
            <Text style={styles.methodologyText}>• Godkjenner og tidspunkt registreres</Text>
          </View>
          {legacyCount > 0 && (
            <View style={[styles.methodologyBox, { backgroundColor: '#FFF4E0', borderLeft: '3px solid #D47500' }]}>
              <Text style={styles.methodologyTitle}>C. Legacy deployments ({legacyCount} stk)</Text>
              <Text style={styles.methodologyText}>
                Legacy deployments er deployments fra før systemet for automatisk verifisering ble innført.
              </Text>
              <Text style={styles.methodologyText}>
                Disse deployments mangler commit SHA eller annen nødvendig informasjon for å verifisere
                four-eyes-prinsippet automatisk.
              </Text>
              <Text style={styles.methodologyText}>
                For perioder med legacy deployments gjaldt andre rutiner for kodereview som ikke er sporbare i dette
                systemet.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Generert: {formatDateTime(generatedAt)} | Pensjon Deployment Audit System
          </Text>
          <Text style={styles.hashText}>SHA256: {contentHash}</Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </Page>

      {/* Pages for deployments - one page per month */}
      {sortedMonths.map((monthKey, monthIdx) => {
        const monthDeployments = deploymentsByMonth.get(monthKey) || []
        let runningTotal = 0
        for (let i = 0; i < monthIdx; i++) {
          runningTotal += deploymentsByMonth.get(sortedMonths[i])?.length || 0
        }

        return (
          <Page key={monthKey} size="A4" style={styles.page}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Deployments - {formatMonthName(monthKey)} ({monthDeployments.length} stk)
              </Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.col1]}>#</Text>
                  <Text style={[styles.tableHeaderCell, styles.col2]}>Dato</Text>
                  <Text style={[styles.tableHeaderCell, styles.col3]}>Commit</Text>
                  <Text style={[styles.tableHeaderCell, styles.col4]}>Metode</Text>
                  <Text style={[styles.tableHeaderCell, styles.col5]}>Deployer</Text>
                  <Text style={[styles.tableHeaderCell, styles.col6]}>Godkjenner</Text>
                  <Text style={[styles.tableHeaderCell, styles.col7]}>Referanse</Text>
                </View>
                {monthDeployments.map((d, idx) => (
                  <View key={d.id} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}>
                    <Text style={[styles.tableCell, styles.col1]}>{runningTotal + idx + 1}</Text>
                    <Text style={[styles.tableCell, styles.col2]}>{formatDate(d.date)}</Text>
                    <Text style={[styles.tableCell, styles.col3]}>
                      {d.commit_sha ? d.commit_sha.substring(0, 7) : 'N/A'}
                    </Text>
                    <Text style={[styles.tableCell, styles.col4]}>
                      {d.method === 'pr' ? 'PR' : d.method === 'legacy' ? 'Legacy' : 'Manuell'}
                    </Text>
                    <Text style={[styles.tableCell, styles.col5]}>{d.deployer || 'N/A'}</Text>
                    <Text style={[styles.tableCell, styles.col6]}>{d.approver || '-'}</Text>
                    <Text style={[styles.tableCell, styles.col7]}>
                      {d.method === 'legacy' ? '-' : d.pr_number ? `PR #${d.pr_number}` : 'Slack'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {appName} | {formatMonthName(monthKey)} | Totalt: {totalDeployments} deployments
              </Text>
            </View>
            <Text
              style={styles.pageNumber}
              render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
            />
          </Page>
        )
      })}

      {/* Page 3: Manual approvals (if any) */}
      {reportData.manual_approvals.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Manuelt godkjente deployments ({reportData.manual_approvals.length})
            </Text>
            {reportData.manual_approvals.map((approval: ManualApprovalEntry) => (
              <View key={approval.deployment_id} style={styles.manualBox}>
                <Text style={styles.manualTitle}>
                  Deployment #{approval.deployment_id} - {formatDate(approval.date)}
                </Text>
                <Text style={styles.manualDetail}>Commit: {approval.commit_sha}</Text>
                <Text style={styles.manualDetail}>Deployer: {approval.deployer}</Text>
                <Text style={styles.manualDetail}>Årsak: {approval.reason}</Text>
                <Text style={styles.manualDetail}>Godkjent av: {approval.approved_by}</Text>
                <Text style={styles.manualDetail}>Godkjent: {formatDateTime(approval.approved_at)}</Text>
                <Text style={styles.manualDetail}>Slack: {approval.slack_link}</Text>
                <Text style={styles.manualDetail}>Kommentar: {approval.comment}</Text>
              </View>
            ))}
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
          />
        </Page>
      )}

      {/* Page 4: Contributors and Reviewers */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bidragsytere ({reportData.contributors.length})</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: '25%' }]}>GitHub</Text>
              <Text style={[styles.tableHeaderCell, { width: '30%' }]}>Navn</Text>
              <Text style={[styles.tableHeaderCell, { width: '25%' }]}>Nav-ident</Text>
              <Text style={[styles.tableHeaderCell, { width: '20%' }]}>Deployments</Text>
            </View>
            {reportData.contributors.map((c: ContributorEntry, idx: number) => (
              <View key={c.github_username} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}>
                <Text style={[styles.tableCell, { width: '25%' }]}>{c.github_username}</Text>
                <Text style={[styles.tableCell, { width: '30%' }]}>{c.display_name || '-'}</Text>
                <Text style={[styles.tableCell, { width: '25%' }]}>{c.nav_ident || '-'}</Text>
                <Text style={[styles.tableCell, { width: '20%' }]}>{c.deployment_count}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviewers ({reportData.reviewers.length})</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: '35%' }]}>GitHub</Text>
              <Text style={[styles.tableHeaderCell, { width: '40%' }]}>Navn</Text>
              <Text style={[styles.tableHeaderCell, { width: '25%' }]}>Reviews</Text>
            </View>
            {reportData.reviewers.map((r: ReviewerEntry, idx: number) => (
              <View key={r.github_username} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}>
                <Text style={[styles.tableCell, { width: '35%' }]}>{r.github_username}</Text>
                <Text style={[styles.tableCell, { width: '40%' }]}>{r.display_name || '-'}</Text>
                <Text style={[styles.tableCell, { width: '25%' }]}>{r.review_count}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verifisering</Text>
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyText}>
              Dette dokumentet er generert automatisk av Pensjon Deployment Audit System.
            </Text>
            <Text style={styles.methodologyText}>Datagrunnlag hentet fra:</Text>
            <Text style={styles.methodologyText}>• Nais Console API (deployments)</Text>
            <Text style={styles.methodologyText}>• GitHub API (pull requests, reviews, commits)</Text>
            <Text style={styles.methodologyText}>• Intern database (manuelle godkjenninger)</Text>
            <Text style={[styles.methodologyText, { marginTop: 8 }]}>
              Alle data kan verifiseres mot originalkildene ved behov.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Dokument-ID: {reportId}</Text>
          <Text style={styles.hashText}>SHA256: {contentHash}</Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </Page>
    </Document>
  )
}

export async function generateAuditReportPdf(props: AuditReportPdfProps): Promise<Buffer> {
  const buffer = await renderToBuffer(<AuditReportPdfDocument {...props} />)
  return Buffer.from(buffer)
}
