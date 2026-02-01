import type { LoaderFunctionArgs } from 'react-router'
import { searchDeployments } from '~/db/deployments.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q') || ''

  if (!query.trim()) {
    return Response.json({ results: [] })
  }

  const results = await searchDeployments(query, 10)
  return Response.json({ results })
}
