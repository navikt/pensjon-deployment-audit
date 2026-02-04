/**
 * Debug Verification Page
 *
 * This page allows testing the new verification system without
 * modifying existing data. Only available when VERIFICATION_DEBUG=true.
 *
 * Shows:
 * - Existing verification status
 * - Data fetched from GitHub
 * - New calculated verification result
 * - Side-by-side comparison
 */

import { Alert, BodyShort, Box, Button, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getDeploymentById } from '~/db/deployments.server'
import { type DebugVerificationResult, isVerificationDebugMode, runDebugVerification } from '~/lib/verification'
import type { Route } from './+types/deployments.$id.debug-verify'

export async function loader({ params }: Route.LoaderArgs) {
  // Check debug mode
  if (!isVerificationDebugMode) {
    throw new Response('Debug mode not enabled', { status: 403 })
  }

  const deploymentId = parseInt(params.id, 10)
  if (Number.isNaN(deploymentId)) {
    throw new Response('Invalid deployment ID', { status: 400 })
  }

  const deployment = await getDeploymentById(deploymentId)
  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 })
  }

  if (!deployment.commit_sha || !deployment.detected_github_owner || !deployment.detected_github_repo_name) {
    return {
      deployment,
      error: 'Deployment mangler nødvendig data for verifisering',
      debugResult: null,
    }
  }

  if (!deployment.monitored_app_id) {
    return {
      deployment,
      error: 'Deployment er ikke koblet til en overvåket applikasjon',
      debugResult: null,
    }
  }

  try {
    const debugResult = await runDebugVerification(deploymentId, {
      commitSha: deployment.commit_sha,
      repository: `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
      environmentName: deployment.environment_name,
      baseBranch: deployment.default_branch || 'main',
      monitoredAppId: deployment.monitored_app_id,
    })

    return {
      deployment,
      debugResult,
      error: null,
    }
  } catch (error) {
    console.error('Debug verification failed:', error)
    return {
      deployment,
      debugResult: null,
      error: error instanceof Error ? error.message : 'Ukjent feil ved verifisering',
    }
  }
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function DebugVerifyPage({ loaderData }: Route.ComponentProps) {
  const { deployment, debugResult, error } = loaderData

  const handleExport = () => {
    if (debugResult) {
      const filename = `debug-verify-${deployment.id}-${new Date().toISOString().slice(0, 10)}.json`
      downloadJson(debugResult, filename)
    }
  }

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <HStack justify="space-between" align="center">
          <VStack gap="space-2">
            <Heading size="large">🔬 Debug Verifisering</Heading>
            <BodyShort>
              Deployment #{deployment.id} - {deployment.commit_sha?.substring(0, 7)}
            </BodyShort>
          </VStack>
          <HStack gap="space-2">
            {debugResult && (
              <Button variant="secondary" size="small" onClick={handleExport}>
                📥 Eksporter JSON
              </Button>
            )}
            <Link to={`/deployments/${deployment.id}`}>
              <Button variant="secondary" size="small">
                ← Tilbake
              </Button>
            </Link>
          </HStack>
        </HStack>

        <Alert variant="warning">
          Debug-modus: Resultat lagres IKKE til databasen. Data fra GitHub lagres som snapshots.
        </Alert>

        {error && (
          <Alert variant="error">
            <Heading size="small" spacing>
              Feil ved verifisering
            </Heading>
            <BodyShort>{error}</BodyShort>
          </Alert>
        )}

        {debugResult && <DebugResultView result={debugResult} />}
      </VStack>
    </Box>
  )
}

function DebugResultView({ result }: { result: DebugVerificationResult }) {
  const { existingStatus, fetchedData, newResult, comparison } = result

  return (
    <VStack gap="space-6">
      {/* Comparison Summary */}
      <Box
        background={comparison.statusChanged || comparison.hasFourEyesChanged ? 'warning-soft' : 'success-soft'}
        padding="space-4"
        borderRadius="8"
      >
        <HStack gap="space-4" align="center">
          {comparison.statusChanged || comparison.hasFourEyesChanged ? (
            <>
              <Tag variant="warning">Endring oppdaget</Tag>
              <BodyShort>
                Status: {comparison.oldStatus || 'null'} → {comparison.newStatus} | Four eyes:{' '}
                {String(comparison.oldHasFourEyes)} → {String(comparison.newHasFourEyes)}
              </BodyShort>
            </>
          ) : (
            <>
              <Tag variant="success">Ingen endring</Tag>
              <BodyShort>Gammelt og nytt resultat er identisk</BodyShort>
            </>
          )}
        </HStack>
      </Box>

      {/* Side-by-side comparison */}
      <HStack gap="space-4" wrap>
        {/* Existing Status */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8" style={{ flex: '1 1 300px' }}>
          <VStack gap="space-4">
            <Heading size="small">Eksisterende status</Heading>
            <DataRow label="Status" value={existingStatus.status || 'null'} />
            <DataRow label="Four eyes" value={String(existingStatus.hasFourEyes)} />
            <DataRow label="PR nummer" value={existingStatus.prNumber?.toString() || 'null'} />
            <DataRow label="Uverifiserte commits" value={existingStatus.unverifiedCommits?.length?.toString() || '0'} />
          </VStack>
        </Box>

        {/* New Result */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8" style={{ flex: '1 1 300px' }}>
          <VStack gap="space-4">
            <Heading size="small">Nytt resultat (V2)</Heading>
            <DataRow label="Status" value={newResult.status} highlight={comparison.statusChanged} />
            <DataRow
              label="Four eyes"
              value={String(newResult.hasFourEyes)}
              highlight={comparison.hasFourEyesChanged}
            />
            <DataRow label="PR nummer" value={newResult.deployedPr?.number?.toString() || 'null'} />
            <DataRow label="Uverifiserte commits" value={newResult.unverifiedCommits.length.toString()} />
            <DataRow label="Approval method" value={newResult.approvalDetails.method || 'null'} />
            <DataRow label="Approval reason" value={newResult.approvalDetails.reason} />
          </VStack>
        </Box>
      </HStack>

      {/* Fetched Data Details */}
      <Box background="neutral-soft" padding="space-4" borderRadius="8">
        <VStack gap="space-4">
          <Heading size="small">Hentet data fra GitHub</Heading>

          <VStack gap="space-2">
            <Heading size="xsmall">Deployment info</Heading>
            <DataRow label="Commit SHA" value={fetchedData.commitSha} />
            <DataRow label="Repository" value={fetchedData.repository} />
            <DataRow label="Environment" value={fetchedData.environmentName} />
            <DataRow label="Base branch" value={fetchedData.baseBranch} />
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall">Deployed PR</Heading>
            {fetchedData.deployedPr ? (
              <>
                <DataRow label="PR nummer" value={`#${fetchedData.deployedPr.number}`} />
                <DataRow label="Tittel" value={fetchedData.deployedPr.metadata.title} />
                <DataRow label="Forfatter" value={fetchedData.deployedPr.metadata.author.username} />
                <DataRow label="Merged by" value={fetchedData.deployedPr.metadata.mergedBy?.username || 'null'} />
                <DataRow label="Reviews" value={fetchedData.deployedPr.reviews.length.toString()} />
                <DataRow label="Commits" value={fetchedData.deployedPr.commits.length.toString()} />
              </>
            ) : (
              <BodyShort>Ingen PR funnet for denne commit</BodyShort>
            )}
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall">Commits mellom deployments</Heading>
            <DataRow label="Antall commits" value={fetchedData.commitsBetween.length.toString()} />
            {fetchedData.commitsBetween.slice(0, 5).map((commit) => (
              <Box key={commit.sha} padding="space-2" background="raised" borderRadius="4">
                <BodyShort size="small">
                  {commit.sha.substring(0, 7)} - {commit.message.split('\n')[0].substring(0, 60)}
                  {commit.pr ? ` (PR #${commit.pr.number})` : ' (ingen PR)'}
                </BodyShort>
              </Box>
            ))}
            {fetchedData.commitsBetween.length > 5 && (
              <BodyShort size="small">... og {fetchedData.commitsBetween.length - 5} til</BodyShort>
            )}
          </VStack>

          {fetchedData.deployedPr && fetchedData.deployedPr.reviews.length > 0 && (
            <VStack gap="space-2">
              <Heading size="xsmall">Reviews</Heading>
              {fetchedData.deployedPr.reviews.map((review) => (
                <Box
                  key={`${review.username}-${review.submittedAt}`}
                  padding="space-2"
                  background="raised"
                  borderRadius="4"
                >
                  <HStack gap="space-2">
                    <Tag variant={review.state === 'APPROVED' ? 'success' : 'neutral'} size="small">
                      {review.state}
                    </Tag>
                    <BodyShort size="small">{review.username}</BodyShort>
                  </HStack>
                </Box>
              ))}
            </VStack>
          )}

          {newResult.unverifiedCommits.length > 0 && (
            <VStack gap="space-2">
              <Heading size="xsmall">Uverifiserte commits</Heading>
              {newResult.unverifiedCommits.map((commit) => (
                <Box key={commit.sha} padding="space-2" background="danger-soft" borderRadius="4">
                  <VStack gap="space-1">
                    <BodyShort size="small" weight="semibold">
                      {commit.sha.substring(0, 7)} - {commit.message.substring(0, 50)}
                    </BodyShort>
                    <BodyShort size="small">
                      Grunn: {commit.reason} | PR: {commit.prNumber || 'ingen'}
                    </BodyShort>
                  </VStack>
                </Box>
              ))}
            </VStack>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}

function DataRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <HStack gap="space-2">
      <BodyShort size="small" weight="semibold" style={{ minWidth: '140px' }}>
        {label}:
      </BodyShort>
      <BodyShort size="small" style={{ color: highlight ? 'var(--a-text-danger)' : undefined }}>
        {value}
      </BodyShort>
    </HStack>
  )
}
