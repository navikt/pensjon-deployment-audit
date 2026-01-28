import { GraphQLClient } from 'graphql-request';

let client: GraphQLClient | null = null;

export function getNaisClient(): GraphQLClient {
  if (!client) {
    const baseUrl = process.env.NAIS_GRAPHQL_URL || 'http://localhost:4242';
    // Ensure we're pointing to the GraphQL endpoint, not the playground
    const url = baseUrl.endsWith('/graphql') ? baseUrl : `${baseUrl}/graphql`;
    client = new GraphQLClient(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  return client;
}

// Types based on Nais API structure
export interface NaisResource {
  id: string;
  kind: string;
  name: string;
}

export interface NaisDeployment {
  id: string;
  createdAt: string;
  environmentName: string;
  teamSlug: string;
  triggerUrl: string;
  repository: string;
  commitSha: string | null;
  deployerUsername: string | null;
  resources: {
    nodes: NaisResource[];
  };
}

export interface NaisApplication {
  name: string;
  team: {
    slug: string;
  };
  teamEnvironment: {
    environment: {
      name: string;
    };
  };
  deployments: {
    pageInfo: {
      totalCount: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      pageEnd: number;
      pageStart: number;
      startCursor: string;
      endCursor: string;
    };
    nodes: NaisDeployment[];
  };
}

export interface TeamEnvironment {
  environment: {
    name: string;
  };
  application: NaisApplication;
}

export interface TeamEnvironmentResponse {
  team: {
    environment: TeamEnvironment;
  };
}

export interface ApplicationWithEnv {
  name: string;
  teamEnvironment: {
    environment: {
      name: string;
    };
  };
}

export interface TeamApplicationsResponse {
  team: {
    applications: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string;
      };
      nodes: ApplicationWithEnv[];
    };
  };
}

// Query for fetching deployments for a specific app in an environment
const APP_DEPLOYMENTS_QUERY = `
  query AppDeploys(
    $team: Slug!
    $env: String!
    $app: String!
    $first: Int
    $last: Int
    $before: Cursor
    $after: Cursor
  ) {
    team(slug: $team) {
      environment(name: $env) {
        application(name: $app) {
          name
          team { slug }
          teamEnvironment { environment { name } }

          deployments(first: $first, last: $last, before: $before, after: $after) {
            pageInfo {
              totalCount
              hasNextPage
              hasPreviousPage
              pageEnd
              pageStart
              startCursor
              endCursor
            }
            nodes {
              id
              environmentName
              teamSlug
              triggerUrl
              createdAt
              repository
              commitSha
              deployerUsername

              resources {
                nodes { id kind name }
              }
            }
          }
        }
      }
    }
  }
`;

