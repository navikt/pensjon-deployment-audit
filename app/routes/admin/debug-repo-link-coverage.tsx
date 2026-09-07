import { BodyShort, Box, Heading, Table, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/debug-repo-link-coverage'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Debug: repo-link-dekning - Admin' }]
}

interface UnlinkedApp {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  active_repo_status: string | null
  linked_repository_id: number | null
  not_found_in_nais_at: string | null
}

interface AppRepoRow {
  monitored_app_id: number
  github_owner: string
  github_repo_name: string
  status: string
  created_at: string
}

interface RecentDeployment {
  monitored_app_id: number
  nais_deployment_id: string
  created_at: string
  detected_github_owner: string | null
  detected_github_repo_name: string | null
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { rows } = await pool.query<UnlinkedApp>(`
    SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name,
           active_repo.status AS active_repo_status,
           r.id AS linked_repository_id,
           ma.not_found_in_nais_at
    FROM monitored_applications ma
    LEFT JOIN LATERAL (
      SELECT ar.status, ar.github_repo_id
      FROM application_repositories ar
      WHERE ar.monitored_app_id = ma.id AND ar.status = 'active'
      ORDER BY ar.created_at DESC, ar.id DESC
      LIMIT 1
    ) active_repo ON true
    LEFT JOIN repositories r ON r.github_repo_id = active_repo.github_repo_id
    WHERE ma.is_active = true AND r.id IS NULL
    ORDER BY ma.team_slug, ma.environment_name, ma.app_name
  `)

  const { rows: totalRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM monitored_applications WHERE is_active = true`,
  )

  const appIds = rows.map((r) => r.id)

  const { rows: repoRows } = appIds.length
    ? await pool.query<AppRepoRow>(
        `SELECT monitored_app_id, github_owner, github_repo_name, status, created_at
         FROM application_repositories
         WHERE monitored_app_id = ANY($1::int[])
         ORDER BY monitored_app_id, created_at DESC`,
        [appIds],
      )
    : { rows: [] }

  const { rows: recentDeployments } = appIds.length
    ? await pool.query<RecentDeployment>(
        `SELECT monitored_app_id, nais_deployment_id, created_at, detected_github_owner, detected_github_repo_name
         FROM deployments
         WHERE monitored_app_id = ANY($1::int[])
         ORDER BY monitored_app_id, created_at DESC`,
        [appIds],
      )
    : { rows: [] }

  return {
    rows,
    unlinkedCount: rows.length,
    totalActiveApps: Number(totalRows[0].count),
    repoRows,
    recentDeployments,
  }
}

export default function DebugRepoLinkCoveragePage() {
  const { rows, unlinkedCount, totalActiveApps, repoRows, recentDeployments } = useLoaderData<typeof loader>()

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-24">
        <div>
          <Heading level="1" size="large" spacing>
            Debug: repo-link-dekning
          </Heading>
          <BodyShort textColor="subtle">
            Midlertidig side for å sjekke hvor mange aktive applikasjoner som mangler en koblet repositories-rad (dvs.
            fortsatt avhenger av per-app fallback for audit_start_year/default_branch/implicit_approval). Fjernes etter
            bruk. {totalActiveApps - unlinkedCount} av {totalActiveApps} aktive apper er koblet. Ukoblede:{' '}
            {unlinkedCount}.
          </BodyShort>
        </div>

        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Team</Table.HeaderCell>
              <Table.HeaderCell>Miljø</Table.HeaderCell>
              <Table.HeaderCell>App</Table.HeaderCell>
              <Table.HeaderCell>Aktiv repo-status</Table.HeaderCell>
              <Table.HeaderCell>not_found_in_nais_at</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={r.id}>
                <Table.DataCell>{r.team_slug}</Table.DataCell>
                <Table.DataCell>{r.environment_name}</Table.DataCell>
                <Table.DataCell>{r.app_name}</Table.DataCell>
                <Table.DataCell>{r.active_repo_status ?? 'ingen aktiv repo-rad'}</Table.DataCell>
                <Table.DataCell>{r.not_found_in_nais_at ? String(r.not_found_in_nais_at) : '-'}</Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {rows.length === 0 && (
          <BodyShort textColor="subtle">Alle aktive apper er koblet til en repositories-rad. 🎉</BodyShort>
        )}

        {rows.length > 0 && (
          <>
            <div>
              <Heading level="2" size="small" spacing>
                Alle application_repositories-rader for de ukoblede appene
              </Heading>
              <Table size="small">
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>monitored_app_id</Table.HeaderCell>
                    <Table.HeaderCell>owner/repo</Table.HeaderCell>
                    <Table.HeaderCell>status</Table.HeaderCell>
                    <Table.HeaderCell>created_at</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {repoRows.map((r) => (
                    <Table.Row key={`${r.monitored_app_id}-${r.github_owner}-${r.github_repo_name}`}>
                      <Table.DataCell>{r.monitored_app_id}</Table.DataCell>
                      <Table.DataCell>
                        {r.github_owner}/{r.github_repo_name}
                      </Table.DataCell>
                      <Table.DataCell>{r.status}</Table.DataCell>
                      <Table.DataCell>{String(r.created_at)}</Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
              {repoRows.length === 0 && (
                <BodyShort textColor="subtle">Ingen application_repositories-rader i det hele tatt.</BodyShort>
              )}
            </div>

            <div>
              <Heading level="2" size="small" spacing>
                Siste deployments for de ukoblede appene
              </Heading>
              <Table size="small">
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>monitored_app_id</Table.HeaderCell>
                    <Table.HeaderCell>nais_deployment_id</Table.HeaderCell>
                    <Table.HeaderCell>created_at</Table.HeaderCell>
                    <Table.HeaderCell>detected_github_owner/repo</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {recentDeployments.slice(0, 20).map((d) => (
                    <Table.Row key={d.nais_deployment_id}>
                      <Table.DataCell>{d.monitored_app_id}</Table.DataCell>
                      <Table.DataCell>{d.nais_deployment_id}</Table.DataCell>
                      <Table.DataCell>{String(d.created_at)}</Table.DataCell>
                      <Table.DataCell>
                        {d.detected_github_owner ?? '-'}/{d.detected_github_repo_name ?? '-'}
                      </Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
              {recentDeployments.length === 0 && (
                <BodyShort textColor="subtle">Ingen deployments funnet for disse appene.</BodyShort>
              )}
            </div>
          </>
        )}
      </VStack>
    </Box>
  )
}
