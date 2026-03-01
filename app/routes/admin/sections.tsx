import { PencilIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Table, Tag, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, useLoaderData } from 'react-router'
import {
  createSection,
  getAllSectionsWithTeams,
  type SectionWithTeams,
  setSectionTeams,
  updateSection,
} from '~/db/sections.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/sections'

export function meta() {
  return [{ title: 'Seksjoner - Admin - Deployment Audit' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const sections = await getAllSectionsWithTeams()
  return { sections }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const slug = (formData.get('slug') as string)?.trim()
    const name = (formData.get('name') as string)?.trim()
    const entraGroupAdmin = (formData.get('entra_group_admin') as string)?.trim() || undefined
    const entraGroupUser = (formData.get('entra_group_user') as string)?.trim() || undefined

    if (!slug || !name) {
      return { error: 'Slug og navn er påkrevd.' }
    }

    try {
      await createSection(slug, name, entraGroupAdmin, entraGroupUser)
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke opprette seksjon: ${error}` }
    }
  }

  if (intent === 'update') {
    const id = Number(formData.get('id'))
    const name = (formData.get('name') as string)?.trim()
    const entraGroupAdmin = (formData.get('entra_group_admin') as string)?.trim()
    const entraGroupUser = (formData.get('entra_group_user') as string)?.trim()
    const teamSlugs = (formData.get('team_slugs') as string)
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (!id || !name) {
      return { error: 'ID og navn er påkrevd.' }
    }

    try {
      await updateSection(id, {
        name,
        entra_group_admin: entraGroupAdmin || null,
        entra_group_user: entraGroupUser || null,
      })
      if (teamSlugs) {
        await setSectionTeams(id, teamSlugs)
      }
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke oppdatere seksjon: ${error}` }
    }
  }

  if (intent === 'deactivate') {
    const id = Number(formData.get('id'))
    try {
      await updateSection(id, { is_active: false })
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke deaktivere seksjon: ${error}` }
    }
  }

  return { error: 'Ukjent handling.' }
}

export default function AdminSections() {
  const { sections } = useLoaderData<typeof loader>()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Seksjoner
        </Heading>
        <BodyShort textColor="subtle">
          Administrer seksjoner som grupperer Nais-team under en organisatorisk enhet med tilgangsstyring.
        </BodyShort>
      </div>

      {/* Create form */}
      {!showCreate ? (
        <HStack>
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Ny seksjon
          </Button>
        </HStack>
      ) : (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setShowCreate(false)}>
            <input type="hidden" name="intent" value="create" />
            <VStack gap="space-16">
              <Heading level="2" size="small">
                Opprett ny seksjon
              </Heading>
              <HStack gap="space-16" wrap>
                <TextField label="Slug" name="slug" size="small" placeholder="f.eks. pensjon" autoComplete="off" />
                <TextField
                  label="Visningsnavn"
                  name="name"
                  size="small"
                  placeholder="f.eks. Pensjon og uføre"
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-16" wrap>
                <TextField
                  label="Entra ID admin-gruppe"
                  name="entra_group_admin"
                  size="small"
                  placeholder="Gruppe-ID (valgfritt)"
                  autoComplete="off"
                />
                <TextField
                  label="Entra ID bruker-gruppe"
                  name="entra_group_user"
                  size="small"
                  placeholder="Gruppe-ID (valgfritt)"
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Opprett
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setShowCreate(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      )}

      {/* Sections table */}
      {sections.length === 0 ? (
        <Alert variant="info">Ingen seksjoner er opprettet ennå.</Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Seksjon</Table.HeaderCell>
              <Table.HeaderCell>Slug</Table.HeaderCell>
              <Table.HeaderCell>Team</Table.HeaderCell>
              <Table.HeaderCell>Entra-grupper</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sections.map((section) => (
              <SectionRow
                key={section.id}
                section={section}
                isEditing={editingId === section.id}
                onEdit={() => setEditingId(section.id)}
                onCancel={() => setEditingId(null)}
              />
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}

function SectionRow({
  section,
  isEditing,
  onEdit,
  onCancel,
}: {
  section: SectionWithTeams
  isEditing: boolean
  onEdit: () => void
  onCancel: () => void
}) {
  if (isEditing) {
    return (
      <Table.Row>
        <Table.DataCell colSpan={5}>
          <Form method="post" onSubmit={onCancel}>
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={section.id} />
            <VStack gap="space-12" style={{ padding: 'var(--ax-space-8) 0' }}>
              <HStack gap="space-16" wrap>
                <TextField label="Navn" name="name" size="small" defaultValue={section.name} autoComplete="off" />
                <TextField
                  label="Team (kommaseparert)"
                  name="team_slugs"
                  size="small"
                  defaultValue={section.team_slugs.join(', ')}
                  autoComplete="off"
                  style={{ minWidth: '300px' }}
                />
              </HStack>
              <HStack gap="space-16" wrap>
                <TextField
                  label="Admin-gruppe"
                  name="entra_group_admin"
                  size="small"
                  defaultValue={section.entra_group_admin ?? ''}
                  autoComplete="off"
                />
                <TextField
                  label="Bruker-gruppe"
                  name="entra_group_user"
                  size="small"
                  defaultValue={section.entra_group_user ?? ''}
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Lagre
                </Button>
                <Button variant="tertiary" size="small" onClick={onCancel}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Table.DataCell>
      </Table.Row>
    )
  }

  return (
    <Table.Row>
      <Table.DataCell>{section.name}</Table.DataCell>
      <Table.DataCell>
        <code>{section.slug}</code>
      </Table.DataCell>
      <Table.DataCell>
        <HStack gap="space-4" wrap>
          {section.team_slugs.map((slug) => (
            <Tag key={slug} variant="neutral" size="small">
              {slug}
            </Tag>
          ))}
          {section.team_slugs.length === 0 && (
            <BodyShort size="small" textColor="subtle">
              Ingen team
            </BodyShort>
          )}
        </HStack>
      </Table.DataCell>
      <Table.DataCell>
        <VStack gap="space-2">
          {section.entra_group_admin && (
            <Tag variant="warning" size="small">
              Admin: {section.entra_group_admin.slice(0, 8)}…
            </Tag>
          )}
          {section.entra_group_user && (
            <Tag variant="info" size="small">
              User: {section.entra_group_user.slice(0, 8)}…
            </Tag>
          )}
          {!section.entra_group_admin && !section.entra_group_user && (
            <BodyShort size="small" textColor="subtle">
              Ikke konfigurert
            </BodyShort>
          )}
        </VStack>
      </Table.DataCell>
      <Table.DataCell>
        <HStack gap="space-4">
          <Button variant="tertiary" size="xsmall" icon={<PencilIcon aria-hidden />} onClick={onEdit}>
            Rediger
          </Button>
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value="deactivate" />
            <input type="hidden" name="id" value={section.id} />
            <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
              Deaktiver
            </Button>
          </Form>
        </HStack>
      </Table.DataCell>
    </Table.Row>
  )
}
