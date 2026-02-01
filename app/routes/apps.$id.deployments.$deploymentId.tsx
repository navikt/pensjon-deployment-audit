// This route provides app-scoped deployment view with proper breadcrumbs
// Re-exports the deployment detail page with additional app context

import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import type { Route } from './+types/apps.$id.deployments.$deploymentId'

import { default as DeploymentDetail, action as deploymentAction, loader as deploymentLoader } from './deployments.$id'

export async function loader({ params, request }: Route.LoaderArgs) {
  const appId = parseInt(params.id, 10)
  if (Number.isNaN(appId)) {
    throw new Response('Invalid app ID', { status: 400 })
  }

  const app = await getMonitoredApplicationById(appId)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  // Call the original deployment loader
  const deploymentData = await deploymentLoader({
    params: { id: params.deploymentId },
    request,
  } as Parameters<typeof deploymentLoader>[0])

  // Add app context for breadcrumbs
  return {
    ...deploymentData,
    app,
    appContext: true,
  }
}

// Wrap the action to pass deploymentId as id
export async function action({ params, request }: Route.ActionArgs) {
  return deploymentAction({
    params: { id: params.deploymentId },
    request,
  } as Parameters<typeof deploymentAction>[0])
}

export default DeploymentDetail
