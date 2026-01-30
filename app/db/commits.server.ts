import { pool } from './connection.server'

export interface Commit {
  sha: string
  repo_owner: string
  repo_name: string
  author_username: string | null
  author_date: Date | null
  committer_date: Date | null
  message: string | null
  parent_shas: string[]
  original_pr_number: number | null
  original_pr_title: string | null
  original_pr_url: string | null
  pr_approved: boolean | null
  pr_approval_reason: string | null
  is_merge_commit: boolean
  html_url: string | null
  created_at: Date
  updated_at: Date
}

export interface UpsertCommitParams {
  sha: string
  repoOwner: string
  repoName: string
  authorUsername?: string | null
  authorDate?: Date | null
  committerDate?: Date | null
  message?: string | null
  parentShas?: string[]
  originalPrNumber?: number | null
  originalPrTitle?: string | null
  originalPrUrl?: string | null
  prApproved?: boolean | null
  prApprovalReason?: string | null
  isMergeCommit?: boolean
  htmlUrl?: string | null
}

/**
 * Upsert a commit into the database
 */
export async function upsertCommit(params: UpsertCommitParams): Promise<Commit> {
  const result = await pool.query(
    `INSERT INTO commits (
      sha, repo_owner, repo_name, author_username, author_date, committer_date,
      message, parent_shas, original_pr_number, original_pr_title, original_pr_url,
      pr_approved, pr_approval_reason, is_merge_commit, html_url, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
    ON CONFLICT (repo_owner, repo_name, sha) DO UPDATE SET
      author_username = COALESCE(EXCLUDED.author_username, commits.author_username),
      author_date = COALESCE(EXCLUDED.author_date, commits.author_date),
      committer_date = COALESCE(EXCLUDED.committer_date, commits.committer_date),
      message = COALESCE(EXCLUDED.message, commits.message),
      parent_shas = COALESCE(EXCLUDED.parent_shas, commits.parent_shas),
      original_pr_number = COALESCE(EXCLUDED.original_pr_number, commits.original_pr_number),
      original_pr_title = COALESCE(EXCLUDED.original_pr_title, commits.original_pr_title),
      original_pr_url = COALESCE(EXCLUDED.original_pr_url, commits.original_pr_url),
      pr_approved = COALESCE(EXCLUDED.pr_approved, commits.pr_approved),
      pr_approval_reason = COALESCE(EXCLUDED.pr_approval_reason, commits.pr_approval_reason),
      is_merge_commit = COALESCE(EXCLUDED.is_merge_commit, commits.is_merge_commit),
      html_url = COALESCE(EXCLUDED.html_url, commits.html_url),
      updated_at = NOW()
    RETURNING *`,
    [
      params.sha,
      params.repoOwner,
      params.repoName,
      params.authorUsername ?? null,
      params.authorDate ?? null,
      params.committerDate ?? null,
      params.message ?? null,
      JSON.stringify(params.parentShas ?? []),
      params.originalPrNumber ?? null,
      params.originalPrTitle ?? null,
      params.originalPrUrl ?? null,
      params.prApproved ?? null,
      params.prApprovalReason ?? null,
      params.isMergeCommit ?? false,
      params.htmlUrl ?? null,
    ],
  )

  return result.rows[0]
}

/**
 * Batch upsert multiple commits
 */
export async function upsertCommits(commits: UpsertCommitParams[]): Promise<number> {
  if (commits.length === 0) return 0

  // Use a transaction for batch insert
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const commit of commits) {
      await client.query(
        `INSERT INTO commits (
          sha, repo_owner, repo_name, author_username, author_date, committer_date,
          message, parent_shas, original_pr_number, original_pr_title, original_pr_url,
          pr_approved, pr_approval_reason, is_merge_commit, html_url, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (repo_owner, repo_name, sha) DO UPDATE SET
          author_username = COALESCE(EXCLUDED.author_username, commits.author_username),
          author_date = COALESCE(EXCLUDED.author_date, commits.author_date),
          committer_date = COALESCE(EXCLUDED.committer_date, commits.committer_date),
          message = COALESCE(EXCLUDED.message, commits.message),
          parent_shas = COALESCE(EXCLUDED.parent_shas, commits.parent_shas),
          original_pr_number = COALESCE(EXCLUDED.original_pr_number, commits.original_pr_number),
          original_pr_title = COALESCE(EXCLUDED.original_pr_title, commits.original_pr_title),
          original_pr_url = COALESCE(EXCLUDED.original_pr_url, commits.original_pr_url),
          pr_approved = COALESCE(EXCLUDED.pr_approved, commits.pr_approved),
          pr_approval_reason = COALESCE(EXCLUDED.pr_approval_reason, commits.pr_approval_reason),
          is_merge_commit = COALESCE(EXCLUDED.is_merge_commit, commits.is_merge_commit),
          html_url = COALESCE(EXCLUDED.html_url, commits.html_url),
          updated_at = NOW()`,
        [
          commit.sha,
          commit.repoOwner,
          commit.repoName,
          commit.authorUsername ?? null,
          commit.authorDate ?? null,
          commit.committerDate ?? null,
          commit.message ?? null,
          JSON.stringify(commit.parentShas ?? []),
          commit.originalPrNumber ?? null,
          commit.originalPrTitle ?? null,
          commit.originalPrUrl ?? null,
          commit.prApproved ?? null,
          commit.prApprovalReason ?? null,
          commit.isMergeCommit ?? false,
          commit.htmlUrl ?? null,
        ],
      )
    }

    await client.query('COMMIT')
    return commits.length
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Get a commit by SHA
 */
