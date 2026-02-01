import { CheckmarkCircleIcon, DownloadIcon, ExclamationmarkTriangleIcon, EyeIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  Hide,
  HStack,
  Select,
  Show,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { Form, Link, useActionData, useLoaderData, useNavigation } from 'react-router'
import {
  buildReportData,
  checkAuditReadiness,
  getAllAuditReports,
  getAuditReportData,
  saveAuditReport,
  updateAuditReportPdf,
} from '~/db/audit-reports.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getAllUserMappings } from '~/db/user-mappings.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import styles from '~/styles/common.module.css'

export async function loader(_args: LoaderFunctionArgs) {
  const [reports, apps] = await Promise.all([getAllAuditReports(), getAllMonitoredApplications()])

  // Filter to only production apps
  const prodApps = apps.filter((app) => app.environment_name.startsWith('prod-'))

  return { reports, apps: prodApps }
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'check-readiness') {
    const appId = Number(formData.get('app_id'))
    const year = Number(formData.get('year'))

    if (!appId || !year) {
      return { error: 'Mangler app eller år', readiness: null, generated: null }
    }

    const readiness = await checkAuditReadiness(appId, year)
    return { readiness, error: null, generated: null }
  }

  if (intent === 'generate-report') {
    const appId = Number(formData.get('app_id'))
    const year = Number(formData.get('year'))

    if (!appId || !year) {
      return { error: 'Mangler app eller år', readiness: null, generated: null }
    }

    // Check readiness first
    const readiness = await checkAuditReadiness(appId, year)
    if (!readiness.is_ready) {
      return {
        error: `Kan ikke generere rapport. ${readiness.pending_count} deployments mangler godkjenning.`,
        readiness,
        generated: null,
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
      generatedBy: undefined, // Could add user info here
    })

    // Get user mappings for PDF generation
    const mappingsArray = await getAllUserMappings()
    const userMappings = Object.fromEntries(
      mappingsArray.map((m) => [m.github_username, { display_name: m.display_name, nav_ident: m.nav_ident }]),
    )

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
      userMappings,
    })

    // Store PDF in database
    await updateAuditReportPdf(report.id, Buffer.from(pdfBuffer))

    return { generated: report, error: null, readiness: null }
  }

  return { error: 'Ugyldig handling', readiness: null, generated: null }
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

