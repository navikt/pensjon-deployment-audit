import { BellIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, Hide, HStack, Show, Tag, VStack } from '@navikt/ds-react'
import { Link, useRouteLoaderData } from 'react-router'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getAlertCountsByApp } from '../db/alerts.server'
import { getAppDeploymentStats } from '../db/deployments.server'
import { getAllMonitoredApplications } from '../db/monitored-applications.server'
import styles from '../styles/common.module.css'
import type { Route } from './+types/home'
import type { loader as layoutLoader } from './layout'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pensjon Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' },
  ]
}

export async function loader(_args: Route.LoaderArgs) {
  try {
    const [apps, alertCountsByApp] = await Promise.all([getAllMonitoredApplications(), getAlertCountsByApp()])

    // Fetch active repository and deployment stats for each app
    const appsWithData = await Promise.all(
      apps.map(async (app) => {
        const repos = await getRepositoriesByAppId(app.id)
        const activeRepo = repos.find((r) => r.status === 'active')
        const appStats = await getAppDeploymentStats(app.id, undefined, undefined, app.audit_start_year)
        return {
          ...app,
          active_repo: activeRepo ? `${activeRepo.github_owner}/${activeRepo.github_repo_name}` : null,
          stats: appStats,
          alertCount: alertCountsByApp.get(app.id) || 0,
        }
      }),
    )

    return {
      apps: appsWithData,
    }
  } catch (_error) {
    return {
      apps: [],
    }
  }
}

function getStatusTag(appStats: { total: number; without_four_eyes: number; pending_verification: number }) {
  if (appStats.without_four_eyes > 0) {
    return (
      <Tag data-color="danger" variant="outline" size="small">
        <XMarkOctagonIcon aria-hidden /> {appStats.without_four_eyes} mangler
      </Tag>
    )
  }
  if (appStats.pending_verification > 0) {
    return (
      <Tag data-color="warning" variant="outline" size="small">
        <ExclamationmarkTriangleIcon aria-hidden /> {appStats.pending_verification} venter
      </Tag>
    )
  }
  if (appStats.total === 0) {
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

function getAppUrl(app: { team_slug: string; environment_name: string; app_name: string }) {
  return `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { apps } = loaderData
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/layout')
  const isAdmin = layoutData?.user?.role === 'admin'

  // Group apps by team
  type AppWithStats = (typeof apps)[number]
  const appsByTeam: Record<string, AppWithStats[]> = {}
  for (const app of apps) {
    if (!appsByTeam[app.team_slug]) {
      appsByTeam[app.team_slug] = []
    }
    appsByTeam[app.team_slug].push(app)
  }

  return (
    <VStack gap="space-32">
      {/* Add app button - only for admins */}
      {isAdmin && (
        <HStack justify="end">
          <Button as={Link} to="/apps/add" size="small" variant="secondary">
            Legg til applikasjon
          </Button>
        </HStack>
      )}

      {/* Empty state */}
      {apps.length === 0 && <Alert variant="info">Ingen applikasjoner overvåkes ennå.</Alert>}

      {/* App list grouped by team */}
      {Object.entries(appsByTeam).map(([teamSlug, teamApps]) => (
        <VStack key={teamSlug} gap="space-16">
          <Heading size="small">
            {teamSlug} ({teamApps.length})
          </Heading>

          <div>
            {teamApps.map((app) => (
              <Box key={app.id} padding="space-16" background="raised" className={styles.stackedListItem}>
                <VStack gap="space-12">
                  {/* First row: App name, environment (desktop), alert indicator, status tag */}
                  <HStack gap="space-8" align="center" justify="space-between" wrap>
                    <HStack gap="space-12" align="center" style={{ flex: 1 }}>
                      <Link to={getAppUrl(app)}>
                        <BodyShort weight="semibold">{app.app_name}</BodyShort>
                      </Link>
                      <Show above="md">
                        <Detail textColor="subtle">{app.environment_name}</Detail>
                      </Show>
                    </HStack>
                    <HStack gap="space-8" align="center">
                      {app.alertCount > 0 && (
                        <Link to={`${getAppUrl(app)}#varsler`} style={{ textDecoration: 'none' }}>
                          <Tag data-color="danger" variant="moderate" size="xsmall">
                            <BellIcon aria-hidden /> {app.alertCount}
                          </Tag>
                        </Link>
                      )}
                      {app.stats.without_four_eyes > 0 ? (
                        <Link
                          to={`${getAppUrl(app)}/deployments?status=not_approved&period=all`}
                          style={{ textDecoration: 'none' }}
                        >
                          {getStatusTag(app.stats)}
                        </Link>
                      ) : (
                        getStatusTag(app.stats)
                      )}
                    </HStack>
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
          </div>
        </VStack>
      ))}
    </VStack>
  )
}
