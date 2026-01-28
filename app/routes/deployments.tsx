import { Alert, Button, Checkbox, Detail, Heading, Select, Table, Tag } from '@navikt/ds-react';
import { Form, Link, useSearchParams } from 'react-router';
import { type DeploymentWithApp, getAllDeployments, getDeploymentStats } from '../db/deployments';
import { getAllMonitoredApplications } from '../db/monitored-applications';
import { getDateRange } from '../lib/nais';
import styles from '../styles/common.module.css';
import type { Route } from './+types/deployments';

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const appId = url.searchParams.get('app');
  const teamSlug = url.searchParams.get('team');
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
    monitored_app_id: appId ? parseInt(appId, 10) : undefined,
    team_slug: teamSlug || undefined,
    start_date: startDate,
    end_date: endDate,
    only_missing_four_eyes: onlyMissing,
    environment_name: environment || undefined,
  });

  const apps = await getAllMonitoredApplications();

  // Get unique teams and environments
  const teams = Array.from(new Set(deployments.map((d) => d.team_slug))).sort();
  const environments = Array.from(new Set(deployments.map((d) => d.environment_name))).sort();

  return { deployments, apps, teams, environments };
}

function getFourEyesLabel(deployment: DeploymentWithApp): {
  text: string;
  variant: 'success' | 'warning' | 'error' | 'info';
} {
  if (deployment.has_four_eyes) {
    return { text: 'Godkjent PR', variant: 'success' };
  }

  switch (deployment.four_eyes_status) {
    case 'approved_pr':
      return { text: 'Godkjent PR', variant: 'success' };
    case 'direct_push':
      return { text: 'Direct push', variant: 'warning' };
    case 'missing':
      return { text: 'Mangler godkjenning', variant: 'error' };
    case 'error':
      return { text: 'Feil ved sjekk', variant: 'error' };
    default:
      return { text: 'Ukjent status', variant: 'info' };
  }
}

export default function Deployments({ loaderData }: Route.ComponentProps) {
  const { deployments, apps, teams, environments } = loaderData;
  const [searchParams] = useSearchParams();

  const currentApp = searchParams.get('app');
  const currentTeam = searchParams.get('team');
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
    <div className={styles.pageContainer}>
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
        <div className={styles.filterForm}>
          <div className={styles.filterRow}>
            <Select
              label="Team"
              name="team"
              defaultValue={currentTeam || ''}
              className={styles.filterSelect}
            >
              <option value="">Alle teams</option>
              {teams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </Select>

            <Select
              label="Applikasjon"
              name="app"
              defaultValue={currentApp || ''}
              className={styles.filterSelectWide}
            >
              <option value="">Alle applikasjoner</option>
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.app_name} ({app.environment_name})
                </option>
              ))}
            </Select>

            <Select
              label="Miljø"
              name="environment"
              defaultValue={currentEnvironment || ''}
              className={styles.filterSelectNarrow}
            >
              <option value="">Alle miljøer</option>
              {environments.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </Select>

            <Select
              label="Tidsperiode"
              name="period"
              defaultValue={currentPeriod}
              className={styles.filterSelect}
            >
              <option value="last-month">Siste måned</option>
              <option value="last-12-months">Siste 12 måneder</option>
              <option value="year-2025">Hele 2025</option>
              <option value="all">Alle</option>
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
          deployments fra applikasjoner.
        </Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
              <Table.HeaderCell>Applikasjon</Table.HeaderCell>
              <Table.HeaderCell>Team</Table.HeaderCell>
              <Table.HeaderCell>Miljø</Table.HeaderCell>
              <Table.HeaderCell>Repository</Table.HeaderCell>
              <Table.HeaderCell>Deployer</Table.HeaderCell>
              <Table.HeaderCell>Commit</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell></Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {deployments.map((deployment) => {
              const status = getFourEyesLabel(deployment);
              const repoMismatch =
                deployment.detected_github_owner !== deployment.approved_github_owner ||
                deployment.detected_github_repo_name !== deployment.approved_github_repo_name;

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
                    <strong>{deployment.app_name}</strong>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code className={styles.codeSmall}>{deployment.team_slug}</code>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code className={styles.codeSmall}>{deployment.environment_name}</code>
                  </Table.DataCell>
                  <Table.DataCell>
                    <a
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={repoMismatch ? styles.linkDanger : styles.linkExternal}
                    >
                      {repoMismatch && '⚠️ '}
                      {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
                    </a>
                  </Table.DataCell>
                  <Table.DataCell>{deployment.deployer_username || '(ukjent)'}</Table.DataCell>
                  <Table.DataCell>
                    {deployment.commit_sha ? (
                      <a
                        href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.codeMedium}
                      >
                        {deployment.commit_sha.substring(0, 7)}
                      </a>
                    ) : (
                      <span className={styles.textSubtle}>(ukjent)</span>
                    )}
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
