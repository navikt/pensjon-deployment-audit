import { ArrowsCirclepathIcon, CheckmarkCircleIcon, TrashIcon } from '@navikt/aksel-icons';
import { Alert, BodyShort, Button, Heading, Table } from '@navikt/ds-react';
import { Form, Link } from 'react-router';
import { getAllMonitoredApplications } from '../db/monitored-applications';
import { syncDeploymentsFromNais, verifyDeploymentsFourEyes } from '../lib/sync';
import styles from '../styles/common.module.css';
import type { Route } from './+types/apps';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Overvåkede applikasjoner - Pensjon Deployment Audit' }];
}

export async function loader() {
  const apps = await getAllMonitoredApplications();
  return { apps };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'sync-nais') {
    const teamSlug = formData.get('team_slug') as string;
    const environmentName = formData.get('environment_name') as string;
    const appName = formData.get('app_name') as string;

    try {
      const result = await syncDeploymentsFromNais(teamSlug, environmentName, appName);

      return {
        success: `Hentet ${result.newCount} nye deployments fra Nais. ${result.alertsCreated > 0 ? `⚠️ ${result.alertsCreated} nye varsler opprettet.` : ''} Kjør GitHub-verifisering for å sjekke four-eyes.`,
        error: null,
      };
    } catch (error) {
      console.error('Nais sync error:', error);
      return {
        success: null,
        error: error instanceof Error ? error.message : 'Kunne ikke hente deployments fra Nais',
      };
    }
  }

  if (intent === 'verify-github') {
    const monitoredAppId = Number(formData.get('monitored_app_id'));

    try {
      const result = await verifyDeploymentsFourEyes({
        monitored_app_id: monitoredAppId,
        limit: 100, // Verify max 100 deployments at a time
      });

      return {
        success: `Verifiserte ${result.verified} deployments med GitHub. ${result.failed > 0 ? `❌ ${result.failed} feilet.` : ''}`,
        error: null,
      };
    } catch (error) {
      console.error('GitHub verify error:', error);
      return {
        success: null,
        error:
          error instanceof Error
            ? error.message.includes('rate limit')
              ? 'GitHub rate limit nådd. Vent litt før du prøver igjen.'
              : error.message
            : 'Kunne ikke verifisere deployments med GitHub',
      };
    }
  }

  return { success: null, error: 'Ugyldig handling' };
}

export default function Apps({ loaderData, actionData }: Route.ComponentProps) {
  const { apps } = loaderData;

  // Group apps by team
  const appsByTeam = apps.reduce(
    (acc, app) => {
      if (!acc[app.team_slug]) {
        acc[app.team_slug] = [];
      }
      acc[app.team_slug].push(app);
      return acc;
    },
    {} as Record<string, typeof apps>
  );

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderContent}>
          <Heading size="large" spacing>
            Overvåkede applikasjoner
          </Heading>
          <BodyShort>Administrer hvilke applikasjoner som overvåkes for deployments.</BodyShort>
        </div>
        <Button as={Link} to="/apps/discover">
          Oppdag nye applikasjoner
        </Button>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      {apps.length === 0 && (
        <Alert variant="info">
          Ingen applikasjoner overvåkes ennå. <Link to="/apps/discover">Oppdag applikasjoner</Link>{' '}
          for å komme i gang.
        </Alert>
      )}

      {Object.entries(appsByTeam).map(([teamSlug, teamApps]) => (
        <div key={teamSlug}>
          <Heading size="medium" spacing>
            {teamSlug} ({teamApps.length} applikasjoner)
          </Heading>

          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
                <Table.HeaderCell scope="col">Godkjent repository</Table.HeaderCell>
                <Table.HeaderCell scope="col">Detektert repository</Table.HeaderCell>
                <Table.HeaderCell scope="col">Status</Table.HeaderCell>
                <Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {teamApps.map((app) => {
                const hasRepoMismatch =
                  app.detected_github_owner &&
                  app.detected_github_repo_name &&
                  (app.detected_github_owner !== app.approved_github_owner ||
                    app.detected_github_repo_name !== app.approved_github_repo_name);

                return (
                  <Table.Row key={app.id}>
                    <Table.DataCell>
                      <strong>{app.app_name}</strong>
                    </Table.DataCell>
                    <Table.DataCell>{app.environment_name}</Table.DataCell>
                    <Table.DataCell>
                      <a
                        href={`https://github.com/${app.approved_github_owner}/${app.approved_github_repo_name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {app.approved_github_owner}/{app.approved_github_repo_name}
                      </a>
                    </Table.DataCell>
                    <Table.DataCell>
                      {app.detected_github_owner && app.detected_github_repo_name ? (
                        <a
                          href={`https://github.com/${app.detected_github_owner}/${app.detected_github_repo_name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {app.detected_github_owner}/{app.detected_github_repo_name}
                        </a>
                      ) : (
                        <span className={styles.textSubtle}>Ikke synkronisert ennå</span>
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      {hasRepoMismatch ? (
                        <span className={styles.textDangerBold}>⚠️ Mismatch</span>
                      ) : app.detected_github_owner ? (
                        <span className={styles.textSuccess}>✓ OK</span>
                      ) : (
                        <span className={styles.textSubtle}>Ikke synkronisert</span>
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      <div className={styles.actionButtons}>
                        <Form method="post">
                          <input type="hidden" name="intent" value="sync-nais" />
                          <input type="hidden" name="team_slug" value={app.team_slug} />
                          <input
                            type="hidden"
                            name="environment_name"
                            value={app.environment_name}
                          />
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
                      </div>
                    </Table.DataCell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </div>
      ))}
    </div>
  );
}
