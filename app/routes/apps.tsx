import {
  ArrowsCirclepathIcon,
  CheckmarkCircleIcon,
  ExclamationmarkTriangleIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import { resolveAlertsForLegacyDeployments } from '~/db/alerts.server'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getAppDeploymentStats } from '~/db/deployments.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { syncDeploymentsFromNais, verifyDeploymentsFourEyes } from '~/lib/sync.server'
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

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'sync-nais') {
    const teamSlug = formData.get('team_slug') as string
    const environmentName = formData.get('environment_name') as string
    const appName = formData.get('app_name') as string

    try {
      const result = await syncDeploymentsFromNais(teamSlug, environmentName, appName)

      return {
        success: `Hentet ${result.newCount} nye deployments fra Nais. ${result.alertsCreated > 0 ? `⚠️ ${result.alertsCreated} nye varsler opprettet.` : ''} Kjør GitHub-verifisering for å sjekke four-eyes.`,
        error: null,
      }
    } catch (error) {
      console.error('Nais sync error:', error)
      return {
        success: null,
        error: error instanceof Error ? error.message : 'Kunne ikke hente deployments fra Nais',
      }
    }
  }

  if (intent === 'verify-github') {
    const monitoredAppId = Number(formData.get('monitored_app_id'))

    try {
      const result = await verifyDeploymentsFourEyes({
        monitored_app_id: monitoredAppId,
        limit: 1000, // Verify max 1000 deployments at a time
      })

      return {
        success: `Verifiserte ${result.verified} deployments med GitHub. ${result.failed > 0 ? `❌ ${result.failed} feilet.` : ''}`,
        error: null,
      }
    } catch (error) {
      console.error('GitHub verify error:', error)
      return {
        success: null,
        error:
          error instanceof Error
            ? error.message.includes('rate limit')
              ? 'GitHub rate limit nådd. Vent litt før du prøver igjen.'
              : error.message
            : 'Kunne ikke verifisere deployments med GitHub',
      }
    }
  }

  if (intent === 'resolve-legacy-alerts') {
    try {
      const result = await resolveAlertsForLegacyDeployments()
      return {
        success: `Oppdatert ${result.deploymentsUpdated} deployments til legacy status og løst ${result.alertsResolved} varsler.`,
        error: null,
      }
    } catch (error) {
      console.error('Resolve legacy alerts error:', error)
      return {
        success: null,
        error: error instanceof Error ? error.message : 'Kunne ikke løse legacy alerts',
      }
    }
  }

  return { success: null, error: 'Ugyldig handling' }
}

export default function Apps({ loaderData, actionData }: Route.ComponentProps) {
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
        <HStack gap="space-8">
          <Form method="post">
            <input type="hidden" name="intent" value="resolve-legacy-alerts" />
            <Button
              type="submit"
              variant="secondary"
              size="small"
              title="Oppdater deployments eldre enn 1 år uten commit SHA til legacy status"
            >
              Recheck legacy
            </Button>
          </Form>
          <Button as={Link} to="/apps/discover">
            Oppdag nye applikasjoner
          </Button>
        </HStack>
      </HStack>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

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

            <Table size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Status</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Godkjent repository</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {teamApps.map((app) => {
                  // Determine status based on deployment stats
                  let statusColor: 'success' | 'warning' | 'danger' = 'success'
                  let statusIcon = <CheckmarkCircleIcon />
                  let statusText = 'OK'

                  if (app.stats.without_four_eyes > 0) {
                    statusColor = 'danger'
                    statusIcon = <XMarkOctagonIcon />
                    statusText = `${app.stats.without_four_eyes} mangler`
                  } else if (app.stats.pending_verification > 0) {
                    statusColor = 'warning'
                    statusIcon = <ExclamationmarkTriangleIcon />
                    statusText = `${app.stats.pending_verification} venter`
                  } else if (app.stats.total === 0) {
                    statusColor = 'warning'
                    statusIcon = <ExclamationmarkTriangleIcon />
                    statusText = 'Ingen data'
                  }

                  return (
                    <Table.Row key={app.id}>
                      <Table.DataCell>
                        <Button as={Link} to={`/apps/${app.id}`} variant="tertiary" size="small">
                          {app.app_name}
                        </Button>
                      </Table.DataCell>
                      <Table.DataCell>{app.environment_name}</Table.DataCell>
                      <Table.DataCell>
                        {app.stats.without_four_eyes > 0 ? (
                          <Link to={`/deployments?app=${app.id}&only_missing=true`} style={{ textDecoration: 'none' }}>
                            <Tag data-color={statusColor} variant="outline" size="small">
                              {statusIcon} {statusText}
                            </Tag>
                          </Link>
                        ) : (
                          <Tag data-color={statusColor} variant="outline" size="small">
                            {statusIcon} {statusText}
                          </Tag>
                        )}
                      </Table.DataCell>
                      <Table.DataCell>
                        {app.active_repo ? (
                          <a href={`https://github.com/${app.active_repo}`} target="_blank" rel="noopener noreferrer">
                            {app.active_repo}
                          </a>
                        ) : (
                          <BodyShort textColor="subtle">(ingen aktivt repo)</BodyShort>
                        )}
                      </Table.DataCell>
                      <Table.DataCell>
                        <HStack gap="space-8">
                          <Form method="post">
                            <input type="hidden" name="intent" value="sync-nais" />
                            <input type="hidden" name="team_slug" value={app.team_slug} />
                            <input type="hidden" name="environment_name" value={app.environment_name} />
                            <input type="hidden" name="app_name" value={app.app_name} />
                            <Button
                              type="submit"
                              size="small"
                              variant="secondary"
                              icon={<ArrowsCirclepathIcon aria-hidden />}
                              title="Hent deployments fra Nais (ingen GitHub-kall)"
                            >
                              Hent
                            </Button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="verify-github" />
                            <input type="hidden" name="monitored_app_id" value={app.id} />
                            <Button
                              type="submit"
                              size="small"
                              variant="secondary"
                              icon={<CheckmarkCircleIcon aria-hidden />}
                              title="Verifiser four-eyes med GitHub (bruker rate limit)"
                            >
                              Verifiser
                            </Button>
                          </Form>
                        </HStack>
                      </Table.DataCell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </VStack>
        </Box>
      ))}
    </VStack>
  )
}
