import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  Detail,
  Heading,
  HGrid,
  Select,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Form, Link, useSearchParams } from 'react-router'
import { type DeploymentWithApp, getAllDeployments } from '~/db/deployments.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getDateRange } from '~/lib/nais.server'
import type { Route } from './+types/deployments'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const appId = url.searchParams.get('app')
  const teamSlug = url.searchParams.get('team')
  const period = url.searchParams.get('period') || 'last-month'
  const onlyMissing = url.searchParams.get('only_missing') === 'true'
  const environment = url.searchParams.get('environment')

  let startDate: Date | undefined
  let endDate: Date | undefined

  if (period !== 'all') {
    const range = getDateRange(period as any)
    startDate = range.startDate
    endDate = range.endDate
  }

  const deployments = await getAllDeployments({
    monitored_app_id: appId ? parseInt(appId, 10) : undefined,
    team_slug: teamSlug || undefined,
    start_date: startDate,
    end_date: endDate,
    only_missing_four_eyes: onlyMissing,
    environment_name: environment || undefined,
  })

  const apps = await getAllMonitoredApplications()

  // Get unique teams and environments
  const teams = Array.from(new Set(deployments.map((d) => d.team_slug))).sort()
  const environments = Array.from(new Set(deployments.map((d) => d.environment_name))).sort()

  return { deployments, apps, teams, environments }
}

function getFourEyesLabel(deployment: DeploymentWithApp): {
  text: string
  color: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
} {
  if (deployment.has_four_eyes) {
    return { text: 'Godkjent PR', color: 'success' }
  }

  switch (deployment.four_eyes_status) {
    case 'approved':
    case 'approved_pr':
      return { text: 'Godkjent PR', color: 'success' }
    case 'baseline':
      return { text: 'Baseline', color: 'success' }
    case 'no_changes':
      return { text: 'Ingen endringer', color: 'success' }
    case 'unverified_commits':
      return { text: 'Uverifiserte commits', color: 'danger' }
    case 'approved_pr_with_unreviewed':
      return { text: 'Ureviewed i merge', color: 'danger' }
    case 'legacy':
      return { text: 'Legacy (ignorert)', color: 'success' }
    case 'direct_push':
      return { text: 'Direct push', color: 'warning' }
    case 'missing':
      return { text: 'Mangler godkjenning', color: 'danger' }
    case 'error':
      return { text: 'Feil ved sjekk', color: 'danger' }
    case 'pending':
      return { text: 'Venter', color: 'info' }
    default:
      return { text: 'Ukjent status', color: 'neutral' }
  }
}

function getDeploymentMethod(deployment: DeploymentWithApp): {
  type: 'pr' | 'direct' | 'unknown'
  label: string
  prNumber: number | null
  prUrl: string | null
} {
  if (deployment.github_pr_number && deployment.github_pr_url) {
    return {
      type: 'pr',
      label: `PR #${deployment.github_pr_number}`,
      prNumber: deployment.github_pr_number,
      prUrl: deployment.github_pr_url,
    }
  }
  if (deployment.four_eyes_status === 'direct_push' || deployment.four_eyes_status === 'unverified_commits') {
    return {
      type: 'direct',
      label: 'Direct push',
      prNumber: null,
      prUrl: null,
    }
  }
  if (deployment.four_eyes_status === 'legacy') {
    return {
      type: 'unknown',
      label: 'Legacy',
      prNumber: null,
      prUrl: null,
    }
  }
  if (deployment.four_eyes_status === 'pending') {
    return {
      type: 'unknown',
      label: 'Venter...',
      prNumber: null,
      prUrl: null,
    }
  }
  return {
    type: 'unknown',
    label: '-',
    prNumber: null,
    prUrl: null,
  }
}

