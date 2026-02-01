// Redirect /apps to / (homepage now includes app list)
import { redirect } from 'react-router'
import type { Route } from './+types/apps'

export function loader({ request }: Route.LoaderArgs) {
  // Preserve query parameters when redirecting
  const url = new URL(request.url)
  const search = url.search
  return redirect(`/${search}`)
}
