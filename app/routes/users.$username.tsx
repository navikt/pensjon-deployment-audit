import { ExternalLinkIcon, PlusIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  HStack,
  Modal,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef } from 'react'
import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
} from 'react-router'
import { getDeploymentCountByDeployer, getDeploymentsByDeployer } from '~/db/deployments.server'
import { getUserMapping, upsertUserMapping } from '~/db/user-mappings.server'
import styles from '~/styles/common.module.css'

export function meta({ data }: { data: { username: string } }) {
  return [{ title: `${data?.username || 'Bruker'} - Deployment Audit` }]
}

export async function loader({ params }: LoaderFunctionArgs) {
  const username = params.username
  if (!username) {
    throw new Response('Username required', { status: 400 })
  }

  const [mapping, deploymentCount, recentDeployments] = await Promise.all([
    getUserMapping(username),
    getDeploymentCountByDeployer(username),
    getDeploymentsByDeployer(username, 5),
  ])

  return {
    username,
    mapping,
    deploymentCount,
    recentDeployments,
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'create-mapping') {
    const githubUsername = formData.get('github_username') as string
    const navEmail = (formData.get('nav_email') as string) || null
    const navIdent = (formData.get('nav_ident') as string) || null

    const fieldErrors: { nav_email?: string; nav_ident?: string } = {}

    if (!githubUsername) {
      return { error: 'GitHub brukernavn er påkrevd' }
    }

    // Validate email format
    if (navEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(navEmail)) {
      fieldErrors.nav_email = 'Ugyldig e-postformat'
    }

    // Validate Nav-ident format (one letter followed by 6 digits)
    if (navIdent && !/^[a-zA-Z]\d{6}$/.test(navIdent)) {
      fieldErrors.nav_ident = 'Må være én bokstav etterfulgt av 6 siffer (f.eks. A123456)'
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors }
    }

    await upsertUserMapping({
      githubUsername,
      displayName: (formData.get('display_name') as string) || null,
      navEmail,
      navIdent,
      slackMemberId: (formData.get('slack_member_id') as string) || null,
    })
    return { success: true }
  }

  return { error: 'Ukjent handling' }
}

export default function UserPage() {
  const { username, mapping, deploymentCount, recentDeployments } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'
  const modalRef = useRef<HTMLDialogElement>(null)

  // Close modal when action succeeds
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      modalRef.current?.close()
    }
  }, [actionData, navigation.state])

  const formatDate = (date: string | Date) => {
    const d = new Date(date)
    return d.toLocaleDateString('nb-NO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <VStack gap="space-32">
      {/* Header */}
      <div>
        <Heading size="large">{username}</Heading>
        {mapping?.display_name && <BodyShort textColor="subtle">{mapping.display_name}</BodyShort>}
      </div>

      {/* Stats and links */}
      <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">Deployments</Detail>
            <Heading size="medium">{deploymentCount}</Heading>
          </VStack>
        </Box>

        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">GitHub</Detail>
            <AkselLink href={`https://github.com/${username}`} target="_blank">
              {username} <ExternalLinkIcon aria-hidden />
            </AkselLink>
          </VStack>
        </Box>

        {mapping?.nav_ident && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Teamkatalogen</Detail>
              <AkselLink href={`https://teamkatalog.nav.no/resource/${mapping.nav_ident}`} target="_blank">
                {mapping.nav_ident} <ExternalLinkIcon aria-hidden />
              </AkselLink>
            </VStack>
          </Box>
        )}

        {mapping?.slack_member_id && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Slack</Detail>
              <AkselLink href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`} target="_blank">
                Åpne i Slack <ExternalLinkIcon aria-hidden />
              </AkselLink>
            </VStack>
          </Box>
        )}
      </HGrid>

      {/* No mapping warning */}
      {!mapping && (
        <Alert variant="warning">
          <HStack gap="space-16" align="center" justify="space-between" wrap>
            <BodyShort>Ingen brukermapping funnet for denne brukeren.</BodyShort>
            <Button
              variant="secondary"
              size="small"
              icon={<PlusIcon aria-hidden />}
              onClick={() => modalRef.current?.showModal()}
            >
              Opprett mapping
            </Button>
          </HStack>
        </Alert>
      )}

      {/* Details (if mapping exists) */}
      {mapping && (
        <Box padding="space-20" borderRadius="8" background="sunken">
          <VStack gap="space-12">
            <Heading size="small">Detaljer</Heading>
            <VStack gap="space-8">
              {mapping.nav_email && (
                <HStack gap="space-8">
                  <Detail textColor="subtle" style={{ minWidth: '80px' }}>
                    E-post:
                  </Detail>
                  <BodyShort>{mapping.nav_email}</BodyShort>
                </HStack>
              )}
              {mapping.nav_ident && (
                <HStack gap="space-8">
                  <Detail textColor="subtle" style={{ minWidth: '80px' }}>
                    Nav-ident:
                  </Detail>
                  <BodyShort>{mapping.nav_ident}</BodyShort>
                </HStack>
              )}
              {mapping.slack_member_id && (
                <HStack gap="space-8">
                  <Detail textColor="subtle" style={{ minWidth: '80px' }}>
                    Slack ID:
                  </Detail>
                  <BodyShort>{mapping.slack_member_id}</BodyShort>
                </HStack>
              )}
              {!mapping.nav_email && !mapping.nav_ident && !mapping.slack_member_id && (
                <BodyShort textColor="subtle">Ingen tilleggsinformasjon registrert.</BodyShort>
              )}
            </VStack>
          </VStack>
        </Box>
      )}

      {/* Recent deployments */}
      <VStack gap="space-16">
        <Heading size="small">Siste deployments ({deploymentCount})</Heading>

        {recentDeployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet for denne brukeren.</BodyShort>
          </Box>
        ) : (
          <div>
            {recentDeployments.map((deployment) => (
              <Box key={deployment.id} padding="space-16" background="raised" className={styles.stackedListItem}>
                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  <HStack gap="space-12" align="center">
                    <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(deployment.created_at)}
                    </BodyShort>
                    <Link
                      to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}`}
                    >
                      <BodyShort>{deployment.app_name}</BodyShort>
                    </Link>
                  </HStack>
                  <Detail textColor="subtle">{deployment.environment_name}</Detail>
                </HStack>
              </Box>
            ))}
          </div>
        )}
      </VStack>

      {/* Create mapping modal */}
      <Modal ref={modalRef} header={{ heading: 'Opprett brukermapping' }}>
        <Modal.Body>
          <Form method="post" id="create-mapping-form">
            <input type="hidden" name="intent" value="create-mapping" />
            <input type="hidden" name="github_username" value={username} />
            <VStack gap="space-16">
              <TextField label="GitHub brukernavn" value={username} disabled />
              <TextField label="Navn" name="display_name" />
              <TextField label="Nav e-post" name="nav_email" error={actionData?.fieldErrors?.nav_email} />
              <TextField
                label="Nav-ident"
                name="nav_ident"
                description="Format: én bokstav etterfulgt av 6 siffer (f.eks. A123456)"
                error={actionData?.fieldErrors?.nav_ident}
              />
              <TextField label="Slack member ID" name="slack_member_id" />
            </VStack>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form="create-mapping-form" loading={isSubmitting}>
            Lagre
          </Button>
          <Button variant="secondary" onClick={() => modalRef.current?.close()}>
            Avbryt
          </Button>
        </Modal.Footer>
      </Modal>
    </VStack>
  )
}
