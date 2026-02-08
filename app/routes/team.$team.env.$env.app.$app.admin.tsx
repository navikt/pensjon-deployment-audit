import { ChatIcon, CheckmarkCircleIcon, CogIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
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
  Loader,
  Select,
  Switch,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useCallback, useEffect, useState } from 'react'
import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
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
import { pool } from '~/db/connection.server'
import { getGitHubDataStatsForApp } from '~/db/github-data.server'
import { getMonitoredApplicationByIdentity, updateMonitoredApplication } from '~/db/monitored-applications.server'
import { acquireSyncLock, getLatestSyncJob, getSyncJobById, releaseSyncLock, type SyncJob } from '~/db/sync-jobs.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { requireAdmin } from '~/lib/auth.server'
import { fetchVerificationDataForAllDeployments, isVerificationDebugMode } from '~/lib/verification'

// Async function to process data fetch job in background
async function processFetchDataJobAsync(jobId: number, appId: number) {
  try {
    const result = await fetchVerificationDataForAllDeployments(appId)
    await releaseSyncLock(jobId, 'completed', result as unknown as Record<string, unknown>)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await releaseSyncLock(jobId, 'failed', undefined, errorMessage)
    throw err
  }
}

// Async function to process report generation in background
async function processReportJobAsync(jobId: string, appId: number, year: number, generatedBy: string) {
  try {
    await pool.query(`UPDATE report_jobs SET status = 'processing' WHERE job_id = $1`, [jobId])

    const rawData = await getAuditReportData(appId, year)
    const reportData = buildReportData(rawData)

    // Save report metadata
    const report = await saveAuditReport({
      monitoredAppId: appId,
      appName: rawData.app.app_name,
      teamSlug: rawData.app.team_slug,
      environmentName: rawData.app.environment_name,
      repository: rawData.repository,
      year,
      reportData,
      generatedBy,
    })

    // Generate PDF
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
      testRequirement: rawData.app.test_requirement as 'none' | 'unit_tests' | 'integration_tests',
    })

    // Store PDF in audit_reports table
    await updateAuditReportPdf(report.id, Buffer.from(pdfBuffer))

    // Update job with PDF data and mark completed
    await pool.query(
      `UPDATE report_jobs SET status = 'completed', pdf_data = $2, completed_at = NOW() WHERE job_id = $1`,
      [jobId, pdfBuffer],
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await pool.query(`UPDATE report_jobs SET status = 'failed', error = $2 WHERE job_id = $1`, [jobId, errorMessage])
    throw err
  }
}

export function meta({ data }: { data: Awaited<ReturnType<typeof loader>> | undefined }) {
  return [{ title: data?.app ? `Admin - ${data.app.app_name}` : 'Admin' }]
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireAdmin(request)

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

  const [implicitApprovalSettings, recentConfigChanges, auditReports, readiness, latestFetchJob, githubDataStats] =
    await Promise.all([
      getImplicitApprovalSettings(app.id),
      getAppConfigAuditLog(app.id, { limit: 10 }),
      getAuditReportsForApp(app.id),
      isProdApp ? checkAuditReadiness(app.id, selectedYear) : null,
      getLatestSyncJob(app.id, 'fetch_verification_data'),
      getGitHubDataStatsForApp(app.id, app.audit_start_year),
    ])

  return {
    app,
    implicitApprovalSettings,
    recentConfigChanges,
    auditReports,
    isProdApp,
    readiness,
    selectedYear,
    latestFetchJob,
    debugMode: isVerificationDebugMode,
    githubDataStats,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireAdmin(request)

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

  if (action === 'update_test_requirement') {
    const testRequirement = formData.get('test_requirement') as 'none' | 'unit_tests' | 'integration_tests'
    if (!['none', 'unit_tests', 'integration_tests'].includes(testRequirement)) {
      return { error: 'Ugyldig testkrav' }
    }

    await updateMonitoredApplication(appId, { test_requirement: testRequirement })
    return { success: 'Testkrav oppdatert!' }
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

    // Create background job for PDF generation
    const { pool } = await import('~/db/connection.server')
    const result = await pool.query(
      `INSERT INTO report_jobs (monitored_app_id, year, status)
       VALUES ($1, $2, 'pending')
       RETURNING job_id`,
      [appId, year],
    )
    const jobId = result.rows[0].job_id

    // Start async processing (fire and forget)
    processReportJobAsync(jobId, appId, year, user.navIdent).catch((err) => {
      console.error(`Report job ${jobId} failed:`, err)
    })

    return { jobStarted: jobId }
  }

  if (action === 'fetch_verification_data') {
    // Try to acquire lock for this job
    const jobId = await acquireSyncLock('fetch_verification_data', appId, 60) // 60 min timeout
    if (!jobId) {
      return { error: 'En datahenting kjører allerede for denne appen' }
    }

    // Start async processing (fire and forget)
    processFetchDataJobAsync(jobId, appId).catch((err) => {
      console.error(`Fetch data job ${jobId} failed:`, err)
    })

    return { fetchJobStarted: jobId }
  }

  if (action === 'check_fetch_job_status') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) {
      return { error: 'Mangler job_id' }
    }
    const job = await getSyncJobById(jobId)
    return { fetchJobStatus: job }
  }

  if (action === 'update_slack_config') {
    const slackChannelId = (formData.get('slack_channel_id') as string)?.trim() || null
    const slackNotificationsEnabled = formData.get('slack_notifications_enabled') === 'true'

    // Validate channel ID format if provided (C followed by alphanumeric, or #channel-name)
    if (slackChannelId && !/^(C[A-Z0-9]+|#[\w-]+)$/i.test(slackChannelId)) {
      return { error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)' }
    }

    await updateMonitoredApplication(appId, {
      slack_channel_id: slackChannelId,
      slack_notifications_enabled: slackNotificationsEnabled,
    })
    return { success: 'Slack-innstillinger oppdatert!' }
  }

  return null
}

