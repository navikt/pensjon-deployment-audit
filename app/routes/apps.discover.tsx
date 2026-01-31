import { PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Checkbox, Detail, Heading, Table, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, useNavigation } from 'react-router'
import { upsertApplicationRepository } from '../db/application-repositories.server'
import { createMonitoredApplication } from '../db/monitored-applications.server'
import { fetchAllTeamsAndApplications, getApplicationInfo } from '../lib/nais.server'
import type { Route } from './+types/apps.discover'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Oppdag applikasjoner - Pensjon Deployment Audit' }]
}

export async function loader() {
  try {
    // Fetch all teams and applications on page load
    const allApps = await fetchAllTeamsAndApplications()
    return { allApps, error: null }
  } catch (error) {
    console.error('Loader error:', error)
    return {
      allApps: [],
      error: error instanceof Error ? error.message : 'Kunne ikke laste applikasjoner',
    }
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  // Add selected applications
  if (intent === 'add') {
    const selectedApps = formData.getAll('app')

    if (!selectedApps.length) {
      return {
        error: 'Velg minst én applikasjon',
      }
    }

    try {
      let addedCount = 0

      for (const appKey of selectedApps) {
        const [teamSlug, appName] = (appKey as string).split('|')

        // Discover which environment this app is in (try common ones)
        const commonEnvs = ['dev-gcp', 'dev-fss', 'prod-gcp', 'prod-fss']
        let appInfo = null
        let foundEnv = null

        for (const env of commonEnvs) {
          appInfo = await getApplicationInfo(teamSlug, env, appName)
          if (appInfo) {
            foundEnv = env
            break
          }
        }

        if (!appInfo || !foundEnv) {
          console.warn(`Could not find app info for ${teamSlug}/${appName}`)
          continue
        }

        // Create monitored application (without repo fields)
        const monitoredApp = await createMonitoredApplication({
          team_slug: teamSlug,
          environment_name: foundEnv,
          app_name: appName,
        })

        // If we found a repository, add it as active
        if (appInfo.repository) {
          const [owner, repo] = appInfo.repository.split('/')
          await upsertApplicationRepository({
            monitoredAppId: monitoredApp.id,
            githubOwner: owner,
            githubRepoName: repo,
            status: 'active',
            approvedBy: 'user',
          })
        }

        addedCount++
      }

      return {
        error: null,
        success: `La til ${addedCount} applikasjon(er) for overvåking`,
      }
    } catch (error) {
      console.error('Add error:', error)
      return {
        error: error instanceof Error ? error.message : 'Kunne ikke legge til applikasjoner',
      }
    }
  }

  return { error: 'Ugyldig handling' }
}

export default function AppsDiscover({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation()
  const isAdding = navigation.state === 'submitting'

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set())

  // Filter apps based on search query
  const filteredApps = loaderData.allApps.filter((app) => {
    const query = searchQuery.toLowerCase()
    return app.teamSlug.toLowerCase().includes(query) || app.appName.toLowerCase().includes(query)
  })

  // Group by team for display
  const appsByTeam = filteredApps.reduce(
    (acc, app) => {
      if (!acc[app.teamSlug]) {
        acc[app.teamSlug] = []
      }
      acc[app.teamSlug].push(app.appName)
      return acc
    },
    {} as Record<string, string[]>,
  )

  const toggleApp = (appKey: string) => {
    const newSelected = new Set(selectedApps)
    if (newSelected.has(appKey)) {
      newSelected.delete(appKey)
    } else {
      newSelected.add(appKey)
    }
    setSelectedApps(newSelected)
  }

  const totalResults = filteredApps.length
  const totalTeams = Object.keys(appsByTeam).length

  return (
    <VStack gap="space-32">
      <div>
        <Heading size="large" spacing>
          Oppdag applikasjoner
        </Heading>
        <BodyShort textColor="subtle">
          Søk etter team eller applikasjonsnavn. Søket filtrerer i sanntid blant alle tilgjengelige applikasjoner.
        </BodyShort>
      </div>

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
              description={`Viser ${totalResults} applikasjoner fra ${totalTeams} team`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="F.eks. pensjon, pen, rocket..."
            />
          </Box>

          {searchQuery && (
            <Form method="post">
              <input type="hidden" name="intent" value="add" />

              <VStack gap="space-24">
                <BodyShort>
                  <strong>{selectedApps.size}</strong> applikasjon(er) valgt
                </BodyShort>

                {Object.entries(appsByTeam)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([teamSlug, apps]) => (
                    <Box
                      key={teamSlug}
                      padding="space-20"
                      borderRadius="8"
                      background="raised"
                      borderColor="neutral-subtle"
                      borderWidth="1"
                    >
                      <VStack gap="space-16">
                        <Heading size="small">
                          {teamSlug}{' '}
                          <Detail as="span" textColor="subtle">
                            ({apps.length} treff)
                          </Detail>
                        </Heading>

                        <Table size="small">
                          <Table.Header>
                            <Table.Row>
                              <Table.HeaderCell scope="col">Velg</Table.HeaderCell>
                              <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                              <Table.HeaderCell scope="col">Team</Table.HeaderCell>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body>
                            {apps.sort().map((appName) => {
                              const appKey = `${teamSlug}|${appName}`
                              const isSelected = selectedApps.has(appKey)
                              return (
                                <Table.Row key={appKey}>
                                  <Table.DataCell>
                                    <Checkbox
                                      name="app"
                                      value={appKey}
                                      checked={isSelected}
                                      onChange={() => toggleApp(appKey)}
                                      hideLabel
                                    >
                                      Velg {appName}
                                    </Checkbox>
                                  </Table.DataCell>
                                  <Table.DataCell>
                                    <strong>{appName}</strong>
                                  </Table.DataCell>
                                  <Table.DataCell>
                                    <Detail textColor="subtle">{teamSlug}</Detail>
                                  </Table.DataCell>
                                </Table.Row>
                              )
                            })}
                          </Table.Body>
                        </Table>
                      </VStack>
                    </Box>
                  ))}

                {selectedApps.size > 0 && (
                  <div>
                    <Button type="submit" variant="primary" icon={<PlusIcon aria-hidden />} disabled={isAdding}>
                      {isAdding ? 'Legger til...' : `Legg til ${selectedApps.size} applikasjon(er)`}
                    </Button>
                  </div>
                )}
              </VStack>
            </Form>
          )}

          {!searchQuery && (
            <Alert variant="info">
              Skriv inn et søkeord for å begynne. Søket filtrerer automatisk blant {loaderData.allApps.length}{' '}
              tilgjengelige applikasjoner.
            </Alert>
          )}
        </>
      )}
    </VStack>
  )
}
