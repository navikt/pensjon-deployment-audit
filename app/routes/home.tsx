import { BellIcon, RocketIcon, TableIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Heading, HGrid, LinkPanel, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getUnresolvedAlerts } from '../db/alerts.server'
import { getAllDeployments, getDeploymentStats } from '../db/deployments.server'
import { getAllMonitoredApplications } from '../db/monitored-applications.server'
import styles from '../styles/common.module.css'
import type { Route } from './+types/home'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pensjon Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' },
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

    return { stats, appsCount: apps.length, alerts, pendingCount }
  } catch (_error) {
    return { stats: null, appsCount: 0, alerts: [], pendingCount: 0 }
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats, appsCount, alerts, pendingCount } = loaderData

  return (
    <VStack gap="space-32">
      <BodyShort textColor="subtle">
        Overvåk deployments og verifiser at alle har hatt godkjenning før deploy.
      </BodyShort>

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

      {/* Stats - clickable cards */}
      {stats && stats.total > 0 && (
        <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
          <Link to="/deployments" style={{ textDecoration: 'none' }}>
            <Box
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor="neutral-subtle"
              borderWidth="1"
              className={styles.clickableCard}
            >
              <BodyShort size="small" textColor="subtle">
                Totalt deployments
              </BodyShort>
              <Heading size="large">{stats.total}</Heading>
            </Box>
          </Link>

          <Link to="/deployments?only_missing=false" style={{ textDecoration: 'none' }}>
            <Box
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor="success-subtle"
              borderWidth="1"
              data-color="success"
              className={styles.clickableCard}
            >
              <BodyShort size="small" textColor="subtle">
                Godkjent
              </BodyShort>
              <Heading size="large">{stats.with_four_eyes}</Heading>
              <BodyShort size="small" textColor="subtle">
                {stats.percentage}%
              </BodyShort>
            </Box>
          </Link>

          <Link to="/deployments?only_missing=true" style={{ textDecoration: 'none' }}>
            <Box
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor="danger-subtle"
              borderWidth="1"
              data-color="danger"
              className={styles.clickableCard}
            >
              <BodyShort size="small" textColor="subtle">
                Mangler godkjenning
              </BodyShort>
              <Heading size="large">{stats.without_four_eyes}</Heading>
              <BodyShort size="small" textColor="subtle">
                {(100 - stats.percentage).toFixed(1)}%
              </BodyShort>
            </Box>
          </Link>

          <Link to="/apps" style={{ textDecoration: 'none' }}>
            <Box
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor="neutral-subtle"
              borderWidth="1"
              className={styles.clickableCard}
            >
              <BodyShort size="small" textColor="subtle">
                Overvåkede applikasjoner
              </BodyShort>
              <Heading size="large">{appsCount}</Heading>
            </Box>
          </Link>
        </HGrid>
      )}

      {stats && stats.total === 0 && (
        <Alert variant="info">
          Ingen deployments funnet. <Link to="/apps">Legg til applikasjoner</Link> for å komme i gang.
        </Alert>
      )}

      {/* Navigation Panels */}
      <HGrid gap="space-16" columns={{ xs: 1, md: 2, lg: 3 }}>
        <LinkPanel as={Link} to="/apps">
          <LinkPanel.Title>
            <TableIcon aria-hidden />
            Applikasjoner
          </LinkPanel.Title>
          <LinkPanel.Description>Se og administrer overvåkede applikasjoner</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/deployments">
          <LinkPanel.Title>
            <RocketIcon aria-hidden />
            Deployments
          </LinkPanel.Title>
          <LinkPanel.Description>Se alle deployments med godkjenningsstatus</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/alerts">
          <LinkPanel.Title>
            <BellIcon aria-hidden />
            Repository-varsler {alerts && alerts.length > 0 && `(${alerts.length})`}
          </LinkPanel.Title>
          <LinkPanel.Description>Varsler om endrede repositories (sikkerhet)</LinkPanel.Description>
        </LinkPanel>
      </HGrid>
    </VStack>
  )
}