export default function AppAdmin() {
  const {
    app,
    implicitApprovalSettings,
    recentConfigChanges,
    auditReports,
    isProdApp,
    readiness,
    selectedYear,
    latestFetchJob,
    debugMode,
    githubDataStats,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const isSubmitting = navigation.state === 'submitting'
  const [, setSearchParams] = useSearchParams()

  // Polling state for report background job
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'pending' | 'processing' | 'completed' | 'failed' | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobCompleted, setJobCompleted] = useState(false)

  // Polling state for fetch data job
  const [fetchJobId, setFetchJobId] = useState<number | null>(null)
  const [fetchJobStatus, setFetchJobStatus] = useState<SyncJob | null>(latestFetchJob)

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

  // Start polling when fetch job is started
  useEffect(() => {
    if (actionData?.fetchJobStarted) {
      setFetchJobId(actionData.fetchJobStarted)
    }
  }, [actionData?.fetchJobStarted])

  // Update fetch job status from action
  useEffect(() => {
    if (actionData?.fetchJobStatus) {
      setFetchJobStatus(actionData.fetchJobStatus)
    }
  }, [actionData?.fetchJobStatus])

  // Poll fetch job status
  useEffect(() => {
    if (!fetchJobId) return
    if (fetchJobStatus?.status === 'completed' || fetchJobStatus?.status === 'failed') return

    const interval = setInterval(() => {
      revalidator.revalidate()
    }, 3000)

    return () => clearInterval(interval)
  }, [fetchJobId, fetchJobStatus?.status, revalidator])

  // Update fetch job status from loader
  useEffect(() => {
    if (latestFetchJob) {
      setFetchJobStatus(latestFetchJob)
    }
  }, [latestFetchJob])

  // Start polling when job is started
  useEffect(() => {
    if (actionData?.jobStarted) {
      setPendingJobId(actionData.jobStarted)
      setJobStatus('pending')
      setJobError(null)
      setJobCompleted(false)
    }
  }, [actionData?.jobStarted])

  // Poll for job status
  const pollJobStatus = useCallback(async () => {
    if (!pendingJobId) return

    try {
      const response = await fetch(`/api/reports/status?jobId=${pendingJobId}`)
      const data = await response.json()

      setJobStatus(data.status)

      if (data.status === 'completed') {
        setPendingJobId(null)
        setJobCompleted(true)
        // Reload to show new report in list
        revalidator.revalidate()
      } else if (data.status === 'failed') {
        setPendingJobId(null)
        setJobError(data.error || 'Ukjent feil')
      }
    } catch {
      setJobError('Kunne ikke sjekke status')
      setPendingJobId(null)
    }
  }, [pendingJobId, revalidator])

  useEffect(() => {
    if (!pendingJobId) return

    const interval = setInterval(pollJobStatus, 2000)
    // Also poll immediately
    pollJobStatus()

    return () => clearInterval(interval)
  }, [pendingJobId, pollJobStatus])

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
      {actionData?.error && (
        <Box padding="space-16" borderRadius="8" background="danger-softA">
          <BodyShort>{actionData.error}</BodyShort>
        </Box>
      )}
      {jobError && <Alert variant="error">Rapportgenerering feilet: {jobError}</Alert>}
      {jobCompleted && (
        <Alert variant="success">
          Leveranserapport er generert! Du finner den i listen over genererte rapporter nedenfor.
        </Alert>
      )}

      {/* Job progress indicator */}
      {pendingJobId && (
        <Alert variant="info">
          <HStack gap="space-12" align="center">
            <Loader size="small" />
            <span>
              {jobStatus === 'pending' && 'Starter rapportgenerering...'}
              {jobStatus === 'processing' && 'Genererer rapport... Dette kan ta opptil et minutt.'}
            </span>
          </HStack>
        </Alert>
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
                    loading={
                      (isSubmitting && navigation.formData?.get('action') === 'generate_report') || !!pendingJobId
                    }
                    disabled={!readinessData?.is_ready || !!pendingJobId}
                  >
                    {pendingJobId ? 'Genererer...' : 'Generer rapport'}
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

      {/* Test Requirements */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small">Testkrav for leveranser</Heading>
            <BodyShort textColor="subtle" size="small">
              Spesifiser hvilke tester som må være vellykket før en leveranse kan gjennomføres.
            </BodyShort>
          </div>

          <Form method="post">
            <input type="hidden" name="action" value="update_test_requirement" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-12">
              <Select
                label="Testkrav"
                name="test_requirement"
                defaultValue={app.test_requirement || 'none'}
                size="small"
                style={{ maxWidth: '300px' }}
              >
                <option value="none">Ingen</option>
                <option value="unit_tests">Enhetstester</option>
                <option value="integration_tests">Integrasjonstester</option>
              </Select>

              <BodyShort size="small" textColor="subtle">
                Dette valget dokumenteres i rapporten under «Sikkerhet og dataintegritet».
              </BodyShort>

              <Button type="submit" size="small" variant="secondary">
                Lagre testkrav
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Slack Configuration */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <HStack gap="space-8" align="center" justify="space-between">
            <HStack gap="space-8" align="center">
              <ChatIcon aria-hidden fontSize="1.25rem" />
              <div>
                <Heading size="small">Slack-varsler</Heading>
                <BodyShort textColor="subtle" size="small">
                  Konfigurer Slack-varsler for uverifiserte deployments.
                </BodyShort>
              </div>
            </HStack>
            <Button
              as={Link}
              to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/slack`}
              variant="tertiary"
              size="small"
            >
              Se meldingshistorikk
            </Button>
          </HStack>

          <Form method="post">
            <input type="hidden" name="action" value="update_slack_config" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-16">
              <Switch name="slack_notifications_enabled" value="true" defaultChecked={app.slack_notifications_enabled}>
                Aktiver Slack-varsler for denne appen
              </Switch>

              <TextField
                label="Slack-kanal"
                name="slack_channel_id"
                defaultValue={app.slack_channel_id || ''}
                description="Kanal-ID (f.eks. C01234567) eller kanalnavn (f.eks. #min-kanal)"
                size="small"
                style={{ maxWidth: '300px' }}
              />

              <Button type="submit" size="small" variant="secondary">
                Lagre Slack-innstillinger
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Fetch Verification Data */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small">Hent verifiseringsdata fra GitHub</Heading>
            <BodyShort textColor="subtle" size="small">
              Henter og lagrer data fra GitHub for alle deployments. Kjører kun for deployments som mangler data eller
              har utdatert schema-versjon.
            </BodyShort>
          </div>

          {/* GitHub Data Stats */}
          <Box padding="space-16" borderRadius="4" background="neutral-soft">
            <VStack gap="space-8">
              <Label size="small">
                GitHub data-dekning{app.audit_start_year ? ` (fra ${app.audit_start_year})` : ''}
              </Label>
              <HStack gap="space-24" wrap>
                <div>
                  <Detail textColor="subtle">Totalt deployments</Detail>
                  <BodyShort weight="semibold">{githubDataStats.total}</BodyShort>
                </div>
                <div>
                  <Detail textColor="subtle">Med GitHub-data</Detail>
                  <BodyShort weight="semibold" style={{ color: 'var(--ax-text-success)' }}>
                    {githubDataStats.withCurrentData}
                  </BodyShort>
                </div>
                {githubDataStats.withOutdatedData > 0 && (
                  <div>
                    <Detail textColor="subtle">Utdatert data</Detail>
                    <BodyShort weight="semibold" style={{ color: 'var(--ax-text-warning)' }}>
                      {githubDataStats.withOutdatedData}
                    </BodyShort>
                  </div>
                )}
                <div>
                  <Detail textColor="subtle">Mangler data</Detail>
                  <BodyShort
                    weight="semibold"
                    style={{
                      color:
                        githubDataStats.withoutData > 0 ? 'var(--ax-text-danger)' : 'var(--ax-text-neutral-subtle)',
                    }}
                  >
                    {githubDataStats.withoutData}
                  </BodyShort>
                </div>
                {githubDataStats.total > 0 && (
                  <div>
                    <Detail textColor="subtle">Dekning</Detail>
                    <BodyShort weight="semibold">
                      {Math.round((githubDataStats.withCurrentData / githubDataStats.total) * 100)}%
                    </BodyShort>
                  </div>
                )}
              </HStack>
            </VStack>
          </Box>

          <Form method="post">
            <input type="hidden" name="action" value="fetch_verification_data" />
            <input type="hidden" name="app_id" value={app.id} />
            <HStack gap="space-16" align="center">
              <Button
                type="submit"
                size="small"
                variant="secondary"
                loading={fetchJobStatus?.status === 'running'}
                disabled={fetchJobStatus?.status === 'running'}
              >
                {fetchJobStatus?.status === 'running' ? 'Henter data...' : 'Hent data for alle deployments'}
              </Button>
            </HStack>
          </Form>

          {fetchJobStatus && (
            <Box
              padding="space-12"
              borderRadius="4"
              background={
                fetchJobStatus.status === 'completed'
                  ? 'success-soft'
                  : fetchJobStatus.status === 'failed'
                    ? 'danger-soft'
                    : fetchJobStatus.status === 'running'
                      ? 'info-soft'
                      : 'neutral-soft'
              }
            >
              <VStack gap="space-8">
                <HStack gap="space-8" align="center">
                  {fetchJobStatus.status === 'running' && <Loader size="xsmall" />}
                  {fetchJobStatus.status === 'completed' && <CheckmarkCircleIcon aria-hidden />}
                  {fetchJobStatus.status === 'failed' && <ExclamationmarkTriangleIcon aria-hidden />}
                  <BodyShort size="small" weight="semibold">
                    {fetchJobStatus.status === 'pending' && 'Venter...'}
                    {fetchJobStatus.status === 'running' && 'Henter data fra GitHub...'}
                    {fetchJobStatus.status === 'completed' && 'Datahenting fullført'}
                    {fetchJobStatus.status === 'failed' && 'Datahenting feilet'}
                  </BodyShort>
                </HStack>

                {fetchJobStatus.status === 'completed' && fetchJobStatus.result && (
                  <HStack gap="space-16" wrap>
                    <Detail>Totalt: {(fetchJobStatus.result as Record<string, number>).total}</Detail>
                    <Detail>Hentet: {(fetchJobStatus.result as Record<string, number>).fetched}</Detail>
                    <Detail>Hoppet over: {(fetchJobStatus.result as Record<string, number>).skipped}</Detail>
                    {(fetchJobStatus.result as Record<string, number>).errors > 0 && (
                      <Detail>
                        <span style={{ color: 'var(--ax-text-danger)' }}>
                          Feil: {(fetchJobStatus.result as Record<string, number>).errors}
                        </span>
                      </Detail>
                    )}
                  </HStack>
                )}

                {fetchJobStatus.status === 'failed' && fetchJobStatus.error && (
                  <BodyShort size="small">
                    <span style={{ color: 'var(--ax-text-danger)' }}>{fetchJobStatus.error}</span>
                  </BodyShort>
                )}

                <Detail textColor="subtle">
                  Startet:{' '}
                  {fetchJobStatus.started_at ? new Date(fetchJobStatus.started_at).toLocaleString('no-NO') : 'N/A'}
                  {fetchJobStatus.completed_at &&
                    ` • Fullført: ${new Date(fetchJobStatus.completed_at).toLocaleString('no-NO')}`}
                </Detail>
              </VStack>
            </Box>
          )}
        </VStack>
      </Box>

      {/* Debug: Verification Diff */}
      {debugMode && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="info-subtle" borderWidth="1">
          <VStack gap="space-16">
            <div>
              <Heading size="small">Debug: Verifiseringsavvik</Heading>
              <BodyShort textColor="subtle" size="small">
                Sammenlign gammel og ny verifiseringslogikk for å finne avvik.
              </BodyShort>
            </div>
            <AkselLink
              as={Link}
              to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/verification-diff`}
            >
              Se verifiseringsavvik →
            </AkselLink>
          </VStack>
        </Box>
      )}

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