export default function AdminAuditReports() {
  const { reports, apps } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [selectedApp, setSelectedApp] = useState<string>('')
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString())

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <VStack gap="space-24">
      <div>
        <Heading size="large" spacing>
          Revisjonsbevis
        </Heading>
        <BodyShort textColor="subtle">
          Generer revisjonsbevis for Riksrevisjonen som dokumenterer four-eyes-prinsippet for alle deployments.
        </BodyShort>
      </div>

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      {actionData?.generated && (
        <Alert variant="success">
          Revisjonsbevis generert! Dokument-ID: <strong>{actionData.generated.report_id}</strong>
        </Alert>
      )}

      {/* Generate new report section */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="medium" spacing>
              Generer revisjonsbevis
            </Heading>
            <BodyShort textColor="subtle">
              Velg applikasjon og år for å sjekke status og generere revisjonsbevis. Det kan bare finnes ett
              revisjonsbevis per applikasjon per år. Hvis et bevis allerede finnes, vil det bli oppdatert med ny data og
              ny dokument-ID.
            </BodyShort>
          </div>

          <Form method="post">
            <VStack gap="space-16">
              <HStack gap="space-16" align="end" wrap>
                <Select
                  label="Applikasjon (prod)"
                  value={selectedApp}
                  onChange={(e) => setSelectedApp(e.target.value)}
                  name="app_id"
                  style={{ minWidth: '250px' }}
                >
                  <option value="">Velg applikasjon...</option>
                  {apps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.app_name} ({app.environment_name})
                    </option>
                  ))}
                </Select>

                <Select
                  label="År"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  name="year"
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
                  name="intent"
                  value="check-readiness"
                  variant="secondary"
                  loading={isSubmitting && navigation.formData?.get('intent') === 'check-readiness'}
                  disabled={!selectedApp}
                >
                  Sjekk status
                </Button>

                <Button
                  type="submit"
                  name="intent"
                  value="generate-report"
                  variant="primary"
                  loading={isSubmitting && navigation.formData?.get('intent') === 'generate-report'}
                  disabled={!selectedApp}
                >
                  Generer/oppdater rapport
                </Button>
              </HStack>

              {/* Readiness check result */}
              {actionData?.readiness && (
                <Box
                  padding="space-16"
                  borderRadius="4"
                  background={actionData.readiness.is_ready ? 'success-soft' : 'warning-soft'}
                >
                  <VStack gap="space-8">
                    <HStack gap="space-8" align="center">
                      {actionData.readiness.is_ready ? (
                        <>
                          <CheckmarkCircleIcon aria-hidden fontSize="1.5rem" />
                          <Heading size="small">Klar for revisjonsbevis</Heading>
                        </>
                      ) : (
                        <>
                          <ExclamationmarkTriangleIcon aria-hidden fontSize="1.5rem" />
                          <Heading size="small">Ikke klar</Heading>
                        </>
                      )}
                    </HStack>

                    <HStack gap="space-24" wrap>
                      <div>
                        <Detail>Totalt deployments</Detail>
                        <BodyShort weight="semibold">{actionData.readiness.total_deployments}</BodyShort>
                      </div>
                      <div>
                        <Detail>Godkjent</Detail>
                        <BodyShort weight="semibold">{actionData.readiness.approved_count}</BodyShort>
                      </div>
                      {actionData.readiness.legacy_count > 0 && (
                        <div>
                          <Detail>Legacy</Detail>
                          <BodyShort weight="semibold">{actionData.readiness.legacy_count}</BodyShort>
                        </div>
                      )}
                      <div>
                        <Detail>Venter godkjenning</Detail>
                        <BodyShort weight="semibold">{actionData.readiness.pending_count}</BodyShort>
                      </div>
                    </HStack>

                    {actionData.readiness.pending_count > 0 && (
                      <div>
                        <Detail>Deployments som mangler godkjenning:</Detail>
                        <VStack gap="space-4">
                          {actionData.readiness.pending_deployments.map((d) => (
                            <HStack key={d.id} gap="space-8" align="center">
                              <AkselLink as={Link} to={`/deployments/${d.id}`}>
                                {d.commit_sha?.substring(0, 7) || 'N/A'}
                              </AkselLink>
                              <BodyShort size="small">
                                {formatDate(d.created_at)} • {d.deployer_username} • {d.four_eyes_status}
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
        </VStack>
      </Box>

      {/* Existing reports */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="medium" spacing>
              Utstedte revisjonsbevis
            </Heading>
            <BodyShort textColor="subtle">{reports.length} revisjonsbevis er generert.</BodyShort>
          </div>

          {reports.length === 0 ? (
            <BodyShort textColor="subtle">Ingen revisjonsbevis er generert enda.</BodyShort>
          ) : (
            <>
              {/* Desktop table */}
              <Show above="md">
                <Table size="small">
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Dokument-ID</Table.HeaderCell>
                      <Table.HeaderCell>Applikasjon</Table.HeaderCell>
                      <Table.HeaderCell>År</Table.HeaderCell>
                      <Table.HeaderCell>Deployments</Table.HeaderCell>
                      <Table.HeaderCell>Generert</Table.HeaderCell>
                      <Table.HeaderCell>Handlinger</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {reports.map((report) => (
                      <Table.Row key={report.id}>
                        <Table.DataCell>
                          <code style={{ fontSize: '0.75rem' }}>{report.report_id}</code>
                        </Table.DataCell>
                        <Table.DataCell>
                          <VStack gap="space-2">
                            <BodyShort size="small" weight="semibold">
                              {report.app_name}
                            </BodyShort>
                            <Detail>{report.environment_name}</Detail>
                          </VStack>
                        </Table.DataCell>
                        <Table.DataCell>{report.year}</Table.DataCell>
                        <Table.DataCell>
                          <VStack gap="space-2">
                            <BodyShort size="small">{report.total_deployments} totalt</BodyShort>
                            <Detail>
                              {report.pr_approved_count} PR, {report.manually_approved_count} manuell
                            </Detail>
                          </VStack>
                        </Table.DataCell>
                        <Table.DataCell>{formatDateTime(report.generated_at)}</Table.DataCell>
                        <Table.DataCell>
                          <HStack gap="space-8">
                            <Button
                              as="a"
                              href={`/admin/audit-reports/${report.id}/view`}
                              target="_blank"
                              size="small"
                              variant="tertiary"
                              icon={<EyeIcon aria-hidden />}
                            >
                              Vis
                            </Button>
                            <Button
                              as="a"
                              href={`/admin/audit-reports/${report.id}/pdf`}
                              size="small"
                              variant="tertiary"
                              icon={<DownloadIcon aria-hidden />}
                            >
                              Last ned
                            </Button>
                          </HStack>
                        </Table.DataCell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </Show>

              {/* Mobile cards */}
              <Hide above="md">
                <div>
                  {reports.map((report) => (
                    <Box key={report.id} padding="space-16" background="default" className={styles.stackedListItem}>
                      <VStack gap="space-8">
                        <HStack justify="space-between" align="start" wrap>
                          <div>
                            <BodyShort weight="semibold">{report.app_name}</BodyShort>
                            <Detail>
                              {report.environment_name} • {report.year}
                            </Detail>
                          </div>
                          <Tag variant="success" size="small">
                            {report.total_deployments} deployments
                          </Tag>
                        </HStack>
                        <Detail>Generert: {formatDateTime(report.generated_at)}</Detail>
                        <code style={{ fontSize: '0.65rem', wordBreak: 'break-all' }}>{report.report_id}</code>
                        <HStack gap="space-8">
                          <Button
                            as="a"
                            href={`/admin/audit-reports/${report.id}/view`}
                            target="_blank"
                            size="small"
                            variant="secondary"
                            icon={<EyeIcon aria-hidden />}
                          >
                            Vis
                          </Button>
                          <Button
                            as="a"
                            href={`/admin/audit-reports/${report.id}/pdf`}
                            size="small"
                            variant="secondary"
                            icon={<DownloadIcon aria-hidden />}
                          >
                            Last ned
                          </Button>
                        </HStack>
                      </VStack>
                    </Box>
                  ))}
                </div>
              </Hide>
            </>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
