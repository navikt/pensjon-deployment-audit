import { Alert, Button, Checkbox, Detail, Heading, Select, Table, Tag } from '@navikt/ds-react';
import { Form, Link, useSearchParams } from 'react-router';
import { type Deployment, getAllDeployments } from '../db/deployments';
import { getAllRepositories } from '../db/repositories';
import { getDateRange } from '../lib/nais';
import type { Route } from './+types/deployments';

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const repoId = url.searchParams.get('repo');
  const period = url.searchParams.get('period') || 'last-month';
  const onlyMissing = url.searchParams.get('only_missing') === 'true';
  const environment = url.searchParams.get('environment');

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (period !== 'all') {
    const range = getDateRange(period as any);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  const deployments = await getAllDeployments({
    repo_id: repoId ? parseInt(repoId, 10) : undefined,
    start_date: startDate,
    end_date: endDate,
    only_missing_four_eyes: onlyMissing,
    environment_name: environment || undefined,
  });

  const repos = await getAllRepositories();

  // Get unique environments
  const environments = Array.from(new Set(deployments.map((d) => d.environment_name))).sort();

  return { deployments, repos, environments };
}

function getFourEyesLabel(deployment: Deployment): {
  text: string;
  variant: 'success' | 'warning' | 'error';
} {
  if (deployment.has_four_eyes) {
    return { text: 'Godkjent PR', variant: 'success' };
  }

  switch (deployment.four_eyes_status) {
    case 'direct_push':
      return { text: 'Direct push', variant: 'warning' };
    case 'pr_not_approved':
      return { text: 'PR ikke godkjent', variant: 'error' };
    case 'error':
      return { text: 'Feil ved sjekk', variant: 'error' };
    default:
      return { text: 'Ukjent status', variant: 'error' };
  }
}

export default function Deployments({ loaderData }: Route.ComponentProps) {
  const { deployments, repos, environments } = loaderData;
  const [searchParams] = useSearchParams();

  const currentRepo = searchParams.get('repo');
  const currentPeriod = searchParams.get('period') || 'last-month';
  const onlyMissing = searchParams.get('only_missing') === 'true';
  const currentEnvironment = searchParams.get('environment');

  const stats = {
    total: deployments.length,
    withFourEyes: deployments.filter((d) => d.has_four_eyes).length,
    withoutFourEyes: deployments.filter((d) => !d.has_four_eyes).length,
  };

  const percentage = stats.total > 0 ? Math.round((stats.withFourEyes / stats.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <Heading size="large" spacing>
          Deployments
        </Heading>
        <Detail>
          {stats.total} deployments totalt • {stats.withFourEyes} med four-eyes ({percentage}%) •{' '}
          {stats.withoutFourEyes} mangler four-eyes
        </Detail>
      </div>

      <Form method="get">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <Select
              label="Repository"
              name="repo"
              defaultValue={currentRepo || ''}
              style={{ minWidth: '200px' }}
            >
              <option value="">Alle repositories</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.github_owner}/{repo.github_repo_name}
                </option>
              ))}
            </Select>

            <Select
              label="Tidsperiode"
              name="period"
              defaultValue={currentPeriod}
              style={{ minWidth: '180px' }}
            >
              <option value="last-month">Siste måned</option>
              <option value="last-12-months">Siste 12 måneder</option>
              <option value="year-2025">Hele 2025</option>
              <option value="all">Alle</option>
            </Select>

            <Select
              label="Miljø"
              name="environment"
              defaultValue={currentEnvironment || ''}
              style={{ minWidth: '150px' }}
            >
              <option value="">Alle miljøer</option>
              {environments.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </Select>

            <Button type="submit">Filtrer</Button>
          </div>

          <Checkbox name="only_missing" value="true" defaultChecked={onlyMissing}>
            Vis kun deployments som mangler four-eyes
          </Checkbox>
        </div>
      </Form>

      {deployments.length === 0 ? (
        <Alert variant="info">
          Ingen deployments funnet med de valgte filtrene. Prøv å endre filtrene eller synkroniser
          deployments fra repositories.
        </Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
              <Table.HeaderCell>Repository</Table.HeaderCell>
              <Table.HeaderCell>Miljø</Table.HeaderCell>
              <Table.HeaderCell>Deployer</Table.HeaderCell>
              <Table.HeaderCell>Commit</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell></Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {deployments.map((deployment) => {
              const status = getFourEyesLabel(deployment);
              return (
                <Table.Row key={deployment.id}>
                  <Table.DataCell>
                    {new Date(deployment.created_at).toLocaleString('no-NO', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Table.DataCell>
                  <Table.DataCell>
                    <Link to={`/repos/${deployment.repo_id}`} style={{ fontSize: '0.875rem' }}>
                      {deployment.repository}
                    </Link>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code style={{ fontSize: '0.75rem' }}>{deployment.environment_name}</code>
                  </Table.DataCell>
                  <Table.DataCell>{deployment.deployer_username}</Table.DataCell>
                  <Table.DataCell>
                    <a
                      href={`https://github.com/${deployment.repository}/commit/${deployment.commit_sha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                    >
                      {deployment.commit_sha.substring(0, 7)}
                    </a>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Tag variant={status.variant} size="small">
                      {deployment.has_four_eyes ? '✓' : '✗'} {status.text}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Button
                      as={Link}
                      to={`/deployments/${deployment.id}`}
                      size="small"
                      variant="secondary"
                    >
                      Vis
                    </Button>
                  </Table.DataCell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
