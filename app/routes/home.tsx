import { BellIcon, CheckmarkCircleIcon, MagnifyingGlassIcon, RocketIcon, TableIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Heading, HGrid, LinkPanel, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getUnresolvedAlerts } from '../db/alerts.server'
import { getAllDeployments, getDeploymentStats } from '../db/deployments.server'
import { getAllMonitoredApplications } from '../db/monitored-applications.server'
import type { Route } from './+types/home'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pensjon Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for four-eyes principle' },
  ]
}

export async function loader() {
  try {
    const [stats, apps, alerts, allDeployments] = await Promise.all([
      getDeploymentStats(),
      getAllMonitoredApplications(),
      getUnresolvedAlerts(),
      getAllDeployments(),
    ])

    // Count pending verifications
    const pendingCount = allDeployments.filter(
      (d) => d.four_eyes_status === 'pending' || d.four_eyes_status === 'error',
    ).length

    return { stats, apps, alerts, pendingCount }
  } catch (_error) {
    return { stats: null, apps: [], alerts: [], pendingCount: 0 }
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats, apps, alerts, pendingCount } = loaderData

  return (
    <VStack gap="space-32">
      <div>
        <Heading size="large" spacing>
          Pensjon Deployment Audit
        </Heading>
        <BodyShort textColor="subtle">
          Overvåk deployments på Nav sin Nais-plattform og verifiser at alle har hatt to sett av øyne.
          Applikasjon-sentrisk modell med sikkerhetsvarsler.
        </BodyShort>
      </div>

      {/* Security Alerts */}
      {alerts && alerts.length > 0 && (
        <Alert variant="error">
          <strong>{alerts.length} repository-varsler</strong> krever oppmerksomhet. <Link to="/alerts">Se varsler</Link>
        </Alert>
      )}

      {/* Pending Verifications */}
      {pendingCount > 0 && (
        <Alert variant="info">
          <strong>{pendingCount} deployments</strong> venter på GitHub-verifisering.{' '}
          <Link to="/deployments/verify">Kjør verifisering</Link>
        </Alert>
      )}

      {/* Stats */}
      {stats && stats.total > 0 && (
        <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
          <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort size="small" textColor="subtle">
              Totalt deployments
            </BodyShort>
            <Heading size="large">{stats.total}</Heading>
          </Box>

          <Box
            padding="space-20"
            borderRadius="8"
            background="raised"
            borderColor="success-subtle"
            borderWidth="1"
            data-color="success"
          >
            <BodyShort size="small" textColor="subtle">
              Med four-eyes
            </BodyShort>
            <Heading size="large">{stats.with_four_eyes}</Heading>
            <BodyShort size="small" textColor="subtle">
              {stats.percentage}%
            </BodyShort>
          </Box>

          <Box
            padding="space-20"
            borderRadius="8"
            background="raised"
            borderColor="danger-subtle"
            borderWidth="1"
            data-color="danger"
          >
            <BodyShort size="small" textColor="subtle">
              Mangler four-eyes
            </BodyShort>
            <Heading size="large">{stats.without_four_eyes}</Heading>
            <BodyShort size="small" textColor="subtle">
              {(100 - stats.percentage).toFixed(1)}%
            </BodyShort>
          </Box>

          <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort size="small" textColor="subtle">
              Overvåkede applikasjoner
            </BodyShort>
            <Heading size="large">{apps?.length || 0}</Heading>
          </Box>
        </HGrid>
      )}

      {stats && stats.total === 0 && (
        <Alert variant="info">
          Ingen deployments funnet. Legg til applikasjoner og synkroniser deployments for å komme i gang.
        </Alert>
      )}

      {/* Navigation Panels */}
      <HGrid gap="space-16" columns={{ xs: 1, md: 2, lg: 3 }}>
        <LinkPanel as={Link} to="/apps/discover">
          <LinkPanel.Title>
            <MagnifyingGlassIcon aria-hidden />
            Oppdag applikasjoner
          </LinkPanel.Title>
          <LinkPanel.Description>Søk etter team og finn tilgjengelige applikasjoner</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/apps">
          <LinkPanel.Title>
            <TableIcon aria-hidden />
            Overvåkede applikasjoner
          </LinkPanel.Title>
          <LinkPanel.Description>Administrer hvilke applikasjoner som overvåkes</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/deployments">
          <LinkPanel.Title>
            <RocketIcon aria-hidden />
            Deployments
          </LinkPanel.Title>
          <LinkPanel.Description>Se alle deployments med four-eyes status</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/deployments/verify">
          <LinkPanel.Title>
            <CheckmarkCircleIcon aria-hidden />
            Verifiser deployments {pendingCount > 0 && `(${pendingCount})`}
          </LinkPanel.Title>
          <LinkPanel.Description>Kjør GitHub-verifisering av four-eyes status</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/alerts">
          <LinkPanel.Title>
            <BellIcon aria-hidden />
            Repository-varsler {alerts && alerts.length > 0 && `(${alerts.length})`}
          </LinkPanel.Title>
          <LinkPanel.Description>Varsler om endrede repositories (sikkerhet)</LinkPanel.Description>
        </LinkPanel>
      </HGrid>

      {stats && stats.without_four_eyes > 0 && (
        <Alert variant="warning">
          Du har {stats.without_four_eyes} deployment{stats.without_four_eyes !== 1 ? 's' : ''} som mangler four-eyes.{' '}
          <Link to="/deployments?only_missing=true">Se oversikt</Link>
        </Alert>
      )}
    </VStack>
  )
}
