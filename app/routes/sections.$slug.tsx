import { BarChartIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, LinkIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Detail,
  Heading,
  HGrid,
  HStack,
  Select,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useLoaderData, useSearchParams } from 'react-router'
import type { DevTeamDashboardStats } from '~/db/dashboard-stats.server'
import { getSectionDashboardStats } from '~/db/dashboard-stats.server'
import { getDevTeamsBySection } from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { type BoardPeriodType, getCurrentPeriod, getPeriodsForYear } from '~/lib/board-periods'
import type { Route } from './+types/sections.$slug'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.section?.name ?? 'Seksjon'} – Oversikt` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const section = await getSectionBySlug(params.slug)
  if (!section) throw new Response('Seksjon ikke funnet', { status: 404 })

  const url = new URL(request.url)
  const periodType = (url.searchParams.get('periodType') as BoardPeriodType) || 'tertiary'
  const periodLabel = url.searchParams.get('period') || getCurrentPeriod(periodType).label

  const year = new Date().getFullYear()
  const periods = getPeriodsForYear(periodType, year)
  const selectedPeriod = periods.find((p) => p.label === periodLabel) ?? getCurrentPeriod(periodType)

  const startDate = new Date(selectedPeriod.start)
  const endDate = new Date(selectedPeriod.end)
  endDate.setDate(endDate.getDate() + 1) // inclusive end

  const stats = await getSectionDashboardStats(section.id, startDate, endDate)
  const devTeams = await getDevTeamsBySection(section.id)

  return { section, stats, devTeams, periods, selectedPeriod, periodType }
}

export default function SectionOverview() {
  const { section, stats, devTeams, periods, selectedPeriod, periodType } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()

  const totalDeployments = stats.reduce((sum, s) => sum + s.total_deployments, 0)
  const totalWithFourEyes = stats.reduce((sum, s) => sum + s.with_four_eyes, 0)
  const totalLinked = stats.reduce((sum, s) => sum + s.linked_to_goal, 0)
  const overallFourEyes = totalDeployments > 0 ? totalWithFourEyes / totalDeployments : 0
  const overallGoalCoverage = totalDeployments > 0 ? totalLinked / totalDeployments : 0

  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="xlarge" spacing>
          {section.name}
        </Heading>
        <BodyShort textColor="subtle">Seksjonsoversikt – helsetilstand for SDLC governance</BodyShort>
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

      {/* Summary cards */}
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
        <SummaryCard title="Deployments" value={totalDeployments} icon={<BarChartIcon aria-hidden />} />
        <SummaryCard
          title="4-øyne dekning"
          value={`${Math.round(overallFourEyes * 100)}%`}
          icon={<CheckmarkCircleIcon aria-hidden />}
          variant={getHealthVariant(overallFourEyes)}
        />
        <SummaryCard
          title="Endringsopphav"
          value={`${Math.round(overallGoalCoverage * 100)}%`}
          icon={<LinkIcon aria-hidden />}
          variant={getHealthVariant(overallGoalCoverage)}
        />
        <SummaryCard
          title="Samlet helsetilstand"
          value={getHealthLabel(overallFourEyes, overallGoalCoverage)}
          icon={getHealthIcon(overallFourEyes, overallGoalCoverage)}
          variant={getHealthVariant(Math.min(overallFourEyes, overallGoalCoverage))}
        />
      </HGrid>

      {/* Dev team breakdown */}
      <VStack gap="space-16">
        <Heading level="2" size="large">
          Utviklingsteam
        </Heading>
        {devTeams.length === 0 ? (
          <Alert variant="info">
            Ingen utviklingsteam er opprettet.{' '}
            <AkselLink as={Link} to={`/admin/sections/${section.slug}/dev-teams`}>
              Opprett utviklingsteam
            </AkselLink>
          </Alert>
        ) : (
          <VStack gap="space-12">
            {stats.map((teamStats) => (
              <DevTeamCard key={teamStats.dev_team_id} stats={teamStats} />
            ))}
          </VStack>
        )}
      </VStack>
    </VStack>
  )
}

function SummaryCard({
  title,
  value,
  icon,
  variant = 'neutral',
}: {
  title: string
  value: string | number
  icon: React.ReactNode
  variant?: 'success' | 'warning' | 'error' | 'neutral'
}) {
  const bgMap = {
    success: 'success-soft' as const,
    warning: 'warning-soft' as const,
    error: 'danger-soft' as const,
    neutral: 'neutral-soft' as const,
  }

  return (
    <Box padding="space-20" borderRadius="8" background={bgMap[variant]}>
      <VStack gap="space-4">
        <HStack gap="space-8" align="center">
          {icon}
          <Detail textColor="subtle">{title}</Detail>
        </HStack>
        <Heading size="large" level="3">
          {value}
        </Heading>
      </VStack>
    </Box>
  )
}

function DevTeamCard({ stats }: { stats: DevTeamDashboardStats }) {
  const fourEyesPct = Math.round(stats.four_eyes_coverage * 100)
  const goalPct = Math.round(stats.goal_coverage * 100)

  return (
    <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <HStack justify="space-between" align="start" wrap>
        <VStack gap="space-8">
          <Heading level="3" size="medium">
            <Link to={`/boards/${stats.dev_team_slug}`}>{stats.dev_team_name}</Link>
          </Heading>
          <HStack gap="space-8" wrap>
            {stats.nais_team_slugs.map((slug) => (
              <Tag key={slug} variant="neutral" size="xsmall">
                {slug}
              </Tag>
            ))}
          </HStack>
        </VStack>

        <HStack gap="space-24" wrap>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">Deployments</Detail>
            <BodyShort weight="semibold">{stats.total_deployments}</BodyShort>
          </VStack>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">4-øyne</Detail>
            <Tag variant={getHealthVariant(stats.four_eyes_coverage)} size="small">
              {fourEyesPct}%
            </Tag>
          </VStack>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">Endringsopphav</Detail>
            <Tag variant={getHealthVariant(stats.goal_coverage)} size="small">
              {goalPct}%
            </Tag>
          </VStack>
          {stats.without_four_eyes > 0 && (
            <VStack gap="space-4" align="center">
              <Detail textColor="subtle">Avvist</Detail>
              <Tag variant="warning" size="small">
                {stats.without_four_eyes}
              </Tag>
            </VStack>
          )}
        </HStack>
      </HStack>
    </Box>
  )
}

function getHealthVariant(ratio: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (ratio >= 0.9) return 'success'
  if (ratio >= 0.7) return 'warning'
  if (ratio > 0) return 'error'
  return 'neutral'
}

function getHealthLabel(fourEyes: number, goalCoverage: number): string {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 0.9) return 'God'
  if (min >= 0.7) return 'Akseptabel'
  if (min > 0) return 'Trenger oppfølging'
  return 'Ingen data'
}

function getHealthIcon(fourEyes: number, goalCoverage: number): React.ReactNode {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 0.7) return <CheckmarkCircleIcon aria-hidden />
  return <ExclamationmarkTriangleIcon aria-hidden />
}
