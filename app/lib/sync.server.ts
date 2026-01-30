import { createRepositoryAlert } from '~/db/alerts.server';
import {
  findRepositoryForApp,
  getRepositoriesByAppId,
  upsertApplicationRepository,
} from '~/db/application-repositories.server';
import {
  type CreateDeploymentParams,
  createDeployment,
  type DeploymentFilters,
  getAllDeployments,
  getDeploymentByNaisId,
  updateDeploymentFourEyes,
} from '~/db/deployments.server';
import { getMonitoredApplication } from '~/db/monitored-applications.server';
import {
  findUnreviewedCommitsInMerge,
  getBranchFromWorkflowRun,
  getCommitDetails,
  getDetailedPullRequestInfo,
  getPullRequestForCommit,
  verifyPullRequestFourEyes,
} from '~/lib/github.server';
import { fetchApplicationDeployments } from '~/lib/nais.server';

/**
 * Step 1: Sync deployments from Nais API to database
 * This ONLY fetches from Nais and stores to DB - no GitHub calls
 */
export async function syncDeploymentsFromNais(
  teamSlug: string,
  environmentName: string,
  appName: string
): Promise<{
  newCount: number;
  skippedCount: number;
  alertsCreated: number;
  totalProcessed: number;
}> {
  console.log('📥 Syncing deployments from Nais (no GitHub verification):', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  });

  // Get the monitored application
  const monitoredApp = await getMonitoredApplication(teamSlug, environmentName, appName);
  if (!monitoredApp) {
    throw new Error(
      `Application not found in monitored applications: ${teamSlug}/${environmentName}/${appName}`
    );
  }

  // Fetch deployments from Nais
  const naisDeployments = await fetchApplicationDeployments(teamSlug, environmentName, appName);

  console.log(`📦 Processing ${naisDeployments.length} deployments from Nais`);

  let newCount = 0;
  let skippedCount = 0;
  let alertsCreated = 0;
  let totalProcessed = 0;

  for (const naisDep of naisDeployments) {
    totalProcessed++;

    // Skip deployments without repository info
    if (!naisDep.repository) {
      console.warn(`⚠️  Skipping deployment without repository: ${naisDep.id}`);
      skippedCount++;
      continue;
    }

    // Extract GitHub owner/repo from repository field
    const repoParts = naisDep.repository.split('/');
    if (repoParts.length !== 2) {
      console.warn(`⚠️  Invalid repository format: ${naisDep.repository}`);
      skippedCount++;
      continue;
    }

    const [detectedOwner, detectedRepoName] = repoParts;

    // Check if deployment already exists
    const existingDep = await getDeploymentByNaisId(naisDep.id);

    if (existingDep) {
      console.log(`⏭️  Deployment already exists: ${naisDep.id}`);
      skippedCount++;
      continue;
    }

    // Create deployment record first (WITHOUT four-eyes verification)
    console.log(`➕ Creating new deployment: ${naisDep.id}`);

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
    };

    await createDeployment(deploymentParams);
    newCount++;

    // Skip repository checks for legacy deployments (older than 1 year without commit SHA)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const isLegacyDeployment = new Date(naisDep.createdAt) < oneYearAgo && !naisDep.commitSha;
    if (isLegacyDeployment) {
      console.log(`⏭️  Skipping repository checks for legacy deployment: ${naisDep.id}`);
      continue;
    }

    // Check repository status using application_repositories
    const repoCheck = await findRepositoryForApp(monitoredApp.id, detectedOwner, detectedRepoName);

    if (!repoCheck.repository) {
      // Repository not found - create pending approval entry
      console.warn(
        `🆕 New repository detected for app ${appName}: ${detectedOwner}/${detectedRepoName}`
      );

      // Check if this is the first repo for this app
      const existingRepos = await getRepositoriesByAppId(monitoredApp.id);

      if (existingRepos.length === 0) {
        // First repo - auto-approve as active
        console.log(`📝 Auto-approving first repository as active`);
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'active',
          approvedBy: 'system',
        });
      } else {
        // Additional repo - require approval
        console.log(`⏸️  Creating pending approval entry`);
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'pending_approval',
        });

        // Create alert
        await createRepositoryAlert({
          monitoredApplicationId: monitoredApp.id,
          deploymentNaisId: naisDep.id,
          detectedGithubOwner: detectedOwner,
          detectedGithubRepoName: detectedRepoName,
          alertType: 'pending_approval',
        });

        alertsCreated++;
      }
    } else if (repoCheck.repository.status === 'pending_approval') {
      // Repository exists but pending approval
      console.warn(
        `⏸️  Deployment from pending approval repository: ${detectedOwner}/${detectedRepoName}`
      );

      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
        alertType: 'pending_approval',
      });

      alertsCreated++;
    } else if (repoCheck.repository.status === 'historical') {
      // Repository is historical (not active)
      console.warn(
        `⚠️  Deployment from historical repository: ${detectedOwner}/${detectedRepoName}`
      );

      // Get active repo for context
      const activeRepo = (await getRepositoriesByAppId(monitoredApp.id)).find(
        (r) => r.status === 'active'
      );

      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
        expectedGithubOwner: activeRepo?.github_owner || detectedOwner,
        expectedGithubRepoName: activeRepo?.github_repo_name || detectedRepoName,
        alertType: 'historical_repository',
      });

      alertsCreated++;
    }
    // else: repository is active - all good, no alert needed
  }

  console.log(`✅ Nais sync complete:`, {
    newCount,
    skippedCount,
    alertsCreated,
    totalProcessed,
  });

  return {
    newCount,
    skippedCount,
    alertsCreated,
    totalProcessed,
  };
}

