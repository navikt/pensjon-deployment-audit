/**
 * Verification Diff Page (App-specific)
 *
 * Shows deployments where old and new verification results differ.
 * Only considers deployments with:
 * - Valid SHA (not refs/*, length >= 7)
 * - Created on or after audit_start_year
 * - Has downloaded GitHub data (compare snapshots exist)
 */

import { Link as AkselLink, BodyShort, Box, Button, Heading, Table, Tag, VStack } from '@navikt/ds-react'
import { Form, Link, useLoaderData, useNavigation } from 'react-router'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import {
  getCompareSnapshotForCommit,
  getDeploymentsWithCompareData,
  getPreviousDeploymentForDiff,
  getPrSnapshotsForDiff,
} from '~/db/verification-diff.server'
import { requireAdmin } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import { reverifyDeployment } from '~/lib/verification'
import { buildCommitsBetweenFromCache } from '~/lib/verification/fetch-data.server'
import type { CompareData, PrCommit, PrMetadata, PrReview, VerificationInput } from '~/lib/verification/types'
import { verifyDeployment } from '~/lib/verification/verify'
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

  // Get the monitored app
  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, app)
  if (!monitoredApp) {
    return { diffs: [], appContext: null }
  }

  const appContext = {
    teamSlug: monitoredApp.team_slug,
    environmentName: monitoredApp.environment_name,
    appName: monitoredApp.app_name,
  }

  // Find deployments for this app that have compare snapshots
  const deployments = await getDeploymentsWithCompareData(monitoredApp.id)

  const diffs: DeploymentDiff[] = []

  for (const row of deployments) {
    const prevRow = await getPreviousDeploymentForDiff(row.id, row.environment_name)

    const previousDeployment = prevRow
      ? {
          id: prevRow.id,
          commitSha: prevRow.commit_sha,
          createdAt: prevRow.created_at.toISOString(),
        }
      : null

    const compareSnapshot = await getCompareSnapshotForCommit(row.commit_sha)
    if (!compareSnapshot) continue

    const compareData = compareSnapshot.data as CompareData
    const owner = row.detected_github_owner as string
    const repo = row.detected_github_repo_name as string
    const baseBranch = row.default_branch || 'main'

    // Build commits with PR data from cache only (no GitHub calls)
    const commitsBetween = await buildCommitsBetweenFromCache(owner, repo, baseBranch, compareData, { cacheOnly: true })

    // Get PR snapshots if available
    let deployedPr: VerificationInput['deployedPr'] = null
    if (row.github_pr_number) {
      const snapshotMap = await getPrSnapshotsForDiff(row.github_pr_number)

      if (snapshotMap.has('metadata') && snapshotMap.has('reviews') && snapshotMap.has('commits')) {
        const metadata = snapshotMap.get('metadata') as PrMetadata
        deployedPr = {
          number: row.github_pr_number,
          url: `https://github.com/${owner}/${repo}/pull/${row.github_pr_number}`,
          metadata,
          reviews: snapshotMap.get('reviews') as PrReview[],
          commits: snapshotMap.get('commits') as PrCommit[],
        }
      }
    }

    // Build verification input
    const input: VerificationInput = {
      deploymentId: row.id,
      commitSha: row.commit_sha,
      repository: `${owner}/${repo}`,
      environmentName: row.environment_name,
      baseBranch,
      auditStartYear: row.audit_start_year,
      implicitApprovalSettings: { mode: 'off' },
      previousDeployment,
      deployedPr,
      commitsBetween,
      dataFreshness: {
        deployedPrFetchedAt: null,
        commitsFetchedAt: null,
        schemaVersion: 1,
      },
    }

    // Run verification
    const newResult = verifyDeployment(input)

    // Normalize statuses for comparison
    const normalizeStatus = (status: string | null): string | null => {
      if (!status) return status
      const equivalentStatuses: Record<string, string> = {
        approved_pr: 'approved',
        pending_approval: 'pending',
      }
      return equivalentStatuses[status] || status
    }

    const normalizedOldStatus = normalizeStatus(row.four_eyes_status)
    const normalizedNewStatus = normalizeStatus(newResult.status)

    // Skip manually approved deployments — they were approved by a human
    // precisely because automated verification found unverified commits
    if (normalizedOldStatus === 'manually_approved') continue

    // Check for real differences
    const statusDifferent = normalizedOldStatus !== normalizedNewStatus
    const fourEyesDifferent = row.has_four_eyes !== newResult.hasFourEyes

    if (statusDifferent || fourEyesDifferent) {
      diffs.push({
        id: row.id,
        commitSha: row.commit_sha,
        environmentName: row.environment_name,
        createdAt: row.created_at.toISOString(),
        oldStatus: row.four_eyes_status,
        newStatus: newResult.status,
        oldHasFourEyes: row.has_four_eyes,
        newHasFourEyes: newResult.hasFourEyes,
      })
    }
  }

  return { diffs, appContext }
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

  return null
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiseringsavvik' }]
}

export default function VerificationDiffPage() {
  const { diffs, appContext } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const submittingId = navigation.state === 'submitting' ? navigation.formData?.get('deployment_id')?.toString() : null
  const isApplyingAll = navigation.state === 'submitting' && navigation.formData?.get('action') === 'apply_all'

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <VStack gap="space-2">
          <Heading level="1" size="large">
            Verifiseringsavvik
          </Heading>
          <BodyShort textColor="subtle">
            Deployments hvor gammel og ny verifisering gir forskjellig resultat. Klikk på en deployment for detaljer.
          </BodyShort>
        </VStack>

        {diffs.length === 0 ? (
          <Box background="success-soft" padding="space-4" borderRadius="8">
            <BodyShort>✅ Ingen avvik funnet blant deployments med nedlastet GitHub-data.</BodyShort>
          </Box>
        ) : (
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
