/**
 * Store Verification Data
 *
 * This module handles storing verification results to the database.
 * It connects the verification output to the deployment record and
 * stores the verification run history.
 */

import { pool } from '~/db/connection.server'
import { logStatusTransition } from '~/db/deployments.server'
import { saveVerificationRun } from '~/db/github-data.server'
import type { VerificationResult } from './types'

// =============================================================================
// Store Verification Result
// =============================================================================

/**
 * Store a verification result and update the deployment record
 */
export async function storeVerificationResult(
  deploymentId: number,
  result: VerificationResult,
  snapshotIds: {
    prSnapshotIds: number[]
    commitSnapshotIds: number[]
  },
  changeSource?: string,
): Promise<{ verificationRunId: number }> {
  // Save the verification run for history/audit
  const verificationRunId = await saveVerificationRun(
    deploymentId,
    {
      hasFourEyes: result.hasFourEyes,
      status: result.status,
      result: result,
    },
    snapshotIds,
  )

  // Update the deployment record with the verification result
  await updateDeploymentVerification(deploymentId, result, changeSource)

  return { verificationRunId }
}

/**
 * Update the deployment table with verification results
 */
async function updateDeploymentVerification(
  deploymentId: number,
  result: VerificationResult,
  changeSource?: string,
): Promise<void> {
  // Determine the four_eyes value for the deployment
  let fourEyesValue: boolean | null = null

  switch (result.status) {
    case 'approved':
      fourEyesValue = true
      break
    case 'implicitly_approved':
      fourEyesValue = true
      break
    case 'unverified_commits':
      fourEyesValue = false
      break
    case 'pending_baseline':
      fourEyesValue = null
      break
    case 'no_changes':
      fourEyesValue = true
      break
    case 'manually_approved':
      // Don't overwrite manual approval
      return
    case 'legacy':
      // Don't update legacy deployments
      return
    case 'error':
      fourEyesValue = null
      break
  }

  // Get current status before update for history logging
  const current = await pool.query(`SELECT four_eyes_status, has_four_eyes FROM deployments WHERE id = $1`, [
    deploymentId,
  ])

  // Get PR info for the deployment if available
  let githubPrData = null
  if (result.deployedPr) {
    githubPrData = {
      number: result.deployedPr.number,
      title: result.deployedPr.title,
      url: result.deployedPr.url,
      author: result.deployedPr.author,
    }
  }

  // Update deployment record
  await pool.query(
    `UPDATE deployments
     SET 
       has_four_eyes = COALESCE($1, has_four_eyes),
       four_eyes_status = $2,
       github_pr_number = COALESCE($3, github_pr_number),
       github_pr_data = COALESCE($4::jsonb, github_pr_data),
       unverified_commits = $6::jsonb
     WHERE id = $5
       AND four_eyes_status NOT IN ('manually_approved', 'legacy')`,
    [
      fourEyesValue,
      result.status,
      result.deployedPr?.number || null,
      githubPrData ? JSON.stringify(githubPrData) : null,
      deploymentId,
      result.unverifiedCommits.length > 0
        ? JSON.stringify(
            result.unverifiedCommits.map((c) => ({
              sha: c.sha,
              message: c.message,
              author: c.author,
              date: c.date,
              html_url: c.htmlUrl,
              pr_number: c.prNumber,
              reason: c.reason,
            })),
          )
        : null,
    ],
  )

  // Log status transition if status changed
  if (current.rows.length > 0 && fourEyesValue !== null) {
    const prev = current.rows[0]
    const newStatus = result.status
    if (prev.four_eyes_status !== newStatus || prev.has_four_eyes !== (fourEyesValue === true)) {
      await logStatusTransition(deploymentId, {
        fromStatus: prev.four_eyes_status,
        toStatus: newStatus,
        fromHasFourEyes: prev.has_four_eyes,
        toHasFourEyes: fourEyesValue === true,
        changeSource: changeSource || 'verification',
      })
    }
  }
}
