/**
 * Verification System
 *
 * This is the main entry point for the new verification system.
 * It orchestrates: Fetch → Store → Verify → Save Result
 *
 * Usage:
 * ```typescript
 * import { runVerification } from '~/lib/verification'
 *
 * const result = await runVerification(deploymentId, {
 *   commitSha: 'abc123',
 *   repository: 'owner/repo',
 *   environmentName: 'prod',
 *   baseBranch: 'main',
 *   monitoredAppId: 42,
 * })
 * ```
 */

import { fetchVerificationData } from './fetch-data.server'
import { storeVerificationResult } from './store-data.server'
import type { VerificationResult } from './types'
import { verifyDeployment } from './verify'

// Re-export individual modules
export { fetchVerificationData } from './fetch-data.server'
export { storeVerificationResult } from './store-data.server'
// Re-export types for convenience
export type { VerificationInput, VerificationResult, VerificationStatus } from './types'
export { verifyDeployment } from './verify'

// =============================================================================
// Main Verification Function
// =============================================================================

export interface RunVerificationOptions {
  commitSha: string
  repository: string
  environmentName: string
  baseBranch: string
  monitoredAppId: number
  forceRefresh?: boolean
}

/**
 * Run the complete verification flow for a deployment.
 *
 * Flow:
 * 1. Fetch all data needed (from cache or GitHub)
 * 2. Store fetched data to database
 * 3. Run stateless verification
 * 4. Store verification result
 *
 * @param deploymentId - The deployment ID to verify
 * @param options - Verification options
 * @returns The verification result
 */
export async function runVerification(
  deploymentId: number,
  options: RunVerificationOptions,
): Promise<VerificationResult> {
  console.log(`🔍 Starting verification for deployment ${deploymentId}`)

  // Step 1: Fetch all data needed for verification
  console.log(`   📥 Fetching data from GitHub/cache...`)
  const input = await fetchVerificationData(
    deploymentId,
    options.commitSha,
    options.repository,
    options.environmentName,
    options.baseBranch,
    options.monitoredAppId,
    { forceRefresh: options.forceRefresh },
  )

  console.log(`   ✅ Data fetched:`)
  console.log(`      - Deployed PR: ${input.deployedPr?.number || 'none'}`)
  console.log(`      - Commits between: ${input.commitsBetween.length}`)
  console.log(`      - Previous deployment: ${input.previousDeployment?.id || 'none'}`)

  // Step 2: Run stateless verification
  console.log(`   🧪 Running verification logic...`)
  const result = verifyDeployment(input)

  console.log(`   ✅ Verification complete:`)
  console.log(`      - Status: ${result.status}`)
  console.log(`      - Four eyes: ${result.hasFourEyes}`)
  console.log(`      - Unverified commits: ${result.unverifiedCommits.length}`)

  // Step 3: Store the result
  console.log(`   💾 Storing verification result...`)

  // Collect snapshot IDs from the fetched data
  // In a full implementation, fetchVerificationData would return these
  const snapshotIds = {
    prSnapshotIds: [], // Would be populated by fetch-data
    commitSnapshotIds: [], // Would be populated by fetch-data
  }

  const { verificationRunId } = await storeVerificationResult(deploymentId, result, snapshotIds)

  console.log(`   ✅ Stored as verification run #${verificationRunId}`)
  console.log(`🎉 Verification complete for deployment ${deploymentId}`)

  return result
}
