import { DownloadIcon, PencilIcon, PlusIcon, TrashIcon, UploadIcon } from '@navikt/aksel-icons'
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
import { requireAdmin } from '~/lib/auth.server'
import styles from '~/styles/common.module.css'

export async function loader({ request }: LoaderFunctionArgs) {
  requireAdmin(request)

  const [mappings, unmappedUsers] = await Promise.all([getAllUserMappings(), getUnmappedUsers()])
  return { mappings, unmappedUsers }
}

export async function action({ request }: ActionFunctionArgs) {
  requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'delete') {
    const githubUsername = formData.get('github_username') as string
    await deleteUserMapping(githubUsername)
    return { success: true }
  }

  if (intent === 'upsert') {
    const githubUsername = formData.get('github_username') as string
    const navEmail = (formData.get('nav_email') as string) || null
    const navIdent = (formData.get('nav_ident') as string) || null

    const fieldErrors: { github_username?: string; nav_email?: string; nav_ident?: string } = {}

    if (!githubUsername) {
      fieldErrors.github_username = 'GitHub brukernavn er påkrevd'
    }

    // Validate email format
    if (navEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(navEmail)) {
      fieldErrors.nav_email = 'Ugyldig e-postformat'
    }

    // Validate Nav-ident format (one letter followed by 6 digits)
    if (navIdent && !/^[a-zA-Z]\d{6}$/.test(navIdent)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer (f.eks. A123456)'
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors }
    }

    await upsertUserMapping({
      githubUsername,
      displayName: (formData.get('display_name') as string) || null,
      navEmail,
      navIdent,
      slackMemberId: (formData.get('slack_member_id') as string) || null,
    })
    return { success: true }
  }

  if (intent === 'import') {
    const file = formData.get('file') as File
    if (!file || file.size === 0) {
      return { error: 'Ingen fil valgt' }
    }

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!data.mappings || !Array.isArray(data.mappings)) {
        return { error: 'Ugyldig filformat - mangler mappings array' }
      }

      let imported = 0
      for (const mapping of data.mappings) {
        if (!mapping.github_username) continue
        await upsertUserMapping({
          githubUsername: mapping.github_username,
          displayName: mapping.display_name || null,
          navEmail: mapping.nav_email || null,
          navIdent: mapping.nav_ident || null,
          slackMemberId: mapping.slack_member_id || null,
        })
        imported++
      }

      return { success: true, message: `Importerte ${imported} brukermappinger` }
    } catch (e) {
      return { error: `Kunne ikke lese fil: ${e instanceof Error ? e.message : 'Ukjent feil'}` }
    }
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset add form and close modals when action succeeds
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      setAddFormKey((k) => k + 1)
      addModalRef.current?.close()
      modalRef.current?.close()
    }
  }, [actionData, navigation.state])

  const openEdit = (mapping: UserMapping) => {
    setEditMapping(mapping)
    modalRef.current?.showModal()
  }

  const openAdd = () => {
    setPrefillUsername('')
    setAddFormKey((k) => k + 1)
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
        <HStack justify="space-between" align="center" wrap gap="space-8">
          <Heading size="large">Brukermappinger</Heading>
          <HStack gap="space-8">
            <Button
              as="a"
              href="/admin/users/export"
              download
              variant="tertiary"
              size="small"
              icon={<DownloadIcon aria-hidden />}
            >
              <Show above="sm">Eksporter</Show>
            </Button>
            <Form method="post" encType="multipart/form-data" style={{ display: 'contents' }}>
              <input type="hidden" name="intent" value="import" />
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    e.target.form?.requestSubmit()
                  }
                }}
              />
              <Button
                type="button"
                variant="tertiary"
                size="small"
                icon={<UploadIcon aria-hidden />}
                onClick={() => fileInputRef.current?.click()}
              >
                <Show above="sm">Importer</Show>
              </Button>
            </Form>
            <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={openAdd}>
              <Show above="sm">Legg til</Show>
            </Button>
          </HStack>
        </HStack>

        <BodyShort textColor="subtle">
          Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.
        </BodyShort>

        {/* Success message from import */}
        {actionData?.message && (
          <Alert variant="success" closeButton>
            {actionData.message}
          </Alert>
        )}

        {/* Error message */}
        {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

        {/* Warning alert for unmapped users */}
        {unmappedUsers.length > 0 && (
          <Alert variant="warning">
            {unmappedUsers.length} GitHub-bruker{unmappedUsers.length === 1 ? '' : 'e'} har deployments men mangler
            mapping. Se listen nederst på siden.
          </Alert>
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
                      <Link to={`/users/${mapping.github_username}`}>
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

        {/* Unmapped users section at bottom */}
        {unmappedUsers.length > 0 && (
          <VStack gap="space-16">
            <Heading size="medium">Brukere uten mapping ({unmappedUsers.length})</Heading>
            <div>
              {unmappedUsers.map((user) => (
                <Box
                  key={user.github_username}
                  padding="space-16"
                  background="raised"
                  className={styles.stackedListItem}
                >
                  <HStack justify="space-between" align="center">
                    <HStack gap="space-12" align="center">
                      <Link to={`/users/${user.github_username}`}>
                        <BodyShort weight="semibold">{user.github_username}</BodyShort>
                      </Link>
                      <Detail textColor="subtle">{user.deployment_count} deployments</Detail>
                    </HStack>
                    <Button
                      variant="secondary"
                      size="small"
                      icon={<PlusIcon aria-hidden />}
                      onClick={() => openAddWithUsername(user.github_username)}
                    >
                      <Show above="sm">Legg til mapping</Show>
                    </Button>
                  </HStack>
                </Box>
              ))}
            </div>
          </VStack>
        )}

        {/* Add Modal */}
        <Modal ref={addModalRef} header={{ heading: 'Legg til brukermapping' }} width="medium">
          <Modal.Body>
            <Form method="post" id="add-form" key={addFormKey}>
              <input type="hidden" name="intent" value="upsert" />
              <VStack gap="space-16">
                <TextField
                  label="GitHub brukernavn"
                  name="github_username"
                  required
                  defaultValue={prefillUsername}
                  error={actionData?.fieldErrors?.github_username}
                />
                <TextField label="Navn" name="display_name" />
                <TextField label="Nav e-post" name="nav_email" error={actionData?.fieldErrors?.nav_email} />
                <TextField
                  label="Nav-ident"
                  name="nav_ident"
                  description="Format: én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
                  error={actionData?.fieldErrors?.nav_ident}
                />
                <TextField label="Slack member ID" name="slack_member_id" />
              </VStack>
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button type="submit" form="add-form" loading={isSubmitting}>
              Lagre
            </Button>
            <Button variant="secondary" onClick={() => addModalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Edit Modal */}
        <Modal
          ref={modalRef}
          header={{ heading: 'Rediger brukermapping' }}
          width="medium"
          onClose={() => setEditMapping(null)}
        >
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
                    defaultValue={editMapping.nav_email || ''}
                    error={actionData?.fieldErrors?.nav_email}
                  />
                  <TextField
                    label="Nav-ident"
                    name="nav_ident"
                    description="Format: én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
                    defaultValue={editMapping.nav_ident || ''}
                    error={actionData?.fieldErrors?.nav_ident}
                  />
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
            <Button type="submit" form="edit-form" loading={isSubmitting}>
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
