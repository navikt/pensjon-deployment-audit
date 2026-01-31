import { CheckmarkCircleIcon, ExclamationmarkTriangleIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, Hide, HStack, Show, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getAppDeploymentStats } from '~/db/deployments.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import type { Route } from './+types/apps'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Overvåkede applikasjoner - Pensjon Deployment Audit' }]
}

export async function loader() {
  const apps = await getAllMonitoredApplications()

  // Fetch active repository and deployment stats for each app
  const appsWithData = await Promise.all(
    apps.map(async (app) => {
      const repos = await getRepositoriesByAppId(app.id)
      const activeRepo = repos.find((r) => r.status === 'active')
      const stats = await getAppDeploymentStats(app.id)
      return {
        ...app,
        active_repo: activeRepo ? `${activeRepo.github_owner}/${activeRepo.github_repo_name}` : null,
        stats,
      }
    }),
  )

  return { apps: appsWithData }
}

function getStatusTag(stats: { total: number; without_four_eyes: number; pending_verification: number }) {
  if (stats.without_four_eyes > 0) {
    return (
      <Tag data-color="danger" variant="outline" size="small">
        <XMarkOctagonIcon aria-hidden /> {stats.without_four_eyes} mangler
      </Tag>
    )
  }
  if (stats.pending_verification > 0) {
    return (
      <Tag data-color="warning" variant="outline" size="small">
        <ExclamationmarkTriangleIcon aria-hidden /> {stats.pending_verification} venter
      </Tag>
    )
  }
  if (stats.total === 0) {
    return (
      <Tag data-color="warning" variant="outline" size="small">
        <ExclamationmarkTriangleIcon aria-hidden /> Ingen data
      </Tag>
    )
  }
  return (
    <Tag data-color="success" variant="outline" size="small">
      <CheckmarkCircleIcon aria-hidden /> OK
    </Tag>
  )
}

export default function Apps({ loaderData }: Route.ComponentProps) {
  const { apps } = loaderData

  // Group apps by team
  const appsByTeam = apps.reduce(
    (acc, app) => {
      if (!acc[app.team_slug]) {
        acc[app.team_slug] = []
      }
      acc[app.team_slug].push(app)
      return acc
    },
    {} as Record<string, typeof apps>,
  )

  return (
    <VStack gap="space-32">
      <HStack justify="space-between" align="start" wrap>
        <div>
          <Heading size="large" spacing>
            Overvåkede applikasjoner
          </Heading>
          <BodyShort textColor="subtle">Administrer hvilke applikasjoner som overvåkes for deployments.</BodyShort>
        </div>
        <Button as={Link} to="/apps/discover" size="small" variant="secondary">
          Legg til applikasjon
        </Button>
      </HStack>

      {apps.length === 0 && (
        <Alert variant="info">
          Ingen applikasjoner overvåkes ennå. <Link to="/apps/discover">Oppdag applikasjoner</Link> for å komme i gang.
        </Alert>
      )}

      {Object.entries(appsByTeam).map(([teamSlug, teamApps]) => (
        <Box
          key={teamSlug}
          padding="space-20"
          borderRadius="8"
          background="raised"
          borderColor="neutral-subtle"
          borderWidth="1"
        >
          <VStack gap="space-16">
            <Heading size="medium">
              {teamSlug} ({teamApps.length} applikasjoner)
            </Heading>

            <VStack gap="space-12">
              {teamApps.map((app) => (
                <Box key={app.id} padding="space-16" borderRadius="8" background="sunken">
                  <VStack gap="space-12">
                    {/* First row: App name, environment (desktop), status tag */}
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-12" align="center" style={{ flex: 1 }}>
                        <Link to={`/apps/${app.id}`}>
                          <BodyShort weight="semibold">{app.app_name}</BodyShort>
                        </Link>
                        <Show above="md">
                          <Detail textColor="subtle">{app.environment_name}</Detail>
                        </Show>
                      </HStack>
                      {app.stats.without_four_eyes > 0 ? (
                        <Link to={`/deployments?app=${app.id}&only_missing=true`} style={{ textDecoration: 'none' }}>
                          {getStatusTag(app.stats)}
                        </Link>
                      ) : (
                        getStatusTag(app.stats)
                      )}
                    </HStack>

                    {/* Environment on mobile */}
                    <Hide above="md">
                      <Detail textColor="subtle">{app.environment_name}</Detail>
                    </Hide>

                    {/* Repository row */}
                    <Detail textColor="subtle">
                      {app.active_repo ? (
                        <a href={`https://github.com/${app.active_repo}`} target="_blank" rel="noopener noreferrer">
                          {app.active_repo}
                        </a>
                      ) : (
                        '(ingen aktivt repo)'
                      )}
                    </Detail>
                  </VStack>
                </Box>
              ))}
            </VStack>
          </VStack>
        </Box>
      ))}
    </VStack>
  )
}
