import { CheckmarkIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Modal,
  Table,
  Textarea,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link } from 'react-router'
import { getUnresolvedAlertsWithContext, resolveRepositoryAlert } from '../db/alerts.server'
import type { Route } from './+types/alerts'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-varsler - Pensjon Deployment Audit' }]
}

export async function loader() {
  const alerts = await getUnresolvedAlertsWithContext()
  return { alerts }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'resolve') {
    const alertId = Number(formData.get('alert_id'))
    const resolutionNote = formData.get('resolution_note') as string

    if (!resolutionNote?.trim()) {
      return {
        success: null,
        error: 'Vennligst skriv en merknad om hvordan varselet ble løst',
      }
    }

    try {
      await resolveRepositoryAlert(alertId, resolutionNote)
      return {
        success: 'Varsel markert som løst',
        error: null,
      }
    } catch (error) {
      console.error('Resolve error:', error)
      return {
        success: null,
        error: error instanceof Error ? error.message : 'Kunne ikke løse varsel',
      }
    }
  }

  return { success: null, error: 'Ugyldig handling' }
}

export default function Alerts({ loaderData, actionData }: Route.ComponentProps) {
  const { alerts } = loaderData
  const [resolveModalOpen, setResolveModalOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<(typeof alerts)[0] | null>(null)

  const openResolveModal = (alert: (typeof alerts)[0]) => {
    setSelectedAlert(alert)
    setResolveModalOpen(true)
  }

  return (
    <VStack gap="space-32">
      <div>
        <Heading size="large" spacing>
          Repository-varsler 🔒
        </Heading>
        <BodyShort textColor="subtle">
          Disse varslene oppstår når en deployment kommer fra et annet repository enn forventet. Dette kan indikere at
          noen har «kapret» en applikasjon, og må sjekkes manuelt.
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
        <VStack gap="space-16">
          <Alert variant="error">
            Du har <strong>{alerts.length} uløste varsel(er)</strong> som krever oppmerksomhet.
          </Alert>

          <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell scope="col">Type</Table.HeaderCell>
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
                {alerts.map((alert) => {
                  const alertTypeLabel =
                    {
                      repository_mismatch: 'Ukjent repo',
                      pending_approval: 'Venter godkjenning',
                      historical_repository: 'Historisk repo',
                    }[alert.alert_type] || alert.alert_type

                  return (
                    <Table.Row key={alert.id}>
                      <Table.DataCell>
                        <Detail textColor="subtle">{alertTypeLabel}</Detail>
                      </Table.DataCell>
                      <Table.DataCell>
                        <strong>{alert.app_name}</strong>
                        <br />
                        <Detail textColor="subtle">Team: {alert.team_slug}</Detail>
                      </Table.DataCell>
                      <Table.DataCell>{alert.environment_name}</Table.DataCell>
                      <Table.DataCell>
                        <Link
                          to={`https://github.com/${alert.expected_github_owner}/${alert.expected_github_repo_name}`}
                          target="_blank"
                        >
                          {alert.expected_github_owner}/{alert.expected_github_repo_name}
                        </Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <Link
                          to={`https://github.com/${alert.detected_github_owner}/${alert.detected_github_repo_name}`}
                          target="_blank"
                          data-color="danger"
                        >
                          {alert.detected_github_owner}/{alert.detected_github_repo_name}
                        </Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <code style={{ fontSize: '0.75rem' }}>{alert.deployment_nais_id.substring(0, 16)}...</code>
                      </Table.DataCell>
                      <Table.DataCell>
                        <Detail textColor="subtle">
                          {new Date(alert.created_at).toLocaleDateString('nb-NO', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Detail>
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
                  )
                })}
              </Table.Body>
            </Table>
          </Box>
        </VStack>
      )}

      <Modal
        open={resolveModalOpen}
        onClose={() => setResolveModalOpen(false)}
        header={{ heading: 'Løs repository-varsel' }}
      >
        <Modal.Body>
          {selectedAlert && (
            <VStack gap="space-16">
              <BodyShort>Du er i ferd med å markere dette varselet som løst:</BodyShort>
              <Alert variant="warning">
                <strong>{selectedAlert.app_name}</strong> ({selectedAlert.environment_name})
                <br />
                Forventet: {selectedAlert.expected_github_owner}/{selectedAlert.expected_github_repo_name}
                <br />
                Detektert: {selectedAlert.detected_github_owner}/{selectedAlert.detected_github_repo_name}
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

                <HStack gap="space-16" justify="end" marginBlock="space-16 space-0">
                  <Button type="button" variant="secondary" onClick={() => setResolveModalOpen(false)}>
                    Avbryt
                  </Button>
                  <Button type="submit" variant="primary">
                    Marker som løst
                  </Button>
                </HStack>
              </Form>
            </VStack>
          )}
        </Modal.Body>
      </Modal>
    </VStack>
  )
}
