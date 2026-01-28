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

export interface NaisDeployment {
  id: string;
  createdAt: string;
  teamSlug: string;
  environmentName: string;
  repository: string;
  deployerUsername: string;
  commitSha: string;
  triggerUrl: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string;
}

export interface NaisApplication {
  name: string;
  deployments: {
    nodes: NaisDeployment[];
    pageInfo: PageInfo;
  };
}

export interface TeamResponse {
  team: {
    applications: {
      nodes: NaisApplication[];
      pageInfo: PageInfo;
    };
  };
}

const DEPLOYMENTS_QUERY = `
  query($team: Slug!, $appsFirst: Int!, $appsAfter: Cursor, $depsFirst: Int!, $depsAfter: Cursor) {
    team(slug: $team) {
      applications(first: $appsFirst, after: $appsAfter) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          deployments(first: $depsFirst, after: $depsAfter) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              createdAt
              teamSlug
              environmentName
              repository
              deployerUsername
              commitSha
              triggerUrl
            }
          }
        }
      }
    }
  }
`;

export async function fetchDeployments(
  teamSlug: string,
  appsFirst: number = 100,
  deploymentsFirst: number = 100
): Promise<NaisDeployment[]> {
  const client = getNaisClient();

  console.log('📡 Fetching deployments from Nais API:', {
    team: teamSlug,
    appsFirst,
    deploymentsFirst,
  });

  const allDeployments: NaisDeployment[] = [];
  let appsAfter: string | undefined = undefined;
  let appsPageCount = 0;
  let hasMoreApps = true;

  try {
    // Paginate through applications
    while (hasMoreApps) {
      appsPageCount++;
      console.log(
        `📄 Fetching applications page ${appsPageCount}${appsAfter ? ` (cursor: ${appsAfter})` : ''}`
      );

      const response: TeamResponse = await client.request<TeamResponse>(DEPLOYMENTS_QUERY, {
        team: teamSlug,
        appsFirst,
        appsAfter,
        depsFirst: deploymentsFirst,
        depsAfter: undefined, // We'll handle deployment pagination per app
      });

      if (!response.team) {
        console.warn('⚠️  No team data in response - team might not exist or no access');
        break;
      }

      if (!response.team.applications) {
        console.warn('⚠️  No applications data in response');
        break;
      }

      console.log(
        `📦 Found ${response.team.applications.nodes.length} applications on page ${appsPageCount}`
      );

      // For each application, paginate through its deployments
      for (const app of response.team.applications.nodes) {
        const appDeployments: NaisDeployment[] = [];

        // First page of deployments (already fetched)
        if (app.deployments?.nodes) {
          appDeployments.push(...app.deployments.nodes);
        }

        // Paginate through remaining deployment pages if needed
        let depsAfter = app.deployments?.pageInfo?.endCursor;
        let depsHasNextPage = app.deployments?.pageInfo?.hasNextPage || false;
        let depsPageCount = 1;

        while (depsHasNextPage && depsAfter) {
          depsPageCount++;
          console.log(
            `  📄 Fetching more deployments for ${app.name} (page ${depsPageCount})`
          );

          const depsResponse = await client.request<TeamResponse>(DEPLOYMENTS_QUERY, {
            team: teamSlug,
            appsFirst: 1, // Only fetch this specific app
            appsAfter: undefined,
            depsFirst: deploymentsFirst,
            depsAfter: depsAfter,
          });

          // Find the matching app in the response
          const appData = depsResponse?.team?.applications?.nodes?.[0];
          if (appData?.deployments?.nodes) {
            appDeployments.push(...appData.deployments.nodes);
          }

          // Update pagination info for next iteration
          depsAfter = appData?.deployments?.pageInfo?.endCursor;
          depsHasNextPage = appData?.deployments?.pageInfo?.hasNextPage || false;
        }

        console.log(`  - ${app.name}: ${appDeployments.length} deployments (${depsPageCount} page(s))`);
        allDeployments.push(...appDeployments);
      }

      // Check if there are more applications pages
      appsAfter = response.team.applications.pageInfo?.endCursor;
      hasMoreApps = response.team.applications.pageInfo?.hasNextPage || false;
    }

    console.log(
      `✨ Total deployments fetched: ${allDeployments.length} (from ${appsPageCount} app page(s))`
    );
    return allDeployments;
  } catch (error) {
    console.error('❌ Error fetching deployments from Nais:', error);

    // Check if the error is because we got HTML instead of JSON
    if (error instanceof Error && error.message.includes('Unexpected token')) {
      throw new Error(
        'Nais GraphQL API returnerte HTML i stedet for JSON. ' +
          'Sjekk at NAIS_GRAPHQL_URL peker til GraphQL endpoint (typisk /graphql eller /query), ' +
          'ikke til playground-siden.'
      );
    }

    throw error;
  }
}

/**
 * Fetch deployments within a time range by filtering after retrieval
 * (since the Nais API has limited filtering capabilities)
 */
export async function fetchDeploymentsInRange(
  teamSlug: string,
  startDate: Date,
  endDate: Date
): Promise<NaisDeployment[]> {
  console.log('📅 Filtering deployments by date range:', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  const allDeployments = await fetchDeployments(teamSlug, 100, 100);

  const filtered = allDeployments.filter((deployment) => {
    const deploymentDate = new Date(deployment.createdAt);
    return deploymentDate >= startDate && deploymentDate <= endDate;
  });

  console.log(
    `🔍 Filtered to ${filtered.length} deployments within date range (out of ${allDeployments.length} total)`
  );

  return filtered;
}

/**
 * Helper to get date ranges for common periods
 */
export function getDateRange(
  period: 'last-month' | 'last-12-months' | 'year-2025' | 'custom',
  customStart?: Date,
  customEnd?: Date
): { startDate: Date; endDate: Date } {
  const now = new Date();

  switch (period) {
    case 'last-month': {
      const startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      return { startDate, endDate: now };
    }

    case 'last-12-months': {
      const startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      return { startDate, endDate: now };
    }

    case 'year-2025': {
      const startDate = new Date('2025-01-01T00:00:00Z');
      const endDate = new Date('2025-12-31T23:59:59Z');
      return { startDate, endDate };
    }

    case 'custom': {
      if (!customStart || !customEnd) {
        throw new Error('Custom date range requires start and end dates');
      }
      return { startDate: customStart, endDate: customEnd };
    }

    default:
      throw new Error(`Unknown period: ${period}`);
  }
}
