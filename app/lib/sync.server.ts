import { createRepositoryAlert } from '~/db/alerts.server'
import {
  findRepositoryForApp,
  getRepositoriesByAppId,
  upsertApplicationRepository,
} from '~/db/application-repositories.server'
import {
  type CreateDeploymentParams,
  createDeployment,
  type DeploymentFilters,
  getAllDeployments,
  getDeploymentByNaisId,
  getLatestDeploymentForApp,
  updateDeploymentFourEyes,
} from '~/db/deployments.server'
import { getMonitoredApplication } from '~/db/monitored-applications.server'
import { logger, runWithJobContext } from '~/lib/logger.server'
import { fetchApplicationDeployments, fetchNewDeployments } from '~/lib/nais.server'
import { runVerification } from '~/lib/verification'

/**
 * Step 1: Sync deployments from Nais API to database
 * This ONLY fetches from Nais and stores to DB - no GitHub calls
 */
async function syncDeploymentsFromNais(
  teamSlug: string,
  environmentName: string,
  appName: string,
): Promise<{
  newCount: number
  skippedCount: number
  alertsCreated: number
  totalProcessed: number
}> {
  logger.info('📥 Syncing deployments from Nais (no GitHub verification):', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  })

  // Get the monitored application
  const monitoredApp = await getMonitoredApplication(teamSlug, environmentName, appName)
  if (!monitoredApp) {
    throw new Error(`Application not found in monitored applications: ${teamSlug}/${environmentName}/${appName}`)
  }

  // Fetch deployments from Nais
  const naisDeployments = await fetchApplicationDeployments(teamSlug, environmentName, appName)

  logger.info(`📦 Processing ${naisDeployments.length} deployments from Nais`)

  let newCount = 0
  let skippedCount = 0
  let alertsCreated = 0
  let totalProcessed = 0

  for (const naisDep of naisDeployments) {
    totalProcessed++

    // Skip deployments without repository info
    if (!naisDep.repository) {
      logger.warn(`⚠️  Skipping deployment without repository: ${naisDep.id}`)
      skippedCount++
      continue
    }

    // Extract GitHub owner/repo from repository field
    const repoParts = naisDep.repository.split('/')
    if (repoParts.length !== 2) {
      logger.warn(`⚠️  Invalid repository format: ${naisDep.repository}`)
      skippedCount++
      continue
    }

    const [detectedOwner, detectedRepoName] = repoParts

    // Check if deployment already exists
    const existingDep = await getDeploymentByNaisId(naisDep.id)

    if (existingDep) {
      logger.info(`⏭️  Deployment already exists: ${naisDep.id}`)
      skippedCount++
      continue
    }

    // Create deployment record first (WITHOUT four-eyes verification)
    logger.info(`➕ Creating new deployment: ${naisDep.id}`)

    const deploymentParams: CreateDeploymentParams = {
      monitoredApplicationId: monitoredApp.id,
      naisDeploymentId: naisDep.id,
      createdAt: new Date(naisDep.createdAt),
      teamSlug: teamSlug,
      environmentName: environmentName,
      appName: appName,
      commitSha: naisDep.commitSha,
      deployerUsername: naisDep.deployerUsername,
      triggerUrl: naisDep.triggerUrl,
      detectedGithubOwner: detectedOwner,
      detectedGithubRepoName: detectedRepoName,
      resources: naisDep.resources.nodes,
    }

    await createDeployment(deploymentParams)
    newCount++

    // Skip repository checks for legacy deployments (before 2025-01-01 without commit SHA)
    const legacyCutoffDate = new Date('2025-01-01T00:00:00Z')
    const isLegacyDeployment = new Date(naisDep.createdAt) < legacyCutoffDate && !naisDep.commitSha
    if (isLegacyDeployment) {
      logger.info(`⏭️  Skipping repository checks for legacy deployment: ${naisDep.id}`)
      continue
    }

    // Check repository status using application_repositories
    const repoCheck = await findRepositoryForApp(monitoredApp.id, detectedOwner, detectedRepoName)

    if (!repoCheck.repository) {
      // Repository not found - create pending approval entry
      logger.warn(`🆕 New repository detected for app ${appName}: ${detectedOwner}/${detectedRepoName}`)

      // Check if this is the first repo for this app
      const existingRepos = await getRepositoriesByAppId(monitoredApp.id)

      if (existingRepos.length === 0) {
        // First repo - auto-approve as active
        logger.info(`📝 Auto-approving first repository as active`)
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'active',
          approvedBy: 'system',
        })
      } else {
        // Additional repo - require approval
        logger.info(`⏸️  Creating pending approval entry`)
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'pending_approval',
        })

        // Create alert
        await createRepositoryAlert({
          monitoredApplicationId: monitoredApp.id,
          deploymentNaisId: naisDep.id,
          detectedGithubOwner: detectedOwner,
          detectedGithubRepoName: detectedRepoName,
          alertType: 'pending_approval',
        })

        alertsCreated++
      }
    } else if (repoCheck.repository.status === 'pending_approval') {
      // Repository exists but pending approval
      logger.warn(`⏸️  Deployment from pending approval repository: ${detectedOwner}/${detectedRepoName}`)

      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
        alertType: 'pending_approval',
      })

      alertsCreated++
    } else if (repoCheck.repository.status === 'historical') {
      // Repository is historical (not active)
      logger.warn(`⚠️  Deployment from historical repository: ${detectedOwner}/${detectedRepoName}`)

      // Get active repo for context
      const activeRepo = (await getRepositoriesByAppId(monitoredApp.id)).find((r) => r.status === 'active')

      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
        expectedGithubOwner: activeRepo?.github_owner || detectedOwner,
        expectedGithubRepoName: activeRepo?.github_repo_name || detectedRepoName,
        alertType: 'historical_repository',
      })

      alertsCreated++
    }
    // else: repository is active - all good, no alert needed
  }

  logger.info(`✅ Nais sync complete:`, {
    newCount,
    skippedCount,
    alertsCreated,
    totalProcessed,
  })

  return {
    newCount,
    skippedCount,
    alertsCreated,
    totalProcessed,
  }
}

