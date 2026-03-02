import { BarChartIcon, PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Select, Table, Tag, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link, useLoaderData } from 'react-router'
import { type Board, createBoard, getBoardsByDevTeam } from '~/db/boards.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { requireUser } from '~/lib/auth.server'
import { type BoardPeriodType, getCurrentPeriod, getPeriodsForYear } from '~/lib/board-periods'
import type { Route } from './+types/boards.$devTeamSlug'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Tavler – ${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }
  const boards = await getBoardsByDevTeam(devTeam.id)
  const currentTertial = getCurrentPeriod('tertiary')
  const currentQuarter = getCurrentPeriod('quarterly')
  return { devTeam, boards, currentTertial, currentQuarter }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const title = (formData.get('title') as string)?.trim()
    const periodType = formData.get('period_type') as BoardPeriodType
    const periodLabel = formData.get('period_label') as string
    const periodStart = formData.get('period_start') as string
    const periodEnd = formData.get('period_end') as string

    if (!title || !periodType || !periodStart || !periodEnd || !periodLabel) {
      return { error: 'Alle felt er påkrevd.' }
    }

    try {
      await createBoard({
        dev_team_id: devTeam.id,
        title,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        period_label: periodLabel,
        created_by: user.navIdent,
      })
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke opprette tavle: ${error}` }
    }
  }

  return { error: 'Ukjent handling.' }
}

export default function BoardsList() {
  const { devTeam, boards } = useLoaderData<typeof loader>()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Tavler – {devTeam.name}
        </Heading>
        <BodyShort textColor="subtle">Mål- og commitmentstavler for utviklingsteamet.</BodyShort>
      </div>

      {!showCreate ? (
        <HStack gap="space-8">
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Ny tavle
          </Button>
          <Button
            as={Link}
            to={`/boards/${devTeam.slug}/dashboard`}
            variant="tertiary"
            size="small"
            icon={<BarChartIcon aria-hidden />}
          >
            Dashboard
          </Button>
        </HStack>
      ) : (
        <CreateBoardForm onCancel={() => setShowCreate(false)} />
      )}

      {boards.length === 0 ? (
        <Alert variant="info">Ingen tavler er opprettet for dette utviklingsteamet.</Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tavle</Table.HeaderCell>
              <Table.HeaderCell>Periode</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {boards.map((board) => (
              <BoardRow key={board.id} board={board} devTeamSlug={devTeam.slug} />
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}

function BoardRow({ board, devTeamSlug }: { board: Board; devTeamSlug: string }) {
  return (
    <Table.Row>
      <Table.DataCell>
        <Link to={`/boards/${devTeamSlug}/${board.id}`}>{board.title}</Link>
      </Table.DataCell>
      <Table.DataCell>{board.period_label}</Table.DataCell>
      <Table.DataCell>
        <Tag variant="neutral" size="small">
          {board.period_type === 'tertiary' ? 'Tertial' : 'Kvartal'}
        </Tag>
      </Table.DataCell>
      <Table.DataCell>
        <Tag variant={board.is_active ? 'success' : 'neutral'} size="small">
          {board.is_active ? 'Aktiv' : 'Avsluttet'}
        </Tag>
      </Table.DataCell>
      <Table.DataCell>
        <Button as={Link} to={`/boards/${devTeamSlug}/${board.id}`} variant="tertiary" size="xsmall">
          Vis
        </Button>
      </Table.DataCell>
    </Table.Row>
  )
}

function CreateBoardForm({ onCancel }: { onCancel: () => void }) {
  const [periodType, setPeriodType] = useState<BoardPeriodType>('tertiary')
  const year = new Date().getFullYear()
  const periods = getPeriodsForYear(periodType, year)

  const [selectedPeriod, setSelectedPeriod] = useState(periods[0])

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <Form method="post" onSubmit={onCancel}>
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="period_start" value={selectedPeriod?.start ?? ''} />
        <input type="hidden" name="period_end" value={selectedPeriod?.end ?? ''} />
        <input type="hidden" name="period_label" value={selectedPeriod?.label ?? ''} />
        <VStack gap="space-16">
          <Heading level="2" size="small">
            Opprett ny tavle
          </Heading>
          <HStack gap="space-16" wrap>
            <TextField label="Tittel" name="title" size="small" placeholder="f.eks. Mål T1 2026" autoComplete="off" />
            <Select
              label="Periodetype"
              name="period_type"
              size="small"
              value={periodType}
              onChange={(e) => {
                const type = e.target.value as BoardPeriodType
                setPeriodType(type)
                const newPeriods = getPeriodsForYear(type, year)
                setSelectedPeriod(newPeriods[0])
              }}
            >
              <option value="tertiary">Tertial</option>
              <option value="quarterly">Kvartal</option>
            </Select>
            <Select
              label="Periode"
              size="small"
              value={selectedPeriod?.label ?? ''}
              onChange={(e) => {
                const p = periods.find((p) => p.label === e.target.value)
                if (p) setSelectedPeriod(p)
              }}
            >
              {periods.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </Select>
          </HStack>
          <HStack gap="space-8">
            <Button type="submit" size="small">
              Opprett
            </Button>
            <Button variant="tertiary" size="small" onClick={onCancel}>
              Avbryt
            </Button>
          </HStack>
        </VStack>
      </Form>
    </Box>
  )
}
