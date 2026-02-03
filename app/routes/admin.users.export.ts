import type { LoaderFunctionArgs } from 'react-router'
import { getAllUserMappings } from '~/db/user-mappings.server'
import { requireAdmin } from '~/lib/auth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  requireAdmin(request)

  const mappings = await getAllUserMappings()

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    mappings: mappings.map((m) => ({
      github_username: m.github_username,
      display_name: m.display_name,
      nav_email: m.nav_email,
      nav_ident: m.nav_ident,
      slack_member_id: m.slack_member_id,
    })),
  }

  const json = JSON.stringify(exportData, null, 2)

  return new Response(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="user-mappings-${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}
