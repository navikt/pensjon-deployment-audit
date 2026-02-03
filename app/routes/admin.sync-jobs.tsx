import { ArrowsCirclepathIcon, CheckmarkCircleIcon, ClockIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  Hide,
  HStack,
  Select,
  Show,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Form } from 'react-router'
import {
  cleanupOldSyncJobs,
  getAllSyncJobs,
  getSyncJobStats,
  releaseExpiredLocks,
  type SyncJobStatus,
  type SyncJobType,
} from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/admin.sync-jobs'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Sync Jobs - Admin - Pensjon Deployment Audit' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)

  const url = new URL(request.url)
  const status = url.searchParams.get('status') as SyncJobStatus | null
  const jobType = url.searchParams.get('type') as SyncJobType | null

  const [jobs, stats] = await Promise.all([
    getAllSyncJobs({
      status: status || undefined,
      jobType: jobType || undefined,
      limit: 100,
    }),
    getSyncJobStats(),
  ])

  return { jobs, stats, filters: { status, jobType } }
}

export async function action({ request }: Route.ActionArgs) {
  requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'release-expired') {
    const released = await releaseExpiredLocks()
    return { success: `Frigjorde ${released} utløpte låser`, error: null }
  }

  if (intent === 'cleanup') {
    const cleaned = await cleanupOldSyncJobs(50)
    return { success: `Slettet ${cleaned} gamle jobber`, error: null }
  }

  return { success: null, error: 'Ukjent handling' }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr) return '-'
  const start = new Date(startStr)
  const end = endStr ? new Date(endStr) : new Date()
  const durationMs = end.getTime() - start.getTime()
  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function StatusTag({ status }: { status: SyncJobStatus }) {
  switch (status) {
    case 'running':
      return (
        <Tag data-color="info" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <ArrowsCirclepathIcon aria-hidden />
            Kjører
          </HStack>
        </Tag>
      )
    case 'completed':
      return (
        <Tag data-color="success" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <CheckmarkCircleIcon aria-hidden />
            Fullført
          </HStack>
        </Tag>
      )
    case 'failed':
      return (
        <Tag data-color="danger" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <XMarkOctagonIcon aria-hidden />
            Feilet
          </HStack>
        </Tag>
      )
    case 'pending':
      return (
        <Tag data-color="neutral" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <ClockIcon aria-hidden />
            Venter
          </HStack>
        </Tag>
      )
  }
}

function JobTypeTag({ type }: { type: SyncJobType }) {
  switch (type) {
    case 'nais_sync':
      return (
        <Tag data-color="accent" variant="outline" size="small">
          Nais Sync
        </Tag>
      )
    case 'github_verify':
      return (
        <Tag data-color="info" variant="outline" size="small">
          GitHub Verify
        </Tag>
      )
  }
}

