import { BellIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  Hide,
  HStack,
  Show,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import { StatCard } from '~/components/StatCard'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getAlertCountsByApp } from '../db/alerts.server'
import { getAppDeploymentStats, getDeploymentStats } from '../db/deployments.server'
import { getAllMonitoredApplications } from '../db/monitored-applications.server'
import styles from '../styles/common.module.css'
import type { Route } from './+types/home'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pensjon Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' },
  ]
}

type AppStatus = 'all' | 'missing' | 'pending' | 'ok'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const statusFilter = (url.searchParams.get('status') || 'all') as AppStatus

  try {
    const [stats, apps, alertCountsByApp] = await Promise.all([
      getDeploymentStats(),
      getAllMonitoredApplications(),
      getAlertCountsByApp(),
    ])

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

    // Filter apps based on status
    const filteredApps = appsWithData.filter((app) => {
      if (statusFilter === 'all') return true
      if (statusFilter === 'missing') return app.stats.without_four_eyes > 0
      if (statusFilter === 'pending') return app.stats.pending_verification > 0
      if (statusFilter === 'ok')
        return app.stats.without_four_eyes === 0 && app.stats.pending_verification === 0 && app.stats.total > 0
      return true
    })

    return {
      stats,
      apps: filteredApps,
      allAppsCount: appsWithData.length,
      statusFilter,
    }
  } catch (_error) {
    return {
      stats: null,
      apps: [],
      allAppsCount: 0,
      statusFilter: 'all' as AppStatus,
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
  const { stats, apps, allAppsCount, statusFilter } = loaderData
  const [searchParams, setSearchParams] = useSearchParams()

  const updateFilter = (value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value === 'all') {
      newParams.delete('status')
    } else {
      newParams.set('status', value)
    }
    setSearchParams(newParams)
  }

  // Group apps by team
  type AppWithStats = (typeof apps)[number]
  const appsByTeam: Record<string, AppWithStats[]> = {}
  for (const app of apps) {
    if (!appsByTeam[app.team_slug]) {
      appsByTeam[app.team_slug] = []
    }
    appsByTeam[app.team_slug].push(app)
  }

  const filterLabels: Record<AppStatus, string> = {
    all: 'Alle applikasjoner',
    missing: 'Mangler godkjenning',
    pending: 'Venter verifisering',
    ok: 'Alt OK',
  }

  return (
    <VStack gap="space-32">
      {/* Stats - clickable cards that filter the list */}
      {stats && stats.total > 0 && (
        <HGrid gap="space-16" columns={{ xs: 2, sm: 4 }}>
          <StatCard
            label="Totalt deployments"
            value={stats.total}
            onClick={() => updateFilter('all')}
            selected={statusFilter === 'all'}
          />
          <StatCard
            label="Godkjent"
            value={stats.with_four_eyes}
            subtitle={`${stats.percentage}%`}
            variant="success"
            onClick={() => updateFilter('ok')}
            selected={statusFilter === 'ok'}
          />
          <StatCard
            label="Mangler godkjenning"
            value={stats.without_four_eyes}
            subtitle={`${(100 - stats.percentage).toFixed(1)}%`}
            variant="danger"
            onClick={() => updateFilter('missing')}
            selected={statusFilter === 'missing'}
          />
          <StatCard label="Applikasjoner" value={allAppsCount} onClick={() => updateFilter('all')} />
        </HGrid>
      )}

      {/* Add app button */}
      <HStack justify="end">
        <Button as={Link} to="/apps/discover" size="small" variant="secondary">
          Legg til applikasjon
        </Button>
      </HStack>

      {/* Empty states */}
      {allAppsCount === 0 && <Alert variant="info">Ingen applikasjoner overvåkes ennå.</Alert>}

      {apps.length === 0 && allAppsCount > 0 && statusFilter !== 'all' && (
        <Alert variant="success">Ingen applikasjoner matcher filteret "{filterLabels[statusFilter]}".</Alert>
      )}

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