export async function getCommit(repoOwner: string, repoName: string, sha: string): Promise<Commit | null> {
  const result = await pool.query(`SELECT * FROM commits WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3`, [
    repoOwner,
    repoName,
    sha,
  ])
  return result.rows[0] || null
}

/**
 * Get commits that need PR verification (no pr_approved value yet)
 */
export async function getCommitsNeedingVerification(
  repoOwner: string,
  repoName: string,
  limit: number = 100,
): Promise<Commit[]> {
  const result = await pool.query(
    `SELECT * FROM commits 
     WHERE repo_owner = $1 AND repo_name = $2 
       AND pr_approved IS NULL
       AND is_merge_commit = false
     ORDER BY committer_date DESC
     LIMIT $3`,
    [repoOwner, repoName, limit],
  )
  return result.rows
}

/**
 * Update PR verification result for a commit
 */
export async function updateCommitPrVerification(
  repoOwner: string,
  repoName: string,
  sha: string,
  prNumber: number | null,
  prTitle: string | null,
  prUrl: string | null,
  approved: boolean,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE commits SET
      original_pr_number = $4,
      original_pr_title = $5,
      original_pr_url = $6,
      pr_approved = $7,
      pr_approval_reason = $8,
      updated_at = NOW()
     WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3`,
    [repoOwner, repoName, sha, prNumber, prTitle, prUrl, approved, reason],
  )
}

/**
 * Find commits between two SHAs using local data
 * Returns commits that are reachable from headSha but not from baseSha
 * This uses a graph traversal via parent_shas
 */
export async function findCommitsBetween(
  repoOwner: string,
  repoName: string,
  baseSha: string,
  headSha: string,
): Promise<Commit[]> {
  // Use a recursive CTE to traverse the commit graph
  const result = await pool.query(
    `WITH RECURSIVE commit_chain AS (
      -- Start from head commit
      SELECT c.*, 0 as depth
      FROM commits c
      WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3
      
      UNION ALL
      
      -- Traverse to parent commits
      SELECT c.*, cc.depth + 1
      FROM commits c
      JOIN commit_chain cc ON c.sha = ANY(
        SELECT jsonb_array_elements_text(cc.parent_shas)
      )
      WHERE c.repo_owner = $1 AND c.repo_name = $2
        AND c.sha != $4  -- Stop when we reach base
        AND cc.depth < 1000  -- Safety limit
    )
    SELECT DISTINCT ON (sha) *
    FROM commit_chain
    WHERE sha != $4  -- Exclude base commit
    ORDER BY sha, depth`,
    [repoOwner, repoName, headSha, baseSha],
  )

  return result.rows
}

/**
 * Find unverified commits between two deployment SHAs
 * Returns commits that either have no PR or have unapproved PR
 */
export async function findUnverifiedCommitsBetween(
  repoOwner: string,
  repoName: string,
  baseSha: string,
  headSha: string,
): Promise<Commit[]> {
  const commits = await findCommitsBetween(repoOwner, repoName, baseSha, headSha)

  // Filter to unverified commits (excluding merge commits)
  return commits.filter((c) => !c.is_merge_commit && (c.pr_approved === null || c.pr_approved === false))
}

/**
 * Check if we have commits cached for a range
 */
export async function hasCommitsCached(repoOwner: string, repoName: string, sha: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM commits WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3 LIMIT 1`,
    [repoOwner, repoName, sha],
  )
  return result.rows.length > 0
}

/**
 * Get commit count for a repo
 */
export async function getCommitCount(repoOwner: string, repoName: string): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*) FROM commits WHERE repo_owner = $1 AND repo_name = $2`, [
    repoOwner,
    repoName,
  ])
  return parseInt(result.rows[0].count, 10)
}
