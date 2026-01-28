import {
  getMonitoredApplication,
  updateMonitoredApplicationRepository,
} from '~/db/monitored-applications';
import {
  createDeployment,
  getDeploymentByNaisId,
  updateDeploymentFourEyes,
  type CreateDeploymentParams,
} from '~/db/deployments';
import { createRepositoryAlert } from '~/db/alerts';
import { fetchApplicationDeployments } from '~/lib/nais-v2';
import { getCommit, getPullRequestForCommit, verifyPullRequestFourEyes } from '~/lib/github';

/**
 * Sync deployments for a monitored application
 * Validates repository and creates alerts on mismatch
 */
export async function syncDeploymentsForApplication(
  teamSlug: string,
  environmentName: string,
  appName: string
): Promise<{
  newCount: number;
  updatedCount: number;
  alertsCreated: number;
  totalProcessed: number;
}> {
  console.log('🔄 Starting sync for application:', {
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
  let updatedCount = 0;
  let alertsCreated = 0;
  let totalProcessed = 0;

  for (const naisDep of naisDeployments) {
    totalProcessed++;

    // Extract GitHub owner/repo from repository field
    // Format: "navikt/repo-name" or "owner/repo-name"
    const repoParts = naisDep.repository.split('/');
    if (repoParts.length !== 2) {
      console.warn(`⚠️  Invalid repository format: ${naisDep.repository}`);
      continue;
    }

    const [detectedOwner, detectedRepoName] = repoParts;

    // Check if deployment already exists
    const existingDep = await getDeploymentByNaisId(naisDep.id);

    if (existingDep) {
      // Skip if already approved - no need to re-check
      if (existingDep.four_eyes_status === 'approved_pr') {
        console.log(`⏭️  Skipping already approved deployment: ${naisDep.id}`);
        continue;
      }

      console.log(`📝 Updating deployment: ${naisDep.id}`);
      // Re-verify four-eyes status
      await verifyAndUpdateFourEyes(existingDep.id, naisDep.commitSha, naisDep.repository);
      updatedCount++;
      continue;
    }

    // New deployment - check for repository mismatch
    const repositoryMismatch =
      monitoredApp.approved_github_owner !== detectedOwner ||
      monitoredApp.approved_github_repo_name !== detectedRepoName;

    if (repositoryMismatch) {
      console.warn(`🚨 Repository mismatch detected for deployment ${naisDep.id}:`, {
        approved: `${monitoredApp.approved_github_owner}/${monitoredApp.approved_github_repo_name}`,
        detected: `${detectedOwner}/${detectedRepoName}`,
      });

      // Create alert
      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
      });

      alertsCreated++;
    }

    // If this is the first deployment for this app, auto-update detected repo
    // (unless there's already a mismatch alert)
    if (!monitoredApp.detected_github_owner && !repositoryMismatch) {
      console.log(`📝 Auto-updating detected repository for first deployment`);
      await updateMonitoredApplicationRepository(
        monitoredApp.id,
        detectedOwner,
        detectedRepoName
      );
    }

    // Create deployment record
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

    const newDeployment = await createDeployment(deploymentParams);
    newCount++;

    // Verify four-eyes status
    await verifyAndUpdateFourEyes(
      newDeployment.id,
      naisDep.commitSha,
      naisDep.repository
    );
  }

  console.log(`✅ Sync complete:`, {
    newCount,
    updatedCount,
    alertsCreated,
    totalProcessed,
  });

  return {
    newCount,
    updatedCount,
    alertsCreated,
    totalProcessed,
  };
}

/**
 * Verify and update four-eyes status for a deployment
 */
async function verifyAndUpdateFourEyes(
  deploymentId: number,
  commitSha: string,
  repository: string
): Promise<void> {
  const repoParts = repository.split('/');
  if (repoParts.length !== 2) {
    console.warn(`⚠️  Invalid repository format for four-eyes check: ${repository}`);
    return;
  }

  const [owner, repo] = repoParts;

  try {
    // Get commit info
    const commitInfo = await getCommit(owner, repo, commitSha);

    // Check if commit is part of a PR
    const prInfo = await getPullRequestForCommit(owner, repo, commitSha);

    if (!prInfo) {
      // Direct push to main
      console.log(`📌 Direct push detected for deployment ${deploymentId}`);
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'direct_push',
        githubPrNumber: null,
        githubPrUrl: null,
      });
      return;
    }

    // Check if PR has approval after last commit
    const lastCommitDate = new Date(commitInfo.commit.committer.date);
    const hasApproval = await verifyPullRequestFourEyes(owner, repo, prInfo.number, lastCommitDate);

    console.log(
      `${hasApproval ? '✅' : '❌'} PR #${prInfo.number} ${hasApproval ? 'has' : 'lacks'} approval after last commit`
    );

    await updateDeploymentFourEyes(deploymentId, {
      hasFourEyes: hasApproval,
      fourEyesStatus: hasApproval ? 'approved_pr' : 'missing',
      githubPrNumber: prInfo.number,
      githubPrUrl: prInfo.html_url,
    });
  } catch (error) {
    console.error(`❌ Error verifying four-eyes for deployment ${deploymentId}:`, error);
    // On error, mark as missing to be safe
    await updateDeploymentFourEyes(deploymentId, {
      hasFourEyes: false,
      fourEyesStatus: 'missing',
      githubPrNumber: null,
      githubPrUrl: null,
    });
  }
}
