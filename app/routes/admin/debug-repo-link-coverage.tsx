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
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { rows } = await pool.query<UnlinkedApp>(`
    SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name,
           active_repo.status AS active_repo_status,
           r.id AS linked_repository_id
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

  return { rows, unlinkedCount: rows.length, totalActiveApps: Number(totalRows[0].count) }
}

export default function DebugRepoLinkCoveragePage() {
  const { rows, unlinkedCount, totalActiveApps } = useLoaderData<typeof loader>()

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
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={r.id}>
                <Table.DataCell>{r.team_slug}</Table.DataCell>
                <Table.DataCell>{r.environment_name}</Table.DataCell>
                <Table.DataCell>{r.app_name}</Table.DataCell>
                <Table.DataCell>{r.active_repo_status ?? 'ingen aktiv repo-rad'}</Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {rows.length === 0 && (
          <BodyShort textColor="subtle">Alle aktive apper er koblet til en repositories-rad. 🎉</BodyShort>
        )}
      </VStack>
    </Box>
  )
}
