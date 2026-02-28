/**
 * Verification Diff Page (App-specific)
 *
 * Shows pre-computed differences between stored verification status and
 * what V2 verification would produce. Diffs are computed by the
 * reverify_app sync job and stored in the verification_diffs table.
 */

import {
  Link as AkselLink,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Loader,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { pool } from '~/db/connection.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getLatestSyncJob, getSyncJobById } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import { reverifyDeployment } from '~/lib/verification'
import type { Route } from './+types/team.$team.env.$env.app.$app.admin.verification-diff'

interface DeploymentDiff {
  id: number
  commitSha: string
  environmentName: string
  createdAt: string
  oldStatus: string | null
  newStatus: string
  oldHasFourEyes: boolean | null
  newHasFourEyes: boolean
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { team, env, app } = params

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, app)
  if (!monitoredApp) {
    return { diffs: [], appContext: null, lastComputed: null, latestJob: null }
  }

  const appContext = {
    teamSlug: monitoredApp.team_slug,
    environmentName: monitoredApp.environment_name,
    appName: monitoredApp.app_name,
    monitoredAppId: monitoredApp.id,
  }

  // Read pre-computed diffs from database
  const result = await pool.query(
    `SELECT vd.deployment_id, vd.old_status, vd.new_status,
            vd.old_has_four_eyes, vd.new_has_four_eyes, vd.computed_at,
            d.commit_sha, d.environment_name, d.created_at
     FROM verification_diffs vd
     JOIN deployments d ON vd.deployment_id = d.id
     WHERE vd.monitored_app_id = $1
     ORDER BY d.created_at DESC`,
    [monitoredApp.id],
  )

  const diffs: DeploymentDiff[] = result.rows.map((row) => ({
    id: row.deployment_id,
    commitSha: row.commit_sha,
    environmentName: row.environment_name,
    createdAt: row.created_at.toISOString(),
    oldStatus: row.old_status,
    newStatus: row.new_status,
    oldHasFourEyes: row.old_has_four_eyes,
    newHasFourEyes: row.new_has_four_eyes,
  }))

  const lastComputed = result.rows.length > 0 ? result.rows[0].computed_at?.toISOString() : null

  // Get latest reverify_app job for this app
  const latestJob = await getLatestSyncJob(monitoredApp.id, 'reverify_app')

  return { diffs, appContext, lastComputed, latestJob }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const actionType = formData.get('action') as string
  const deploymentId = parseInt(formData.get('deployment_id') as string, 10)

  if (actionType === 'apply_reverification' && deploymentId) {
    try {
      const result = await reverifyDeployment(deploymentId)
      if (!result) {
        return { error: `Deployment ${deploymentId} ble hoppet over (manuelt godkjent, legacy, eller mangler data)` }
      }
      if (result.changed) {
        // Remove the diff row since we've applied the change
        await pool.query('DELETE FROM verification_diffs WHERE deployment_id = $1', [deploymentId])
        return {
          applied: deploymentId,
          message: `Oppdatert: ${result.oldStatus} → ${result.newStatus}`,
        }
      }
      return { applied: deploymentId, message: 'Ingen endring nødvendig' }
    } catch (err) {
      logger.error(
        `Reverification failed for deployment ${deploymentId}`,
        err instanceof Error ? err : new Error(String(err)),
      )
      return {
        error: `Feil ved re-verifisering av deployment ${deploymentId}: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  if (actionType === 'apply_all') {
    const ids = formData.getAll('deployment_ids').map((id) => parseInt(id as string, 10))
    let applied = 0
    let skipped = 0
    let errors = 0

    for (const id of ids) {
      try {
        const result = await reverifyDeployment(id)
        if (result?.changed) {
          await pool.query('DELETE FROM verification_diffs WHERE deployment_id = $1', [id])
          applied++
        } else {
          skipped++
        }
      } catch (err) {
        logger.error(`Reverification failed for deployment ${id}`, err instanceof Error ? err : new Error(String(err)))
        errors++
      }
    }

    return { appliedAll: true, applied, skipped, errors }
  }

  if (actionType === 'check_compute_status') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) return { error: 'Mangler job_id' }
    const job = await getSyncJobById(jobId)
    return { computeJobStatus: job }
  }

  return null
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiseringsavvik' }]
}

export default function VerificationDiffPage() {
  const { diffs, appContext, lastComputed, latestJob } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const submittingId = navigation.state === 'submitting' ? navigation.formData?.get('deployment_id')?.toString() : null
  const isApplyingAll = navigation.state === 'submitting' && navigation.formData?.get('action') === 'apply_all'

  // Job polling state
  const computeFetcher = useFetcher()
  const [activeJobId, setActiveJobId] = useState<number | null>(latestJob?.status === 'running' ? latestJob.id : null)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const computeFetcherRef = useRef(computeFetcher)
  computeFetcherRef.current = computeFetcher
  const revalidatorRef = useRef(revalidator)
  revalidatorRef.current = revalidator

  // Start polling when job becomes active
  useEffect(() => {
    if (activeJobId) {
      pollInterval.current = setInterval(() => {
        computeFetcherRef.current.submit(
          { action: 'check_compute_status', job_id: String(activeJobId) },
          { method: 'post' },
        )
      }, 2000)
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId])

  // Handle poll responses
  useEffect(() => {
    const data = computeFetcher.data as { computeJobStatus?: { status: string } } | undefined
    if (data?.computeJobStatus) {
      const status = data.computeJobStatus.status
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      }
    }
  }, [computeFetcher.data])

  // Handle compute_diffs trigger response from admin page
  const triggerFetcher = useFetcher()
  useEffect(() => {
    const data = triggerFetcher.data as { computeDiffsJobStarted?: number; error?: string } | undefined
    if (data?.computeDiffsJobStarted) {
      setActiveJobId(data.computeDiffsJobStarted)
    }
  }, [triggerFetcher.data])

  const isComputing = !!activeJobId

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <VStack gap="space-2">
          <Heading level="1" size="large">
            Verifiseringsavvik
          </Heading>
          <BodyShort textColor="subtle">
            Deployments hvor lagret og ny verifisering gir forskjellig resultat. Klikk på en deployment for detaljer.
          </BodyShort>
        </VStack>

        {/* Compute trigger and status */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <HStack gap="space-4" align="center" justify="space-between">
            <VStack gap="space-1">
              {lastComputed ? (
                <Detail>Sist beregnet: {new Date(lastComputed).toLocaleString('no-NO')}</Detail>
              ) : (
                <Detail>Avvik er ikke beregnet ennå. Klikk «Beregn avvik» for å starte.</Detail>
              )}
            </VStack>
            {appContext && (
              <triggerFetcher.Form
                method="post"
                action={`/team/${appContext.teamSlug}/env/${appContext.environmentName}/app/${appContext.appName}/admin`}
              >
                <input type="hidden" name="action" value="compute_diffs" />
                <input type="hidden" name="app_id" value={appContext.monitoredAppId} />
                <Button type="submit" size="small" variant="secondary" loading={isComputing}>
                  {isComputing ? 'Beregner…' : 'Beregn avvik'}
                </Button>
              </triggerFetcher.Form>
            )}
          </HStack>
          {isComputing && (
            <HStack gap="space-2" align="center">
              <Loader size="xsmall" />
              <Detail>Beregner avvik i bakgrunnen…</Detail>
            </HStack>
          )}
        </Box>

        {diffs.length === 0 && lastComputed ? (
          <Box background="success-soft" padding="space-4" borderRadius="8">
            <BodyShort>✅ Ingen avvik funnet blant deployments med nedlastet GitHub-data.</BodyShort>
          </Box>
        ) : diffs.length === 0 && !lastComputed ? null : (
          <Box background="warning-soft" padding="space-4" borderRadius="8">
            <BodyShort>⚠️ {diffs.length} deployment(s) med avvik mellom gammel og ny verifisering.</BodyShort>
          </Box>
        )}

        {diffs.length > 0 && (
          <VStack gap="space-4">
            <Form method="post">
              <input type="hidden" name="action" value="apply_all" />
              {diffs.map((diff) => (
                <input key={diff.id} type="hidden" name="deployment_ids" value={diff.id} />
              ))}
              <Button type="submit" size="small" variant="secondary" loading={isApplyingAll}>
                Oppdater alle ({diffs.length})
              </Button>
            </Form>

            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Deployment</Table.HeaderCell>
                  <Table.HeaderCell>Miljø</Table.HeaderCell>
                  <Table.HeaderCell>Dato</Table.HeaderCell>
                  <Table.HeaderCell>Gammel status</Table.HeaderCell>
                  <Table.HeaderCell>Ny status</Table.HeaderCell>
                  <Table.HeaderCell>Four eyes</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {diffs.map((diff) => (
                  <Table.Row key={diff.id}>
                    <Table.DataCell>
                      <AkselLink
                        as={Link}
                        to={
                          appContext
                            ? `/team/${appContext.teamSlug}/env/${appContext.environmentName}/app/${appContext.appName}/admin/verification-diff/${diff.id}`
                            : `/deployments/${diff.id}`
                        }
                      >
                        {diff.commitSha.substring(0, 7)}
                      </AkselLink>
                    </Table.DataCell>
                    <Table.DataCell>{diff.environmentName}</Table.DataCell>
                    <Table.DataCell>{new Date(diff.createdAt).toLocaleDateString('no-NO')}</Table.DataCell>
                    <Table.DataCell>
                      <Tag variant="neutral" size="small">
                        {diff.oldStatus || 'null'}
                      </Tag>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Tag variant="info" size="small">
                        {diff.newStatus}
                      </Tag>
                    </Table.DataCell>
                    <Table.DataCell>
                      {diff.oldHasFourEyes !== diff.newHasFourEyes ? (
                        <Tag variant="warning" size="small">
                          {String(diff.oldHasFourEyes)} → {String(diff.newHasFourEyes)}
                        </Tag>
                      ) : (
                        <BodyShort size="small">{String(diff.newHasFourEyes)}</BodyShort>
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      <Form method="post">
                        <input type="hidden" name="action" value="apply_reverification" />
                        <input type="hidden" name="deployment_id" value={diff.id} />
                        <Button
                          type="submit"
                          size="xsmall"
                          variant="tertiary"
                          loading={submittingId === String(diff.id)}
                        >
                          Oppdater
                        </Button>
                      </Form>
                    </Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </VStack>
        )}
      </VStack>
    </Box>
  )
}