export default function AdminSyncJobs({ loaderData, actionData }: Route.ComponentProps) {
  const { jobs, stats, filters } = loaderData

  return (
    <VStack gap="space-24">
      <div>
        <Heading size="large" spacing>
          Sync Jobs
        </Heading>
        <BodyShort textColor="subtle">Oversikt over synkroniseringsjobber og låser mellom podder.</BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && (
        <Alert variant="error" closeButton>
          {actionData.error}
        </Alert>
      )}

      <HGrid gap="space-16" columns={{ xs: 2, md: 5 }}>
        <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <BodyShort size="small" textColor="subtle">
            Totalt
          </BodyShort>
          <Heading size="large">{stats.total}</Heading>
        </Box>
        <Box
          padding="space-16"
          borderRadius="8"
          background="raised"
          borderColor="info-subtle"
          borderWidth="1"
          data-color="info"
        >
          <BodyShort size="small" textColor="subtle">
            Kjører nå
          </BodyShort>
          <Heading size="large">{stats.running}</Heading>
        </Box>
        <Box
          padding="space-16"
          borderRadius="8"
          background="raised"
          borderColor="success-subtle"
          borderWidth="1"
          data-color="success"
        >
          <BodyShort size="small" textColor="subtle">
            Fullført
          </BodyShort>
          <Heading size="large">{stats.completed}</Heading>
        </Box>
        <Box
          padding="space-16"
          borderRadius="8"
          background="raised"
          borderColor="danger-subtle"
          borderWidth="1"
          data-color="danger"
        >
          <BodyShort size="small" textColor="subtle">
            Feilet
          </BodyShort>
          <Heading size="large">{stats.failed}</Heading>
        </Box>
        <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <BodyShort size="small" textColor="subtle">
            Siste time
          </BodyShort>
          <Heading size="large">{stats.lastHour}</Heading>
        </Box>
      </HGrid>

      <HStack gap="space-16" justify="space-between" wrap>
        <Form method="get">
          <HStack gap="space-12">
            <Select label="Status" name="status" defaultValue={filters.status || ''} size="small">
              <option value="">Alle</option>
              <option value="running">Kjører</option>
              <option value="completed">Fullført</option>
              <option value="failed">Feilet</option>
              <option value="pending">Venter</option>
            </Select>
            <Select label="Type" name="type" defaultValue={filters.jobType || ''} size="small">
              <option value="">Alle</option>
              <option value="nais_sync">Nais Sync</option>
              <option value="github_verify">GitHub Verify</option>
            </Select>
            <Button type="submit" size="small" variant="secondary" style={{ alignSelf: 'flex-end' }}>
              Filtrer
            </Button>
          </HStack>
        </Form>

        <HStack gap="space-8">
          <Form method="post">
            <input type="hidden" name="intent" value="release-expired" />
            <Button type="submit" size="small" variant="tertiary">
              Frigjør utløpte låser
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="cleanup" />
            <Button type="submit" size="small" variant="tertiary">
              Rydd opp gamle jobber
            </Button>
          </Form>
        </HStack>
      </HStack>

      {jobs.length === 0 ? (
        <Alert variant="info">Ingen sync-jobber funnet med de valgte filtrene.</Alert>
      ) : (
        <div>
          {jobs.map((job) => (
            <Box key={job.id} padding="space-16" background="raised" className={styles.stackedListItem}>
              <VStack gap="space-12">
                {/* First row: ID, App name, Status/Type tags */}
                <HStack gap="space-8" align="center" justify="space-between" wrap>
                  <HStack gap="space-12" align="center" style={{ flex: 1 }}>
                    <Detail textColor="subtle">#{job.id}</Detail>
                    <BodyShort weight="semibold">{job.app_name}</BodyShort>
                    <Show above="md">
                      <Detail textColor="subtle">
                        {job.team_slug} / {job.environment_name}
                      </Detail>
                    </Show>
                  </HStack>
                  <HStack gap="space-8">
                    <JobTypeTag type={job.job_type} />
                    <StatusTag status={job.status} />
                  </HStack>
                </HStack>

                {/* Team/env on mobile */}
                <Hide above="md">
                  <Detail textColor="subtle">
                    {job.team_slug} / {job.environment_name}
                  </Detail>
                </Hide>

                {/* Second row: Details */}
                <HStack gap="space-16" wrap>
                  <Detail textColor="subtle">Startet: {formatDate(job.started_at)}</Detail>
                  <Detail textColor="subtle">Varighet: {formatDuration(job.started_at, job.completed_at)}</Detail>
                  {job.locked_by && <Detail textColor="subtle">Pod: {job.locked_by}</Detail>}
                </HStack>

                {/* Error/Result row */}
                {(job.error || job.result) && (
                  <BodyShort size="small" textColor="subtle" style={{ wordBreak: 'break-word' }}>
                    {job.error ? `❌ ${job.error}` : JSON.stringify(job.result)}
                  </BodyShort>
                )}
              </VStack>
            </Box>
          ))}
        </div>
      )}
    </VStack>
  )
}
