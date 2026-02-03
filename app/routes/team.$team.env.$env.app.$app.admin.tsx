import { CheckmarkCircleIcon, CogIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Label,
  Select,
  TextField,
  VStack,
} from '@navikt/ds-react'
import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from 'react-router'
import {
  getAppConfigAuditLog,
  getImplicitApprovalSettings,
  updateImplicitApprovalSettings,
} from '~/db/app-settings.server'
import {
  buildReportData,
  checkAuditReadiness,
  getAuditReportData,
  getAuditReportsForApp,
  saveAuditReport,
  updateAuditReportPdf,
} from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity, updateMonitoredApplication } from '~/db/monitored-applications.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { requireAdmin } from '~/lib/auth.server'

export function meta({ data }: { data: Awaited<ReturnType<typeof loader>> | undefined }) {
  return [{ title: data?.app ? `Admin - ${data.app.app_name}` : 'Admin' }]
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  requireAdmin(request)

  const { team, env, app: appName } = params
  if (!team || !env || !appName) {
    throw new Response('Missing route parameters', { status: 400 })
  }

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  // Check if this is a production app (audit reports only make sense for prod)
  const isProdApp = app.environment_name.startsWith('prod-')

  // Get selected year from URL or default to last year
  const url = new URL(request.url)
  const currentYear = new Date().getFullYear()
  const selectedYear = Number(url.searchParams.get('year')) || currentYear - 1

  const [implicitApprovalSettings, recentConfigChanges, auditReports, readiness] = await Promise.all([
    getImplicitApprovalSettings(app.id),
    getAppConfigAuditLog(app.id, { limit: 10 }),
    getAuditReportsForApp(app.id),
    isProdApp ? checkAuditReadiness(app.id, selectedYear) : null,
  ])

  return {
    app,
    implicitApprovalSettings,
    recentConfigChanges,
    auditReports,
    isProdApp,
    readiness,
    selectedYear,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = requireAdmin(request)

  const formData = await request.formData()
  const action = formData.get('action') as string
  const appId = parseInt(formData.get('app_id') as string, 10)

  if (action === 'update_default_branch') {
    const defaultBranch = formData.get('default_branch') as string
    if (!defaultBranch || defaultBranch.trim() === '') {
      return { error: 'Default branch kan ikke være tom' }
    }
    await updateMonitoredApplication(appId, { default_branch: defaultBranch.trim() })
    return { success: 'Default branch oppdatert!' }
  }

  if (action === 'update_implicit_approval') {
    const mode = formData.get('mode') as 'off' | 'dependabot_only' | 'all'
    if (!['off', 'dependabot_only', 'all'].includes(mode)) {
      return { error: 'Ugyldig modus' }
    }

    await updateImplicitApprovalSettings({
      monitoredAppId: appId,
      settings: { mode },
      changedByNavIdent: user.navIdent,
      changedByName: user.name || undefined,
    })
    return { success: 'Implisitt godkjenning-innstillinger oppdatert!' }
  }

  if (action === 'update_audit_start_year') {
    const appIdForYear = parseInt(formData.get('app_id') as string, 10)
    const startYearValue = formData.get('audit_start_year') as string

    let auditStartYear: number | null = null
    if (startYearValue && startYearValue.trim() !== '') {
      auditStartYear = parseInt(startYearValue, 10)
      if (Number.isNaN(auditStartYear) || auditStartYear < 2000 || auditStartYear > 2100) {
        return { error: 'Ugyldig startår. Må være mellom 2000 og 2100.' }
      }
    }

    await updateMonitoredApplication(appIdForYear, { audit_start_year: auditStartYear })
    return { success: 'Startår for revisjon oppdatert!' }
  }

  if (action === 'check_readiness') {
    const year = Number(formData.get('year'))
    if (!appId || !year) {
      return { error: 'Mangler app eller år' }
    }
    const readiness = await checkAuditReadiness(appId, year)
    return { readiness }
  }

  if (action === 'generate_report') {
    const year = Number(formData.get('year'))
    if (!appId || !year) {
      return { error: 'Mangler app eller år' }
    }

    // Block current year - year is not complete
    const currentYear = new Date().getFullYear()
    if (year >= currentYear) {
      return { error: 'Kan ikke generere rapport for inneværende eller fremtidige år' }
    }

    // Check readiness first
    const readiness = await checkAuditReadiness(appId, year)
    if (!readiness.is_ready) {
      return {
        error: `Kan ikke generere rapport. ${readiness.pending_count} deployments mangler godkjenning.`,
        readiness,
      }
    }

    // Get all data
    const rawData = await getAuditReportData(appId, year)
    const reportData = buildReportData(rawData)

    // Save report metadata first
    const report = await saveAuditReport({
      monitoredAppId: appId,
      appName: rawData.app.app_name,
      teamSlug: rawData.app.team_slug,
      environmentName: rawData.app.environment_name,
      repository: rawData.repository,
      year,
      reportData,
      generatedBy: user.navIdent,
    })

    // Generate PDF and store in database
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
    })

    // Store PDF in database
    await updateAuditReportPdf(report.id, Buffer.from(pdfBuffer))

    return { generated: report }
  }

  return null
}

