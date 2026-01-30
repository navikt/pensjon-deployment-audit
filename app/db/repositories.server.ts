import { query } from './connection.server'

export interface Repository {
  id: number
  github_owner: string
  github_repo_name: string
  nais_team_slug: string
  nais_environment_name: string
  created_at: Date
  updated_at: Date
}

export interface CreateRepositoryParams {
  github_owner?: string
  github_repo_name: string
  nais_team_slug: string
  nais_environment_name: string
}

export interface UpdateRepositoryParams {
  nais_team_slug?: string
  nais_environment_name?: string
}

export async function getAllRepositories(): Promise<Repository[]> {
  const result = await query<Repository>('SELECT * FROM repositories ORDER BY created_at DESC')
  return result.rows
}

export async function getRepositoryById(id: number): Promise<Repository | null> {
  const result = await query<Repository>('SELECT * FROM repositories WHERE id = $1', [id])
  return result.rows[0] || null
}

export async function createRepository(params: CreateRepositoryParams): Promise<Repository> {
  const { github_owner = 'navikt', github_repo_name, nais_team_slug, nais_environment_name } = params

  const result = await query<Repository>(
    `INSERT INTO repositories (github_owner, github_repo_name, nais_team_slug, nais_environment_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (github_owner, github_repo_name, nais_team_slug, nais_environment_name)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [github_owner, github_repo_name, nais_team_slug, nais_environment_name],
  )

  return result.rows[0]
}

export async function updateRepository(id: number, params: UpdateRepositoryParams): Promise<Repository | null> {
  const updates: string[] = []
  const values: any[] = []
  let paramIndex = 1

  if (params.nais_team_slug !== undefined) {
    updates.push(`nais_team_slug = $${paramIndex++}`)
    values.push(params.nais_team_slug)
  }

  if (params.nais_environment_name !== undefined) {
    updates.push(`nais_environment_name = $${paramIndex++}`)
    values.push(params.nais_environment_name)
  }

  if (updates.length === 0) {
    return getRepositoryById(id)
  }

  values.push(id)

  const result = await query<Repository>(
    `UPDATE repositories SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramIndex}
     RETURNING *`,
    values,
  )

  return result.rows[0] || null
}

export async function deleteRepository(id: number): Promise<boolean> {
  const result = await query('DELETE FROM repositories WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
