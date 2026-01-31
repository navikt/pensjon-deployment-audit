import {
  CheckmarkIcon,
  ExclamationmarkTriangleIcon,
  XMarkIcon,
} from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  Detail,
  Heading,
  HGrid,
  Hide,
  HStack,
  Select,
  Show,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Form, Link, useSearchParams } from 'react-router'
import { type DeploymentWithApp, getAllDeployments } from '~/db/deployments.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getUserMappings } from '~/db/user-mappings.server'
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

  // Get display names for deployers
  const deployerUsernames = [...new Set(deployments.map((d) => d.deployer_username).filter(Boolean))] as string[]
  const userMappingsMap = await getUserMappings(deployerUsernames)
  const userMappings: Record<string, string> = {}
  for (const [username, mapping] of userMappingsMap) {
    if (mapping.display_name) {
      userMappings[username] = mapping.display_name
    }
  }

  return { deployments, apps, teams, environments, userMappings }
}

function getMethodTag(deployment: DeploymentWithApp) {
  if (deployment.github_pr_number) {
    return (
      <Tag data-color="info" variant="outline" size="small">
        PR #{deployment.github_pr_number}
      </Tag>
    )
  }
  if (deployment.four_eyes_status === 'legacy') {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Legacy
      </Tag>
    )
  }
  return (
    <Tag data-color="warning" variant="outline" size="small">
      Direct Push
    </Tag>
  )
}

function getStatusTag(deployment: DeploymentWithApp) {
  if (deployment.has_four_eyes) {
    return (
      <Tag data-color="success" variant="outline" size="small">
        <CheckmarkIcon aria-hidden /> Godkjent
      </Tag>
    )
  }
  switch (deployment.four_eyes_status) {
    case 'pending':
      return (
        <Tag data-color="neutral" variant="outline" size="small">
          Venter
        </Tag>
      )
    case 'direct_push':
    case 'unverified_commits':
      return (
        <Tag data-color="warning" variant="outline" size="small">
          <XMarkIcon aria-hidden /> Ikke godkjent
        </Tag>
      )
    case 'approved_pr_with_unreviewed':
      return (
        <Tag data-color="warning" variant="outline" size="small">
          <ExclamationmarkTriangleIcon aria-hidden /> Ureviewed
        </Tag>
      )
    case 'error':
    case 'missing':
      return (
        <Tag data-color="danger" variant="outline" size="small">
          <XMarkIcon aria-hidden /> Feil
        </Tag>
      )
    default:
      return (
        <Tag data-color="neutral" variant="outline" size="small">
          {deployment.four_eyes_status}
        </Tag>
      )
  }
}

export default function Deployments({ loaderData }: Route.ComponentProps) {
  const { deployments, apps, teams, environments, userMappings } = loaderData
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
        <VStack gap="space-16">
          {deployments.map((deployment) => (
            <Box key={deployment.id} padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
              <VStack gap="space-12">
                {/* First row: Time, App name (desktop), Tags */}
                <HStack gap="space-8" align="center" justify="space-between" wrap>
                  <HStack gap="space-12" align="center" style={{ flex: 1 }}>
                    <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(deployment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </BodyShort>
                    {/* App name and environment on desktop */}
                    <Show above="md">
                      <HStack gap="space-8" align="center">
                        <Link to={`/apps/${deployment.monitored_app_id}`}>
                          <BodyShort weight="semibold">{deployment.app_name}</BodyShort>
                        </Link>
                        <Detail textColor="subtle">{deployment.environment_name}</Detail>
                      </HStack>
                    </Show>
                  </HStack>
                  <HStack gap="space-8">
                    {getMethodTag(deployment)}
                    {getStatusTag(deployment)}
                  </HStack>
                </HStack>

                {/* App name on mobile - separate line */}
                <Hide above="md">
                  <HStack gap="space-8" align="center">
                    <Link to={`/apps/${deployment.monitored_app_id}`}>
                      <BodyShort weight="semibold">{deployment.app_name}</BodyShort>
                    </Link>
                    <Detail textColor="subtle">{deployment.environment_name}</Detail>
                  </HStack>
                </Hide>

                {/* Second row: Deployer, commit, and View button */}
                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  <HStack gap="space-16" wrap>
                    <Detail textColor="subtle">
                      {deployment.deployer_username ? (
                        <a
                          href={`https://github.com/${deployment.deployer_username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={deployment.deployer_username}
                        >
                          {userMappings[deployment.deployer_username] || deployment.deployer_username}
                        </a>
                      ) : (
                        '(ukjent)'
                      )}
                    </Detail>
                    <Detail textColor="subtle">
                      {deployment.commit_sha ? (
                        <a
                          href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontFamily: 'monospace' }}
                        >
                          {deployment.commit_sha.substring(0, 7)}
                        </a>
                      ) : (
                        '(ukjent)'
                      )}
                    </Detail>
                    {deployment.github_pr_url && (
                      <Detail textColor="subtle">
                        <a href={deployment.github_pr_url} target="_blank" rel="noopener noreferrer">
                          PR #{deployment.github_pr_number}
                        </a>
                      </Detail>
                    )}
                  </HStack>
                  <Button as={Link} to={`/deployments/${deployment.id}`} variant="tertiary" size="small">
                    Vis
                  </Button>
                </HStack>
              </VStack>
            </Box>
          ))}
        </VStack>
      )}
    </VStack>
  )
}
