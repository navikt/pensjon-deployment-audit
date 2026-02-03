import { PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Tag, TextField, VStack } from '@navikt/ds-react'
import { Form, useNavigation } from 'react-router'
import { upsertApplicationRepository } from '../db/application-repositories.server'
import { createMonitoredApplication, getAllMonitoredApplications } from '../db/monitored-applications.server'
import { fetchAllTeamsAndApplications, getApplicationInfo } from '../lib/nais.server'
import type { Route } from './+types/apps.add'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Legg til applikasjon - Pensjon Deployment Audit' }]
}

export async function loader() {
  try {
    // Get allowed environments from config (comma-separated)
    const allowedEnvs = process.env.ALLOWED_ENVIRONMENTS?.split(',').map((e) => e.trim()) || []

    // Fetch all teams and applications on page load
    let allApps = await fetchAllTeamsAndApplications()

    // Filter by allowed environments if configured
    if (allowedEnvs.length > 0) {
      allApps = allApps.filter((app) => allowedEnvs.includes(app.environmentName))
    }

    // Fetch already monitored apps
    const monitoredApps = await getAllMonitoredApplications()
    const monitoredKeys = new Set(
      monitoredApps.map((app) => `${app.team_slug}|${app.environment_name}|${app.app_name}`),
    )
    return { allApps, monitoredKeys: Array.from(monitoredKeys), error: null }
  } catch (error) {
    console.error('Loader error:', error)
    return {
      allApps: [],
      monitoredKeys: [],
      error: error instanceof Error ? error.message : 'Kunne ikke laste applikasjoner',
    }
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  // Add single application
  if (intent === 'add') {
    const teamSlug = formData.get('team_slug') as string
    const environmentName = formData.get('environment_name') as string
    const appName = formData.get('app_name') as string

    if (!teamSlug || !environmentName || !appName) {
      return { error: 'Mangler påkrevde felt', success: null }
    }

    try {
      // Get app info to find repository
      const appInfo = await getApplicationInfo(teamSlug, environmentName, appName)

      // Create monitored application
      const monitoredApp = await createMonitoredApplication({
        team_slug: teamSlug,
        environment_name: environmentName,
        app_name: appName,
      })

      // If we found a repository, add it as active
      if (appInfo?.repository) {
        const [owner, repo] = appInfo.repository.split('/')
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: owner,
          githubRepoName: repo,
          status: 'active',
          approvedBy: 'user',
        })
      }

      return {
        error: null,
        success: `La til ${appName} (${environmentName}) for overvåking`,
      }
    } catch (error) {
      console.error('Add error:', error)
      return {
        error: error instanceof Error ? error.message : 'Kunne ikke legge til applikasjon',
        success: null,
      }
    }
  }

  return { error: 'Ugyldig handling', success: null }
}

import { useState } from 'react'

export default function AppsDiscover({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation()
  const isAdding = navigation.state === 'submitting'
  const addingApp = navigation.formData?.get('app_name') as string | null

  const [searchQuery, setSearchQuery] = useState('')
  const monitoredKeys = new Set(loaderData.monitoredKeys)

  // Filter apps based on search query
  const filteredApps = loaderData.allApps.filter((app) => {
    const query = searchQuery.toLowerCase()
    return app.teamSlug.toLowerCase().includes(query) || app.appName.toLowerCase().includes(query)
  })

  // Group by team -> environment for display
  type AppInfo = { appName: string; environmentName: string }
  const appsByTeamAndEnv = filteredApps.reduce(
    (acc, app) => {
      const teamKey = app.teamSlug
      if (!acc[teamKey]) {
        acc[teamKey] = {}
      }
      if (!acc[teamKey][app.environmentName]) {
        acc[teamKey][app.environmentName] = []
      }
      acc[teamKey][app.environmentName].push({
        appName: app.appName,
        environmentName: app.environmentName,
      })
      return acc
    },
    {} as Record<string, Record<string, AppInfo[]>>,
  )

  const totalResults = filteredApps.length
  const totalTeams = Object.keys(appsByTeamAndEnv).length

  return (
    <VStack gap="space-32">
      <Heading size="large">Legg til applikasjon</Heading>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}
      {loaderData.error && <Alert variant="error">{loaderData.error}</Alert>}

      {!loaderData.error && (
        <>
          <Box padding="space-20" borderRadius="8" background="sunken">
            <TextField
              label="Søk etter team eller applikasjon"
              description={searchQuery ? `Viser ${totalResults} treff fra ${totalTeams} team` : undefined}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="F.eks. pensjon, pen, rocket..."
            />
          </Box>

          {searchQuery && (
            <VStack gap="space-24">
              {Object.entries(appsByTeamAndEnv)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([teamSlug, envs]) => (
                  <Box
                    key={teamSlug}
                    padding="space-20"
                    borderRadius="8"
                    background="raised"
                    borderColor="neutral-subtle"
                    borderWidth="1"
                  >
                    <VStack gap="space-16">
                      <Heading size="small">{teamSlug}</Heading>

                      {Object.entries(envs)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([envName, apps]) => (
                          <VStack key={envName} gap="space-8">
                            <Detail textColor="subtle">{envName}</Detail>
                            <VStack gap="space-4">
                              {apps
                                .sort((a, b) => a.appName.localeCompare(b.appName))
                                .map((app) => {
                                  const appKey = `${teamSlug}|${envName}|${app.appName}`
                                  const isMonitored = monitoredKeys.has(appKey)
                                  const isAddingThis = isAdding && addingApp === app.appName

                                  return (
                                    <HStack
                                      key={appKey}
                                      gap="space-8"
                                      align="center"
                                      justify="space-between"
                                      wrap
                                      style={isMonitored ? { opacity: 0.5 } : undefined}
                                    >
                                      <BodyShort weight="semibold">{app.appName}</BodyShort>
                                      {isMonitored ? (
                                        <Tag size="xsmall" variant="outline" data-color="success">
                                          Overvåkes
                                        </Tag>
                                      ) : (
                                        <Form method="post" style={{ display: 'inline' }}>
                                          <input type="hidden" name="intent" value="add" />
                                          <input type="hidden" name="team_slug" value={teamSlug} />
                                          <input type="hidden" name="environment_name" value={envName} />
                                          <input type="hidden" name="app_name" value={app.appName} />
                                          <Button
                                            type="submit"
                                            size="xsmall"
                                            variant="secondary"
                                            icon={<PlusIcon aria-hidden />}
                                            disabled={isAdding}
                                            loading={isAddingThis}
                                          >
                                            Legg til
                                          </Button>
                                        </Form>
                                      )}
                                    </HStack>
                                  )
                                })}
                            </VStack>
                          </VStack>
                        ))}
                    </VStack>
                  </Box>
                ))}
            </VStack>
          )}

          {!searchQuery && <Alert variant="info">Skriv inn et søkeord for å finne applikasjoner.</Alert>}
        </>
      )}
    </VStack>
  )
}
