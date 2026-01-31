import { CheckmarkCircleIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HGrid, ProgressBar, TextField, VStack } from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, useNavigation } from 'react-router'
import { getAllDeployments } from '../db/deployments.server'
import { verifyDeploymentsFourEyes } from '../lib/sync.server'
import type { Route } from './+types/deployments.verify'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiser deployments - Pensjon Deployment Audit' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const appId = url.searchParams.get('app')

  // Get stats on unverified deployments
  const allDeployments = await getAllDeployments({
    monitored_app_id: appId ? parseInt(appId, 10) : undefined,
  })

  const pending = allDeployments.filter((d) => d.four_eyes_status === 'pending').length
  const missing = allDeployments.filter((d) => d.four_eyes_status === 'missing').length
  const error = allDeployments.filter((d) => d.four_eyes_status === 'error').length
  const needsVerification = pending + missing + error

  return {
    appId: appId ? parseInt(appId, 10) : null,
    stats: {
      total: allDeployments.length,
      needsVerification,
      pending,
      missing,
      error,
    },
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const limit = Number(formData.get('limit')) || 50
  const appId = formData.get('app_id')

  try {
    console.log(`🔍 Starting batch verification (limit: ${limit})`)

    const result = await verifyDeploymentsFourEyes({
      limit,
      monitored_app_id: appId ? parseInt(appId as string, 10) : undefined,
    })

    return {
      success: `Verifisert ${result.verified} deployments. ${result.failed > 0 ? `${result.failed} feilet.` : ''} ${result.skipped > 0 ? `${result.skipped} hoppet over.` : ''}`,
      error: null,
      result,
    }
  } catch (error) {
    console.error('Batch verification error:', error)

    if (error instanceof Error && error.message.includes('rate limit')) {
      return {
        success: null,
        error: 'GitHub rate limit nådd! Vent 1 time før du prøver igjen.',
        result: null,
      }
    }

    return {
      success: null,
      error: error instanceof Error ? error.message : 'Kunne ikke verifisere deployments',
      result: null,
    }
  }
}

export default function DeploymentsVerify({ loaderData, actionData }: Route.ComponentProps) {
  const { appId, stats } = loaderData
  const navigation = useNavigation()
  const isVerifying = navigation.state === 'submitting'

  // Simulate progress based on typical verification time
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!isVerifying) {
      setProgress(0)
      return
    }

    // Estimate: ~1 second per deployment, progress updates every second
    const formData = navigation.formData
    const limit = formData ? Number(formData.get('limit')) || 50 : 50
    const estimatedSeconds = limit * 1 // 1 second per deployment estimate

    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 1
      const percentage = Math.min((elapsed / estimatedSeconds) * 100, 95) // Cap at 95% until done
      setProgress(percentage)
    }, 1000)

    return () => clearInterval(interval)
  }, [isVerifying, navigation.formData])

  return (
    <VStack gap="space-32">
      <div>
        <Heading size="large" spacing>
          Batch GitHub-verifisering{appId ? ' for applikasjon' : ''}
        </Heading>
        <BodyShort textColor="subtle">
          Verifiser four-eyes status for flere deployments samtidig. Dette kaller GitHub API og bruker rate limit.
        </BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
          {actionData.result && (
            <BodyShort size="small">
              Verifisert: {actionData.result.verified} • Feilet: {actionData.result.failed} • Hoppet over:{' '}
              {actionData.result.skipped}
            </BodyShort>
          )}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small">Status</Heading>
          <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
            <Box padding="space-16" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Totalt deployments
                </BodyShort>
                <Heading size="medium">{stats.total}</Heading>
              </VStack>
            </Box>
            <Box padding="space-16" borderRadius="8" background="sunken" data-color="warning">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Trenger verifisering
                </BodyShort>
                <Heading size="medium">{stats.needsVerification}</Heading>
              </VStack>
            </Box>
            <Box padding="space-16" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Pending
                </BodyShort>
                <Heading size="medium">{stats.pending}</Heading>
              </VStack>
            </Box>
            <Box padding="space-16" borderRadius="8" background="sunken" data-color="danger">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Error
                </BodyShort>
                <Heading size="medium">{stats.error}</Heading>
              </VStack>
            </Box>
          </HGrid>
        </VStack>
      </Box>

      <Alert variant="info">
        <Heading size="small" spacing>
          Om GitHub Rate Limits
        </Heading>
        <BodyShort>
          GitHub har en rate limit på 5000 requests per time for autentiserte requests. Hver verifisering bruker 2-3
          requests. Hvis du når limit, må du vente 1 time.
        </BodyShort>
      </Alert>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <Form method="post">
          <VStack gap="space-24">
            {appId && <input type="hidden" name="app_id" value={appId} />}
            <TextField
              name="limit"
              label="Antall deployments å verifisere"
              description="Maks antall som verifiseres i denne kjøringen"
              defaultValue="50"
              type="number"
              min="1"
              max="500"
              style={{ maxWidth: '300px' }}
            />

            <div>
              <Button
                type="submit"
                icon={<CheckmarkCircleIcon aria-hidden />}
                disabled={isVerifying || stats.needsVerification === 0}
              >
                {isVerifying ? 'Verifiserer...' : 'Start verifisering'}
              </Button>
            </div>
          </VStack>
        </Form>
      </Box>

      {isVerifying && (
        <Box padding="space-32" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16" align="center">
            <div style={{ width: '100%', maxWidth: '600px' }}>
              <ProgressBar value={progress} size="medium" aria-label="Verifiserings-fremdrift" />
            </div>
            <BodyShort textColor="subtle">Verifiserer deployments... {Math.round(progress)}%</BodyShort>
            <BodyShort size="small" textColor="subtle">
              Dette kan ta litt tid. Ikke lukk vinduet.
            </BodyShort>
          </VStack>
        </Box>
      )}
    </VStack>
  )
}