export default function Deployments({ loaderData }: Route.ComponentProps) {
  const { deployments, apps, teams, environments } = loaderData
  const [searchParams] = useSearchParams()

  const currentApp = searchParams.get('app')
  const currentTeam = searchParams.get('team')
  const currentPeriod = searchParams.get('period') || 'last-month'
  const onlyMissing = searchParams.get('only_missing') === 'true'
  const currentEnvironment = searchParams.get('environment')

  const stats = {
    total: deployments.length,
    withFourEyes: deployments.filter((d) => d.has_four_eyes).length,
    withoutFourEyes: deployments.filter((d) => !d.has_four_eyes).length,
  }

  const percentage = stats.total > 0 ? Math.round((stats.withFourEyes / stats.total) * 100) : 0

  return (
    <VStack gap="space-32">
      <div>
        <Heading size="large" spacing>
          Deployments
        </Heading>
        <BodyShort textColor="subtle">
          {stats.total} deployments totalt • {stats.withFourEyes} med four-eyes ({percentage}%) •{' '}
          {stats.withoutFourEyes} mangler four-eyes
        </BodyShort>
      </div>

      <Box padding="space-20" borderRadius="8" background="sunken">
        <Form method="get" onChange={(e) => e.currentTarget.submit()}>
          <VStack gap="space-16">
            <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
              <Select label="Team" name="team" defaultValue={currentTeam || ''}>
                <option value="">Alle teams</option>
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </Select>

              <Select label="Applikasjon" name="app" defaultValue={currentApp || ''}>
                <option value="">Alle applikasjoner</option>
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.app_name} ({app.environment_name})
                  </option>
                ))}
              </Select>

              <Select label="Miljø" name="environment" defaultValue={currentEnvironment || ''}>
                <option value="">Alle miljøer</option>
                {environments.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </Select>

              <Select label="Tidsperiode" name="period" defaultValue={currentPeriod}>
                <option value="last-month">Siste måned</option>
                <option value="last-12-months">Siste 12 måneder</option>
                <option value="this-year">I år</option>
                <option value="year-2025">Hele 2025</option>
                <option value="all">Alle</option>
              </Select>
            </HGrid>

            <Checkbox name="only_missing" value="true" defaultChecked={onlyMissing}>
              Vis kun deployments som mangler four-eyes
            </Checkbox>
          </VStack>
        </Form>
      </Box>

      {deployments.length === 0 ? (
        <Alert variant="info">
          Ingen deployments funnet med de valgte filtrene. Prøv å endre filtrene eller synkroniser deployments fra
          applikasjoner.
        </Alert>
      ) : (
        <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
                <Table.HeaderCell>Applikasjon</Table.HeaderCell>
                <Table.HeaderCell>Miljø</Table.HeaderCell>
                <Table.HeaderCell>Metode</Table.HeaderCell>
                <Table.HeaderCell>Deployer</Table.HeaderCell>
                <Table.HeaderCell>Commit</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {deployments.map((deployment) => {
                const status = getFourEyesLabel(deployment)
                const method = getDeploymentMethod(deployment)

                return (
                  <Table.Row key={deployment.id}>
                    <Table.DataCell>
                      <Detail textColor="subtle">
                        {new Date(deployment.created_at).toLocaleString('no-NO', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Detail>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Link to={`/apps/${deployment.monitored_app_id}`}>
                        <strong>{deployment.app_name}</strong>
                      </Link>
                    </Table.DataCell>
                    <Table.DataCell>
                      <code style={{ fontSize: '0.75rem' }}>{deployment.environment_name}</code>
                    </Table.DataCell>
                    <Table.DataCell>
                      {method.type === 'pr' && method.prUrl ? (
                        <Link to={method.prUrl} target="_blank">
                          <Tag data-color="info" variant="outline" size="small">
                            {method.label}
                          </Tag>
                        </Link>
                      ) : method.type === 'direct' ? (
                        <Tag data-color="warning" variant="outline" size="small">
                          {method.label}
                        </Tag>
                      ) : (
                        <Detail textColor="subtle">{method.label}</Detail>
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      {deployment.deployer_username || <Detail textColor="subtle">(ukjent)</Detail>}
                    </Table.DataCell>
                    <Table.DataCell>
                      {deployment.commit_sha ? (
                        <Link
                          to={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                          target="_blank"
                        >
                          <code style={{ fontSize: '0.8rem' }}>{deployment.commit_sha.substring(0, 7)}</code>
                        </Link>
                      ) : (
                        <Detail textColor="subtle">(ukjent)</Detail>
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      <Tag data-color={status.color} variant="outline" size="small">
                        {deployment.has_four_eyes ? '✓' : '✗'} {status.text}
                      </Tag>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Button as={Link} to={`/deployments/${deployment.id}`} size="small" variant="secondary">
                        Vis
                      </Button>
                    </Table.DataCell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        </Box>
      )}
    </VStack>
  )
}
