import { BarChartIcon, PencilIcon, PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Heading,
  HStack,
  Table,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link, useLoaderData } from 'react-router'
import {
  createDevTeam,
  type DevTeamApplication,
  type DevTeamWithNaisTeams,
  getAvailableAppsForDevTeam,
  getDevTeamApplications,
  getDevTeamsBySection,
  setDevTeamApplications,
  setDevTeamNaisTeams,
  updateDevTeam,
} from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/sections.$slug.dev-teams'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Utviklingsteam – ${data?.section?.name ?? 'Seksjon'} – Admin` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)
  const section = await getSectionBySlug(params.slug)
  if (!section) {
    throw new Response('Seksjon ikke funnet', { status: 404 })
  }
  const devTeams = await getDevTeamsBySection(section.id)

  const appsByTeam: Record<number, DevTeamApplication[]> = {}
  const availableAppsByTeam: Record<
    number,
    { id: number; team_slug: string; environment_name: string; app_name: string; is_linked: boolean }[]
  > = {}
  for (const team of devTeams) {
    appsByTeam[team.id] = await getDevTeamApplications(team.id)
    availableAppsByTeam[team.id] = await getAvailableAppsForDevTeam(team.id)
  }

  return { section, devTeams, appsByTeam, availableAppsByTeam }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireAdmin(request)
  const section = await getSectionBySlug(params.slug)
  if (!section) {
    throw new Response('Seksjon ikke funnet', { status: 404 })
  }

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const slug = (formData.get('slug') as string)?.trim()
    const name = (formData.get('name') as string)?.trim()

    if (!slug || !name) {
      return { error: 'Slug og navn er påkrevd.' }
    }

    try {
      await createDevTeam(section.id, slug, name)
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke opprette utviklingsteam: ${error}` }
    }
  }

  if (intent === 'update') {
    const id = Number(formData.get('id'))
    const name = (formData.get('name') as string)?.trim()
    const naisTeamSlugs = (formData.get('nais_team_slugs') as string)
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (!id || !name) {
      return { error: 'ID og navn er påkrevd.' }
    }

    try {
      await updateDevTeam(id, { name })
      await setDevTeamNaisTeams(id, naisTeamSlugs ?? [])
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke oppdatere utviklingsteam: ${error}` }
    }
  }

  if (intent === 'deactivate') {
    const id = Number(formData.get('id'))
    try {
      await updateDevTeam(id, { is_active: false })
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke deaktivere utviklingsteam: ${error}` }
    }
  }

  if (intent === 'update_apps') {
    const id = Number(formData.get('id'))
    const appIds = formData.getAll('app_ids').map(Number).filter(Boolean)
    try {
      await setDevTeamApplications(id, appIds)
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke oppdatere applikasjoner: ${error}` }
    }
  }

  return { error: 'Ukjent handling.' }
}

