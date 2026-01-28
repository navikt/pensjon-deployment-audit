import { MagnifyingGlassIcon, RocketIcon, TableIcon } from '@navikt/aksel-icons';
import { Alert, BodyShort, Heading, LinkPanel } from '@navikt/ds-react';
import { Link } from 'react-router';
import { getDeploymentStats } from '../db/deployments';
import { getAllRepositories } from '../db/repositories';
import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pensjon Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for four-eyes principle' },
  ];
}

export async function loader() {
  try {
    const [stats, repos] = await Promise.all([getDeploymentStats(), getAllRepositories()]);
    return { stats, repos };
  } catch (_error) {
    return { stats: null, repos: [] };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stats, repos } = loaderData;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <Heading size="large" spacing>
          Pensjon Deployment Audit
        </Heading>
        <BodyShort>
          Sammenstill deployments på Nav sin Nais-plattform med endringer fra GitHub. Verifiser at
          alle deployments har hatt to sett av øyne.
        </BodyShort>
      </div>

      {stats && stats.total > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <div
            style={{
              padding: '1.5rem',
              border: '1px solid #ccc',
              borderRadius: '0.5rem',
              background: '#f9f9f9',
            }}
          >
            <BodyShort size="small" style={{ color: '#666', marginBottom: '0.5rem' }}>
              Totalt deployments
            </BodyShort>
            <Heading size="large">{stats.total}</Heading>
          </div>

          <div
            style={{
              padding: '1.5rem',
              border: '1px solid #ccc',
              borderRadius: '0.5rem',
              background: '#f0fdf4',
            }}
          >
            <BodyShort size="small" style={{ color: '#166534', marginBottom: '0.5rem' }}>
              Med four-eyes
            </BodyShort>
            <Heading size="large" style={{ color: '#166534' }}>
              {stats.with_four_eyes}
            </Heading>
            <BodyShort size="small" style={{ color: '#166534' }}>
              {stats.percentage}%
            </BodyShort>
          </div>

          <div
            style={{
              padding: '1.5rem',
              border: '1px solid #ccc',
              borderRadius: '0.5rem',
              background: '#fef2f2',
            }}
          >
            <BodyShort size="small" style={{ color: '#991b1b', marginBottom: '0.5rem' }}>
              Mangler four-eyes
            </BodyShort>
            <Heading size="large" style={{ color: '#991b1b' }}>
              {stats.without_four_eyes}
            </Heading>
            <BodyShort size="small" style={{ color: '#991b1b' }}>
              {(100 - stats.percentage).toFixed(1)}%
            </BodyShort>
          </div>

          <div
            style={{
              padding: '1.5rem',
              border: '1px solid #ccc',
              borderRadius: '0.5rem',
              background: '#f9f9f9',
            }}
          >
            <BodyShort size="small" style={{ color: '#666', marginBottom: '0.5rem' }}>
              Konfigurerte repos
            </BodyShort>
            <Heading size="large">{repos?.length || 0}</Heading>
          </div>
        </div>
      )}

      {stats && stats.total === 0 && (
        <Alert variant="info">
          Ingen deployments funnet. Legg til repositories og synkroniser deployments for å komme i
          gang.
        </Alert>
      )}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <LinkPanel as={Link} to="/repos/search" style={{ flex: 1 }}>
          <LinkPanel.Title>
            <MagnifyingGlassIcon aria-hidden />
            Søk etter repo
          </LinkPanel.Title>
          <LinkPanel.Description>
            Søk etter repositories under navikt org på GitHub
          </LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/repos" style={{ flex: 1 }}>
          <LinkPanel.Title>
            <TableIcon aria-hidden />
            Repositories
          </LinkPanel.Title>
          <LinkPanel.Description>Administrer konfigurerte repositories</LinkPanel.Description>
        </LinkPanel>

        <LinkPanel as={Link} to="/deployments" style={{ flex: 1 }}>
          <LinkPanel.Title>
            <RocketIcon aria-hidden />
            Deployments
          </LinkPanel.Title>
          <LinkPanel.Description>Se alle deployments med four-eyes status</LinkPanel.Description>
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
