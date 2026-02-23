import { ExternalLinkIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getAlertCountsByApp } from '~/db/alerts.server'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getAppDeploymentStats } from '~/db/deployments.server'
import { getApplicationsByTeamAndEnv } from '~/db/monitored-applications.server'
import type { Route } from './+types/team.$team.env.$env'

export async function loader({ params }: Route.LoaderArgs) {
  const { team, env } = params
  if (!team || !env) {
    throw new Response('Missing team or env parameter', { status: 400 })
  }

  const applications = await getApplicationsByTeamAndEnv(team, env)

  if (applications.length === 0) {
    throw new Response('Team/environment not found or has no monitored applications', { status: 404 })
  }

  const alertCountsByApp = await getAlertCountsByApp()

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

  return {
    team,
    env,
    apps: appsWithData,
  }
}

export function meta({ data }: { data?: { team: string; env: string } }) {
  return [{ title: `${data?.team ?? 'Team'} / ${data?.env ?? 'Env'} - Pensjon Deployment Audit` }]
}

export default function TeamEnvPage() {
  const { team, env, apps } = useLoaderData<typeof loader>()

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="xlarge">
            {team} / {env}
          </Heading>
          <HStack gap="space-16" align="center">
            <Tag size="small" variant="neutral">
              {apps.length} {apps.length === 1 ? 'app' : 'apper'}
            </Tag>
            <AkselLink href={`https://console.nav.cloud.nais.io/team/${team}/applications`} target="_blank">
              <HStack gap="space-4" align="center">
                NAIS Console <ExternalLinkIcon aria-hidden />
              </HStack>
            </AkselLink>
          </HStack>
        </VStack>

        <div>
          {apps.map((app) => (
            <AppCard key={app.id} app={app} showEnvironment={false} />
          ))}
        </div>
      </VStack>
    </Box>
  )
}
