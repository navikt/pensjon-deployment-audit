import { PencilIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  Hide,
  HStack,
  Modal,
  Show,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { Form, Link, useActionData, useLoaderData, useNavigation } from 'react-router'
import {
  deleteUserMapping,
  getAllUserMappings,
  getUnmappedUsers,
  type UserMapping,
  upsertUserMapping,
} from '~/db/user-mappings.server'
import styles from '~/styles/common.module.css'

export async function loader(_args: LoaderFunctionArgs) {
  const [mappings, unmappedUsers] = await Promise.all([getAllUserMappings(), getUnmappedUsers()])
  return { mappings, unmappedUsers }
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
  const { mappings, unmappedUsers } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [editMapping, setEditMapping] = useState<UserMapping | null>(null)
  const [addFormKey, setAddFormKey] = useState(0)
  const [prefillUsername, setPrefillUsername] = useState('')
  const modalRef = useRef<HTMLDialogElement>(null)
  const addModalRef = useRef<HTMLDialogElement>(null)

  // Reset add form when action succeeds
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      setAddFormKey((k) => k + 1)
    }
  }, [actionData, navigation.state])

  const openEdit = (mapping: UserMapping) => {
    setEditMapping(mapping)
    modalRef.current?.showModal()
  }

  const openAdd = () => {
    setPrefillUsername('')
    addModalRef.current?.showModal()
  }

  const openAddWithUsername = (username: string) => {
    setPrefillUsername(username)
    setAddFormKey((k) => k + 1)
    addModalRef.current?.showModal()
  }

  return (
    <Box padding={{ xs: 'space-16', md: 'space-24' }}>
      <VStack gap="space-24">
        <HStack justify="space-between" align="center">
          <Heading size="large">Brukermappinger</Heading>
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={openAdd}>
            Legg til
          </Button>
        </HStack>

        <BodyShort textColor="subtle">
          Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.
        </BodyShort>

        {/* Unmapped users section */}
        {unmappedUsers.length > 0 && (
          <Box background="warning-moderate" padding="space-16" borderRadius="8">
            <VStack gap="space-12">
              <Heading size="small">Brukere uten mapping ({unmappedUsers.length})</Heading>
              <BodyShort size="small">
                Følgende GitHub-brukere har deployments men mangler mapping til Nav-identitet:
              </BodyShort>
              <HStack gap="space-8" wrap>
                {unmappedUsers.map((user) => (
                  <Button
                    key={user.github_username}
                    variant="secondary-neutral"
                    size="xsmall"
                    onClick={() => openAddWithUsername(user.github_username)}
                  >
                    {user.github_username} ({user.deployment_count})
                  </Button>
                ))}
              </HStack>
            </VStack>
          </Box>
        )}

        {mappings.length === 0 ? (
          <Alert variant="info">
            Ingen brukermappinger er lagt til ennå. Klikk "Legg til" for å opprette den første.
          </Alert>
        ) : (
          <div>
            {mappings.map((mapping) => (
              <Box
                key={mapping.github_username}
                padding="space-16"
                background="raised"
                className={styles.stackedListItem}
              >
                <VStack gap="space-12">
                  {/* First row: GitHub username, name (desktop), actions */}
                  <HStack gap="space-8" align="center" justify="space-between" wrap>
                    <HStack gap="space-12" align="center" style={{ flex: 1 }}>
                      <Link to={`https://github.com/${mapping.github_username}`} target="_blank">
                        <BodyShort weight="semibold">{mapping.github_username}</BodyShort>
                      </Link>
                      <Show above="md">{mapping.display_name && <BodyShort>{mapping.display_name}</BodyShort>}</Show>
                    </HStack>
                    <HStack gap="space-8">
                      <Button
                        variant="tertiary"
                        size="small"
                        icon={<PencilIcon aria-hidden />}
                        onClick={() => openEdit(mapping)}
                      >
                        <Show above="sm">Rediger</Show>
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
                          <Show above="sm">Slett</Show>
                        </Button>
                      </Form>
                    </HStack>
                  </HStack>

                  {/* Name on mobile */}
                  <Hide above="md">{mapping.display_name && <BodyShort>{mapping.display_name}</BodyShort>}</Hide>

                  {/* Details row */}
                  <HStack gap="space-16" wrap>
                    {mapping.nav_email && <Detail textColor="subtle">{mapping.nav_email}</Detail>}
                    {mapping.nav_ident && <Detail textColor="subtle">Ident: {mapping.nav_ident}</Detail>}
                    {mapping.slack_member_id && <Detail textColor="subtle">Slack: {mapping.slack_member_id}</Detail>}
                    {!mapping.nav_email && !mapping.nav_ident && !mapping.slack_member_id && (
                      <Detail textColor="subtle">Ingen tilleggsinformasjon</Detail>
                    )}
                  </HStack>
                </VStack>
              </Box>
            ))}
          </div>
        )}

        {/* Add Modal */}
        <Modal ref={addModalRef} header={{ heading: 'Legg til brukermapping' }}>
          <Modal.Body>
            <Form method="post" id="add-form" key={addFormKey}>
              <input type="hidden" name="intent" value="upsert" />
              <VStack gap="space-16">
                <TextField label="GitHub brukernavn" name="github_username" required defaultValue={prefillUsername} />
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
