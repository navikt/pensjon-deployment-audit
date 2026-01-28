import {
  BellIcon,
  CheckmarkCircleIcon,
  MagnifyingGlassIcon,
  RocketIcon,
  TableIcon,
} from '@navikt/aksel-icons';
import { Alert, BodyShort, Heading, LinkPanel } from '@navikt/ds-react';
import { Link } from 'react-router';
import { getUnresolvedAlerts } from '../db/alerts';
import { getAllDeployments, getDeploymentStats } from '../db/deployments';
import { getAllMonitoredApplications } from '../db/monitored-applications';
import styles from '../styles/common.module.css';
import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pensjon Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for four-eyes principle' },
  ];
}

export async function loader() {
  try {
    const [stats, apps, alerts, allDeployments] = await Promise.all([
      getDeploymentStats(),
      getAllMonitoredApplications(),
      getUnresolvedAlerts(),
      getAllDeployments(),
    ]);

    // Count pending verifications
    const pendingCount = allDeployments.filter(
      (d) => d.four_eyes_status === 'pending' || d.four_eyes_status === 'error'
    ).length;

    return { stats, apps, alerts, pendingCount };
  } catch (_error) {
    return { stats: null, apps: [], alerts: [], pendingCount: 0 };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats, apps, alerts, pendingCount } = loaderData;

  return (
    <div className={styles.pageContainer}>
      <div>
        <Heading size="large" spacing>
          Pensjon Deployment Audit
        </Heading>
        <BodyShort>
          Overvåk deployments på Nav sin Nais-plattform og verifiser at alle har hatt to sett av
          øyne. Applikasjon-sentrisk modell med sikkerhetsvarsler.
        </BodyShort>
      </div>

      {/* Security Alerts */}
      {alerts && alerts.length > 0 && (
        <Alert variant="error">
          🚨 <strong>{alerts.length} repository-varsler</strong> krever oppmerksomhet.{' '}
          <Link to="/alerts">Se varsler</Link>
        </Alert>
      )}

      {/* Pending Verifications */}
      {pendingCount > 0 && (
        <Alert variant="info">
          ℹ️ <strong>{pendingCount} deployments</strong> venter på GitHub-verifisering.{' '}
          <Link to="/deployments/verify">Kjør verifisering</Link>
        </Alert>
      )}

      {/* Stats */}
      {stats && stats.total > 0 && (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <BodyShort size="small" className={styles.statLabel}>
              Totalt deployments
            </BodyShort>
            <Heading size="large">{stats.total}</Heading>
          </div>

          <div className={styles.statCardSuccess}>
            <BodyShort size="small" className={styles.statLabelSuccess}>
              Med four-eyes
            </BodyShort>
            <Heading size="large" className={styles.textSuccess}>
              {stats.with_four_eyes}
            </Heading>
            <BodyShort size="small" className={styles.textSuccess}>
              {stats.percentage}%
            </BodyShort>
          </div>

          <div className={styles.statCardDanger}>
            <BodyShort size="small" className={styles.statLabelDanger}>
              Mangler four-eyes
            </BodyShort>
            <Heading size="large" className={styles.textDanger}>
              {stats.without_four_eyes}
            </Heading>
            <BodyShort size="small" className={styles.textDanger}>
              {(100 - stats.percentage).toFixed(1)}%
            </BodyShort>
          </div>

          <div className={styles.statCard}>
            <BodyShort size="small" className={styles.statLabel}>
              Overvåkede applikasjoner
            </BodyShort>
            <Heading size="large">{apps?.length || 0}</Heading>
          </div>
        </div>
      )}

      {stats && stats.total === 0 && (
        <Alert variant="info">
          Ingen deployments funnet. Legg til applikasjoner og synkroniser deployments for å komme i
          gang.
        </Alert>
      )}

      {/* Navigation Panels */}
      <div className={styles.navLinksGrid}>
        <LinkPanel as={Link} to="/apps/discover">
          <LinkPanel.Title>
            <MagnifyingGlassIcon aria-hidden />
            Oppdag applikasjoner
          </LinkPanel.Title>
          <LinkPanel.Description>
            Søk etter team og finn tilgjengelige applikasjoner
          </LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/apps">
          <LinkPanel.Title>
            <TableIcon aria-hidden />
            Overvåkede applikasjoner
          </LinkPanel.Title>
          <LinkPanel.Description>
            Administrer hvilke applikasjoner som overvåkes
          </LinkPanel.Description>
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
          <LinkPanel.Description>
            Kjør GitHub-verifisering av four-eyes status
          </LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/alerts">
          <LinkPanel.Title>
            <BellIcon aria-hidden />
            Repository-varsler {alerts && alerts.length > 0 && `(${alerts.length})`}
          </LinkPanel.Title>
          <LinkPanel.Description>Varsler om endrede repositories (sikkerhet)</LinkPanel.Description>
        </LinkPanel>
      </div>

      {stats && stats.without_four_eyes > 0 && (
        <Alert variant="warning">
          Du har {stats.without_four_eyes} deployment{stats.without_four_eyes !== 1 ? 's' : ''} som
          mangler four-eyes. <Link to="/deployments?only_missing=true">Se oversikt</Link>
        </Alert>
      )}
    </div>
  );
}
