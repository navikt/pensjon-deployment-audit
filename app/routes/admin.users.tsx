import { PencilIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Modal, Table, TextField, VStack } from '@navikt/ds-react'
import { useRef, useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { Form, useLoaderData, useNavigation } from 'react-router'
import { deleteUserMapping, getAllUserMappings, type UserMapping, upsertUserMapping } from '~/db/user-mappings.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const mappings = await getAllUserMappings()
  return { mappings }
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'delete') {
    const githubUsername = formData.get('github_username') as string
    await deleteUserMapping(githubUsername)
    return { success: true }
  }

  if (intent === 'upsert') {
    const githubUsername = formData.get('github_username') as string

    if (!githubUsername) {
      return { error: 'GitHub brukernavn er påkrevd' }
    }

    await upsertUserMapping({
      githubUsername,
      displayName: (formData.get('display_name') as string) || null,
      navEmail: (formData.get('nav_email') as string) || null,
      navIdent: (formData.get('nav_ident') as string) || null,
      slackMemberId: (formData.get('slack_member_id') as string) || null,
    })
    return { success: true }
  }

  return { error: 'Ukjent handling' }
}

export default function AdminUsers() {
  const { mappings } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [editMapping, setEditMapping] = useState<UserMapping | null>(null)
  const [_isAddOpen, setIsAddOpen] = useState(false)
  const modalRef = useRef<HTMLDialogElement>(null)
  const addModalRef = useRef<HTMLDialogElement>(null)

  const openEdit = (mapping: UserMapping) => {
    setEditMapping(mapping)
    modalRef.current?.showModal()
  }

  const openAdd = () => {
    setIsAddOpen(true)
    addModalRef.current?.showModal()
  }

  return (
    <Box padding={{ xs: 'space-16', md: 'space-24' }}>
      <VStack gap="space-24">
        <HStack justify="space-between" align="center">
          <Heading size="large">Brukermappinger</Heading>
          <Button variant="primary" icon={<PlusIcon aria-hidden />} onClick={openAdd}>
            Legg til
          </Button>
        </HStack>

        <BodyShort>Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.</BodyShort>

        {mappings.length === 0 ? (
          <Alert variant="info">
            Ingen brukermappinger er lagt til ennå. Klikk "Legg til" for å opprette den første.
          </Alert>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>GitHub</Table.HeaderCell>
                <Table.HeaderCell>Navn</Table.HeaderCell>
                <Table.HeaderCell>E-post</Table.HeaderCell>
                <Table.HeaderCell>Nav-ident</Table.HeaderCell>
                <Table.HeaderCell>Slack ID</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {mappings.map((mapping) => (
                <Table.Row key={mapping.github_username}>
                  <Table.DataCell>
                    <a href={`https://github.com/${mapping.github_username}`} target="_blank" rel="noopener noreferrer">
                      {mapping.github_username}
                    </a>
                  </Table.DataCell>
                  <Table.DataCell>{mapping.display_name || '-'}</Table.DataCell>
                  <Table.DataCell>{mapping.nav_email || '-'}</Table.DataCell>
                  <Table.DataCell>{mapping.nav_ident || '-'}</Table.DataCell>
                  <Table.DataCell>{mapping.slack_member_id || '-'}</Table.DataCell>
                  <Table.DataCell>
                    <HStack gap="space-8">
                      <Button
                        variant="tertiary"
                        size="small"
                        icon={<PencilIcon aria-hidden />}
                        onClick={() => openEdit(mapping)}
                      >
                        Rediger
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="github_username" value={mapping.github_username} />
                        <Button
                          variant="tertiary-neutral"
                          size="small"
                          type="submit"
                          name="intent"
                          value="delete"
                          icon={<TrashIcon aria-hidden />}
                          loading={isSubmitting}
                        >
                          Slett
                        </Button>
                      </Form>
                    </HStack>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        {/* Add Modal */}
        <Modal ref={addModalRef} header={{ heading: 'Legg til brukermapping' }} onClose={() => setIsAddOpen(false)}>
          <Modal.Body>
            <Form method="post" id="add-form">
              <input type="hidden" name="intent" value="upsert" />
              <VStack gap="space-16">
                <TextField label="GitHub brukernavn" name="github_username" required />
                <TextField label="Navn" name="display_name" />
                <TextField label="Nav e-post" name="nav_email" type="email" />
                <TextField label="Nav-ident" name="nav_ident" />
                <TextField label="Slack member ID" name="slack_member_id" />
              </VStack>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button type="submit" form="add-form" loading={isSubmitting} onClick={() => addModalRef.current?.close()}>
              Lagre
            </Button>
            <Button variant="secondary" onClick={() => addModalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Edit Modal */}
        <Modal ref={modalRef} header={{ heading: 'Rediger brukermapping' }} onClose={() => setEditMapping(null)}>
          <Modal.Body>
            {editMapping && (
              <Form method="post" id="edit-form">
                <input type="hidden" name="intent" value="upsert" />
                <input type="hidden" name="github_username" value={editMapping.github_username} />
                <VStack gap="space-16">
                  <TextField label="GitHub brukernavn" value={editMapping.github_username} disabled />
                  <TextField label="Navn" name="display_name" defaultValue={editMapping.display_name || ''} />
                  <TextField
                    label="Nav e-post"
                    name="nav_email"
                    type="email"
                    defaultValue={editMapping.nav_email || ''}
                  />
                  <TextField label="Nav-ident" name="nav_ident" defaultValue={editMapping.nav_ident || ''} />
                  <TextField
                    label="Slack member ID"
                    name="slack_member_id"
                    defaultValue={editMapping.slack_member_id || ''}
                  />
                </VStack>
              </Form>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button type="submit" form="edit-form" loading={isSubmitting} onClick={() => modalRef.current?.close()}>
              Lagre
            </Button>
            <Button variant="secondary" onClick={() => modalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Modal>
      </VStack>
    </Box>
  )
}
