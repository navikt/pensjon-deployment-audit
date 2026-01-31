import {
  BarChartIcon,
  CheckmarkCircleIcon,
  CheckmarkIcon,
  ExclamationmarkTriangleIcon,
  ExternalLinkIcon,
  PackageIcon,
  XMarkIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  HStack,
  Label,
  Select,
  Show,
  Tag,
  VStack,
} from '@navikt/ds-react'
import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useSearchParams,
} from 'react-router'
import { getUnresolvedAlertsByApp } from '~/db/alerts.server'
import {
  approveRepository,
  getRepositoriesByAppId,
  rejectRepository,
  setRepositoryAsActive,
} from '~/db/application-repositories.server'
import { getAppDeploymentStats } from '~/db/deployments.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import { getDateRange } from '~/lib/nais.server'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = parseInt(params.id || '', 10)
  if (Number.isNaN(id)) {
    throw new Response('Invalid app ID', { status: 400 })
  }

  const url = new URL(request.url)
  const period = url.searchParams.get('period') || 'all'

  let startDate: Date | undefined
  let endDate: Date | undefined

  if (period !== 'all') {
    const range = getDateRange(period)
    startDate = range.startDate
    endDate = range.endDate
  }

  const app = await getMonitoredApplicationById(id)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const [repositories, deploymentStats, alerts] = await Promise.all([
    getRepositoriesByAppId(id),
    getAppDeploymentStats(id, startDate, endDate),
    getUnresolvedAlertsByApp(id),
  ])

  const activeRepo = repositories.find((r) => r.status === 'active')
  const pendingRepos = repositories.filter((r) => r.status === 'pending_approval')
  const historicalRepos = repositories.filter((r) => r.status === 'historical')

  return {
    app,
    repositories,
    activeRepo,
    pendingRepos,
    historicalRepos,
    deploymentStats,
    alerts,
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = parseInt(params.id || '', 10)
  if (Number.isNaN(id)) {
    throw new Response('Invalid app ID', { status: 400 })
  }

  const formData = await request.formData()
  const action = formData.get('action')

  try {
    if (action === 'approve_repo') {
      const repoId = parseInt(formData.get('repo_id') as string, 10)
      const setActive = formData.get('set_active') === 'true'
      await approveRepository(repoId, 'web-user', setActive)
      return { success: 'Repository godkjent!' }
    }

    if (action === 'reject_repo') {
      const repoId = parseInt(formData.get('repo_id') as string, 10)
      await rejectRepository(repoId)
      return { success: 'Repository avvist!' }
    }

    if (action === 'set_active') {
      const repoId = parseInt(formData.get('repo_id') as string, 10)
      await setRepositoryAsActive(repoId)
      return { success: 'Aktivt repository oppdatert!' }
    }

    return { error: 'Ukjent handling' }
  } catch (error) {
    console.error('Action error:', error)
    return { error: error instanceof Error ? error.message : 'En feil oppstod' }
  }
}