/**
 * Incremental sync - only fetches new deployments since last sync
 * Stops as soon as it finds a deployment already in the database
 * Much faster for periodic syncs
 */
async function syncNewDeploymentsFromNais(
  teamSlug: string,
  environmentName: string,
  appName: string,
  monitoredAppId: number,
): Promise<{
  newCount: number
  alertsCreated: number
  stoppedEarly: boolean
}> {
  logger.info('📥 Incremental sync - fetching only new deployments:', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  })

  // Get the latest deployment we have for this app
  const latestDeployment = await getLatestDeploymentForApp(monitoredAppId)

  if (!latestDeployment) {
    // No deployments yet - fall back to full sync
    logger.info('📋 No existing deployments - performing full sync instead')
    const result = await syncDeploymentsFromNais(teamSlug, environmentName, appName)
    return {
      newCount: result.newCount,
      alertsCreated: result.alertsCreated,
      stoppedEarly: false,
    }
  }

  logger.info(`🔍 Looking for deployments newer than ${latestDeployment.nais_deployment_id.substring(0, 20)}...`)

  // Fetch only new deployments
  const { deployments, stoppedEarly } = await fetchNewDeployments(
    teamSlug,
    environmentName,
    appName,
    latestDeployment.nais_deployment_id,
    100, // Smaller page size for incremental
  )

  if (deployments.length === 0) {
    logger.info('✅ No new deployments found')
    return { newCount: 0, alertsCreated: 0, stoppedEarly }
  }

  logger.info(`📦 Processing ${deployments.length} new deployments`)

  let newCount = 0
  const alertsCreated = 0
  let detectedRepository: { owner: string; repo: string } | null = null

  for (const deployment of deployments) {
    // Double-check it doesn't exist (in case of race condition)
    const existing = await getDeploymentByNaisId(deployment.id)
    if (existing) {
      logger.info(`⏭️  Already exists: ${deployment.id}`)
      continue
    }

    // Parse repository from Nais data
    if (deployment.repository) {
      const match = deployment.repository.match(/github\.com\/([^/]+)\/([^/]+)/)
      if (match) {
        detectedRepository = { owner: match[1], repo: match[2] }
      } else if (deployment.repository.includes('/')) {
        const parts = deployment.repository.split('/')
        detectedRepository = { owner: parts[0], repo: parts[1] }
      }
    }

    // Extract resources
    const resources = deployment.resources?.nodes?.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
    }))

    logger.info(`➕ Creating new deployment: ${deployment.id}`)
    await createDeployment({
      monitoredApplicationId: monitoredAppId,
      naisDeploymentId: deployment.id,
      createdAt: new Date(deployment.createdAt),
      teamSlug: deployment.teamSlug,
      environmentName: deployment.environmentName,
      appName,
      deployerUsername: deployment.deployerUsername,
      commitSha: deployment.commitSha,
      triggerUrl: deployment.triggerUrl,
      detectedGithubOwner: detectedRepository?.owner || '',
      detectedGithubRepoName: detectedRepository?.repo || '',
      resources,
    })
    newCount++
  }

  // Check for repository mismatches if we detected a repo
  if (detectedRepository) {
    const existingRepos = await getRepositoriesByAppId(monitoredAppId)
    const matchingRepo = existingRepos.find(
      (r) => r.github_owner === detectedRepository.owner && r.github_repo_name === detectedRepository.repo,
    )

    if (!matchingRepo) {
      // New repository detected - create it (but skip alert for incremental sync)
      await upsertApplicationRepository({
        monitoredAppId,
        githubOwner: detectedRepository.owner,
        githubRepoName: detectedRepository.repo,
        status: 'active',
      })
      logger.info(`📌 New repository detected: ${detectedRepository.owner}/${detectedRepository.repo}`)
    }
  }

  logger.info(`✅ Incremental sync complete: ${newCount} new, ${alertsCreated} alerts`)
  return { newCount, alertsCreated, stoppedEarly }
}

