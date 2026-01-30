import { createRepositoryAlert } from '~/db/alerts.server'
import {
  findRepositoryForApp,
  getRepositoriesByAppId,
  upsertApplicationRepository,
} from '~/db/application-repositories.server'
import {
  getCommit,
  hasCommitsCached,
  type UpsertCommitParams,
  updateCommitPrVerification,
  upsertCommits,
} from '~/db/commits.server'
import {
  type CreateDeploymentParams,
  createDeployment,
  type DeploymentFilters,
  getAllDeployments,
  getDeploymentByNaisId,
  getPreviousDeployment,
  type UnverifiedCommit,
  updateDeploymentFourEyes,
} from '~/db/deployments.server'
import { getMonitoredApplication } from '~/db/monitored-applications.server'
import {
  getCommitsBetween,
  getDetailedPullRequestInfo,
  getPullRequestForCommit,
  verifyPullRequestFourEyes,
} from '~/lib/github.server'
import { fetchApplicationDeployments } from '~/lib/nais.server'

/**
 * Step 1: Sync deployments from Nais API to database
 * This ONLY fetches from Nais and stores to DB - no GitHub calls
 */
export async function syncDeploymentsFromNais(
  teamSlug: string,
  environmentName: string,
  appName: string,
): Promise<{
  newCount: number
  skippedCount: number
  alertsCreated: number
  totalProcessed: number
}> {
  console.log('📥 Syncing deployments from Nais (no GitHub verification):', {
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

  console.log(`📦 Processing ${naisDeployments.length} deployments from Nais`)

  let newCount = 0
  let skippedCount = 0
  let alertsCreated = 0
  let totalProcessed = 0

  for (const naisDep of naisDeployments) {
    totalProcessed++

    // Skip deployments without repository info
    if (!naisDep.repository) {
      console.warn(`⚠️  Skipping deployment without repository: ${naisDep.id}`)
      skippedCount++
      continue
    }

    // Extract GitHub owner/repo from repository field
    const repoParts = naisDep.repository.split('/')
    if (repoParts.length !== 2) {
      console.warn(`⚠️  Invalid repository format: ${naisDep.repository}`)
      skippedCount++
      continue
    }

    const [detectedOwner, detectedRepoName] = repoParts

    // Check if deployment already exists
    const existingDep = await getDeploymentByNaisId(naisDep.id)

    if (existingDep) {
      console.log(`⏭️  Deployment already exists: ${naisDep.id}`)
      skippedCount++
      continue
    }

    // Create deployment record first (WITHOUT four-eyes verification)
    console.log(`➕ Creating new deployment: ${naisDep.id}`)

    const deploymentParams: CreateDeploymentParams = {
      monitoredApplicationId: monitoredApp.id,
      naisDeploymentId: naisDep.id,
      createdAt: new Date(naisDep.createdAt),
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
      console.log(`⏭️  Skipping repository checks for legacy deployment: ${naisDep.id}`)
      continue
    }

    // Check repository status using application_repositories
    const repoCheck = await findRepositoryForApp(monitoredApp.id, detectedOwner, detectedRepoName)

    if (!repoCheck.repository) {
      // Repository not found - create pending approval entry
      console.warn(`🆕 New repository detected for app ${appName}: ${detectedOwner}/${detectedRepoName}`)

      // Check if this is the first repo for this app
      const existingRepos = await getRepositoriesByAppId(monitoredApp.id)

      if (existingRepos.length === 0) {
        // First repo - auto-approve as active
        console.log(`📝 Auto-approving first repository as active`)
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'active',
          approvedBy: 'system',
        })
      } else {
        // Additional repo - require approval
        console.log(`⏸️  Creating pending approval entry`)
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
      console.warn(`⏸️  Deployment from pending approval repository: ${detectedOwner}/${detectedRepoName}`)

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
      console.warn(`⚠️  Deployment from historical repository: ${detectedOwner}/${detectedRepoName}`)

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

  console.log(`✅ Nais sync complete:`, {
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
 * Step 2: Verify four-eyes status for deployments by checking GitHub
 * This can be run separately to avoid rate limits
 */
export async function verifyDeploymentsFourEyes(filters?: DeploymentFilters & { limit?: number }): Promise<{
  verified: number
  failed: number
  skipped: number
}> {
  console.log(`🔍 Starting GitHub verification for deployments (limit: ${filters?.limit})`)

  // Get deployments that need verification
  const deploymentsToVerify = await getAllDeployments({
    ...filters,
    // Only verify deployments that haven't been verified yet or failed
    // Skip 'approved_pr' and 'direct_push' statuses
  })

  // Filter to deployments without four-eyes approval, excluding legacy deployments
  const needsVerification = deploymentsToVerify.filter((d) => !d.has_four_eyes && d.four_eyes_status !== 'legacy')

  // Prioritize: 1) pending (never verified), 2) others (failed verification or direct push)
  // Within each priority, sort by created_at ascending (oldest first)
  const pending = needsVerification
    .filter((d) => d.four_eyes_status === 'pending')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const nonPending = needsVerification
    .filter((d) => d.four_eyes_status !== 'pending')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const prioritized = [...pending, ...nonPending]

  // Apply limit if specified
  const toVerify = filters?.limit ? prioritized.slice(0, filters.limit) : prioritized

  console.log(
    `📋 Found ${toVerify.length} deployments needing verification (${prioritized.filter((d) => d.four_eyes_status === 'pending').length} pending, ${prioritized.filter((d) => d.four_eyes_status !== 'pending').length} failed)`,
  )

  let verified = 0
  let failed = 0
  let skipped = 0

  for (const deployment of toVerify) {
    try {
      console.log(`🔍 Verifying deployment ${deployment.nais_deployment_id}...`)

      // Skip deployments without commit SHA - keep current status
      if (!deployment.commit_sha) {
        console.log(`⏭️  Skipping deployment without commit SHA: ${deployment.nais_deployment_id}`)
        skipped++
        continue
      }

      const success = await verifyDeploymentFourEyes(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
      )

      if (success) {
        verified++
      } else {
        skipped++
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      console.error(`❌ Error verifying deployment ${deployment.nais_deployment_id}:`, error)
      failed++
    }
  }

  console.log(`✅ Verification complete:`, {
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
 * Verify and update four-eyes status for a single deployment
 * New approach: Checks ALL commits between previous deployment and this one
 * Returns true if verification succeeded, false if skipped
 */
export async function verifyDeploymentFourEyes(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  _triggerUrl?: string | null,
): Promise<boolean> {
  const repoParts = repository.split('/')
  if (repoParts.length !== 2) {
    console.warn(`⚠️  Invalid repository format for four-eyes check: ${repository}`)
    return false
  }

  const [owner, repo] = repoParts

  try {
    console.log(`🔍 [Deployment ${deploymentId}] Verifying commits up to ${commitSha.substring(0, 7)} in ${repository}`)

    // Step 1: Get PR info for the deployed commit itself (for UI display)
    const deployedCommitPr = await getPullRequestForCommit(owner, repo, commitSha)
    let deployedPrNumber: number | null = null
    let deployedPrUrl: string | null = null
    let deployedPrData: any = null

    if (deployedCommitPr) {
      deployedPrNumber = deployedCommitPr.number
      deployedPrUrl = deployedCommitPr.html_url
      console.log(`📎 [Deployment ${deploymentId}] Deployed commit is from PR #${deployedPrNumber}`)

      // Fetch detailed PR data (reviews, commits, etc.)
      deployedPrData = await getDetailedPullRequestInfo(owner, repo, deployedPrNumber)
    } else {
      console.log(`📎 [Deployment ${deploymentId}] Deployed commit has no associated PR`)
    }

    // Step 2: Get previous deployment for this repo/environment
    const previousDeployment = await getPreviousDeployment(deploymentId, owner, repo, environmentName)

    if (!previousDeployment) {
      console.log(
        `📍 [Deployment ${deploymentId}] First deployment for ${repository}/${environmentName} - marking as baseline`,
      )
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'baseline',
        githubPrNumber: deployedPrNumber,
        githubPrUrl: deployedPrUrl,
        githubPrData: deployedPrData,
      })
      return true
    }

    console.log(
      `📍 [Deployment ${deploymentId}] Previous deployment: ${previousDeployment.commit_sha?.substring(0, 7)} (ID: ${previousDeployment.id})`,
    )

    // Step 3: Get all commits between previous and current deployment
    // First check if we have them cached
    const hasCached = await hasCommitsCached(owner, repo, commitSha)

    const commitsBetween = await getCommitsBetween(owner, repo, previousDeployment.commit_sha!, commitSha)

    if (!commitsBetween) {
      console.warn(`⚠️  [Deployment ${deploymentId}] Could not fetch commits between deployments`)
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'error',
        githubPrNumber: deployedPrNumber,
        githubPrUrl: deployedPrUrl,
        githubPrData: deployedPrData,
      })
      return false
    }

    console.log(`📊 [Deployment ${deploymentId}] Found ${commitsBetween.length} commit(s) between deployments`)

    // Cache commits to database for future fast lookups
    if (commitsBetween.length > 0 && !hasCached) {
      const commitsToCache: UpsertCommitParams[] = commitsBetween.map((c) => ({
        sha: c.sha,
        repoOwner: owner,
        repoName: repo,
        authorUsername: c.author,
        authorDate: c.date ? new Date(c.date) : null,
        committerDate: c.committer_date ? new Date(c.committer_date) : null,
        message: c.message,
        parentShas: c.parent_shas,
        isMergeCommit: c.parents_count >= 2,
        htmlUrl: c.html_url,
      }))

      await upsertCommits(commitsToCache)
      console.log(`💾 [Deployment ${deploymentId}] Cached ${commitsToCache.length} commit(s) to database`)
    }

    if (commitsBetween.length === 0) {
      console.log(`✅ [Deployment ${deploymentId}] No new commits - same as previous deployment`)
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'no_changes',
        githubPrNumber: deployedPrNumber,
        githubPrUrl: deployedPrUrl,
        githubPrData: deployedPrData,
      })
      return true
    }

    // Step 4: Verify each commit has four-eyes
    // First check database cache, then GitHub API
    const unverifiedCommits: UnverifiedCommit[] = []
    const prCache = new Map<number, { hasFourEyes: boolean; reason: string }>()

    for (const commit of commitsBetween) {
      // Skip merge commits (they're verified through their source PRs)
      if (commit.parents_count >= 2) {
        console.log(`   ⏭️  Skipping merge commit ${commit.sha.substring(0, 7)}`)
        continue
      }

      // Check if we have cached verification in database
      const cachedCommit = await getCommit(owner, repo, commit.sha)
      if (cachedCommit && cachedCommit.pr_approved !== null) {
        // We have a cached result
        if (cachedCommit.pr_approved) {
          console.log(
            `   💾 Commit ${commit.sha.substring(0, 7)}: cached as approved (PR #${cachedCommit.original_pr_number})`,
          )
          continue
        } else {
          console.log(`   💾 Commit ${commit.sha.substring(0, 7)}: cached as NOT approved`)
          unverifiedCommits.push({
            sha: commit.sha,
            message: commit.message.split('\n')[0],
            author: commit.author,
            date: commit.date,
            html_url: commit.html_url,
            pr_number: cachedCommit.original_pr_number,
            reason: cachedCommit.pr_approval_reason || 'no_pr',
          })
          continue
        }
      }

      // No cached result - check GitHub API
      // Use verifyCommitIsInPR=true to detect commits that were pushed to main
      // and then "smuggled" into a PR when the PR merged main into its branch.
      const prInfo = await getPullRequestForCommit(owner, repo, commit.sha, true)

      if (!prInfo) {
        console.log(
          `   ❌ Commit ${commit.sha.substring(0, 7)}: No PR found or not an original PR commit (direct push to main)`,
        )

        // Cache the result
        await updateCommitPrVerification(owner, repo, commit.sha, null, null, null, false, 'no_pr')

        unverifiedCommits.push({
          sha: commit.sha,
          message: commit.message.split('\n')[0],
          author: commit.author,
          date: commit.date,
          html_url: commit.html_url,
          pr_number: null,
          reason: 'no_pr',
        })
        continue
      }

      // Check PR approval (use memory cache for this deployment)
      let approvalResult = prCache.get(prInfo.number)
      if (!approvalResult) {
        approvalResult = await verifyPullRequestFourEyes(owner, repo, prInfo.number)
        prCache.set(prInfo.number, approvalResult)
        console.log(
          `   🔍 Commit ${commit.sha.substring(0, 7)}: PR #${prInfo.number} - ${approvalResult.hasFourEyes ? '✅ approved' : '❌ not approved'}`,
        )
      } else {
        console.log(`   💾 Commit ${commit.sha.substring(0, 7)}: PR #${prInfo.number} - cached result`)
      }

      // Cache the result in database
      await updateCommitPrVerification(
        owner,
        repo,
        commit.sha,
        prInfo.number,
        prInfo.title,
        prInfo.html_url,
        approvalResult.hasFourEyes,
        approvalResult.reason,
      )

      if (!approvalResult.hasFourEyes) {
        unverifiedCommits.push({
          sha: commit.sha,
          message: commit.message.split('\n')[0],
          author: commit.author,
          date: commit.date,
          html_url: commit.html_url,
          pr_number: prInfo.number,
          reason: 'pr_not_approved',
        })
      }
    }

    // Step 5: Determine final status
    if (unverifiedCommits.length > 0) {
      console.log(`❌ [Deployment ${deploymentId}] Found ${unverifiedCommits.length} unverified commit(s):`)
      unverifiedCommits.forEach((c) => {
        console.log(`      - ${c.sha.substring(0, 7)}: ${c.message.substring(0, 60)}`)
        console.log(`        Reason: ${c.reason}, PR: ${c.pr_number || 'none'}`)
      })

      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'unverified_commits',
        githubPrNumber: deployedPrNumber,
        githubPrUrl: deployedPrUrl,
        githubPrData: deployedPrData,
        unverifiedCommits,
      })
    } else {
      console.log(`✅ [Deployment ${deploymentId}] All ${commitsBetween.length} commit(s) verified`)
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'approved',
        githubPrNumber: deployedPrNumber,
        githubPrUrl: deployedPrUrl,
        githubPrData: deployedPrData,
      })
    }

    return true
  } catch (error) {
    console.error(`❌ Error verifying four-eyes for deployment ${deploymentId}:`, error)

    // Check if it's a rate limit error
    if (error instanceof Error && error.message.includes('rate limit')) {
      console.warn('⚠️  GitHub rate limit reached, stopping verification without updating status')
      throw error // Re-throw to stop batch processing, but don't update deployment status
    }

    // On other errors, mark as error status
    await updateDeploymentFourEyes(deploymentId, {
      hasFourEyes: false,
      fourEyesStatus: 'error',
      githubPrNumber: null,
      githubPrUrl: null,
    })

    return false
  }
}

/**
 * Combined sync: Fetch from Nais AND verify with GitHub
 * Use this for small batches where rate limits are not a concern
 */
export async function syncAndVerifyDeployments(
  teamSlug: string,
  environmentName: string,
  appName: string,
): Promise<{
  newCount: number
  verified: number
  alertsCreated: number
}> {
  console.log('🔄 Full sync (Nais + GitHub) for application:', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  })

  // Step 1: Sync from Nais
  const naisResult = await syncDeploymentsFromNais(teamSlug, environmentName, appName)

  // Step 2: Verify new deployments with GitHub
  const monitoredApp = await getMonitoredApplication(teamSlug, environmentName, appName)
  if (!monitoredApp) {
    throw new Error('Application not found after sync')
  }

  const verifyResult = await verifyDeploymentsFourEyes({
    monitored_app_id: monitoredApp.id,
    limit: 1000, // Limit to avoid rate limits
  })

  console.log(`✅ Full sync complete`)

  return {
    newCount: naisResult.newCount,
    verified: verifyResult.verified,
    alertsCreated: naisResult.alertsCreated,
  }
}
