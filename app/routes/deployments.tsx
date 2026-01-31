import { ChevronLeftIcon, ChevronRightIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Heading, HGrid, Hide, HStack, Select, Show, VStack } from '@navikt/ds-react'
import { Form, Link, useSearchParams } from 'react-router'
import { MethodTag, StatusTag } from '~/components/deployment-tags'
import { getDeploymentsPaginated } from '~/db/deployments.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getUserMappings } from '~/db/user-mappings.server'
import { getDateRange } from '~/lib/nais.server'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/deployments'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const appId = url.searchParams.get('app')
  const teamSlug = url.searchParams.get('team')
  const period = url.searchParams.get('period') || 'last-month'
  const environment = url.searchParams.get('environment')
  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const page = parseInt(url.searchParams.get('page') || '1', 10)

  let startDate: Date | undefined
  let endDate: Date | undefined

  if (period !== 'all') {
    const range = getDateRange(period as any)
    startDate = range.startDate
    endDate = range.endDate
  }

  const result = await getDeploymentsPaginated({
    monitored_app_id: appId ? parseInt(appId, 10) : undefined,
    team_slug: teamSlug || undefined,
    start_date: startDate,
    end_date: endDate,
    environment_name: environment || undefined,
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    page,
    per_page: 50,
  })

  const apps = await getAllMonitoredApplications()

  // Get unique teams from all apps (not just current page)
  const allTeams = Array.from(new Set(apps.map((a) => a.team_slug))).sort()
  const allEnvironments = Array.from(new Set(apps.map((a) => a.environment_name))).sort()

  // Get display names for deployers
  const deployerUsernames = [...new Set(result.deployments.map((d) => d.deployer_username).filter(Boolean))] as string[]
  const userMappingsMap = await getUserMappings(deployerUsernames)
  const userMappings: Record<string, string> = {}
  for (const [username, mapping] of userMappingsMap) {
    if (mapping.display_name) {
      userMappings[username] = mapping.display_name
    }
  }

  return {
    deployments: result.deployments,
    total: result.total,
    page: result.page,
    total_pages: result.total_pages,
    apps,
    teams: allTeams,
    environments: allEnvironments,
    userMappings,
  }
}

export default function Deployments({ loaderData }: Route.ComponentProps) {
  const { deployments, total, page, total_pages, apps, teams, environments, userMappings } = loaderData
  const [searchParams, setSearchParams] = useSearchParams()

  const currentApp = searchParams.get('app')
  const currentTeam = searchParams.get('team')
  const currentPeriod = searchParams.get('period') || 'last-month'
  const currentEnvironment = searchParams.get('environment')
  const currentStatus = searchParams.get('status') || ''
  const currentMethod = searchParams.get('method') || ''

  const goToPage = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', String(newPage))
    setSearchParams(newParams)
  }

  return (
    <VStack gap="space-32">
      <div>
        <Heading size="large" spacing>
          Deployments
        </Heading>
        <BodyShort textColor="subtle">
          {total} deployments totalt
          {total_pages > 1 && ` • Side ${page} av ${total_pages}`}
        </BodyShort>
      </div>

      <Box padding="space-20" borderRadius="8" background="sunken">
        <Form method="get" onChange={(e) => e.currentTarget.submit()}>
          <VStack gap="space-16">
            <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 3 }}>
              <Select label="Team" name="team" size="small" defaultValue={currentTeam || ''}>
                <option value="">Alle teams</option>
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </Select>

              <Select label="Applikasjon" name="app" size="small" defaultValue={currentApp || ''}>
                <option value="">Alle applikasjoner</option>
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.app_name} ({app.environment_name})
                  </option>
                ))}
              </Select>

              <Select label="Miljø" name="environment" size="small" defaultValue={currentEnvironment || ''}>
                <option value="">Alle miljøer</option>
                {environments.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </Select>

              <Select label="Tidsperiode" name="period" size="small" defaultValue={currentPeriod}>
                <option value="last-month">Siste måned</option>
                <option value="last-12-months">Siste 12 måneder</option>
                <option value="this-year">I år</option>
                <option value="year-2025">Hele 2025</option>
                <option value="all">Alle</option>
              </Select>

              <Select label="Status" name="status" size="small" defaultValue={currentStatus}>
                <option value="">Alle</option>
                <option value="approved">Godkjent</option>
                <option value="manually_approved">Manuelt godkjent</option>
                <option value="not_approved">Ikke godkjent</option>
                <option value="pending">Venter</option>
                <option value="legacy">Legacy</option>
                <option value="error">Feil</option>
              </Select>

              <Select label="Metode" name="method" size="small" defaultValue={currentMethod}>
                <option value="">Alle</option>
                <option value="pr">Pull Request</option>
                <option value="direct_push">Direct Push</option>
                <option value="legacy">Legacy</option>
              </Select>
            </HGrid>
          </VStack>
        </Form>
      </Box>

      {deployments.length === 0 ? (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <BodyShort>Ingen deployments funnet med valgte filtre.</BodyShort>
        </Box>
      ) : (
        <div>
          {deployments.map((deployment) => (
            <Box key={deployment.id} padding="space-20" background="raised" className={styles.stackedListItem}>
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
                    {/* App name, environment and title on desktop */}
                    <Show above="md">
                      <HStack gap="space-8" align="center" style={{ flex: 1 }}>
                        <Link to={`/apps/${deployment.monitored_app_id}`}>
                          <BodyShort weight="semibold">{deployment.app_name}</BodyShort>
                        </Link>
                        <Detail textColor="subtle">{deployment.environment_name}</Detail>
                        {deployment.title && (
                          <BodyShort style={{ flex: 1 }} truncate>
                            - {deployment.title}
                          </BodyShort>
                        )}
                      </HStack>
                    </Show>
                  </HStack>
                  <HStack gap="space-8">
                    <MethodTag
                      github_pr_number={deployment.github_pr_number}
                      four_eyes_status={deployment.four_eyes_status}
                    />
                    <StatusTag
                      four_eyes_status={deployment.four_eyes_status}
                      has_four_eyes={deployment.has_four_eyes}
                    />
                  </HStack>
                </HStack>

                {/* App name and title on mobile - separate line */}
                <Hide above="md">
                  <VStack gap="space-4">
                    <HStack gap="space-8" align="center">
                      <Link to={`/apps/${deployment.monitored_app_id}`}>
                        <BodyShort weight="semibold">{deployment.app_name}</BodyShort>
                      </Link>
                      <Detail textColor="subtle">{deployment.environment_name}</Detail>
                    </HStack>
                    {deployment.title && <BodyShort truncate>{deployment.title}</BodyShort>}
                  </VStack>
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
                          #{deployment.github_pr_number}
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
        </div>
      )}

      {/* Pagination */}
      {total_pages > 1 && (
        <HStack gap="space-16" justify="center" align="center">
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronLeftIcon aria-hidden />}
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Forrige
          </Button>
          <BodyShort>
            Side {page} av {total_pages}
          </BodyShort>
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronRightIcon aria-hidden />}
            iconPosition="right"
            disabled={page >= total_pages}
            onClick={() => goToPage(page + 1)}
          >
            Neste
          </Button>
        </HStack>
      )}
    </VStack>
  )
}