/**
 * Step 2: Verify four-eyes status for deployments by checking GitHub
 * This can be run separately to avoid rate limits
 */
export async function verifyDeploymentsFourEyes(filters?: DeploymentFilters & { limit?: number }): Promise<{
  verified: number
  failed: number
  skipped: number
}> {
  logger.info(`🔍 Starting GitHub verification for deployments (limit: ${filters?.limit})`)

  // Get deployments that need verification - fetch all non-approved deployments
  const deploymentsToVerify = await getAllDeployments({
    ...filters,
    only_missing_four_eyes: true,
    per_page: 10000, // Get all deployments, not just first 20
  })

  // Only verify deployments with 'pending' or 'error' status
  // Other statuses (direct_push, unverified_commits, missing, etc.) are final results
  // that can only be changed via manual approval
  const statusesToVerify = ['pending', 'error']
  const needsVerification = deploymentsToVerify.filter(
    (d) => !d.has_four_eyes && d.four_eyes_status !== 'legacy' && statusesToVerify.includes(d.four_eyes_status ?? ''),
  )

  // Sort by created_at ascending (oldest first)
  const prioritized = needsVerification.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  // Apply limit if specified
  const toVerify = filters?.limit ? prioritized.slice(0, filters.limit) : prioritized

  logger.info(`📋 Found ${toVerify.length} deployments needing verification`)

  let verified = 0
  let failed = 0
  let skipped = 0

  for (const deployment of toVerify) {
    try {
      logger.info(`🔍 Verifying deployment ${deployment.nais_deployment_id}...`)

      // Skip deployments without commit SHA - keep current status
      if (!deployment.commit_sha) {
        logger.info(`⏭️  Skipping deployment without commit SHA: ${deployment.nais_deployment_id}`)
        skipped++
        continue
      }

      // Check for invalid SHA (e.g., "refs/heads/main" instead of actual SHA)
      // Treat these as legacy deployments that need manual lookup
      if (deployment.commit_sha.startsWith('refs/')) {
        logger.info(
          `⚠️  Invalid commit SHA (ref instead of SHA): ${deployment.commit_sha} - marking as legacy for manual lookup`,
        )
        await updateDeploymentFourEyes(
          deployment.id,
          {
            hasFourEyes: false,
            fourEyesStatus: 'legacy',
            githubPrNumber: null,
            githubPrUrl: null,
          },
          { changeSource: 'sync' },
        )
        skipped++
        continue
      }

      // Always use V2 verification
      const success = await verifyDeploymentFourEyesV2(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
        deployment.default_branch || 'main',
        deployment.monitored_app_id,
      )

      if (success) {
        verified++
      } else {
        skipped++
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      logger.error(`❌ Error verifying deployment ${deployment.nais_deployment_id}:`, error)
      failed++
    }
  }

  logger.info(`✅ Verification complete:`, {
    verified,
    failed,
    skipped,
  })

  return {
    verified,
    failed,
    skipped,
  }
}

/**
 * Verify four-eyes for a single deployment using the modular verification system.
 * Uses database caching and versioned snapshots.
 */
export async function verifyDeploymentFourEyesV2(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  _triggerUrl?: string | null,
  baseBranch: string = 'main',
  monitoredAppId?: number,
): Promise<boolean> {
  if (!monitoredAppId) {
    logger.warn(`⚠️  verifyDeploymentFourEyesV2 requires monitoredAppId`)
    return false
  }

  try {
    const result = await runVerification(deploymentId, {
      commitSha,
      repository,
      environmentName,
      baseBranch,
      monitoredAppId,
    })

    return result.status !== 'error'
  } catch (error) {
    logger.error(`❌ Error in verifyDeploymentFourEyesV2 for deployment ${deploymentId}:`, error)

    // Check if it's a rate limit error
    if (error instanceof Error && error.message.includes('rate limit')) {
      logger.warn('⚠️  GitHub rate limit reached, stopping verification')
      throw error
    }

    return false
  }
}

// ============================================================================
// Locked sync functions - for distributed execution across multiple pods
// ============================================================================

import {
  acquireSyncLock,
  cleanupOldSyncJobs,
  logSyncJobMessage,
  releaseSyncLock,
  SYNC_INTERVAL_MS,
} from '~/db/sync-jobs.server'

/**
 * Incremental sync from Nais with distributed locking (for periodic sync)
 * Only fetches new deployments - much faster than full sync
 */
async function syncNewDeploymentsWithLock(
  monitoredAppId: number,
  teamSlug: string,
  environmentName: string,
  appName: string,
): Promise<{
  success: boolean
  result?: Awaited<ReturnType<typeof syncNewDeploymentsFromNais>>
  locked?: boolean
}> {
  const lockId = await acquireSyncLock('nais_sync', monitoredAppId)
  if (!lockId) {
    return { success: false, locked: true }
  }

  try {
    await logSyncJobMessage(lockId, 'info', `Starter NAIS sync for ${appName}`, {
      team: teamSlug,
      env: environmentName,
    })
    const result = await runWithJobContext(lockId, false, () =>
      syncNewDeploymentsFromNais(teamSlug, environmentName, appName, monitoredAppId),
    )
    await logSyncJobMessage(lockId, 'info', `Sync fullført`, {
      newCount: result.newCount,
      alertsCreated: result.alertsCreated,
      stoppedEarly: result.stoppedEarly,
    })
    await releaseSyncLock(lockId, 'completed', result)
    return { success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logSyncJobMessage(lockId, 'error', `Sync feilet: ${errorMessage}`)
    await releaseSyncLock(lockId, 'failed', undefined, errorMessage)
    throw error
  }
}

/**
 * Verify deployments with distributed locking
 * Only one pod will run verification for a given app at a time
 */
export async function verifyDeploymentsWithLock(
  monitoredAppId: number,
  limit?: number,
): Promise<{ success: boolean; result?: Awaited<ReturnType<typeof verifyDeploymentsFourEyes>>; locked?: boolean }> {
  const lockId = await acquireSyncLock('github_verify', monitoredAppId, 15) // 15 min timeout for verification
  if (!lockId) {
    return { success: false, locked: true }
  }

  try {
    await logSyncJobMessage(lockId, 'info', `Starter GitHub verifisering`, { limit })
    const result = await runWithJobContext(lockId, false, () =>
      verifyDeploymentsFourEyes({
        monitored_app_id: monitoredAppId,
        limit,
      }),
    )
    await logSyncJobMessage(lockId, 'info', `Verifisering fullført`, {
      verified: result.verified,
      failed: result.failed,
      skipped: result.skipped,
    })
    await releaseSyncLock(lockId, 'completed', result)
    return { success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logSyncJobMessage(lockId, 'error', `Verifisering feilet: ${errorMessage}`)
    await releaseSyncLock(lockId, 'failed', undefined, errorMessage)
    throw error
  }
}

/**
 * Cache check logs with distributed locking
 * Only one pod will cache logs for a given app at a time
 */
async function cacheCheckLogsWithLock(
  monitoredAppId: number,
): Promise<{ success: boolean; result?: { cached: number }; locked?: boolean }> {
  const lockId = await acquireSyncLock('cache_check_logs', monitoredAppId, 10)
  if (!lockId) {
    return { success: false, locked: true }
  }

  try {
    await logSyncJobMessage(lockId, 'info', 'Starter caching av sjekk-logger')
    const { cacheCheckLogs } = await import('~/lib/log-cache.server')
    const { cached, diagnostics } = await runWithJobContext(lockId, false, () => cacheCheckLogs(monitoredAppId))

    if (cached === 0) {
      const d = diagnostics
      if (!d.gcsConfigured) {
        await logSyncJobMessage(lockId, 'warn', 'GCS er ikke konfigurert — kan ikke cache logger')
      } else if (d.deploymentsLast7Days === 0) {
        await logSyncJobMessage(lockId, 'info', 'Ingen deployments siste 7 dager')
      } else if (d.deploymentsWithChecks === 0) {
        await logSyncJobMessage(
          lockId,
          'info',
          `${d.deploymentsLast7Days} deployments siste 7 dager, men ingen har checks i github_pr_data (${d.deploymentsWithPrData} har pr_data)`,
        )
      } else {
        await logSyncJobMessage(lockId, 'info', `Ingen nye logger å cache`, {
          deployments_med_checks: d.deploymentsWithChecks,
          checks_totalt: d.checksTotal,
          allerede_cachet: d.skippedAlreadyCached,
          uten_id: d.skippedNoId,
          uten_repo: d.skippedNoRepo,
          ikke_fullført: d.skippedNotCompleted,
        })
      }
    }

    const result = { cached }
    await logSyncJobMessage(lockId, 'info', 'Caching fullført', result)
    await releaseSyncLock(lockId, 'completed', result)
    return { success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logSyncJobMessage(lockId, 'error', `Caching feilet: ${errorMessage}`)
    await releaseSyncLock(lockId, 'failed', undefined, errorMessage)
    throw error
  }
}

// ============================================================================
// Periodic sync scheduler
// ============================================================================

import { getAllMonitoredApplications } from '~/db/monitored-applications.server'

let periodicSyncInterval: ReturnType<typeof setInterval> | null = null
let isPeriodicSyncRunning = false

const VERIFY_LIMIT_PER_APP = 20 // Limit verifications per app per cycle

/**
 * Run periodic sync for all monitored applications
 * Uses locking to ensure only one pod syncs each app
 */
async function runPeriodicSync(): Promise<void> {
  if (isPeriodicSyncRunning) {
    logger.info('⏳ Periodic sync already running, skipping...')
    return
  }

  isPeriodicSyncRunning = true
  logger.info('🔄 Starting periodic sync cycle...')

  try {
    const apps = await getAllMonitoredApplications()
    logger.info(`📋 Found ${apps.length} monitored applications`)

    let syncedCount = 0
    let newDeploymentsCount = 0
    let verifiedCount = 0
    let cachedLogsCount = 0
    let lockedCount = 0

    for (const app of apps) {
      // Try incremental Nais sync (only fetches new deployments)
      const syncResult = await syncNewDeploymentsWithLock(app.id, app.team_slug, app.environment_name, app.app_name)

      if (syncResult.locked) {
        lockedCount++
      } else if (syncResult.success) {
        syncedCount++
        newDeploymentsCount += syncResult.result?.newCount || 0
      }

      // Try GitHub verification
      const verifyResult = await verifyDeploymentsWithLock(app.id, VERIFY_LIMIT_PER_APP)

      if (verifyResult.success && verifyResult.result) {
        verifiedCount += verifyResult.result.verified
      }

      // Try caching check logs
      const cacheResult = await cacheCheckLogsWithLock(app.id)

      if (cacheResult.success && cacheResult.result) {
        cachedLogsCount += cacheResult.result.cached
      }

      // Small delay between apps to be nice to APIs
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Cleanup old job records periodically
    const cleaned = await cleanupOldSyncJobs(50)
    if (cleaned > 0) {
      logger.info(`🧹 Cleaned up ${cleaned} old sync job records`)
    }

    // Send deploy notifications for newly verified deployments
    try {
      const baseUrl = process.env.BASE_URL || 'https://pensjon-deployment-audit.ansatt.nav.no'
      const { sendPendingDeployNotifications } = await import('~/lib/slack.server')
      const notified = await sendPendingDeployNotifications(baseUrl)
      if (notified > 0) {
        logger.info(`📬 Sent ${notified} deploy notifications`)
      }
    } catch (error) {
      logger.error('❌ Failed to send deploy notifications:', error)
    }

    logger.info(
      `✅ Periodic sync complete: synced ${syncedCount} apps (${newDeploymentsCount} new deployments), verified ${verifiedCount} deployments, cached ${cachedLogsCount} logs, ${lockedCount} locked`,
    )
  } catch (error) {
    logger.error('❌ Periodic sync error:', error)
  } finally {
    isPeriodicSyncRunning = false
  }
}

/**
 * Start the periodic sync scheduler
 */
export function startPeriodicSync(): void {
  if (periodicSyncInterval) {
    logger.warn('⚠️ Periodic sync already started')
    return
  }

  logger.info(`🚀 Starting periodic sync scheduler (interval: ${SYNC_INTERVAL_MS / 1000}s)`)

  // Run first sync after a short delay (allow server to fully start)
  setTimeout(() => {
    runPeriodicSync().catch((err) => logger.error('❌ Periodic sync failed:', err))
  }, 10_000) // 10 second delay

  // Schedule recurring syncs
  periodicSyncInterval = setInterval(() => {
    runPeriodicSync().catch((err) => logger.error('❌ Periodic sync failed:', err))
  }, SYNC_INTERVAL_MS)
}
