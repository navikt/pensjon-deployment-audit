import { ArrowsCirclepathIcon, TrashIcon } from '@navikt/aksel-icons';
import {
  Alert,
  BodyShort,
  Button,
  ConfirmationPanel,
  Detail,
  Heading,
  Loader,
  Table,
} from '@navikt/ds-react';
import { useState } from 'react';
import { Form, Link, redirect, useNavigation } from 'react-router';
import { getAllDeployments } from '../db/deployments';
import { deleteRepository, getRepositoryById } from '../db/repositories';
import { syncDeploymentsForRepository } from '../lib/sync';
import type { Route } from './+types/repos.$id';

export async function loader({ params }: Route.LoaderArgs) {
  const repoId = parseInt(params.id, 10);
  const repo = await getRepositoryById(repoId);

  if (!repo) {
    throw new Response('Repository not found', { status: 404 });
  }

  const deployments = await getAllDeployments({ repo_id: repoId });

  return { repo, deployments };
}

export async function action({ request, params }: Route.ActionArgs) {
  const repoId = parseInt(params.id, 10);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'delete') {
    await deleteRepository(repoId);
    return redirect('/repos');
  }

  if (intent === 'sync') {
    const repo = await getRepositoryById(repoId);

    if (!repo) {
      return { error: 'Repository not found' };
    }

    try {
      const result = await syncDeploymentsForRepository(repo);

      if (result.success) {
        return {
          success: `Synkronisert ${result.deploymentsCreated} nye og ${result.deploymentsUpdated} oppdaterte deployments.`,
        };
      } else {
        return {
          error: `Synkronisering delvis mislykket: ${result.errors.join(', ')}`,
        };
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Ukjent feil ved synkronisering',
      };
    }
  }

  return null;
}

export default function RepoDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { repo, deployments } = loaderData;
  const navigation = useNavigation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isSyncing =
    navigation.state === 'submitting' && navigation.formData?.get('intent') === 'sync';

  const isDeleting =
    navigation.state === 'submitting' && navigation.formData?.get('intent') === 'delete';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <Detail>Repository</Detail>
        <Heading size="large">
          {repo.github_owner}/{repo.github_repo_name}
        </Heading>
      </div>

      {actionData?.success && <Alert variant="success">{actionData.success}</Alert>}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
        <div>
          <Detail>Nais Team</Detail>
          <BodyShort>{repo.nais_team_slug}</BodyShort>
        </div>
        <div>
          <Detail>Miljø</Detail>
          <BodyShort>{repo.nais_environment_name}</BodyShort>
        </div>
        <div>
          <Detail>Opprettet</Detail>
          <BodyShort>{new Date(repo.created_at).toLocaleDateString('no-NO')}</BodyShort>
        </div>
        <div>
          <Detail>Sist oppdatert</Detail>
          <BodyShort>{new Date(repo.updated_at).toLocaleDateString('no-NO')}</BodyShort>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
        <Form method="post">
          <input type="hidden" name="intent" value="sync" />
          <Button type="submit" icon={<ArrowsCirclepathIcon aria-hidden />} disabled={isSyncing}>
            {isSyncing ? <Loader size="small" /> : 'Synkroniser alle deployments'}
          </Button>
        </Form>
      </div>

      <div>
        <Heading size="medium" spacing>
          Deployments ({deployments.length})
        </Heading>

        {deployments.length === 0 ? (
          <Alert variant="info">
            Ingen deployments funnet. Klikk "Synkroniser deployments" for å hente fra Nais.
          </Alert>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
                <Table.HeaderCell>Deployer</Table.HeaderCell>
                <Table.HeaderCell>Commit</Table.HeaderCell>
                <Table.HeaderCell>Four Eyes</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {deployments.slice(0, 10).map((deployment) => (
                <Table.Row key={deployment.id}>
                  <Table.DataCell>
                    {new Date(deployment.created_at).toLocaleString('no-NO')}
                  </Table.DataCell>
                  <Table.DataCell>{deployment.deployer_username}</Table.DataCell>
                  <Table.DataCell>
                    <code style={{ fontSize: '0.875rem' }}>
                      {deployment.commit_sha.substring(0, 7)}
                    </code>
                  </Table.DataCell>
                  <Table.DataCell>{deployment.has_four_eyes ? '✓' : '✗'}</Table.DataCell>
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
              ))}
            </Table.Body>
          </Table>
        )}

        {deployments.length > 10 && (
          <BodyShort style={{ marginTop: '1rem' }}>
            Viser 10 av {deployments.length} deployments.{' '}
            <Link to={`/deployments?repo=${repo.id}`}>Se alle</Link>
          </BodyShort>
        )}
      </div>

      <div style={{ borderTop: '1px solid #ccc', paddingTop: '2rem' }}>
        <Heading size="small" spacing>
          Farlig sone
        </Heading>

        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <ConfirmationPanel
              checked={confirmDelete}
              onChange={() => setConfirmDelete(!confirmDelete)}
              label="Ja, jeg er sikker på at jeg vil slette dette repositoryet"
            >
              Sletting fjerner også alle tilhørende deployments og kommentarer.
            </ConfirmationPanel>

            <div>
              <Button
                type="submit"
                variant="danger"
                icon={<TrashIcon aria-hidden />}
                disabled={!confirmDelete || isDeleting}
              >
                {isDeleting ? 'Sletter...' : 'Slett repository'}
              </Button>
            </div>
          </div>
        </Form>
      </div>
    </div>
  );
}
