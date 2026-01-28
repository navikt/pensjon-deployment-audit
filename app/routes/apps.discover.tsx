import { MagnifyingGlassIcon, PlusIcon } from '@navikt/aksel-icons';
import {
  Alert,
  BodyShort,
  Button,
  Checkbox,
  Heading,
  Loader,
  Table,
  TextField,
} from '@navikt/ds-react';
import { Form, useNavigation } from 'react-router';
import { createMonitoredApplication } from '../db/monitored-applications';
import { discoverTeamApplications, getApplicationInfo } from '../lib/nais';
import styles from '../styles/common.module.css';
import type { Route } from './+types/apps.discover';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Oppdag applikasjoner - Pensjon Deployment Audit' }];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  // Step 1: Discover applications
  if (intent === 'discover') {
    const teamSlug = formData.get('team_slug') as string;

    if (!teamSlug?.trim()) {
      return {
        error: 'Team slug er påkrevd',
        discovery: null,
      };
    }

    try {
      const { environments } = await discoverTeamApplications(teamSlug);

      // Convert Map to object for serialization
      const envData: Record<string, string[]> = {};
      for (const [envName, apps] of environments.entries()) {
        envData[envName] = apps;
      }

      return {
        error: null,
        discovery: {
          teamSlug,
          environments: envData,
        },
      };
    } catch (error) {
      console.error('Discovery error:', error);
      return {
        error: error instanceof Error ? error.message : 'Kunne ikke finne applikasjoner',
        discovery: null,
      };
    }
  }

  // Step 2: Add monitored applications
  if (intent === 'add') {
    const teamSlug = formData.get('team_slug') as string;
    const selectedApps = formData.getAll('app');

    if (!selectedApps.length) {
      return {
        error: 'Velg minst én applikasjon',
        discovery: null,
      };
    }

    try {
      let addedCount = 0;

      for (const appKey of selectedApps) {
        const [envName, appName] = (appKey as string).split('|');

        // Get repository info from first deployment
        const appInfo = await getApplicationInfo(teamSlug, envName, appName);

        if (!appInfo?.repository) {
          console.warn(`No repository found for ${teamSlug}/${envName}/${appName}`);
          continue;
        }

        const [owner, repo] = appInfo.repository.split('/');

        await createMonitoredApplication({
          team_slug: teamSlug,
          environment_name: envName,
          app_name: appName,
          approved_github_owner: owner,
          approved_github_repo_name: repo,
        });

        addedCount++;
      }

      return {
        error: null,
        success: `La til ${addedCount} applikasjon(er) for overvåking`,
        discovery: null,
      };
    } catch (error) {
      console.error('Add error:', error);
      return {
        error: error instanceof Error ? error.message : 'Kunne ikke legge til applikasjoner',
        discovery: null,
      };
    }
  }

  return { error: 'Ugyldig handling', discovery: null };
}

export default function AppsDiscover({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const isDiscovering =
    navigation.state === 'submitting' && navigation.formData?.get('intent') === 'discover';
  const isAdding =
    navigation.state === 'submitting' && navigation.formData?.get('intent') === 'add';

  const discovery = actionData?.discovery;

  return (
    <div className={styles.stackContainerLarge}>
      <div>
        <Heading size="large" spacing>
          Oppdag applikasjoner
        </Heading>
        <BodyShort>
          Søk etter et Nais team for å finne tilgjengelige applikasjoner og miljøer.
        </BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      <Form method="post">
        <input type="hidden" name="intent" value="discover" />
        <div className={styles.searchFormRowAlignEnd}>
          <TextField
            name="team_slug"
            label="Team slug"
            description="F.eks. pensjon-q2, team-rocket"
            className={styles.searchFormFlex}
            defaultValue={discovery?.teamSlug}
          />
          <Button type="submit" icon={<MagnifyingGlassIcon aria-hidden />} disabled={isDiscovering}>
            {isDiscovering ? 'Søker...' : 'Søk'}
          </Button>
        </div>
      </Form>

      {isDiscovering && (
        <div className={styles.centerContent}>
          <Loader size="2xlarge" title="Søker etter applikasjoner..." />
        </div>
      )}

      {discovery && !isDiscovering && (
        <Form method="post">
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="team_slug" value={discovery.teamSlug} />

          <div className={styles.stackContainer}>
            <div>
              <Heading size="medium" spacing>
                Funnet applikasjoner for {discovery.teamSlug}
              </Heading>
              <BodyShort>Velg hvilke applikasjoner som skal overvåkes for deployments.</BodyShort>
            </div>

            {Object.entries(discovery.environments).map(([envName, apps]) => (
              <div key={envName}>
                <Heading size="small" spacing>
                  {envName} ({apps.length} applikasjoner)
                </Heading>

                <Table size="small">
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell scope="col">Velg</Table.HeaderCell>
                      <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                      <Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {apps.map((appName) => (
                      <Table.Row key={`${envName}|${appName}`}>
                        <Table.DataCell>
                          <Checkbox name="app" value={`${envName}|${appName}`} hideLabel>
                            Velg {appName}
                          </Checkbox>
                        </Table.DataCell>
                        <Table.DataCell>{appName}</Table.DataCell>
                        <Table.DataCell>{envName}</Table.DataCell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            ))}

            <div>
              <Button
                type="submit"
                variant="primary"
                icon={<PlusIcon aria-hidden />}
                disabled={isAdding}
              >
                {isAdding ? 'Legger til...' : 'Legg til valgte applikasjoner'}
              </Button>
            </div>
          </div>
        </Form>
      )}
    </div>
  );
}
