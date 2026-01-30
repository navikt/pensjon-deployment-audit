import { CheckmarkCircleIcon, ExclamationmarkTriangleIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, Label, Select, Table, Tag } from '@navikt/ds-react'
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
import { syncDeploymentsFromNais } from '~/lib/sync.server'
import styles from '~/styles/common.module.css'

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
    if (action === 'sync') {
      const app = await getMonitoredApplicationById(id)
      if (!app) {
        return { error: 'Applikasjon ikke funnet' }
      }
      await syncDeploymentsFromNais(app.team_slug, app.environment_name, app.app_name)
      return { success: 'Deployments hentet fra Nais!' }
    }

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
  let statusVariant: 'success' | 'warning' | 'error' = 'success'
  let statusIcon = <CheckmarkCircleIcon />
  let statusText = 'Alt OK'

  if (deploymentStats.without_four_eyes > 0) {
    statusVariant = 'error'
    statusIcon = <XMarkOctagonIcon />
    statusText = `${deploymentStats.without_four_eyes} deployment${deploymentStats.without_four_eyes > 1 ? 's' : ''} mangler four-eyes`
  } else if (deploymentStats.pending_verification > 0) {
    statusVariant = 'warning'
    statusIcon = <ExclamationmarkTriangleIcon />
    statusText = `${deploymentStats.pending_verification} deployment${deploymentStats.pending_verification > 1 ? 's' : ''} venter verifisering`
  } else if (alerts.length > 0) {
    statusVariant = 'warning'
    statusIcon = <ExclamationmarkTriangleIcon />
    statusText = `${alerts.length} åpne varsler`
  }

  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${app.team_slug}/${app.environment_name}/app/${app.app_name}`

  return (
    <div className={styles.pageContainer}>
      <div className={styles.flexRowSpaceBetween}>
        <div>
          <Detail>Applikasjon</Detail>
          <Heading size="large">{app.app_name}</Heading>
          <BodyShort>
            Team: <code className={styles.codeSmall}>{app.team_slug}</code> | Miljø:{' '}
            <code className={styles.codeSmall}>{app.environment_name}</code>
          </BodyShort>
        </div>
        <div className={styles.flexColumnEnd}>
          <Tag variant={statusVariant} size="medium">
            {statusIcon} {statusText}
          </Tag>
        </div>
      </div>

      {actionData?.success && (
        <Alert variant="success" className={styles.marginTop1}>
          {actionData.success}
        </Alert>
      )}
      {actionData?.error && (
        <Alert variant="error" className={styles.marginTop1}>
          {actionData.error}
        </Alert>
      )}

      {/* Time Period Filter */}
      <Form method="get" className={styles.marginTop2} onChange={(e) => e.currentTarget.submit()}>
        <Select label="Tidsperiode" name="period" defaultValue={currentPeriod} className={styles.filterSelect}>
          <option value="last-month">Siste måned</option>
          <option value="last-12-months">Siste 12 måneder</option>
          <option value="this-year">I år</option>
          <option value="year-2025">Hele 2025</option>
          <option value="all">Alle</option>
        </Select>
      </Form>

      {/* Statistics Section */}
      <Box background="neutral-soft" padding="space-16" borderRadius="12" className={styles.marginTop2}>
        <Heading size="medium" spacing>
          📊 Statistikk
        </Heading>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <Label>Totalt antall deployments</Label>
            <Heading size="large">{deploymentStats.total}</Heading>
          </div>
          <div className={styles.statCard}>
            <Label>Med fire øyne</Label>
            <Heading size="large" className={styles.textSuccess}>
              {deploymentStats.with_four_eyes} ({deploymentStats.four_eyes_percentage}%)
            </Heading>
          </div>
          <div className={styles.statCard}>
            <Label>Uten fire øyne</Label>
            <Heading size="large" className={styles.textDanger}>
              {deploymentStats.without_four_eyes}
            </Heading>
          </div>
          <div className={styles.statCard}>
            <Label>Venter verifisering</Label>
            <Heading size="large" className={styles.textWarning}>
              {deploymentStats.pending_verification}
            </Heading>
          </div>
          <div className={styles.statCard}>
            <Label>Siste deployment</Label>
            <BodyShort>
              {deploymentStats.last_deployment
                ? new Date(deploymentStats.last_deployment).toLocaleString('no-NO')
                : 'Ingen deployments'}
            </BodyShort>
          </div>
        </div>
        <div className={`${styles.flexRowGap1} ${styles.marginTop1}`}>
          <Button as={Link} to={`/deployments?app=${app.id}&period=${currentPeriod}`} variant="secondary" size="small">
            Se alle deployments →
          </Button>
          <Button
            as="a"
            href={naisConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="secondary"
            size="small"
          >
            Åpne i Nais Console ↗
          </Button>
        </div>
      </Box>

      {/* Quick Actions */}
      <Box background="neutral-soft" padding="space-16" borderRadius="12" className={styles.marginTop2}>
        <Heading size="medium" spacing>
          ⚡ Handlinger
        </Heading>
        <div className={styles.flexRowGap1}>
          <form method="post">
            <input type="hidden" name="action" value="sync" />
            <Button type="submit" size="small">
              🔄 Hent deployments fra Nais
            </Button>
          </form>
          <Button as={Link} to={`/deployments/verify?app=${app.id}`} variant="secondary" size="small">
            ✓ Verifiser deployments mot GitHub
          </Button>
        </div>
      </Box>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <Box background="neutral-soft" padding="space-16" borderRadius="12" className={styles.marginTop2}>
          <Heading size="medium" spacing>
            ⚠️ Åpne varsler ({alerts.length})
          </Heading>
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Dato</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Forventet repo</Table.HeaderCell>
                <Table.HeaderCell>Detektert repo</Table.HeaderCell>
                <Table.HeaderCell>Deployment</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {alerts.map((alert) => (
                <Table.Row key={alert.id}>
                  <Table.DataCell>{new Date(alert.created_at).toLocaleDateString('no-NO')}</Table.DataCell>
                  <Table.DataCell>
                    <Tag size="xsmall" variant="warning">
                      {alert.alert_type === 'repository_mismatch' && 'Ukjent repo'}
                      {alert.alert_type === 'pending_approval' && 'Venter godkjenning'}
                      {alert.alert_type === 'historical_repository' && 'Historisk repo'}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code className={styles.codeSmall}>
                      {alert.expected_github_owner}/{alert.expected_github_repo_name}
                    </code>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code className={styles.codeSmall}>
                      {alert.detected_github_owner}/{alert.detected_github_repo_name}
                    </code>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Button as={Link} to={`/deployments/${alert.deployment_id}`} size="xsmall" variant="tertiary">
                      Se deployment
                    </Button>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <div className={styles.marginTop1}>
            <Button as={Link} to="/alerts" variant="secondary" size="small">
              Se alle varsler →
            </Button>
          </div>
        </Box>
      )}

      {/* Repositories Section */}
      <Box background="neutral-soft" padding="space-16" borderRadius="12" className={styles.marginTop2}>
        <Heading size="medium" spacing>
          📦 Repositories
        </Heading>

        {/* Active Repository */}
        {activeRepo && (
          <div className={styles.marginBottom2}>
            <Label>Aktivt repository</Label>
            <div className={`${styles.flexRowSpaceBetween} ${styles.marginTop05}`}>
              <div className={styles.flexRowGap05}>
                <CheckmarkCircleIcon className={styles.textSuccess} />
                <a
                  href={`https://github.com/${activeRepo.github_owner}/${activeRepo.github_repo_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.linkExternal}
                >
                  {activeRepo.github_owner}/{activeRepo.github_repo_name}
                </a>
                <Tag size="xsmall" variant="success">
                  AKTIV
                </Tag>
              </div>
            </div>
          </div>
        )}

        {!activeRepo && (
          <Alert variant="warning" size="small" className={styles.marginBottom2}>
            Ingen aktivt repository satt for denne applikasjonen
          </Alert>
        )}

        {/* Pending Approval */}
        {pendingRepos.length > 0 && (
          <div className={styles.marginTop2}>
            <Label>Venter godkjenning ({pendingRepos.length})</Label>
            <Table size="small" className={styles.marginTop05}>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Repository</Table.HeaderCell>
                  <Table.HeaderCell>Opprettet</Table.HeaderCell>
                  <Table.HeaderCell>Handlinger</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {pendingRepos.map((repo) => (
                  <Table.Row key={repo.id}>
                    <Table.DataCell>
                      <div className={styles.flexRowGap05}>
                        <ExclamationmarkTriangleIcon className={styles.textWarning} />
                        <a
                          href={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.linkExternal}
                        >
                          {repo.github_owner}/{repo.github_repo_name}
                        </a>
                      </div>
                    </Table.DataCell>
                    <Table.DataCell>{new Date(repo.created_at).toLocaleDateString('no-NO')}</Table.DataCell>
                    <Table.DataCell>
                      <div className={styles.flexRowGap05}>
                        <form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="approve_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <input type="hidden" name="set_active" value="true" />
                          <Button type="submit" size="xsmall" variant="primary">
                            ✓ Godkjenn som aktiv
                          </Button>
                        </form>
                        <form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="approve_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <input type="hidden" name="set_active" value="false" />
                          <Button type="submit" size="xsmall" variant="secondary">
                            Godkjenn som historisk
                          </Button>
                        </form>
                        <form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="reject_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <Button type="submit" size="xsmall" variant="danger">
                            ✗ Avvis
                          </Button>
                        </form>
                      </div>
                    </Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}

        {/* Historical Repositories */}
        {historicalRepos.length > 0 && (
          <div className={styles.marginTop2}>
            <Label>Historiske repositories ({historicalRepos.length})</Label>
            <Table size="small" className={styles.marginTop05}>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Repository</Table.HeaderCell>
                  <Table.HeaderCell>Opprettet</Table.HeaderCell>
                  <Table.HeaderCell>Handlinger</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {historicalRepos.map((repo) => (
                  <Table.Row key={repo.id}>
                    <Table.DataCell>
                      <a
                        href={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.linkExternal}
                      >
                        {repo.github_owner}/{repo.github_repo_name}
                      </a>
                      {repo.redirects_to_owner && (
                        <Tag size="xsmall" variant="info" className={styles.marginLeft05}>
                          → {repo.redirects_to_owner}/{repo.redirects_to_repo}
                        </Tag>
                      )}
                    </Table.DataCell>
                    <Table.DataCell>{new Date(repo.created_at).toLocaleDateString('no-NO')}</Table.DataCell>
                    <Table.DataCell>
                      <form method="post" style={{ display: 'inline' }}>
                        <input type="hidden" name="action" value="set_active" />
                        <input type="hidden" name="repo_id" value={repo.id} />
                        <Button type="submit" size="xsmall" variant="secondary">
                          Sett som aktiv
                        </Button>
                      </form>
                    </Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}

        {repositories.length === 0 && <BodyShort>Ingen repositories registrert for denne applikasjonen</BodyShort>}
      </Box>

      <div className={styles.marginTop2}>
        <Button as={Link} to="/apps" variant="tertiary" size="small">
          ← Tilbake til applikasjoner
        </Button>
      </div>
    </div>
  )
}