export default function AppDetail() {
  const { app, repositories, activeRepo, pendingRepos, historicalRepos, deploymentStats, alerts } =
    useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const [searchParams] = useSearchParams()
  const currentPeriod = searchParams.get('period') || 'all'

  // Status badge based on deployment stats and alerts
  // Priority: 1. Missing four-eyes (error), 2. Pending verification (warning), 3. Alerts (warning), 4. OK (success)
  let statusColor: 'success' | 'warning' | 'danger' = 'success'
  let statusIcon = <CheckmarkCircleIcon />
  let statusText = 'Alt OK'

  if (deploymentStats.without_four_eyes > 0) {
    statusColor = 'danger'
    statusIcon = <XMarkOctagonIcon />
    statusText = `${deploymentStats.without_four_eyes} deployment${deploymentStats.without_four_eyes > 1 ? 's' : ''} mangler godkjenning`
  } else if (deploymentStats.pending_verification > 0) {
    statusColor = 'warning'
    statusIcon = <ExclamationmarkTriangleIcon />
    statusText = `${deploymentStats.pending_verification} deployment${deploymentStats.pending_verification > 1 ? 's' : ''} venter verifisering`
  } else if (alerts.length > 0) {
    statusColor = 'warning'
    statusIcon = <ExclamationmarkTriangleIcon />
    statusText = `${alerts.length} åpne varsler`
  }

  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${app.team_slug}/${app.environment_name}/app/${app.app_name}`

  return (
    <VStack gap="space-32">
      <HStack justify="space-between" align="start" wrap>
        <div>
          <Detail textColor="subtle">Applikasjon</Detail>
          <Heading size="large">{app.app_name}</Heading>
          <BodyShort textColor="subtle">
            Team: <code style={{ fontSize: '0.75rem' }}>{app.team_slug}</code> | Miljø:{' '}
            <code style={{ fontSize: '0.75rem' }}>{app.environment_name}</code>
          </BodyShort>
        </div>
        <div>
          <Tag data-color={statusColor} variant="moderate" size="medium">
            {statusIcon} {statusText}
          </Tag>
        </div>
      </HStack>

      {actionData?.success && <Alert variant="success">{actionData.success}</Alert>}
      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      {/* Time Period Filter */}
      <Box padding="space-20" borderRadius="8" background="sunken">
        <Form method="get" onChange={(e) => e.currentTarget.submit()}>
          <Select label="Tidsperiode" name="period" defaultValue={currentPeriod} style={{ maxWidth: '200px' }}>
            <option value="last-month">Siste måned</option>
            <option value="last-12-months">Siste 12 måneder</option>
            <option value="this-year">I år</option>
            <option value="year-2025">Hele 2025</option>
            <option value="all">Alle</option>
          </Select>
        </Form>
      </Box>

      {/* Statistics Section */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <Heading size="medium">
            <BarChartIcon aria-hidden /> Statistikk
          </Heading>
          <HGrid gap="space-16" columns={{ xs: 2, md: 3, lg: 5 }}>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Totalt deployments</Detail>
                <Heading size="large">{deploymentStats.total}</Heading>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Med fire øyne</Detail>
                <Heading size="large" style={{ color: 'var(--ax-text-success)' }}>
                  {deploymentStats.with_four_eyes} ({deploymentStats.four_eyes_percentage}%)
                </Heading>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Uten fire øyne</Detail>
                <Heading size="large" style={{ color: 'var(--ax-text-danger)' }}>
                  {deploymentStats.without_four_eyes}
                </Heading>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Venter verifisering</Detail>
                <Heading size="large" style={{ color: 'var(--ax-text-warning)' }}>
                  {deploymentStats.pending_verification}
                </Heading>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Siste deployment</Detail>
                <BodyShort>
                  {deploymentStats.last_deployment
                    ? new Date(deploymentStats.last_deployment).toLocaleString('no-NO')
                    : 'Ingen deployments'}
                </BodyShort>
              </VStack>
            </Box>
          </HGrid>
          <HStack gap="space-8">
            <Button as={Link} to={`/apps/${app.id}/deployments`} variant="tertiary" size="small">
              Se alle deployments
            </Button>
            <Button
              as="a"
              href={naisConsoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="tertiary"
              size="small"
              icon={<ExternalLinkIcon aria-hidden />}
              iconPosition="right"
            >
              Åpne i Nais Console
            </Button>
          </HStack>
        </VStack>
      </Box>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="warning-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Heading size="medium">
              <ExclamationmarkTriangleIcon aria-hidden /> Åpne varsler ({alerts.length})
            </Heading>
            <VStack gap="space-12">
              {alerts.map((alert) => (
                <Box key={alert.id} padding="space-16" borderRadius="8" background="sunken">
                  <VStack gap="space-12">
                    {/* First row: Type tag, date, action button */}
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-12" align="center">
                        <Tag data-color="warning" size="xsmall" variant="outline">
                          {alert.alert_type === 'repository_mismatch' && 'Ukjent repo'}
                          {alert.alert_type === 'pending_approval' && 'Venter godkjenning'}
                          {alert.alert_type === 'historical_repository' && 'Historisk repo'}
                        </Tag>
                        <Detail textColor="subtle">{new Date(alert.created_at).toLocaleDateString('no-NO')}</Detail>
                      </HStack>
                      <Button as={Link} to={`/deployments/${alert.deployment_id}`} size="xsmall" variant="tertiary">
                        Se deployment
                      </Button>
                    </HStack>
                    {/* Repository comparison */}
                    <VStack gap="space-4">
                      <HStack gap="space-8" wrap>
                        <Detail textColor="subtle">Forventet:</Detail>
                        <code style={{ fontSize: '0.75rem' }}>
                          {alert.expected_github_owner}/{alert.expected_github_repo_name}
                        </code>
                      </HStack>
                      <HStack gap="space-8" wrap>
                        <Detail textColor="subtle">Detektert:</Detail>
                        <code style={{ fontSize: '0.75rem', color: 'var(--ax-text-danger)' }}>
                          {alert.detected_github_owner}/{alert.detected_github_repo_name}
                        </code>
                      </HStack>
                    </VStack>
                  </VStack>
                </Box>
              ))}
            </VStack>
            <div>
              <Button as={Link} to="/alerts" variant="secondary" size="small">
                Se alle varsler →
              </Button>
            </div>
          </VStack>
        </Box>
      )}

      {/* Repositories Section */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <Heading size="medium">
            <PackageIcon aria-hidden /> Repositories
          </Heading>

          {/* Active Repository */}
          {activeRepo && (
            <VStack gap="space-8">
              <Label>Aktivt repository</Label>
              <HStack gap="space-8" align="center">
                <CheckmarkCircleIcon style={{ color: 'var(--ax-text-success)' }} />
                <Link
                  to={`https://github.com/${activeRepo.github_owner}/${activeRepo.github_repo_name}`}
                  target="_blank"
                >
                  {activeRepo.github_owner}/{activeRepo.github_repo_name}
                </Link>
                <Tag data-color="success" size="xsmall" variant="outline">
                  AKTIV
                </Tag>
              </HStack>
            </VStack>
          )}

          {!activeRepo && (
            <Alert variant="warning" size="small">
              Ingen aktivt repository satt for denne applikasjonen
            </Alert>
          )}

          {/* Pending Approval */}
          {pendingRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Venter godkjenning ({pendingRepos.length})</Label>
              <VStack gap="space-8">
                {pendingRepos.map((repo) => (
                  <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                    <VStack gap="space-12">
                      <HStack gap="space-8" align="center" justify="space-between" wrap>
                        <HStack gap="space-8" align="center">
                          <ExclamationmarkTriangleIcon style={{ color: 'var(--ax-text-warning)' }} />
                          <Link to={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`} target="_blank">
                            <BodyShort weight="semibold">
                              {repo.github_owner}/{repo.github_repo_name}
                            </BodyShort>
                          </Link>
                        </HStack>
                        <Detail textColor="subtle">{new Date(repo.created_at).toLocaleDateString('no-NO')}</Detail>
                      </HStack>
                      <HStack gap="space-8" wrap>
                        <form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="approve_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <input type="hidden" name="set_active" value="true" />
                          <Button type="submit" size="xsmall" variant="primary" icon={<CheckmarkIcon aria-hidden />}>
                            Godkjenn som aktiv
                          </Button>
                        </form>
                        <Show above="sm">
                          <form method="post" style={{ display: 'inline' }}>
                            <input type="hidden" name="action" value="approve_repo" />
                            <input type="hidden" name="repo_id" value={repo.id} />
                            <input type="hidden" name="set_active" value="false" />
                            <Button type="submit" size="xsmall" variant="secondary">
                              Godkjenn som historisk
                            </Button>
                          </form>
                        </Show>
                        <form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="reject_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <Button type="submit" size="xsmall" variant="danger" icon={<XMarkIcon aria-hidden />}>
                            Avvis
                          </Button>
                        </form>
                      </HStack>
                    </VStack>
                  </Box>
                ))}
              </VStack>
            </VStack>
          )}

          {/* Historical Repositories */}
          {historicalRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Historiske repositories ({historicalRepos.length})</Label>
              <VStack gap="space-8">
                {historicalRepos.map((repo) => (
                  <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-8" align="center" wrap>
                        <Link to={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`} target="_blank">
                          <BodyShort>
                            {repo.github_owner}/{repo.github_repo_name}
                          </BodyShort>
                        </Link>
                        {repo.redirects_to_owner && (
                          <Tag data-color="info" size="xsmall" variant="outline">
                            → {repo.redirects_to_owner}/{repo.redirects_to_repo}
                          </Tag>
                        )}
                        <Show above="md">
                          <Detail textColor="subtle">{new Date(repo.created_at).toLocaleDateString('no-NO')}</Detail>
                        </Show>
                      </HStack>
                      <form method="post" style={{ display: 'inline' }}>
                        <input type="hidden" name="action" value="set_active" />
                        <input type="hidden" name="repo_id" value={repo.id} />
                        <Button type="submit" size="xsmall" variant="secondary">
                          Sett som aktiv
                        </Button>
                      </form>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            </VStack>
          )}

          {repositories.length === 0 && (
            <BodyShort textColor="subtle">Ingen repositories registrert for denne applikasjonen</BodyShort>
          )}
        </VStack>
      </Box>

      <div>
        <Button as={Link} to="/apps" variant="tertiary" size="small">
          ← Tilbake til applikasjoner
        </Button>
      </div>
    </VStack>
  )
}
