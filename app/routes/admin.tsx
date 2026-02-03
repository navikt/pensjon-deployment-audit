import { ArrowsCirclepathIcon, CheckmarkCircleIcon, FileTextIcon, PersonGroupIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, HGrid, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { getAllDeployments } from '~/db/deployments.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/admin'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Admin - Pensjon Deployment Audit' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)

  const allDeployments = await getAllDeployments()
  const pendingCount = allDeployments.filter(
    (d) => d.four_eyes_status === 'pending' || d.four_eyes_status === 'error',
  ).length
  return { pendingCount }
}

export default function AdminIndex() {
  const { pendingCount } = useLoaderData<typeof loader>()
  return (
    <VStack gap="space-24">
      <div>
        <Heading size="large" spacing>
          Administrasjon
        </Heading>
        <BodyShort textColor="subtle">Administrer brukere, synkronisering og systeminnstillinger.</BodyShort>
      </div>

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
                  Leveranserapport
                </Heading>
                <BodyShort textColor="subtle">
                  Generer leveranserapport for revisjon som dokumenterer four-eyes-prinsippet.
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
      </HGrid>
    </VStack>
  )
}
