import { createDeployment, getDeploymentByNaisId } from '../db/deployments';
import type { Repository } from '../db/repositories';
import { getPullRequestForCommit, verifyPullRequestFourEyes } from './github';
import { fetchDeploymentsInRange } from './nais';

export interface SyncResult {
  success: boolean;
  deploymentsProcessed: number;
  deploymentsCreated: number;
  deploymentsUpdated: number;
  errors: string[];
}

/**
 * Synchronize deployments for a repository from Nais GraphQL API
 * and verify four-eyes status using GitHub API
 */
export async function syncDeploymentsForRepository(
  repo: Repository,
  startDate: Date,
  endDate: Date
): Promise<SyncResult> {
  console.log('🔄 Starting sync for repository:', {
    repo: `${repo.github_owner}/${repo.github_repo_name}`,
    team: repo.nais_team_slug,
    environment: repo.nais_environment_name,
    dateRange: { startDate, endDate },
  });

  const result: SyncResult = {
    success: true,
    deploymentsProcessed: 0,
    deploymentsCreated: 0,
    deploymentsUpdated: 0,
    errors: [],
  };

  try {
    // Fetch deployments from Nais for the specified time range
    console.log('📡 Fetching deployments from Nais...');
    const naisDeployments = await fetchDeploymentsInRange(repo.nais_team_slug, startDate, endDate);
    console.log(`📦 Received ${naisDeployments.length} total deployments from Nais`);

    if (naisDeployments.length > 0) {
      console.log('Sample deployment:', naisDeployments[0]);
    }

    // Filter to only deployments for this specific repository and environment
    const relevantDeployments = naisDeployments.filter((deployment) => {
      const repoMatch = deployment.repository === `${repo.github_owner}/${repo.github_repo_name}`;
      const envMatch = deployment.environmentName === repo.nais_environment_name;
      
      if (!repoMatch || !envMatch) {
        console.log('⏭️  Skipping deployment:', {
          deploymentRepo: deployment.repository,
          expectedRepo: `${repo.github_owner}/${repo.github_repo_name}`,
          repoMatch,
          deploymentEnv: deployment.environmentName,
          expectedEnv: repo.nais_environment_name,
          envMatch,
        });
      }
      
      return repoMatch && envMatch;
    });

    console.log(`✅ Found ${relevantDeployments.length} relevant deployments after filtering`);
    result.deploymentsProcessed = relevantDeployments.length;

    // Process each deployment
    for (let i = 0; i < relevantDeployments.length; i++) {
      const naisDeployment = relevantDeployments[i];
      console.log(`\n🔧 Processing deployment ${i + 1}/${relevantDeployments.length}:`, {
        id: naisDeployment.id,
        commit: naisDeployment.commitSha.substring(0, 7),
        deployer: naisDeployment.deployerUsername,
        createdAt: naisDeployment.createdAt,
      });

      try {
        // Check if deployment already exists
        const existingDeployment = await getDeploymentByNaisId(naisDeployment.id);
        console.log(`  ${existingDeployment ? '🔄 Updating existing' : '➕ Creating new'} deployment`);

        // Skip GitHub API calls if deployment already has approved four-eyes
        if (existingDeployment && existingDeployment.four_eyes_status === 'approved_pr') {
          console.log('  ⏭️  Skipping GitHub check - already approved');
          result.deploymentsUpdated++;
          continue;
        }

        // Get PR info from GitHub
        let hasFourEyes = false;
        let fourEyesStatus = 'unknown';
        let prNumber: number | undefined;
        let prUrl: string | undefined;

        try {
          console.log(`  🔍 Checking GitHub for commit ${naisDeployment.commitSha.substring(0, 7)}...`);
          const pr = await getPullRequestForCommit(
            repo.github_owner,
            repo.github_repo_name,
            naisDeployment.commitSha
          );

          if (pr?.merged_at) {
            console.log(`  📋 Found PR #${pr.number}: ${pr.title}`);
            // This commit was merged via PR
            prNumber = pr.number;
            prUrl = pr.html_url;

            // Verify four-eyes on the PR
            console.log(`  👀 Verifying four-eyes on PR #${pr.number}...`);
            const verification = await verifyPullRequestFourEyes(
              repo.github_owner,
              repo.github_repo_name,
              pr.number
            );

            console.log(`  ${verification.hasFourEyes ? '✅' : '❌'} Four-eyes: ${verification.reason}`);
            hasFourEyes = verification.hasFourEyes;
            fourEyesStatus = verification.hasFourEyes ? 'approved_pr' : 'pr_not_approved';
          } else {
            console.log('  ⚠️  No PR found - direct push to branch');
            // Direct push to main/branch
            fourEyesStatus = 'direct_push';
            hasFourEyes = false;
          }
        } catch (error) {
          console.error(`  ❌ Error checking GitHub for commit ${naisDeployment.commitSha}:`, error);
          fourEyesStatus = 'error';
          result.errors.push(`Failed to check GitHub for commit ${naisDeployment.commitSha}`);
        }

        // Create or update deployment in database
        console.log('  💾 Saving to database...');
        await createDeployment({
          repo_id: repo.id,
          nais_deployment_id: naisDeployment.id,
          created_at: new Date(naisDeployment.createdAt),
          team_slug: naisDeployment.teamSlug,
          environment_name: naisDeployment.environmentName,
          repository: naisDeployment.repository,
          deployer_username: naisDeployment.deployerUsername,
          commit_sha: naisDeployment.commitSha,
          trigger_url: naisDeployment.triggerUrl,
          has_four_eyes: hasFourEyes,
          four_eyes_status: fourEyesStatus,
          github_pr_number: prNumber,
          github_pr_url: prUrl,
        });

        if (existingDeployment) {
          result.deploymentsUpdated++;
        } else {
          result.deploymentsCreated++;
        }
        console.log('  ✅ Deployment saved successfully');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`  ❌ Failed to process deployment:`, error);
        result.errors.push(`Failed to process deployment ${naisDeployment.id}: ${errorMsg}`);
      }
    }

    result.success = result.errors.length === 0;
    console.log('\n✨ Sync completed:', {
      processed: result.deploymentsProcessed,
      created: result.deploymentsCreated,
      updated: result.deploymentsUpdated,
      errors: result.errors.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Fatal error during sync:', error);
    result.success = false;
    result.errors.push(`Failed to sync deployments: ${errorMsg}`);
  }

  return result;
}