/**
 * Step 2: Verify four-eyes status for deployments by checking GitHub
 * This can be run separately to avoid rate limits
 */
export async function verifyDeploymentsFourEyes(
  filters?: DeploymentFilters & { limit?: number }
): Promise<{
  verified: number;
  failed: number;
  skipped: number;
}> {
  console.log(`🔍 Starting GitHub verification for deployments (limit: ${filters?.limit})`);

  // Get deployments that need verification
  const deploymentsToVerify = await getAllDeployments({
    ...filters,
    // Only verify deployments that haven't been verified yet or failed
    // Skip 'approved_pr' and 'direct_push' statuses
  });

  // Filter to deployments without four-eyes approval
  const needsVerification = deploymentsToVerify.filter((d) => !d.has_four_eyes);

  // Prioritize: 1) pending (never verified), 2) others (failed verification or direct push)
  const prioritized = [
    ...needsVerification.filter((d) => d.four_eyes_status === 'pending'),
    ...needsVerification.filter((d) => d.four_eyes_status !== 'pending'),
  ];

  // Apply limit if specified
  const toVerify = filters?.limit ? prioritized.slice(0, filters.limit) : prioritized;

  console.log(
    `📋 Found ${toVerify.length} deployments needing verification (${prioritized.filter((d) => d.four_eyes_status === 'pending').length} pending, ${prioritized.filter((d) => d.four_eyes_status !== 'pending').length} failed)`
  );

  let verified = 0;
  let failed = 0;
  let skipped = 0;

  for (const deployment of toVerify) {
    try {
      console.log(`🔍 Verifying deployment ${deployment.nais_deployment_id}...`);

      // Skip if no commit SHA
      if (!deployment.commit_sha) {
        console.log(`⏭️  Skipping deployment without commit SHA: ${deployment.nais_deployment_id}`);
        await updateDeploymentFourEyes(deployment.id, {
          hasFourEyes: false,
          fourEyesStatus: 'error',
          githubPrNumber: null,
          githubPrUrl: null,
        });
        skipped++;
        continue;
      }

      const success = await verifyDeploymentFourEyes(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.trigger_url
      );

      if (success) {
        verified++;
      } else {
        skipped++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error verifying deployment ${deployment.nais_deployment_id}:`, error);
      failed++;
    }
  }

  console.log(`✅ Verification complete:`, {
    verified,
    failed,
    skipped,
  });

  return {
    verified,
    failed,
    skipped,
  };
}

/**
 * Verify and update four-eyes status for a single deployment
 * Returns true if verification succeeded, false if skipped
 */
export async function verifyDeploymentFourEyes(
  deploymentId: number,
  commitSha: string,
  repository: string,
  triggerUrl?: string | null
): Promise<boolean> {
  const repoParts = repository.split('/');
  if (repoParts.length !== 2) {
    console.warn(`⚠️  Invalid repository format for four-eyes check: ${repository}`);
    return false;
  }

  const [owner, repo] = repoParts;

  try {
    console.log(`🔍 [Deployment ${deploymentId}] Checking commit ${commitSha} in ${repository}`);

    // Fetch branch name from workflow run if available
    let branchName: string | null = null;
    if (triggerUrl) {
      branchName = await getBranchFromWorkflowRun(triggerUrl);
    }

    // Fetch commit details to get parent commits (for merge commits)
    const commitDetails = await getCommitDetails(owner, repo, commitSha);
    const parentCommits = commitDetails?.parents || null;

    // Check if commit is part of a PR
    const prInfo = await getPullRequestForCommit(owner, repo, commitSha);

    if (!prInfo) {
      // Direct push to main
      console.log(
        `📌 [Deployment ${deploymentId}] No PR found for commit ${commitSha} - marking as direct push`
      );
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'direct_push',
        githubPrNumber: null,
        githubPrUrl: null,
        branchName,
        parentCommits,
      });
      return true;
    }

    console.log(`🔗 [Deployment ${deploymentId}] Found PR #${prInfo.number}: ${prInfo.title}`);
    console.log(`   PR URL: ${prInfo.html_url}`);
    console.log(`   PR merged_at: ${prInfo.merged_at}`);
    console.log(`   PR state: ${prInfo.state}`);

    // Check if PR has approval after last commit
    const fourEyesResult = await verifyPullRequestFourEyes(owner, repo, prInfo.number);

    console.log(
      `${fourEyesResult.hasFourEyes ? '✅' : '❌'} [Deployment ${deploymentId}] PR #${prInfo.number} ${fourEyesResult.hasFourEyes ? 'has' : 'lacks'} approval: ${fourEyesResult.reason}`
    );

    // Fetch detailed PR information
    const detailedPrInfo = await getDetailedPullRequestInfo(owner, repo, prInfo.number);

    // Check for unreviewed commits in merge (if this is a merge commit)
    let unreviewedCommits: Array<any> = [];
    if (parentCommits && parentCommits.length >= 2 && detailedPrInfo) {
      console.log(
        `🔀 [Deployment ${deploymentId}] Merge commit detected - checking for unreviewed commits`
      );

      // Parent 0 is the PR branch, parent 1 is main
      const mainParent = parentCommits[1].sha;
      const prCommitShas = detailedPrInfo.commits.map((c) => c.sha);

      unreviewedCommits = await findUnreviewedCommitsInMerge(
        owner,
        repo,
        detailedPrInfo.base_sha,
        mainParent,
        prCommitShas
      );

      if (unreviewedCommits.length > 0) {
        console.log(
          `⚠️  [Deployment ${deploymentId}] Found ${unreviewedCommits.length} unreviewed commit(s) in merge`
        );
      }
    }

    // Add unreviewed commits to PR data if found
    const prDataWithUnreviewed = detailedPrInfo
      ? {
          ...detailedPrInfo,
          unreviewed_commits: unreviewedCommits.length > 0 ? unreviewedCommits : undefined,
        }
      : null;

    // Determine final status
    let finalHasFourEyes = fourEyesResult.hasFourEyes;
    let finalStatus = fourEyesResult.hasFourEyes ? 'approved_pr' : 'missing';

    if (unreviewedCommits.length > 0) {
      finalHasFourEyes = false;
      finalStatus = 'approved_pr_with_unreviewed';
      console.log(
        `❌ [Deployment ${deploymentId}] Marking as not approved due to unreviewed commits`
      );
    }

    await updateDeploymentFourEyes(deploymentId, {
      hasFourEyes: finalHasFourEyes,
      fourEyesStatus: finalStatus,
      githubPrNumber: prInfo.number,
      githubPrUrl: prInfo.html_url,
      githubPrData: prDataWithUnreviewed,
      branchName,
      parentCommits,
    });

    return true;
  } catch (error) {
    console.error(`❌ Error verifying four-eyes for deployment ${deploymentId}:`, error);

    // Check if it's a rate limit error
    if (error instanceof Error && error.message.includes('rate limit')) {
      console.warn('⚠️  GitHub rate limit reached, stopping verification without updating status');
      throw error; // Re-throw to stop batch processing, but don't update deployment status
    }

    // On other errors, mark as error status
    await updateDeploymentFourEyes(deploymentId, {
      hasFourEyes: false,
      fourEyesStatus: 'error',
      githubPrNumber: null,
      githubPrUrl: null,
    });

    return false;
  }
}

/**
 * Combined sync: Fetch from Nais AND verify with GitHub
 * Use this for small batches where rate limits are not a concern
 */
export async function syncAndVerifyDeployments(
  teamSlug: string,
  environmentName: string,
  appName: string
): Promise<{
  newCount: number;
  verified: number;
  alertsCreated: number;
}> {
  console.log('🔄 Full sync (Nais + GitHub) for application:', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  });

  // Step 1: Sync from Nais
  const naisResult = await syncDeploymentsFromNais(teamSlug, environmentName, appName);

  // Step 2: Verify new deployments with GitHub
  const monitoredApp = await getMonitoredApplication(teamSlug, environmentName, appName);
  if (!monitoredApp) {
    throw new Error('Application not found after sync');
  }

  const verifyResult = await verifyDeploymentsFourEyes({
    monitored_app_id: monitoredApp.id,
    limit: 1000, // Limit to avoid rate limits
  });

  console.log(`✅ Full sync complete`);

  return {
    newCount: naisResult.newCount,
    verified: verifyResult.verified,
    alertsCreated: naisResult.alertsCreated,
  };
}
