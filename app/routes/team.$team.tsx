import { ExternalLinkIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getAlertCountsByApp } from '~/db/alerts.server'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getAppDeploymentStats } from '~/db/deployments.server'
import { getApplicationsByTeam } from '~/db/monitored-applications.server'
import type { Route } from './+types/team.$team'

export async function loader({ params: { team } }: Route.LoaderArgs) {
  const applications = await getApplicationsByTeam(team)

  if (applications.length === 0) {
    throw new Response('Team not found or has no monitored applications', { status: 404 })
  }

  const alertCountsByApp = await getAlertCountsByApp()

  // Fetch active repository and deployment stats for each app
  const appsWithData = await Promise.all(
    applications.map(async (app) => {
      const repos = await getRepositoriesByAppId(app.id)
      const activeRepo = repos.find((r) => r.status === 'active')
      const appStats = await getAppDeploymentStats(app.id, undefined, undefined, app.audit_start_year)
      return {
        ...app,
        active_repo: activeRepo ? `${activeRepo.github_owner}/${activeRepo.github_repo_name}` : null,
        stats: appStats,
        alertCount: alertCountsByApp.get(app.id) || 0,
      } satisfies AppCardData
    }),
  )

  // Group applications by environment
  const appsByEnv = appsWithData.reduce(
    (acc, app) => {
      if (!acc[app.environment_name]) {
        acc[app.environment_name] = []
      }
      acc[app.environment_name].push(app)
      return acc
    },
    {} as Record<string, AppCardData[]>,
  )

  return {
    team,
    appsByEnv,
  }
}

export default function TeamPage({ loaderData: { team, appsByEnv } }: Route.ComponentProps) {
  const environments = Object.keys(appsByEnv).sort()

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading size="xlarge">{team}</Heading>
          <HStack gap="space-8" align="center">
            <AkselLink href={`https://console.nav.cloud.nais.io/team/${team}/applications`} target="_blank">
              <HStack gap="space-4" align="center">
                NAIS Console <ExternalLinkIcon aria-hidden />
              </HStack>
            </AkselLink>
          </HStack>
        </VStack>

        <VStack gap="space-24">
          {environments.map((env) => (
            <VStack key={env} gap="space-16">
              <HStack gap="space-8" align="center">
                <Link to={`/team/${team}/env/${env}`} className="no-underline hover:underline">
                  <Heading size="small">{env}</Heading>
                </Link>
                <Tag size="xsmall" variant="neutral">
                  {appsByEnv[env].length} {appsByEnv[env].length === 1 ? 'app' : 'apper'}
                </Tag>
              </HStack>

              <div>
                {appsByEnv[env].map((app) => (
                  <AppCard key={app.id} app={app} showEnvironment={false} />
                ))}
              </div>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </Box>
  )
}
