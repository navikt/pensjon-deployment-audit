/**
 * Verification Diff Page (App-specific)
 *
 * Shows deployments where old and new verification results differ.
 * Only considers deployments with:
 * - Valid SHA (not refs/*, length >= 7)
 * - Created on or after audit_start_year
 * - Has downloaded GitHub data (compare snapshots exist)
 */

import { Link as AkselLink, BodyShort, Box, Heading, Table, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { requireAdmin } from '~/lib/auth.server'
import { isVerificationDebugMode } from '~/lib/verification'
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
  requireAdmin(request)

  const { team, env, app } = params

  if (!isVerificationDebugMode) {
    return { diffs: [], debugModeEnabled: false }
  }

  // Get the monitored app
  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, app)
  if (!monitoredApp) {
    return { diffs: [], debugModeEnabled: true, appContext: null }
  }

  const appContext = {
    teamSlug: monitoredApp.team_slug,
    environmentName: monitoredApp.environment_name,
    appName: monitoredApp.app_name,
  }

  // Find deployments for this app that have compare snapshots
  const result = await pool.query(
    `WITH valid_deployments AS (
      SELECT 
        d.id,
        d.commit_sha,
        d.four_eyes_status,
        d.has_four_eyes,
        d.github_pr_number,
        d.environment_name,
        d.created_at,
        d.detected_github_owner,
        d.detected_github_repo_name,
        ma.default_branch,
        ma.audit_start_year
      FROM deployments d
      JOIN monitored_applications ma ON d.monitored_app_id = ma.id
      WHERE d.monitored_app_id = $1
        AND d.commit_sha IS NOT NULL
        AND d.detected_github_owner IS NOT NULL
        AND d.detected_github_repo_name IS NOT NULL
        AND d.commit_sha !~ '^refs/'
        AND LENGTH(d.commit_sha) >= 7
        AND (ma.audit_start_year IS NULL OR d.created_at >= (ma.audit_start_year || '-01-01')::date)
    ),
    deployments_with_data AS (
      SELECT DISTINCT vd.*
      FROM valid_deployments vd
      WHERE EXISTS (
        SELECT 1 FROM github_compare_snapshots gcs
        WHERE gcs.head_sha = vd.commit_sha
      )
    )
    SELECT * FROM deployments_with_data
    ORDER BY created_at DESC
    LIMIT 500`,
    [monitoredApp.id],
  )

  const diffs: DeploymentDiff[] = []

  for (const row of result.rows) {
    // Get previous deployment for this app/env
    const prevResult = await pool.query(
      `SELECT id, commit_sha, created_at
       FROM deployments 
       WHERE monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
         AND environment_name = $2
         AND created_at < (SELECT created_at FROM deployments WHERE id = $1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.id, row.environment_name],
    )

    const previousDeployment = prevResult.rows[0]
      ? {
          id: prevResult.rows[0].id as number,
          commitSha: prevResult.rows[0].commit_sha as string,
          createdAt: prevResult.rows[0].created_at.toISOString() as string,
        }
      : null

    // Get the stored compare data
    const compareResult = await pool.query(
      `SELECT data, base_sha FROM github_compare_snapshots 
       WHERE head_sha = $1 
       ORDER BY fetched_at DESC LIMIT 1`,
      [row.commit_sha],
    )

    if (compareResult.rows.length === 0) continue

    const compareData = compareResult.rows[0].data as CompareData
    const owner = row.detected_github_owner as string
    const repo = row.detected_github_repo_name as string
    const baseBranch = row.default_branch || 'main'

    // Build commits with PR data from cache only (no GitHub calls)
    const commitsBetween = await buildCommitsBetweenFromCache(owner, repo, baseBranch, compareData, { cacheOnly: true })

    // Get PR snapshots if available
    let deployedPr: VerificationInput['deployedPr'] = null
    if (row.github_pr_number) {
      const prSnapshots = await pool.query(
        `SELECT data_type, data FROM github_pr_snapshots 
         WHERE pr_number = $1 
         ORDER BY fetched_at DESC`,
        [row.github_pr_number],
      )

      const snapshotMap = new Map<string, unknown>()
      for (const snap of prSnapshots.rows) {
        if (!snapshotMap.has(snap.data_type)) {
          snapshotMap.set(snap.data_type, snap.data)
        }
      }

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

    // Check for real differences
    const statusDifferent = normalizedOldStatus !== normalizedNewStatus
    const fourEyesDifferent = row.has_four_eyes !== newResult.hasFourEyes

    if (statusDifferent || fourEyesDifferent) {
      diffs.push({
        id: row.id,
        commitSha: row.commit_sha,
        environmentName: row.environment_name,
        createdAt: row.created_at,
        oldStatus: row.four_eyes_status,
        newStatus: newResult.status,
        oldHasFourEyes: row.has_four_eyes,
        newHasFourEyes: newResult.hasFourEyes,
      })
    }
  }

  return { diffs, debugModeEnabled: true, appContext }
}

export default function VerificationDiffPage() {
  const { diffs, debugModeEnabled, appContext } = useLoaderData<typeof loader>()

  if (!debugModeEnabled) {
    return (
      <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
        <VStack gap="space-4">
          <Heading size="large">Verifiseringsavvik</Heading>
          <BodyShort>Debug-modus er ikke aktivert. Sett VERIFICATION_DEBUG=true for å bruke denne siden.</BodyShort>
        </VStack>
      </Box>
    )
  }

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <VStack gap="space-2">
          <Heading size="large">Verifiseringsavvik</Heading>
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
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Deployment</Table.HeaderCell>
                <Table.HeaderCell>Miljø</Table.HeaderCell>
                <Table.HeaderCell>Dato</Table.HeaderCell>
                <Table.HeaderCell>Gammel status</Table.HeaderCell>
                <Table.HeaderCell>Ny status</Table.HeaderCell>
                <Table.HeaderCell>Four eyes</Table.HeaderCell>
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
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </VStack>
    </Box>
  )
}
