import { Form } from 'react-router';
import {
  Alert,
  BodyShort,
  Button,
  Heading,
  Table,
  Textarea,
  Modal,
} from '@navikt/ds-react';
import { useState } from 'react';
import { CheckmarkIcon } from '@navikt/aksel-icons';
import { getUnresolvedAlertsWithContext, resolveRepositoryAlert } from '../db/alerts';
import type { Route } from './+types/alerts';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-varsler - Pensjon Deployment Audit' }];
}

export async function loader() {
  const alerts = await getUnresolvedAlertsWithContext();
  return { alerts };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'resolve') {
    const alertId = Number(formData.get('alert_id'));
    const resolutionNote = formData.get('resolution_note') as string;

    if (!resolutionNote?.trim()) {
      return {
        success: null,
        error: 'Vennligst skriv en merknad om hvordan varselet ble løst',
      };
    }

    try {
      await resolveRepositoryAlert(alertId, resolutionNote);
      return {
        success: 'Varsel markert som løst',
        error: null,
      };
    } catch (error) {
      console.error('Resolve error:', error);
      return {
        success: null,
        error: error instanceof Error ? error.message : 'Kunne ikke løse varsel',
      };
    }
  }

  return { success: null, error: 'Ugyldig handling' };
}

export default function Alerts({ loaderData, actionData }: Route.ComponentProps) {
  const { alerts } = loaderData;
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<(typeof alerts)[0] | null>(null);

  const openResolveModal = (alert: (typeof alerts)[0]) => {
    setSelectedAlert(alert);
    setResolveModalOpen(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <Heading size="large" spacing>
          Repository-varsler 🔒
        </Heading>
        <BodyShort>
          Disse varslene oppstår når en deployment kommer fra et annet repository enn forventet.
          Dette kan indikere at noen har «kapret» en applikasjon, og må sjekkes manuelt.
        </BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      {alerts.length === 0 && (
        <Alert variant="success">
          Ingen uløste varsler! 🎉 Alle applikasjoner deployer fra forventede repositories.
        </Alert>
      )}

      {alerts.length > 0 && (
        <>
          <Alert variant="error">
            Du har <strong>{alerts.length} uløste varsel(er)</strong> som krever oppmerksomhet.
          </Alert>

          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Miljø</Table.HeaderCell>
                <Table.HeaderCell scope="col">Forventet repo</Table.HeaderCell>
                <Table.HeaderCell scope="col">Detektert repo</Table.HeaderCell>
                <Table.HeaderCell scope="col">Deployment</Table.HeaderCell>
                <Table.HeaderCell scope="col">Opprettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Handlinger</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {alerts.map((alert) => (
                <Table.Row key={alert.id}>
                  <Table.DataCell>
                    <strong>
                      {alert.app_name}
                    </strong>
                    <br />
                    <span style={{ fontSize: '0.875rem', color: '#666' }}>
                      Team: {alert.team_slug}
                    </span>
                  </Table.DataCell>
                  <Table.DataCell>{alert.environment_name}</Table.DataCell>
                  <Table.DataCell>
                    <a
                      href={`https://github.com/${alert.approved_github_owner}/${alert.approved_github_repo_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {alert.approved_github_owner}/{alert.approved_github_repo_name}
                    </a>
                  </Table.DataCell>
                  <Table.DataCell>
                    <a
                      href={`https://github.com/${alert.detected_github_owner}/${alert.detected_github_repo_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#c30000', fontWeight: 'bold' }}
                    >
                      {alert.detected_github_owner}/{alert.detected_github_repo_name}
                    </a>
                  </Table.DataCell>
                  <Table.DataCell>
                    <code style={{ fontSize: '0.75rem' }}>
                      {alert.deployment_nais_id.substring(0, 16)}...
                    </code>
                  </Table.DataCell>
                  <Table.DataCell>
                    {new Date(alert.created_at).toLocaleDateString('nb-NO', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Table.DataCell>
                  <Table.DataCell>
                    <Button
                      size="small"
                      variant="secondary"
                      icon={<CheckmarkIcon aria-hidden />}
                      onClick={() => openResolveModal(alert)}
                    >
                      Løs
                    </Button>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </>
      )}

      <Modal
        open={resolveModalOpen}
        onClose={() => setResolveModalOpen(false)}
        header={{ heading: 'Løs repository-varsel' }}
      >
        <Modal.Body>
          {selectedAlert && (
            <>
              <BodyShort spacing>
                Du er i ferd med å markere dette varselet som løst:
              </BodyShort>
              <Alert variant="warning" style={{ marginBottom: '1rem' }}>
                <strong>{selectedAlert.app_name}</strong> ({selectedAlert.environment_name})
                <br />
                Forventet: {selectedAlert.approved_github_owner}/
                {selectedAlert.approved_github_repo_name}
                <br />
                Detektert: {selectedAlert.detected_github_owner}/
                {selectedAlert.detected_github_repo_name}
              </Alert>

              <Form method="post">
                <input type="hidden" name="intent" value="resolve" />
                <input type="hidden" name="alert_id" value={selectedAlert.id} />

                <Textarea
                  name="resolution_note"
                  label="Hvordan ble varselet løst?"
                  description="Forklar hva som ble gjort for å løse varselet (f.eks. 'Verifisert at repo-endring var legitim', 'Oppdatert godkjent repository')"
                  required
                  minLength={10}
                />

                <div
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    marginTop: '1.5rem',
                    justifyContent: 'flex-end',
                  }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setResolveModalOpen(false)}
                  >
                    Avbryt
                  </Button>
                  <Button type="submit" variant="primary">
                    Marker som løst
                  </Button>
                </div>
              </Form>
            </>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}