export default function AppAdmin() {
  const { app, implicitApprovalSettings, recentConfigChanges, auditReports, isProdApp, readiness, selectedYear } =
    useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const [, setSearchParams] = useSearchParams()

  const currentYear = new Date().getFullYear()
  // Only allow previous years down to audit_start_year
  const startYear = app.audit_start_year || currentYear - 5
  const years = Array.from({ length: currentYear - startYear }, (_, i) => currentYear - 1 - i).filter(
    (y) => y >= startYear,
  )

  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  // Use loader readiness data (fall back to action data for error cases)
  const readinessData = readiness || actionData?.readiness

  // Handle year change by updating URL (triggers loader reload)
  const handleYearChange = (year: string) => {
    setSearchParams((prev) => {
      prev.set('year', year)
      return prev
    })
  }

  return (
    <VStack gap="space-32">
      {/* Header */}
      <div>
        <HStack gap="space-12" align="center">
          <CogIcon aria-hidden fontSize="1.5rem" />
          <Heading size="large">Administrasjon for {app.app_name}</Heading>
        </HStack>
        <BodyShort textColor="subtle">Administrer leveranserapporter og innstillinger for applikasjonen.</BodyShort>
      </div>

      {/* Success/Error messages */}
      {actionData?.success && (
        <Box padding="space-16" borderRadius="8" background="success-softA">
          <BodyShort>{actionData.success}</BodyShort>
        </Box>
      )}
      {actionData?.generated && (
        <Alert variant="success">
          Leveranserapport generert! Dokument-ID: <strong>{actionData.generated.report_id}</strong>
        </Alert>
      )}
      {actionData?.error && (
        <Box padding="space-16" borderRadius="8" background="danger-softA">
          <BodyShort>{actionData.error}</BodyShort>
        </Box>
      )}

      {/* Audit Report Generation - only for prod apps - MOVED TO TOP */}
      {isProdApp && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <div>
              <Heading size="small">Leveranserapport</Heading>
              <BodyShort textColor="subtle" size="small">
                Generer leveranserapport for revisjon. Rapporten dokumenterer four-eyes-prinsippet for alle deployments
                i valgt år.
              </BodyShort>
            </div>

            <Form method="post">
              <input type="hidden" name="app_id" value={app.id} />
              <input type="hidden" name="year" value={selectedYear} />
              <VStack gap="space-16">
                <HStack gap="space-16" align="end" wrap>
                  <Select
                    label="År"
                    value={String(selectedYear)}
                    onChange={(e) => handleYearChange(e.target.value)}
                    size="small"
                    style={{ minWidth: '120px' }}
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </Select>

                  <Button
                    type="submit"
                    name="action"
                    value="generate_report"
                    variant="primary"
                    size="small"
                    loading={isSubmitting && navigation.formData?.get('action') === 'generate_report'}
                    disabled={!readinessData?.is_ready}
                  >
                    Generer rapport
                  </Button>
                </HStack>

                {/* Readiness check result */}
                {readinessData && (
                  <Box
                    padding="space-16"
                    borderRadius="4"
                    background={readinessData.is_ready ? 'success-soft' : 'warning-soft'}
                  >
                    <VStack gap="space-8">
                      <HStack gap="space-8" align="center">
                        {readinessData.is_ready ? (
                          <>
                            <CheckmarkCircleIcon aria-hidden fontSize="1.5rem" />
                            <Heading size="xsmall">Klar for leveranserapport</Heading>
                          </>
                        ) : (
                          <>
                            <ExclamationmarkTriangleIcon aria-hidden fontSize="1.5rem" />
                            <Heading size="xsmall">Ikke klar</Heading>
                          </>
                        )}
                      </HStack>

                      <HStack gap="space-24" wrap>
                        <div>
                          <Detail>Totalt deployments</Detail>
                          <BodyShort weight="semibold">{readinessData.total_deployments}</BodyShort>
                        </div>
                        <div>
                          <Detail>Godkjent</Detail>
                          <BodyShort weight="semibold">{readinessData.approved_count}</BodyShort>
                        </div>
                        {readinessData.legacy_count > 0 && (
                          <div>
                            <Detail>Legacy</Detail>
                            <BodyShort weight="semibold">{readinessData.legacy_count}</BodyShort>
                          </div>
                        )}
                        <div>
                          <Detail>Venter godkjenning</Detail>
                          <BodyShort weight="semibold">{readinessData.pending_count}</BodyShort>
                        </div>
                      </HStack>

                      {readinessData.pending_count > 0 && (
                        <div>
                          <Detail>Deployments som mangler godkjenning:</Detail>
                          <VStack gap="space-4">
                            {readinessData.pending_deployments.map((d) => (
                              <HStack key={d.id} gap="space-8" align="center">
                                <AkselLink as={Link} to={`${appUrl}/deployments/${d.id}`}>
                                  {d.commit_sha?.substring(0, 7) || 'N/A'}
                                </AkselLink>
                                <BodyShort size="small">
                                  {new Date(d.created_at).toLocaleDateString('no-NO')} • {d.deployer_username} •{' '}
                                  {d.four_eyes_status}
                                </BodyShort>
                              </HStack>
                            ))}
                          </VStack>
                        </div>
                      )}
                    </VStack>
                  </Box>
                )}
              </VStack>
            </Form>

            {/* Existing reports for this app */}
            {auditReports.length > 0 && (
              <VStack gap="space-8">
                <Label>Eksisterende rapporter</Label>
                <VStack gap="space-4">
                  {auditReports.map((report) => (
                    <HStack key={report.id} gap="space-16" align="center">
                      <BodyShort weight="semibold">{report.year}</BodyShort>
                      <Detail textColor="subtle">{report.report_id}</Detail>
                      <HStack gap="space-8">
                        <AkselLink href={`/admin/audit-reports/${report.id}/view`} target="_blank">
                          Vis
                        </AkselLink>
                        <AkselLink href={`/admin/audit-reports/${report.id}/pdf`} target="_blank">
                          Last ned
                        </AkselLink>
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            )}
          </VStack>
        </Box>
      )}

      {/* Default Branch */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small">Default branch</Heading>
          <Form method="post">
            <input type="hidden" name="action" value="update_default_branch" />
            <input type="hidden" name="app_id" value={app.id} />
            <HStack gap="space-16" align="end" wrap>
              <TextField
                label="Branch"
                description="Branchen som PR-er må gå til for å bli godkjent (f.eks. main, master)"
                name="default_branch"
                defaultValue={app.default_branch}
                size="small"
                style={{ minWidth: '200px' }}
              />
              <Button type="submit" size="small" variant="secondary">
                Lagre
              </Button>
            </HStack>
          </Form>
        </VStack>
      </Box>

      {/* Audit Start Year */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small">Startår for revisjon</Heading>
          <Form method="post">
            <input type="hidden" name="action" value="update_audit_start_year" />
            <input type="hidden" name="app_id" value={app.id} />
            <HStack gap="space-16" align="end" wrap>
              <TextField
                label="År"
                description="Deployments før dette året ignoreres i statistikk og rapporter"
                name="audit_start_year"
                type="number"
                defaultValue={app.audit_start_year ?? ''}
                size="small"
                style={{ minWidth: '120px' }}
              />
              <Button type="submit" size="small" variant="secondary">
                Lagre
              </Button>
            </HStack>
          </Form>
        </VStack>
      </Box>

      {/* Implicit Approval Settings */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small">Implisitt godkjenning</Heading>
            <BodyShort textColor="subtle" size="small">
              Godkjenner automatisk en PR hvis den som merger ikke er PR-oppretteren og ikke har siste commit.
            </BodyShort>
          </div>

          <Form method="post">
            <input type="hidden" name="action" value="update_implicit_approval" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-12">
              <Select
                label="Modus"
                name="mode"
                defaultValue={implicitApprovalSettings.mode}
                size="small"
                style={{ maxWidth: '300px' }}
              >
                <option value="off">Av</option>
                <option value="dependabot_only">Kun Dependabot</option>
                <option value="all">Alle</option>
              </Select>

              <BodyShort size="small" textColor="subtle">
                <strong>Kun Dependabot:</strong> Godkjenner automatisk PRer opprettet av Dependabot med kun
                Dependabot-commits.
                <br />
                <strong>Alle:</strong> Godkjenner alle PRer der den som merger verken opprettet PRen eller har siste
                commit.
              </BodyShort>

              <Button type="submit" size="small" variant="secondary">
                Lagre innstillinger
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Recent config changes */}
      {recentConfigChanges.length > 0 && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Label>Siste endringer</Label>
            <VStack gap="space-4">
              {recentConfigChanges.map((change) => (
                <Detail key={change.id} textColor="subtle">
                  {new Date(change.created_at).toLocaleString('no-NO')} -{' '}
                  {change.changed_by_name || change.changed_by_nav_ident}: {change.setting_key}
                </Detail>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}
    </VStack>
  )
}
