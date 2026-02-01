import { Alert, BodyShort, Box, Heading, HGrid, VStack } from '@navikt/ds-react'
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

    return { stats, appsCount: apps.length, alertsCount: alerts.length, pendingCount }
  } catch (_error) {
    return { stats: null, appsCount: 0, alertsCount: 0, pendingCount: 0 }
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats, appsCount, alertsCount, pendingCount } = loaderData

  return (
    <VStack gap="space-32">
      <BodyShort textColor="subtle">
        Overvåk deployments og verifiser at alle har hatt godkjenning før deploy.
      </BodyShort>

      {/* Security Alerts */}
      {alertsCount > 0 && (
        <Alert variant="error">
          <strong>{alertsCount} repository-varsler</strong> krever oppmerksomhet. <Link to="/alerts">Se varsler</Link>
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
        <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 5 }}>
          <Link to="/deployments" className={styles.statCardLink}>
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

          <Link to="/deployments?only_missing=false" className={styles.statCardLink}>
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

          <Link to="/deployments?status=not_approved" className={styles.statCardLink}>
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

          <Link to="/apps" className={styles.statCardLink}>
            <Box
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor="neutral-subtle"
              borderWidth="1"
              className={styles.clickableCard}
            >
              <BodyShort size="small" textColor="subtle">
                Applikasjoner
              </BodyShort>
              <Heading size="large">{appsCount}</Heading>
            </Box>
          </Link>

          <Link to="/alerts" className={styles.statCardLink}>
            <Box
              padding="space-20"
              borderRadius="8"
              background="raised"
              borderColor={alertsCount > 0 ? 'warning-subtle' : 'neutral-subtle'}
              borderWidth="1"
              data-color={alertsCount > 0 ? 'warning' : undefined}
              className={styles.clickableCard}
            >
              <BodyShort size="small" textColor="subtle">
                Varsler
              </BodyShort>
              <Heading size="large">{alertsCount}</Heading>
            </Box>
          </Link>
        </HGrid>
      )}

      {stats && stats.total === 0 && (
        <Alert variant="info">
          Ingen deployments funnet. <Link to="/apps">Legg til applikasjoner</Link> for å komme i gang.
        </Alert>
      )}
    </VStack>
  )
}
