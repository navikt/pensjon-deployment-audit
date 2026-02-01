import { pool } from './connection.server'

export interface UserMapping {
  github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
  created_at: Date
  updated_at: Date
}

// In-memory cache for user mappings
const userMappingCache = new Map<string, UserMapping | null>()

/**
 * Get user mapping by GitHub username
 */
export async function getUserMapping(githubUsername: string): Promise<UserMapping | null> {
  // Check cache first
  if (userMappingCache.has(githubUsername)) {
    return userMappingCache.get(githubUsername) || null
  }

  const result = await pool.query('SELECT * FROM user_mappings WHERE github_username = $1', [githubUsername])

  const mapping = result.rows[0] || null
  userMappingCache.set(githubUsername, mapping)
  return mapping
}

/**
 * Get multiple user mappings by GitHub usernames
 */
export async function getUserMappings(githubUsernames: string[]): Promise<Map<string, UserMapping>> {
  if (githubUsernames.length === 0) return new Map()

  // Filter out cached entries
  const uncached = githubUsernames.filter((u) => !userMappingCache.has(u))

  if (uncached.length > 0) {
    const result = await pool.query('SELECT * FROM user_mappings WHERE github_username = ANY($1)', [uncached])

    // Cache results
    for (const row of result.rows) {
      userMappingCache.set(row.github_username, row)
    }

    // Mark missing usernames as null in cache
    for (const username of uncached) {
      if (!userMappingCache.has(username)) {
        userMappingCache.set(username, null)
      }
    }
  }

  // Build result map from cache
  const mappings = new Map<string, UserMapping>()
  for (const username of githubUsernames) {
    const mapping = userMappingCache.get(username)
    if (mapping) {
      mappings.set(username, mapping)
    }
  }

  return mappings
}

/**
 * Normalize a string value - trim whitespace, return null if empty
 */
function normalize(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Normalize an email - trim, lowercase, return null if empty
 */
function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

/**
 * Create or update a user mapping
 */
export async function upsertUserMapping(params: {
  githubUsername: string
  displayName?: string | null
  navEmail?: string | null
  navIdent?: string | null
  slackMemberId?: string | null
}): Promise<UserMapping> {
  const githubUsername = normalize(params.githubUsername)
  if (!githubUsername) {
    throw new Error('GitHub username is required')
  }

  const result = await pool.query(
    `INSERT INTO user_mappings (github_username, display_name, nav_email, nav_ident, slack_member_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (github_username) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, user_mappings.display_name),
       nav_email = COALESCE(EXCLUDED.nav_email, user_mappings.nav_email),
       nav_ident = COALESCE(EXCLUDED.nav_ident, user_mappings.nav_ident),
       slack_member_id = COALESCE(EXCLUDED.slack_member_id, user_mappings.slack_member_id),
       updated_at = NOW()
     RETURNING *`,
    [
      githubUsername,
      normalize(params.displayName),
      normalizeEmail(params.navEmail),
      normalize(params.navIdent),
      normalize(params.slackMemberId),
    ],
  )

  const mapping = result.rows[0]
  userMappingCache.set(githubUsername, mapping)
  return mapping
}

/**
 * Delete a user mapping
 */
export async function deleteUserMapping(githubUsername: string): Promise<void> {
  await pool.query('DELETE FROM user_mappings WHERE github_username = $1', [githubUsername])
  userMappingCache.delete(githubUsername)
}

/**
 * Get all user mappings
 */
export async function getAllUserMappings(): Promise<UserMapping[]> {
  const result = await pool.query('SELECT * FROM user_mappings ORDER BY github_username')
  return result.rows
}

/**
 * Get GitHub usernames from deployments that don't have user mappings
 */
export async function getUnmappedUsers(): Promise<{ github_username: string; deployment_count: number }[]> {
  const result = await pool.query(`
    SELECT d.deployer_username as github_username, COUNT(*) as deployment_count
    FROM deployments d
    LEFT JOIN user_mappings um ON d.deployer_username = um.github_username
    WHERE d.deployer_username IS NOT NULL
      AND d.deployer_username != ''
      AND um.github_username IS NULL
    GROUP BY d.deployer_username
    ORDER BY github_username
  `)
  return result.rows.map((r) => ({
    github_username: r.github_username,
    deployment_count: parseInt(r.deployment_count, 10),
  }))
}

/**
 * Clear the in-memory cache
 */
export function clearUserMappingCache(): void {
  userMappingCache.clear()
}