// Query for discovering available environments and applications in a team
// Note: We query team.applications to get all apps, then check their environments
const TEAM_ENVIRONMENTS_QUERY = `
  query TeamEnvironments($team: Slug!, $first: Int!) {
    team(slug: $team) {
      applications(first: $first) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          teamEnvironment {
            environment {
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch all deployments for a specific application in an environment
 */
export async function fetchApplicationDeployments(
  teamSlug: string,
  environmentName: string,
  appName: string,
  limit: number = 1000
): Promise<NaisDeployment[]> {
  const client = getNaisClient();

  console.log('📡 Fetching deployments from Nais API:', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
    limit,
  });

  const allDeployments: NaisDeployment[] = [];
  let after: string | undefined = undefined;
  let pageCount = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      pageCount++;
      console.log(
        `📄 Fetching deployments page ${pageCount}${after ? ` (cursor: ${after.substring(0, 20)}...)` : ''}`
      );

      const response: TeamEnvironmentResponse = await client.request(APP_DEPLOYMENTS_QUERY, {
        team: teamSlug,
        env: environmentName,
        app: appName,
        first: limit,
        after: after,
        last: null,
        before: null,
      });

      if (!response.team?.environment?.application) {
        console.warn('⚠️  Application not found or no access');
        break;
      }

      const deployments = response.team.environment.application.deployments;
      const deploymentsCount = deployments.nodes.length;

      console.log(
        `📦 Received ${deploymentsCount} deployments on page ${pageCount} (total: ${deployments.pageInfo.totalCount})`
      );

      allDeployments.push(...deployments.nodes);

      // Check if there are more pages
      after = deployments.pageInfo.endCursor;
      hasMore = deployments.pageInfo.hasNextPage;

      if (hasMore) {
        console.log(`  ➡️  More deployments available, fetching next page...`);
      }
    }

    console.log(
      `✨ Total deployments fetched: ${allDeployments.length} (from ${pageCount} page(s))`
    );
    return allDeployments;
  } catch (error) {
    console.error('❌ Error fetching deployments from Nais:', error);

    // Check if the error is because we got HTML instead of JSON
    if (error instanceof Error && error.message.includes('Unexpected token')) {
      throw new Error(
        'Nais GraphQL API returnerte HTML i stedet for JSON. ' +
          'Sjekk at NAIS_GRAPHQL_URL peker til GraphQL endpoint (typisk /graphql), ' +
          'ikke til playground-siden.'
      );
    }

    throw error;
  }
}

/**
 * Discover available environments and applications for a team
 */
export async function discoverTeamApplications(teamSlug: string): Promise<{
  environments: Map<string, string[]>; // environmentName -> [appNames]
}> {
  const client = getNaisClient();

  console.log('🔍 Discovering applications for team:', teamSlug);

  try {
    // Fetch all applications with pagination
    const allApps: ApplicationWithEnv[] = [];
    let after: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const response: TeamApplicationsResponse = await client.request(
        TEAM_ENVIRONMENTS_QUERY,
        {
          team: teamSlug,
          first: 1000,
          after: after,
        }
      );

      if (!response.team?.applications) {
        console.warn('⚠️  No applications found for team');
        break;
      }

      allApps.push(...response.team.applications.nodes);
      after = response.team.applications.pageInfo.endCursor;
      hasMore = response.team.applications.pageInfo.hasNextPage;
    }

    // Group by environment
    const environments = new Map<string, string[]>();

    for (const app of allApps) {
      const envName = app.teamEnvironment.environment.name;
      const existing = environments.get(envName) || [];
      existing.push(app.name);
      environments.set(envName, existing);
    }

    // Log summary
    for (const [envName, appNames] of environments.entries()) {
      console.log(`  📁 ${envName}: ${appNames.length} applications`);
    }

    console.log(
      `✨ Found ${environments.size} environments with ${allApps.length} total applications`
    );
    return { environments };
  } catch (error) {
    console.error('❌ Error discovering applications:', error);
    throw error;
  }
}

/**
 * Get basic info about a specific application
 */
export async function getApplicationInfo(
  teamSlug: string,
  environmentName: string,
  appName: string
): Promise<{
  name: string;
  team: string;
  environment: string;
  repository: string | null;
} | null> {
  const client = getNaisClient();

  try {
    // Fetch just the first deployment to get repository info
    const response: TeamEnvironmentResponse = await client.request(APP_DEPLOYMENTS_QUERY, {
      team: teamSlug,
      env: environmentName,
      app: appName,
      first: 1,
      after: null,
      last: null,
      before: null,
    });

    const app = response.team?.environment?.application;
    if (!app) {
      return null;
    }

    return {
      name: app.name,
      team: app.team.slug,
      environment: app.teamEnvironment.environment.name,
      repository: app.deployments.nodes[0]?.repository || null,
    };
  } catch (error) {
    console.error('❌ Error fetching application info:', error);
    return null;
  }
}

/**
 * Helper function to get date range for common periods
 */
export function getDateRange(period: string): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = now;
  let startDate: Date;

  switch (period) {
    case 'last-month':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'last-12-months':
      startDate = new Date(now);
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    case 'year-2025':
      startDate = new Date('2025-01-01');
      break;
    default:
      startDate = new Date(0); // Beginning of time
  }

  return { startDate, endDate };
}