export default function AdminDevTeams() {
  const { section, devTeams, appsByTeam, availableAppsByTeam } = useLoaderData<typeof loader>()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [managingAppsId, setManagingAppsId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Utviklingsteam – {section.name}
        </Heading>
        <BodyShort textColor="subtle">
          Administrer utviklingsteam under seksjonen. Utviklingsteam er uavhengige av Nais-team og brukes for
          mål-/commitmentstavler.
        </BodyShort>
        <HStack gap="space-8" style={{ marginTop: 'var(--ax-space-8)' }}>
          <Button
            as={Link}
            to={`/sections/${section.slug}`}
            variant="tertiary"
            size="small"
            icon={<BarChartIcon aria-hidden />}
          >
            Seksjonsoversikt
          </Button>
        </HStack>
      </div>

      {!showCreate ? (
        <HStack>
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Nytt utviklingsteam
          </Button>
        </HStack>
      ) : (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setShowCreate(false)}>
            <input type="hidden" name="intent" value="create" />
            <VStack gap="space-16">
              <Heading level="2" size="small">
                Opprett nytt utviklingsteam
              </Heading>
              <HStack gap="space-16" wrap>
                <TextField
                  label="Slug"
                  name="slug"
                  size="small"
                  placeholder="f.eks. team-pensjon-ytelse"
                  autoComplete="off"
                />
                <TextField
                  label="Visningsnavn"
                  name="name"
                  size="small"
                  placeholder="f.eks. Team Pensjon Ytelse"
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

      {devTeams.length === 0 ? (
        <Alert variant="info">Ingen utviklingsteam er opprettet for denne seksjonen.</Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Utviklingsteam</Table.HeaderCell>
              <Table.HeaderCell>Slug</Table.HeaderCell>
              <Table.HeaderCell>Nais-team</Table.HeaderCell>
              <Table.HeaderCell>Applikasjoner</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {devTeams.map((team) => (
              <DevTeamRow
                key={team.id}
                team={team}
                linkedApps={appsByTeam[team.id] ?? []}
                availableApps={availableAppsByTeam[team.id] ?? []}
                isEditing={editingId === team.id}
                isManagingApps={managingAppsId === team.id}
                onEdit={() => setEditingId(team.id)}
                onCancel={() => setEditingId(null)}
                onManageApps={() => setManagingAppsId(managingAppsId === team.id ? null : team.id)}
                onCancelApps={() => setManagingAppsId(null)}
              />
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}

function DevTeamRow({
  team,
  linkedApps,
  availableApps,
  isEditing,
  isManagingApps,
  onEdit,
  onCancel,
  onManageApps,
  onCancelApps,
}: {
  team: DevTeamWithNaisTeams
  linkedApps: DevTeamApplication[]
  availableApps: { id: number; team_slug: string; environment_name: string; app_name: string; is_linked: boolean }[]
  isEditing: boolean
  isManagingApps: boolean
  onEdit: () => void
  onCancel: () => void
  onManageApps: () => void
  onCancelApps: () => void
}) {
  if (isEditing) {
    return (
      <Table.Row>
        <Table.DataCell colSpan={5}>
          <Form method="post" onSubmit={onCancel}>
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={team.id} />
            <VStack gap="space-12" style={{ padding: 'var(--ax-space-8) 0' }}>
              <HStack gap="space-16" wrap>
                <TextField label="Navn" name="name" size="small" defaultValue={team.name} autoComplete="off" />
                <TextField
                  label="Nais-team (kommaseparert)"
                  name="nais_team_slugs"
                  size="small"
                  defaultValue={team.nais_team_slugs.join(', ')}
                  autoComplete="off"
                  style={{ minWidth: '400px' }}
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

  if (isManagingApps) {
    return (
      <Table.Row>
        <Table.DataCell colSpan={5}>
          <Form method="post" onSubmit={onCancelApps}>
            <input type="hidden" name="intent" value="update_apps" />
            <input type="hidden" name="id" value={team.id} />
            <VStack gap="space-12" style={{ padding: 'var(--ax-space-8) 0' }}>
              <Heading level="3" size="xsmall">
                Applikasjoner for {team.name}
              </Heading>
              {availableApps.length === 0 ? (
                <Alert variant="info" size="small">
                  Ingen tilgjengelige applikasjoner. Koble Nais-team til dette utviklingsteamet først.
                </Alert>
              ) : (
                <CheckboxGroup legend="Velg applikasjoner" size="small" hideLegend>
                  {availableApps.map((app) => (
                    <Checkbox key={app.id} name="app_ids" value={String(app.id)} defaultChecked={app.is_linked}>
                      {app.app_name}{' '}
                      <BodyShort as="span" size="small" textColor="subtle">
                        ({app.team_slug} / {app.environment_name})
                      </BodyShort>
                    </Checkbox>
                  ))}
                </CheckboxGroup>
              )}
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Lagre
                </Button>
                <Button variant="tertiary" size="small" onClick={onCancelApps}>
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
      <Table.DataCell>{team.name}</Table.DataCell>
      <Table.DataCell>
        <code>{team.slug}</code>
      </Table.DataCell>
      <Table.DataCell>
        <HStack gap="space-4" wrap>
          {team.nais_team_slugs.map((slug) => (
            <Tag key={slug} variant="neutral" size="small">
              {slug}
            </Tag>
          ))}
          {team.nais_team_slugs.length === 0 && (
            <BodyShort size="small" textColor="subtle">
              Ingen Nais-team
            </BodyShort>
          )}
        </HStack>
      </Table.DataCell>
      <Table.DataCell>
        <HStack gap="space-4" wrap>
          {linkedApps.map((app) => (
            <Tag key={app.monitored_app_id} variant="info" size="small">
              {app.app_name}
            </Tag>
          ))}
          {linkedApps.length === 0 && (
            <BodyShort size="small" textColor="subtle">
              Alle via Nais-team
            </BodyShort>
          )}
        </HStack>
      </Table.DataCell>
      <Table.DataCell>
        <HStack gap="space-4">
          <Button
            as={Link}
            to={`/boards/${team.slug}`}
            variant="tertiary"
            size="xsmall"
            icon={<BarChartIcon aria-hidden />}
          >
            Tavler
          </Button>
          <Button variant="tertiary" size="xsmall" icon={<PencilIcon aria-hidden />} onClick={onEdit}>
            Rediger
          </Button>
          <Button variant="tertiary" size="xsmall" onClick={onManageApps}>
            Apper
          </Button>
          <Form method="post" style={{ display: 'inline' }}>
            <input type="hidden" name="intent" value="deactivate" />
            <input type="hidden" name="id" value={team.id} />
            <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
              Deaktiver
            </Button>
          </Form>
        </HStack>
      </Table.DataCell>
    </Table.Row>
  )
}
