import { ChevronLeftIcon, ChevronRightIcon } from '@navikt/aksel-icons'
import {
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Select,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { Form, Link, type LoaderFunctionArgs, useLoaderData, useSearchParams } from 'react-router'
import { getDeploymentsPaginated, type DeploymentFilters } from '~/db/deployments.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/apps.$id.deployments'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Deployments - ${data.app.app_name}` : 'Deployments' }]
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = parseInt(params.id || '', 10)
  if (Number.isNaN(id)) {
    throw new Response('Invalid app ID', { status: 400 })
  }

  const app = await getMonitoredApplicationById(id)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const period = url.searchParams.get('period') || undefined

  // Calculate date range based on period
  let start_date: Date | undefined
  let end_date: Date | undefined
  const now = new Date()

  if (period === 'week') {
    start_date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (period === 'month') {
    start_date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (period === '3months') {
    start_date = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  }

  const filters: DeploymentFilters = {
    monitored_app_id: id,
    page,
    per_page: 20,
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    deployer_username: deployer,
    commit_sha: sha,
    start_date,
    end_date,
  }

  const result = await getDeploymentsPaginated(filters)

  return {
    app,
    ...result,
  }
}

function getMethodTag(deployment: {
  github_pr_number: number | null
  four_eyes_status: string
}) {
  if (deployment.github_pr_number) {
    return <Tag variant="info" size="small">Pull Request</Tag>
  }
  if (deployment.four_eyes_status === 'legacy') {
    return <Tag variant="neutral" size="small">Legacy</Tag>
  }
  return <Tag variant="warning" size="small">Direct Push</Tag>
}

function getStatusTag(deployment: { four_eyes_status: string; has_four_eyes: boolean }) {
  if (deployment.has_four_eyes) {
    return <Tag variant="success" size="small">Godkjent</Tag>
  }
  switch (deployment.four_eyes_status) {
    case 'pending':
      return <Tag variant="neutral" size="small">Venter</Tag>
    case 'direct_push':
    case 'unverified_commits':
      return <Tag variant="warning" size="small">Ikke godkjent</Tag>
    case 'error':
    case 'missing':
      return <Tag variant="error" size="small">Feil</Tag>
    default:
      return <Tag variant="neutral" size="small">{deployment.four_eyes_status}</Tag>
  }
}

export default function AppDeployments() {
  const { app, deployments, total, page, per_page, total_pages } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()

  const currentStatus = searchParams.get('status') || ''
  const currentMethod = searchParams.get('method') || ''
  const currentDeployer = searchParams.get('deployer') || ''
  const currentSha = searchParams.get('sha') || ''
  const currentPeriod = searchParams.get('period') || ''

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    newParams.set('page', '1') // Reset to page 1 when filtering
    setSearchParams(newParams)
  }

  const goToPage = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', String(newPage))
    setSearchParams(newParams)
  }

  return (
    <div className={styles.pageContainer}>
      <VStack gap="space-24">
        {/* Header */}
        <div>
          <Detail>
            <Link to="/apps">Applikasjoner</Link> / <Link to={`/apps/${app.id}`}>{app.app_name}</Link> / Deployments
          </Detail>
          <Heading size="large" spacing>
            Deployments for {app.app_name}
          </Heading>
          <BodyShort className={styles.textSubtle}>
            {total} deployment{total !== 1 ? 's' : ''} totalt
          </BodyShort>
        </div>

        {/* Filters */}
        <Box padding="space-16" borderWidth="1" borderRadius="8" background="neutral-soft">
          <Form method="get">
            <VStack gap="space-16">
              <HStack gap="space-16" wrap>
                <Select
                  label="Status"
                  size="small"
                  value={currentStatus}
                  onChange={(e) => updateFilter('status', e.target.value)}
                  style={{ minWidth: '150px' }}
                >
                  <option value="">Alle</option>
                  <option value="approved">Godkjent</option>
                  <option value="manually_approved">Manuelt godkjent</option>
                  <option value="pending">Venter</option>
                  <option value="direct_push">Direct push</option>
                  <option value="unverified_commits">Uverifiserte commits</option>
                  <option value="legacy">Legacy</option>
                  <option value="error">Feil</option>
                </Select>

                <Select
                  label="Metode"
                  size="small"
                  value={currentMethod}
                  onChange={(e) => updateFilter('method', e.target.value)}
                  style={{ minWidth: '150px' }}
                >
                  <option value="">Alle</option>
                  <option value="pr">Pull Request</option>
                  <option value="direct_push">Direct Push</option>
                  <option value="legacy">Legacy</option>
                </Select>

                <Select
                  label="Periode"
                  size="small"
                  value={currentPeriod}
                  onChange={(e) => updateFilter('period', e.target.value)}
                  style={{ minWidth: '150px' }}
                >
                  <option value="">Alle</option>
                  <option value="week">Siste uke</option>
                  <option value="month">Siste måned</option>
                  <option value="3months">Siste 3 måneder</option>
                </Select>

                <TextField
                  label="Deployer"
                  size="small"
                  value={currentDeployer}
                  onChange={(e) => updateFilter('deployer', e.target.value)}
                  placeholder="Søk..."
                  style={{ minWidth: '150px' }}
                />

                <TextField
                  label="Commit SHA"
                  size="small"
                  value={currentSha}
                  onChange={(e) => updateFilter('sha', e.target.value)}
                  placeholder="Søk..."
                  style={{ minWidth: '150px' }}
                />
              </HStack>
            </VStack>
          </Form>
        </Box>

        {/* Deployments list */}
        <VStack gap="space-12">
          {deployments.length === 0 ? (
            <Box padding="space-24" borderWidth="1" borderRadius="8">
              <BodyShort>Ingen deployments funnet med valgte filtre.</BodyShort>
            </Box>
          ) : (
            deployments.map((deployment) => (
              <Box
                key={deployment.id}
                padding="space-16"
                borderWidth="1"
                borderRadius="8"
                background="raised"
              >
                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  {/* Left side: Time and info */}
                  <VStack gap="space-4" style={{ flex: 1, minWidth: '200px' }}>
                    <HStack gap="space-8" align="center" wrap>
                      <BodyShort weight="semibold">
                        {new Date(deployment.created_at).toLocaleString('no-NO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </BodyShort>
                      {getMethodTag(deployment)}
                      {getStatusTag(deployment)}
                    </HStack>
                    {deployment.title && (
                      <BodyShort>{deployment.title}</BodyShort>
                    )}
                    <HStack gap="space-16" wrap>
                      <Detail>
                        Deployer:{' '}
                        {deployment.deployer_username ? (
                          <a
                            href={`https://github.com/${deployment.deployer_username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {deployment.deployer_username}
                          </a>
                        ) : (
                          '(ukjent)'
                        )}
                      </Detail>
                      <Detail>
                        Commit:{' '}
                        {deployment.commit_sha ? (
                          <a
                            href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontFamily: 'monospace' }}
                          >
                            {deployment.commit_sha.substring(0, 7)}
                          </a>
                        ) : (
                          '(ukjent)'
                        )}
                      </Detail>
                      {deployment.github_pr_number && (
                        <Detail>
                          PR:{' '}
                          <a
                            href={deployment.github_pr_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            #{deployment.github_pr_number}
                          </a>
                        </Detail>
                      )}
                    </HStack>
                  </VStack>

                  {/* Right side: View button */}
                  <Button
                    as={Link}
                    to={`/deployments/${deployment.id}`}
                    variant="tertiary"
                    size="small"
                  >
                    Vis
                  </Button>
                </HStack>
              </Box>
            ))
          )}
        </VStack>

        {/* Pagination */}
        {total_pages > 1 && (
          <HStack gap="space-16" justify="center" align="center">
            <Button
              variant="tertiary"
              size="small"
              icon={<ChevronLeftIcon aria-hidden />}
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              Forrige
            </Button>
            <BodyShort>
              Side {page} av {total_pages}
            </BodyShort>
            <Button
              variant="tertiary"
              size="small"
              icon={<ChevronRightIcon aria-hidden />}
              iconPosition="right"
              disabled={page >= total_pages}
              onClick={() => goToPage(page + 1)}
            >
              Neste
            </Button>
          </HStack>
        )}
      </VStack>
    </div>
  )
}
