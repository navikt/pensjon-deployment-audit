import { ChevronLeftIcon, ChevronRightIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, HStack, Select, TextField, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Form, Link } from 'react-router'
import { MethodTag, StatusTag } from '~/components/deployment-tags'
import type { FourEyesStatus } from '~/lib/four-eyes-status'
import { mockDeployments } from './mock-data'

type Deployment = {
  id: number
  created_at: string
  title?: string
  deployer_username: string | null
  commit_sha: string | null
  github_pr_number: number | null
  github_pr_url: string | null
  four_eyes_status: FourEyesStatus
  has_four_eyes: boolean
  detected_github_owner: string
  detected_github_repo_name: string
}

function DeploymentsPage({
  deployments,
  total,
  page,
  totalPages,
}: {
  deployments: Deployment[]
  total: number
  page: number
  totalPages: number
}) {
  return (
    <VStack gap="space-32">
      {/* Filters */}
      <Box padding="space-20" borderRadius="8" background="sunken">
        <Form method="get">
          <VStack gap="space-16">
            <HStack gap="space-16" wrap>
              <Select label="Tidsperiode" size="small" defaultValue="last-week">
                <option value="last-week">Siste 7 dager</option>
                <option value="last-month">Siste 30 dager</option>
                <option value="last-quarter">Siste kvartal</option>
                <option value="this-year">I år</option>
                <option value="all">Alle</option>
              </Select>

              <Select label="Status" size="small" defaultValue="">
                <option value="">Alle</option>
                <option value="approved">Godkjent</option>
                <option value="manually_approved">Manuelt godkjent</option>
                <option value="direct_push">Direkte push</option>
                <option value="pending">Venter</option>
                <option value="error">Feil</option>
              </Select>

              <Select label="Metode" size="small" defaultValue="">
                <option value="">Alle</option>
                <option value="pr">Pull Request</option>
                <option value="direct_push">Direct Push</option>
                <option value="legacy">Legacy</option>
              </Select>

              <TextField label="Deployer" size="small" placeholder="Søk..." />

              <TextField label="Commit SHA" size="small" placeholder="Søk..." />
            </HStack>
          </VStack>
        </Form>
      </Box>

      <BodyShort textColor="subtle">
        {total} deployment{total !== 1 ? 's' : ''} funnet
      </BodyShort>

      {/* Deployments list */}
      <div>
        {deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet med valgte filtre.</BodyShort>
          </Box>
        ) : (
          deployments.map((deployment) => (
            <Box
              key={deployment.id}
              padding="space-20"
              background="raised"
              borderColor="neutral-subtle"
              borderWidth="1"
              style={{ marginBottom: '-1px' }}
            >
              <VStack gap="space-12">
                <HStack gap="space-8" align="center" justify="space-between">
                  <HStack gap="space-8" align="center" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {new Date(deployment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </BodyShort>
                    {deployment.title && (
                      <BodyShort style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {deployment.title}
                      </BodyShort>
                    )}
                  </HStack>
                  <HStack gap="space-8" style={{ flexShrink: 0 }}>
                    <MethodTag
                      github_pr_number={deployment.github_pr_number}
                      four_eyes_status={deployment.four_eyes_status}
                    />
                    <StatusTag
                      four_eyes_status={deployment.four_eyes_status}
                      has_four_eyes={deployment.has_four_eyes}
                    />
                  </HStack>
                </HStack>

                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  <HStack gap="space-16" wrap>
                    <Detail textColor="subtle">
                      {deployment.deployer_username ? (
                        <Link to={`/users/${deployment.deployer_username}`}>{deployment.deployer_username}</Link>
                      ) : (
                        '(ukjent)'
                      )}
                    </Detail>
                    <Detail textColor="subtle">
                      {deployment.commit_sha ? (
                        <span style={{ fontFamily: 'monospace' }}>{deployment.commit_sha.substring(0, 7)}</span>
                      ) : (
                        '(ukjent)'
                      )}
                    </Detail>
                    {deployment.github_pr_number && <Detail textColor="subtle">#{deployment.github_pr_number}</Detail>}
                  </HStack>
                  <Button as={Link} to={`/deployments/${deployment.id}`} variant="tertiary" size="small">
                    Vis
                  </Button>
                </HStack>
              </VStack>
            </Box>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <HStack gap="space-16" justify="center" align="center">
          <Button variant="tertiary" size="small" icon={<ChevronLeftIcon aria-hidden />} disabled={page <= 1}>
            Forrige
          </Button>
          <BodyShort>
            Side {page} av {totalPages}
          </BodyShort>
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronRightIcon aria-hidden />}
            iconPosition="right"
            disabled={page >= totalPages}
          >
            Neste
          </Button>
        </HStack>
      )}
    </VStack>
  )
}

const meta: Meta<typeof DeploymentsPage> = {
  title: 'Pages/Deployments',
  component: DeploymentsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeploymentsPage>

const fullDeployments: Deployment[] = mockDeployments.map((d) => ({
  ...d,
  title: d.commit_message,
  deployer_username: d.deployer,
  has_four_eyes: d.four_eyes_status === 'approved',
  detected_github_owner: d.github_owner,
  detected_github_repo_name: d.github_repo_name,
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/42',
}))

export const Default: Story = {
  args: {
    deployments: fullDeployments,
    total: 42,
    page: 1,
    totalPages: 3,
  },
}

export const Empty: Story = {
  name: 'Ingen resultater',
  args: {
    deployments: [],
    total: 0,
    page: 1,
    totalPages: 0,
  },
}

export const SinglePage: Story = {
  name: 'Én side',
  args: {
    deployments: fullDeployments,
    total: 3,
    page: 1,
    totalPages: 1,
  },
}

export const MiddlePage: Story = {
  name: 'Midterste side',
  args: {
    deployments: fullDeployments,
    total: 100,
    page: 3,
    totalPages: 5,
  },
}

export const MixedStatuses: Story = {
  name: 'Blandet status',
  args: {
    deployments: [
      { ...fullDeployments[0], four_eyes_status: 'approved', has_four_eyes: true },
      { ...fullDeployments[1], four_eyes_status: 'direct_push', has_four_eyes: false },
      { ...fullDeployments[2], four_eyes_status: 'pending', has_four_eyes: false },
      {
        ...fullDeployments[0],
        id: 4,
        four_eyes_status: 'manually_approved',
        has_four_eyes: true,
        title: 'Manuelt godkjent deployment',
      },
      {
        ...fullDeployments[0],
        id: 5,
        four_eyes_status: 'error',
        has_four_eyes: false,
        title: 'Deployment med feil',
      },
    ],
    total: 5,
    page: 1,
    totalPages: 1,
  },
}
