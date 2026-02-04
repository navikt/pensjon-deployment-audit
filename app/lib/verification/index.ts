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

import { pool } from '~/db/connection.server'
import { fetchVerificationData } from './fetch-data.server'
import { storeVerificationResult } from './store-data.server'
import type { VerificationInput, VerificationResult } from './types'
import { verifyDeployment } from './verify'

// Re-export individual modules
export { fetchVerificationData } from './fetch-data.server'
export { storeVerificationResult } from './store-data.server'
// Re-export types for convenience
export type { VerificationInput, VerificationResult, VerificationStatus } from './types'
export { verifyDeployment } from './verify'

// =============================================================================
// Debug Mode
// =============================================================================

/**
 * Check if verification debug mode is enabled.
 * Set VERIFICATION_DEBUG=true to enable.
 */
export const isVerificationDebugMode = process.env.VERIFICATION_DEBUG === 'true'

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

// =============================================================================
// Debug Verification (does NOT store result to deployment)
// =============================================================================

/**
 * Existing verification status from the deployment table
 */
export interface ExistingVerificationStatus {
  hasFourEyes: boolean | null
  status: string | null
  prNumber: number | null
  prUrl: string | null
  prData: unknown
  unverifiedCommits: unknown[]
}

/**
 * Result from debug verification - includes all data for comparison
 */
export interface DebugVerificationResult {
  existingStatus: ExistingVerificationStatus
  fetchedData: VerificationInput
  newResult: VerificationResult
  comparison: {
    statusChanged: boolean
    hasFourEyesChanged: boolean
    oldStatus: string | null
    newStatus: string
    oldHasFourEyes: boolean | null
    newHasFourEyes: boolean
  }
}

/**
 * Run verification in debug mode.
 *
 * This fetches data from GitHub (storing snapshots), runs verification,
 * but does NOT update the deployment record. Used for comparing V1 vs V2.
 */
export async function runDebugVerification(
  deploymentId: number,
  options: RunVerificationOptions,
): Promise<DebugVerificationResult> {
  console.log(`🔬 [DEBUG] Starting debug verification for deployment ${deploymentId}`)

  // Step 1: Get existing status from deployment
  const existingStatus = await getExistingVerificationStatus(deploymentId)
  console.log(`   📋 Existing status: ${existingStatus.status} (four_eyes: ${existingStatus.hasFourEyes})`)

  // Step 2: Fetch data from GitHub (this stores to snapshots table)
  console.log(`   📥 Fetching fresh data from GitHub...`)
  const fetchedData = await fetchVerificationData(
    deploymentId,
    options.commitSha,
    options.repository,
    options.environmentName,
    options.baseBranch,
    options.monitoredAppId,
    { forceRefresh: true }, // Always force refresh in debug mode
  )

  console.log(`   ✅ Data fetched:`)
  console.log(`      - Deployed PR: ${fetchedData.deployedPr?.number || 'none'}`)
  console.log(`      - Commits between: ${fetchedData.commitsBetween.length}`)

  // Step 3: Run verification (but don't store result)
  console.log(`   🧪 Running verification logic...`)
  const newResult = verifyDeployment(fetchedData)

  console.log(`   ✅ New verification result:`)
  console.log(`      - Status: ${newResult.status}`)
  console.log(`      - Four eyes: ${newResult.hasFourEyes}`)

  // Step 4: Build comparison
  const comparison = {
    statusChanged: existingStatus.status !== newResult.status,
    hasFourEyesChanged: existingStatus.hasFourEyes !== newResult.hasFourEyes,
    oldStatus: existingStatus.status,
    newStatus: newResult.status,
    oldHasFourEyes: existingStatus.hasFourEyes,
    newHasFourEyes: newResult.hasFourEyes,
  }

  if (comparison.statusChanged || comparison.hasFourEyesChanged) {
    console.log(`   ⚠️  DIFFERENCE DETECTED:`)
    if (comparison.statusChanged) {
      console.log(`      Status: ${comparison.oldStatus} → ${comparison.newStatus}`)
    }
    if (comparison.hasFourEyesChanged) {
      console.log(`      Four eyes: ${comparison.oldHasFourEyes} → ${comparison.newHasFourEyes}`)
    }
  } else {
    console.log(`   ✅ No difference - results match`)
  }

  console.log(`🔬 [DEBUG] Debug verification complete (result NOT saved)`)

  return {
    existingStatus,
    fetchedData,
    newResult,
    comparison,
  }
}

/**
 * Get the existing verification status from the deployment table
 */
async function getExistingVerificationStatus(deploymentId: number): Promise<ExistingVerificationStatus> {
  const result = await pool.query(
    `SELECT 
       has_four_eyes,
       four_eyes_status,
       github_pr_number,
       github_pr_url,
       github_pr_data,
       unverified_commits
     FROM deployments
     WHERE id = $1`,
    [deploymentId],
  )

  if (result.rows.length === 0) {
    return {
      hasFourEyes: null,
      status: null,
      prNumber: null,
      prUrl: null,
      prData: null,
      unverifiedCommits: [],
    }
  }

  const row = result.rows[0]
  return {
    hasFourEyes: row.has_four_eyes,
    status: row.four_eyes_status,
    prNumber: row.github_pr_number,
    prUrl: row.github_pr_url,
    prData: row.github_pr_data,
    unverifiedCommits: row.unverified_commits || [],
  }
}
