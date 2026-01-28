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

export interface TeamResponse {
  team: {
    deployments: {
      nodes: NaisDeployment[];
      pageInfo: PageInfo;
    };
  };
}

const DEPLOYMENTS_QUERY = `
  query($team: Slug!, $depsFirst: Int!, $depsAfter: Cursor) {
    team(slug: $team) {
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
`;

export async function fetchDeployments(
  teamSlug: string,
  deploymentsFirst: number = 1000
): Promise<NaisDeployment[]> {
  const client = getNaisClient();

  console.log('📡 Fetching deployments from Nais API:', {
    team: teamSlug,
    deploymentsFirst,
  });

  const allDeployments: NaisDeployment[] = [];
  let depsAfter: string | undefined = undefined;
  let pageCount = 0;
  let hasMoreDeployments = true;

  try {
    // Paginate through deployments
    while (hasMoreDeployments) {
      pageCount++;
      console.log(
        `📄 Fetching deployments page ${pageCount}${depsAfter ? ` (cursor: ${depsAfter.substring(0, 20)}...)` : ''}`
      );

      const response: TeamResponse = await client.request<TeamResponse>(DEPLOYMENTS_QUERY, {
        team: teamSlug,
        depsFirst: deploymentsFirst,
        depsAfter: depsAfter,
      });

      if (!response.team) {
        console.warn('⚠️  No team data in response - team might not exist or no access');
        break;
      }

      if (!response.team.deployments) {
        console.warn('⚠️  No deployments data in response');
        break;
      }

      const deploymentsCount = response.team.deployments.nodes.length;
      console.log(`📦 Received ${deploymentsCount} deployments on page ${pageCount}`);

      allDeployments.push(...response.team.deployments.nodes);

      // Check if there are more pages
      depsAfter = response.team.deployments.pageInfo?.endCursor;
      hasMoreDeployments = response.team.deployments.pageInfo?.hasNextPage || false;
      
      if (hasMoreDeployments) {
        console.log(`  ➡️  More deployments available, fetching next page...`);
      }
    }

    console.log(`✨ Total deployments fetched: ${allDeployments.length} (from ${pageCount} page(s))`);
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

  const allDeployments = await fetchDeployments(teamSlug, 1000);

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
