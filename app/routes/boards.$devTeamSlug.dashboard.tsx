import { ChevronLeftIcon, LinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Select, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData, useSearchParams } from 'react-router'
import { getBoardsByDevTeam } from '~/db/boards.server'
import { type BoardObjectiveProgress, getBoardObjectiveProgress } from '~/db/dashboard-stats.server'
import { getOriginOfChangeCoverage } from '~/db/deployment-goal-links.server'
import { getDevTeamApplications, getDevTeamBySlug } from '~/db/dev-teams.server'
import { requireUser } from '~/lib/auth.server'
import { type BoardPeriodType, getCurrentPeriod, getPeriodsForYear } from '~/lib/board-periods'
import type { Route } from './+types/boards.$devTeamSlug.dashboard'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Dashboard – ${data?.devTeam?.name ?? 'Team'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const url = new URL(request.url)
  const periodType = (url.searchParams.get('periodType') as BoardPeriodType) || 'tertiary'
  const periodLabel = url.searchParams.get('period') || getCurrentPeriod(periodType).label

  const year = new Date().getFullYear()
  const periods = getPeriodsForYear(periodType, year)
  const selectedPeriod = periods.find((p) => p.label === periodLabel) ?? getCurrentPeriod(periodType)

  const startDate = new Date(selectedPeriod.start)
  const endDate = new Date(selectedPeriod.end)
  endDate.setDate(endDate.getDate() + 1)

  const boards = await getBoardsByDevTeam(devTeam.id)
  const currentBoard = boards.find((b) => b.period_label === selectedPeriod.label && b.period_type === periodType)

  let objectiveProgress: BoardObjectiveProgress[] = []
  if (currentBoard) {
    objectiveProgress = await getBoardObjectiveProgress(currentBoard.id)
  }

  const directApps = await getDevTeamApplications(devTeam.id)
  const directAppIds = directApps.map((a) => a.monitored_app_id)

  const coverage = await getOriginOfChangeCoverage(
    devTeam.nais_team_slugs,
    startDate,
    endDate,
    directAppIds.length > 0 ? directAppIds : undefined,
  )

  return { devTeam, periods, selectedPeriod, periodType, currentBoard, objectiveProgress, coverage }
}

export default function DevTeamDashboard() {
  const { devTeam, periods, selectedPeriod, periodType, currentBoard, objectiveProgress, coverage } =
    useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()

  return (
    <VStack gap="space-24">
      <div>
        <HStack gap="space-8" align="center">
          <Button
            as={Link}
            to={`/boards/${devTeam.slug}`}
            variant="tertiary"
            size="small"
            icon={<ChevronLeftIcon aria-hidden />}
          >
            Tavler
          </Button>
        </HStack>
        <Heading level="1" size="large" spacing>
          Dashboard – {devTeam.name}
        </Heading>
      </div>

      {/* Period selector */}
      <HStack gap="space-16" wrap>
        <Select
          label="Periodetype"
          size="small"
          value={periodType}
          onChange={(e) => {
            const params = new URLSearchParams(searchParams)
            params.set('periodType', e.target.value)
            params.delete('period')
            setSearchParams(params)
          }}
        >
          <option value="tertiary">Tertial</option>
          <option value="quarterly">Kvartal</option>
        </Select>
        <Select
          label="Periode"
          size="small"
          value={selectedPeriod.label}
          onChange={(e) => {
            const params = new URLSearchParams(searchParams)
            params.set('period', e.target.value)
            setSearchParams(params)
          }}
        >
          {periods.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </Select>
      </HStack>

      {/* Coverage summary */}
      <Box padding="space-20" borderRadius="8" background="neutral-soft">
        <HStack gap="space-32" wrap>
          <VStack gap="space-4">
            <Detail textColor="subtle">Totalt deployments</Detail>
            <Heading size="medium" level="3">
              {coverage.total}
            </Heading>
          </VStack>
          <VStack gap="space-4">
            <Detail textColor="subtle">Med endringsopphav</Detail>
            <Heading size="medium" level="3">
              {coverage.linked}
            </Heading>
          </VStack>
          <VStack gap="space-4">
            <Detail textColor="subtle">Dekningsgrad</Detail>
            <Tag variant={getCoverageVariant(coverage.coverage)} size="medium">
              {Math.round(coverage.coverage * 100)}%
            </Tag>
          </VStack>
          <VStack gap="space-4">
            <Detail textColor="subtle">Uten kobling</Detail>
            <BodyShort weight="semibold">{coverage.total - coverage.linked}</BodyShort>
          </VStack>
        </HStack>
      </Box>

      {/* Board objective progress */}
      {!currentBoard ? (
        <Alert variant="info">
          Ingen tavle funnet for {selectedPeriod.label}. <Link to={`/boards/${devTeam.slug}`}>Opprett en tavle</Link>
        </Alert>
      ) : (
        <VStack gap="space-16">
          <Heading level="2" size="medium">
            Mål-fremdrift – {currentBoard.title}
          </Heading>

          {objectiveProgress.length === 0 ? (
            <Alert variant="info">
              Ingen mål er lagt til på denne tavlen.{' '}
              <Link to={`/boards/${devTeam.slug}/${currentBoard.id}`}>Legg til mål</Link>
            </Alert>
          ) : (
            <VStack gap="space-12">
              {objectiveProgress.map((obj) => (
                <ObjectiveProgressCard key={obj.objective_id} objective={obj} />
              ))}
            </VStack>
          )}
        </VStack>
      )}
    </VStack>
  )
}

function ObjectiveProgressCard({ objective }: { objective: BoardObjectiveProgress }) {
  return (
    <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-12">
        <HStack justify="space-between" align="center">
          <Heading level="3" size="small">
            {objective.objective_title}
          </Heading>
          <HStack gap="space-8" align="center">
            <LinkIcon aria-hidden />
            <Tag variant={objective.total_linked_deployments > 0 ? 'info' : 'neutral'} size="small">
              {objective.total_linked_deployments} leveranser
            </Tag>
          </HStack>
        </HStack>

        {objective.key_results.length > 0 && (
          <VStack gap="space-8">
            {objective.key_results.map((kr) => (
              <HStack key={kr.id} justify="space-between" align="center">
                <BodyShort size="small">{kr.title}</BodyShort>
                <Tag variant={kr.linked_deployments > 0 ? 'info' : 'neutral'} size="xsmall">
                  {kr.linked_deployments} leveranser
                </Tag>
              </HStack>
            ))}
          </VStack>
        )}
      </VStack>
    </Box>
  )
}

function getCoverageVariant(ratio: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (ratio >= 0.9) return 'success'
  if (ratio >= 0.7) return 'warning'
  if (ratio > 0) return 'error'
  return 'neutral'
}
