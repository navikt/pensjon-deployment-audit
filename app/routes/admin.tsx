import {
  ArchiveIcon,
  ArrowsCirclepathIcon,
  CheckmarkCircleIcon,
  FileTextIcon,
  PersonGroupIcon,
} from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HGrid, VStack } from '@navikt/ds-react'
import { Form, Link, useActionData, useLoaderData } from 'react-router'
import { resolveAlertsForLegacyDeployments } from '~/db/alerts.server'
import { getAllDeployments } from '~/db/deployments.server'
import type { Route } from './+types/admin'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Admin - Pensjon Deployment Audit' }]
}

export async function loader() {
  const allDeployments = await getAllDeployments()
  const pendingCount = allDeployments.filter(
    (d) => d.four_eyes_status === 'pending' || d.four_eyes_status === 'error',
  ).length
  return { pendingCount }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'resolve-legacy-alerts') {
    try {
      const result = await resolveAlertsForLegacyDeployments()
      return {
        success: `Oppdatert ${result.deploymentsUpdated} deployments til legacy status og løst ${result.alertsResolved} varsler.`,
        error: null,
      }
    } catch (error) {
      console.error('Resolve legacy alerts error:', error)
      return {
        success: null,
        error: error instanceof Error ? error.message : 'Kunne ikke løse legacy alerts',
      }
    }
  }

  return { success: null, error: 'Ugyldig handling' }
}

export default function AdminIndex() {
  const { pendingCount } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  return (
    <VStack gap="space-24">
      <div>
        <Heading size="large" spacing>
          Administrasjon
        </Heading>
        <BodyShort textColor="subtle">Administrer brukere, synkronisering og systeminnstillinger.</BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      <HGrid gap="space-16" columns={{ xs: 1, md: 2, lg: 3 }}>
        <Link to="/deployments/verify" style={{ textDecoration: 'none' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor={pendingCount > 0 ? 'warning-subtle' : 'neutral-subtle'}
            borderWidth="1"
            data-color={pendingCount > 0 ? 'warning' : undefined}
            className="admin-card"
          >
            <VStack gap="space-12">
              <CheckmarkCircleIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading size="small" spacing>
                  GitHub-verifisering
                </Heading>
                <BodyShort textColor="subtle">
                  {pendingCount > 0
                    ? `${pendingCount} deployments venter på verifisering.`
                    : 'Verifiser deployments mot GitHub.'}
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/audit-reports" style={{ textDecoration: 'none' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
          >
            <VStack gap="space-12">
              <FileTextIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading size="small" spacing>
                  Revisjonsbevis
                </Heading>
                <BodyShort textColor="subtle">
                  Generer revisjonsbevis for Riksrevisjonen som dokumenterer four-eyes-prinsippet.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/users" style={{ textDecoration: 'none' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
          >
            <VStack gap="space-12">
              <PersonGroupIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading size="small" spacing>
                  Brukermappinger
                </Heading>
                <BodyShort textColor="subtle">
                  Koble GitHub-brukernavn til NAV-identiteter for bedre sporbarhet.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Link to="/admin/sync-jobs" style={{ textDecoration: 'none' }}>
          <Box
            padding="space-24"
            borderRadius="8"
            background="raised"
            borderColor="neutral-subtle"
            borderWidth="1"
            className="admin-card"
          >
            <VStack gap="space-12">
              <ArrowsCirclepathIcon fontSize="2rem" aria-hidden />
              <div>
                <Heading size="small" spacing>
                  Sync Jobs
                </Heading>
                <BodyShort textColor="subtle">
                  Overvåk synkroniseringsjobber og distribuert låsing mellom podder.
                </BodyShort>
              </div>
            </VStack>
          </Box>
        </Link>

        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-12">
            <ArchiveIcon fontSize="2rem" aria-hidden />
            <div>
              <Heading size="small" spacing>
                Legacy-håndtering
              </Heading>
              <BodyShort textColor="subtle">Oppdater gamle deployments uten commit SHA til legacy status.</BodyShort>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="resolve-legacy-alerts" />
              <Button type="submit" variant="secondary" size="small">
                Recheck legacy
              </Button>
            </Form>
          </VStack>
        </Box>
      </HGrid>
    </VStack>
  )
}
