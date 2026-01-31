import {
  ArrowsCirclepathIcon,
  ChatIcon,
  CheckmarkCircleIcon,
  CheckmarkIcon,
  CircleIcon,
  ClockIcon,
  ExclamationmarkTriangleIcon,
  MinusCircleIcon,
  TrashIcon,
  XMarkIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import {
  Accordion,
  Alert,
  BodyShort,
  Box,
  Button,
  CopyButton,
  Detail,
  Heading,
  HGrid,
  HStack,
  Modal,
  Tag,
  Textarea,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form, Link } from 'react-router'
import { createComment, deleteComment, getCommentsByDeploymentId, getManualApproval } from '~/db/comments.server'
import {
  getDeploymentById,
  getNextDeployment,
  getPreviousDeploymentForNav,
  updateDeploymentFourEyes,
} from '~/db/deployments.server'
import { getUserMappings } from '~/db/user-mappings.server'
import { verifyDeploymentFourEyes } from '~/lib/sync.server'
import type { Route } from './+types/deployments.$id'

export async function loader({ params }: Route.LoaderArgs) {
  const deploymentId = parseInt(params.id, 10)
  const deployment = await getDeploymentById(deploymentId)

  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 })
  }

  const comments = await getCommentsByDeploymentId(deploymentId)
  const manualApproval = await getManualApproval(deploymentId)

  // Get previous and next deployments for navigation
  const previousDeployment = await getPreviousDeploymentForNav(deploymentId, deployment.monitored_app_id)
  const nextDeployment = await getNextDeployment(deploymentId, deployment.monitored_app_id)

  // Collect all GitHub usernames we need to look up
  const usernames: string[] = []
  if (deployment.deployer_username) usernames.push(deployment.deployer_username)
  if (deployment.github_pr_data?.creator?.username) usernames.push(deployment.github_pr_data.creator.username)
  if (deployment.github_pr_data?.merger?.username) usernames.push(deployment.github_pr_data.merger.username)

  // Get all user mappings in one query
  const userMappings = await getUserMappings(usernames)

  return {
    deployment,
    comments,
    manualApproval,
    previousDeployment,
    nextDeployment,
    userMappings: Object.fromEntries(userMappings),
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const deploymentId = parseInt(params.id, 10)
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'add_comment') {
    const commentText = formData.get('comment_text') as string
    const slackLink = formData.get('slack_link') as string

    if (!commentText || commentText.trim() === '') {
      return { error: 'Kommentar kan ikke være tom' }
    }

    try {
      await createComment({
        deployment_id: deploymentId,
        comment_text: commentText.trim(),
        slack_link: slackLink || undefined,
      })
      return { success: 'Kommentar lagt til' }
    } catch (_error) {
      return { error: 'Kunne ikke legge til kommentar' }
    }
  }

  if (intent === 'manual_approval') {
    const approvedBy = formData.get('approved_by') as string
    const reason = formData.get('reason') as string

    if (!approvedBy || approvedBy.trim() === '') {
      return { error: 'Godkjenner må oppgis' }
    }

    try {
      // Create manual approval comment
      await createComment({
        deployment_id: deploymentId,
        comment_text: reason || 'Manuelt godkjent etter gjennomgang av unreviewed commits',
        comment_type: 'manual_approval',
        approved_by: approvedBy.trim(),
      })

      // Update deployment to mark as approved
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'approved_pr_with_unreviewed',
        githubPrNumber: null,
        githubPrUrl: null,
      })

      return { success: 'Deployment manuelt godkjent' }
    } catch (_error) {
      return { error: 'Kunne ikke godkjenne deployment' }
    }
  }

  if (intent === 'delete_comment') {
    const commentId = parseInt(formData.get('comment_id') as string, 10)
    try {
      await deleteComment(commentId)
      return { success: 'Kommentar slettet' }
    } catch (_error) {
      return { error: 'Kunne ikke slette kommentar' }
    }
  }

  if (intent === 'verify_four_eyes') {
    const deployment = await getDeploymentById(deploymentId)

    if (!deployment) {
      return { error: 'Deployment ikke funnet' }
    }

    // Check if deployment has required data
    if (!deployment.commit_sha) {
      return { error: 'Kan ikke verifisere: deployment mangler commit SHA' }
    }

    if (!deployment.detected_github_owner || !deployment.detected_github_repo_name) {
      return { error: 'Kan ikke verifisere: deployment mangler repository info' }
    }

    try {
      console.log(`🔍 Manually verifying deployment ${deployment.nais_deployment_id}...`)

      const success = await verifyDeploymentFourEyes(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
      )

      if (success) {
        return { success: 'Four-eyes status verifisert og oppdatert' }
      } else {
        return { error: 'Verifisering feilet - se logger for detaljer' }
      }
    } catch (error) {
      console.error('Verification error:', error)
      if (error instanceof Error && error.message.includes('rate limit')) {
        return { error: 'GitHub rate limit nådd. Prøv igjen senere.' }
      }
      return {
        error: `Kunne ikke verifisere: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
      }
    }
  }

  return null
}

function getFourEyesStatus(deployment: any): {
  text: string
  variant: 'success' | 'warning' | 'error' | 'info'
  description: string
} {
  if (deployment.has_four_eyes) {
    return {
      text: 'Godkjent',
      variant: 'success',
      description: 'Dette deploymentet har blitt godkjent via en approved PR.',
    }
  }

  switch (deployment.four_eyes_status) {
    case 'approved':
    case 'approved_pr':
      return {
        text: 'Godkjent',
        variant: 'success',
        description: 'Dette deploymentet har blitt godkjent via en approved PR.',
      }
    case 'baseline':
      return {
        text: 'Baseline',
        variant: 'success',
        description: 'Første deployment for dette miljøet. Brukes som utgangspunkt for verifisering.',
      }
    case 'no_changes':
      return {
        text: 'Ingen endringer',
        variant: 'success',
        description: 'Samme commit som forrige deployment.',
      }
    case 'unverified_commits':
      return {
        text: 'Uverifiserte commits',
        variant: 'error',
        description:
          'Det finnes commits mellom forrige og dette deploymentet som ikke har godkjent PR. Se detaljer under.',
      }
    case 'approved_pr_with_unreviewed':
      return {
        text: 'Ureviewed commits i merge',
        variant: 'error',
        description:
          'PR var godkjent, men det ble merget inn commits fra main som ikke har godkjenning. Se detaljer under.',
      }
    case 'legacy':
      return {
        text: 'Legacy (>1 år)',
        variant: 'success',
        description: 'Dette deploymentet er eldre enn 1 år og mangler informasjon om commit. Deploymentet er ignorert.',
      }
    case 'direct_push':
      return {
        text: 'Direct push',
        variant: 'warning',
        description: 'Dette var en direct push til main. Legg til Slack-lenke som bevis på review.',
      }
    case 'missing':
      return {
        text: 'Mangler godkjenning',
        variant: 'error',
        description: 'PR-en var ikke godkjent etter siste commit, eller godkjenningen kom før siste commit.',
      }
    case 'error':
      return {
        text: 'Feil ved verifisering',
        variant: 'error',
        description: 'Det oppstod en feil ved sjekk av GitHub.',
      }
    case 'pending':
      return {
        text: 'Venter på verifisering',
        variant: 'info',
        description: 'Deploymentet er ikke verifisert ennå.',
      }
    default:
      return {
        text: 'Ukjent status',
        variant: 'info',
        description: `Status for four-eyes kunne ikke fastslås (${deployment.four_eyes_status}).`,
      }
  }
}

export default function DeploymentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { deployment, comments, manualApproval, previousDeployment, nextDeployment, userMappings } = loaderData
  const [commentText, setCommentText] = useState('')
  const [slackLink, setSlackLink] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const [approvalReason, setApprovalReason] = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)
  const commentDialogRef = useRef<HTMLDialogElement>(null)

  const status = getFourEyesStatus(deployment)

  // Helper to get user display info
  const getUserDisplay = (githubUsername: string | undefined | null) => {
    if (!githubUsername) return null
    const mapping = userMappings[githubUsername]
    return mapping?.display_name || mapping?.nav_email || null
  }

  return (
    <VStack gap="space-32">
      {/* Breadcrumb with navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Detail textColor="subtle">
          {deployment.team_slug} / {deployment.environment_name} / {deployment.app_name}
        </Detail>
        <HStack gap="space-8">
          {previousDeployment ? (
            <Button as={Link} to={`/deployments/${previousDeployment.id}`} variant="tertiary" size="xsmall">
              ← Forrige
            </Button>
          ) : (
            <Button variant="tertiary" size="xsmall" disabled>
              ← Forrige
            </Button>
          )}
          <Button
            as={Link}
            to={`/applications/${deployment.team_slug}/${deployment.environment_name}/${deployment.app_name}`}
            variant="tertiary"
            size="xsmall"
          >
            Alle
          </Button>
          {nextDeployment ? (
            <Button as={Link} to={`/deployments/${nextDeployment.id}`} variant="tertiary" size="xsmall">
              Neste →
            </Button>
          ) : (
            <Button variant="tertiary" size="xsmall" disabled>
              Neste →
            </Button>
          )}
        </HStack>
      </div>
      {/* Main header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Heading size="large" style={{ flex: 1 }}>
            {deployment.github_pr_data?.title || `${deployment.app_name} @ ${deployment.environment_name}`}
          </Heading>
          <HStack gap="space-8" align="center">
            {/* Four-eyes status tag (only shown for OK/approved states) */}
            {(deployment.four_eyes_status === 'approved' || deployment.four_eyes_status === 'manually_approved') && (
              <Tag data-color="success" variant="outline" size="small">
                Godkjent
              </Tag>
            )}
            {/* Method tag */}
            {deployment.github_pr_number ? (
              <Tag data-color="info" variant="outline" size="small">
                Pull Request
              </Tag>
            ) : deployment.four_eyes_status === 'direct_push' ||
              deployment.four_eyes_status === 'unverified_commits' ? (
              <Tag data-color="warning" variant="outline" size="small">
                Direct Push
              </Tag>
            ) : deployment.four_eyes_status === 'legacy' ? (
              <Tag data-color="neutral" variant="outline" size="small">
                Legacy
              </Tag>
            ) : null}
            {/* Verify button for non-OK states */}
            {deployment.commit_sha &&
              ['pending', 'error', 'missing', 'direct_push', 'unverified_commits'].includes(
                deployment.four_eyes_status,
              ) && (
                <Form method="post" style={{ display: 'inline' }}>
                  <input type="hidden" name="intent" value="verify_four_eyes" />
                  <Button
                    type="submit"
                    size="small"
                    variant="tertiary"
                    icon={<ArrowsCirclepathIcon aria-hidden />}
                    title="Verifiser four-eyes status mot GitHub"
                  >
                    Verifiser
                  </Button>
                </Form>
              )}
          </HStack>
        </div>
        <BodyShort textColor="subtle">
          {new Date(deployment.created_at).toLocaleString('no-NO', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
          {deployment.github_pr_number && deployment.github_pr_url && (
            <>
              {' '}
              via{' '}
              <Link to={deployment.github_pr_url} target="_blank">
                #{deployment.github_pr_number}
              </Link>
            </>
          )}
        </BodyShort>
      </div>
      {actionData?.success && <Alert variant="success">{actionData.success}</Alert>}
      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}
      {/* Four-eyes Alert - only shown for non-OK states */}
      {deployment.four_eyes_status !== 'approved' && deployment.four_eyes_status !== 'manually_approved' && (
        <Alert variant={status.variant}>
          <Heading size="small" spacing>
            {status.text}
          </Heading>
          <BodyShort>{status.description}</BodyShort>
        </Alert>
      )}
      {/* Unverified commits section */}
      {deployment.unverified_commits && deployment.unverified_commits.length > 0 && (
        <Alert variant="error">
          <Heading size="small" spacing>
            Uverifiserte commits ({deployment.unverified_commits.length})
          </Heading>
          <BodyShort spacing>
            Følgende commits mellom forrige og dette deploymentet har ikke godkjent PR.
            {previousDeployment?.commit_sha && deployment.commit_sha && (
              <>
                {' '}
                <a
                  href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeployment.commit_sha}...${deployment.commit_sha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Se endringer på GitHub
                </a>
              </>
            )}
          </BodyShort>
          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
            {deployment.unverified_commits.map((commit: any) => (
              <li key={commit.sha} style={{ marginBottom: '0.5rem' }}>
                <a
                  href={commit.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                >
                  {commit.sha.substring(0, 7)}
                </a>{' '}
                - {commit.message}
                <br />
                <Detail>
                  av {commit.author} •{' '}
                  {commit.pr_number ? `PR #${commit.pr_number} ikke godkjent` : 'Ingen PR (direkte push)'}
                </Detail>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {/* Deployment Details Section */}
      <Heading size="medium">Detaljer</Heading>
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, md: 3 }}>
        <VStack gap="space-4">
          <Detail>Deployer</Detail>
          <BodyShort>
            {deployment.deployer_username ? (
              <>
                <a
                  href={`https://github.com/${deployment.deployer_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {deployment.deployer_username}
                </a>
                {getUserDisplay(deployment.deployer_username) && (
                  <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                    {' '}
                    ({getUserDisplay(deployment.deployer_username)})
                  </span>
                )}
              </>
            ) : (
              '(ukjent)'
            )}
          </BodyShort>
        </VStack>

        <VStack gap="space-4">
          <Detail>Commit SHA</Detail>
          <BodyShort>
            {deployment.commit_sha ? (
              <a
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
              >
                {deployment.commit_sha.substring(0, 7)}
              </a>
            ) : (
              <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>(ukjent)</span>
            )}
          </BodyShort>
        </VStack>

        {deployment.branch_name && (
          <VStack gap="space-4">
            <Detail>Branch</Detail>
            <BodyShort>
              <a
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/tree/${deployment.branch_name}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
              >
                {deployment.branch_name}
              </a>
            </BodyShort>
          </VStack>
        )}

        {deployment.parent_commits && deployment.parent_commits.length > 1 && (
          <VStack gap="space-4">
            <Detail>Merge commit (parents)</Detail>
            <BodyShort>
              {deployment.parent_commits.map((parent, index) => (
                <span key={parent.sha}>
                  <a
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${parent.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                  >
                    {parent.sha.substring(0, 7)}
                  </a>
                  {index < (deployment.parent_commits?.length ?? 0) - 1 && ', '}
                </span>
              ))}
            </BodyShort>
          </VStack>
        )}

        {deployment.trigger_url && (
          <VStack gap="space-4">
            <Detail>GitHub Actions</Detail>
            <BodyShort>
              <a href={deployment.trigger_url} target="_blank" rel="noopener noreferrer">
                Se workflow run
              </a>
            </BodyShort>
          </VStack>
        )}

        <VStack gap="space-4">
          <Detail>Nais Deployment ID</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{deployment.nais_deployment_id}</code>
            </BodyShort>
            <CopyButton copyText={deployment.nais_deployment_id} size="small" title="Kopier deployment ID" />
          </HStack>
        </VStack>

        {/* PR-specific fields in same grid */}

        {deployment.github_pr_data && (
          <>
            <VStack gap="space-4">
              <Detail>PR Opprettet av</Detail>
              <BodyShort>
                <a
                  href={`https://github.com/${deployment.github_pr_data.creator.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {deployment.github_pr_data.creator.username}
                </a>
                {getUserDisplay(deployment.github_pr_data.creator.username) && (
                  <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                    {' '}
                    ({getUserDisplay(deployment.github_pr_data.creator.username)})
                  </span>
                )}
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merger && (
              <VStack gap="space-4">
                <Detail>Merget av</Detail>
                <BodyShort>
                  <a
                    href={`https://github.com/${deployment.github_pr_data.merger.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {deployment.github_pr_data.merger.username}
                  </a>
                  {getUserDisplay(deployment.github_pr_data.merger.username) && (
                    <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                      {' '}
                      ({getUserDisplay(deployment.github_pr_data.merger.username)})
                    </span>
                  )}
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Opprettet</Detail>
              <BodyShort>
                {new Date(deployment.github_pr_data.created_at).toLocaleString('no-NO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merged_at && (
              <VStack gap="space-4">
                <Detail>Merget</Detail>
                <BodyShort>
                  {new Date(deployment.github_pr_data.merged_at).toLocaleString('no-NO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>Base branch</Detail>
              <BodyShort>{deployment.github_pr_data.base_branch}</BodyShort>
            </VStack>

            {deployment.github_pr_data.head_branch && (
              <VStack gap="space-4">
                <Detail>Head branch</Detail>
                <BodyShort>{deployment.github_pr_data.head_branch}</BodyShort>
              </VStack>
            )}

            {deployment.github_pr_data.merge_commit_sha && (
              <VStack gap="space-4">
                <Detail>Merge commit</Detail>
                <BodyShort>
                  <a
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.github_pr_data.merge_commit_sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {deployment.github_pr_data.merge_commit_sha.substring(0, 7)}
                  </a>
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Status</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.draft && (
                  <Tag data-color="warning" variant="outline" size="small">
                    Draft
                  </Tag>
                )}
                {deployment.github_pr_data.locked && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    🔒 Låst
                  </Tag>
                )}
                {deployment.github_pr_data.auto_merge && (
                  <Tag data-color="info" variant="outline" size="small">
                    Auto-merge ({deployment.github_pr_data.auto_merge.merge_method})
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === true && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} /> Checks OK
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === false && (
                  <Tag data-color="danger" variant="outline" size="small">
                    <XMarkIcon aria-hidden /> Checks failed
                  </Tag>
                )}
              </HStack>
            </VStack>

            {deployment.github_pr_data.assignees && deployment.github_pr_data.assignees.length > 0 && (
              <VStack gap="space-4">
                <Detail>Tildelt</Detail>
                <HStack gap="space-8" wrap>
                  {deployment.github_pr_data.assignees.map((a) => (
                    <Tag data-color="neutral" key={a.username} variant="outline" size="small">
                      {a.username}
                    </Tag>
                  ))}
                </HStack>
              </VStack>
            )}

            {deployment.github_pr_data.milestone && (
              <VStack gap="space-4">
                <Detail>Milestone</Detail>
                <Tag data-color="info" variant="outline" size="small">
                  {deployment.github_pr_data.milestone.title} ({deployment.github_pr_data.milestone.state})
                </Tag>
              </VStack>
            )}
          </>
        )}
      </HGrid>
      {/* PR Details Accordion - Reviewers, Checks, Commits */}
      {deployment.github_pr_data && (
        <Accordion>
          {/* Reviewers - includes requested and completed reviews */}
          {((deployment.github_pr_data.reviewers && deployment.github_pr_data.reviewers.length > 0) ||
            (deployment.github_pr_data.requested_reviewers &&
              deployment.github_pr_data.requested_reviewers.length > 0) ||
            (deployment.github_pr_data.requested_teams && deployment.github_pr_data.requested_teams.length > 0)) && (
            <Accordion.Item>
              <Accordion.Header>
                Reviewers (
                {(deployment.github_pr_data.reviewers?.length || 0) +
                  (deployment.github_pr_data.requested_reviewers?.length || 0) +
                  (deployment.github_pr_data.requested_teams?.length || 0)}
                )
              </Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-8">
                  {/* Completed reviews */}
                  {deployment.github_pr_data.reviewers?.map((reviewer) => (
                    <HStack key={`${reviewer.username}:${reviewer.submitted_at}`} gap="space-8" align="center">
                      {reviewer.state === 'APPROVED' && (
                        <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
                      )}
                      {reviewer.state === 'CHANGES_REQUESTED' && (
                        <XMarkIcon aria-hidden style={{ color: 'var(--ax-text-danger)' }} />
                      )}
                      {reviewer.state === 'COMMENTED' && (
                        <ChatIcon aria-hidden style={{ color: 'var(--ax-text-neutral-subtle)' }} />
                      )}
                      <a href={`https://github.com/${reviewer.username}`} target="_blank" rel="noopener noreferrer">
                        {reviewer.username}
                      </a>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(reviewer.submitted_at).toLocaleString('no-NO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </HStack>
                  ))}

                  {/* Requested reviewers (pending) */}
                  {deployment.github_pr_data.requested_reviewers?.map((r) => (
                    <HStack key={`pending:${r.username}`} gap="space-8" align="center">
                      <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                      <a href={`https://github.com/${r.username}`} target="_blank" rel="noopener noreferrer">
                        {r.username}
                      </a>
                    </HStack>
                  ))}

                  {/* Requested teams (pending) */}
                  {deployment.github_pr_data.requested_teams?.map((t) => (
                    <HStack key={`team:${t.slug}`} gap="space-8" align="center">
                      <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                      <span>{t.name}</span>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* GitHub Checks */}
          {deployment.github_pr_data.checks && deployment.github_pr_data.checks.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>GitHub Checks ({deployment.github_pr_data.checks.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-8">
                  {deployment.github_pr_data.checks.map((check) => {
                    const isSuccess = check.conclusion === 'success'
                    const isFailure =
                      check.conclusion === 'failure' ||
                      check.conclusion === 'timed_out' ||
                      check.conclusion === 'action_required'
                    const isSkipped =
                      check.conclusion === 'skipped' ||
                      check.conclusion === 'neutral' ||
                      check.conclusion === 'cancelled'
                    const isInProgress = check.status === 'in_progress' || check.status === 'queued'

                    return (
                      <HStack key={check.html_url} gap="space-8" align="center">
                        {isSuccess && <CheckmarkCircleIcon style={{ color: 'var(--ax-text-success)' }} />}
                        {isFailure && <XMarkOctagonIcon style={{ color: 'var(--ax-text-danger)' }} />}
                        {isSkipped && <MinusCircleIcon style={{ color: 'var(--ax-text-neutral-subtle)' }} />}
                        {isInProgress && <ClockIcon style={{ color: 'var(--ax-text-warning)' }} />}

                        {check.html_url ? (
                          <a href={check.html_url} target="_blank" rel="noopener noreferrer">
                            {check.name}
                          </a>
                        ) : (
                          <span>{check.name}</span>
                        )}

                        <Tag
                          variant={isSuccess ? 'success' : isFailure ? 'error' : isSkipped ? 'neutral' : 'warning'}
                          size="small"
                        >
                          {check.conclusion || check.status}
                        </Tag>

                        {check.completed_at && (
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(check.completed_at).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        )}
                      </HStack>
                    )
                  })}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* PR Commits */}
          {deployment.github_pr_data.commits && deployment.github_pr_data.commits.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>Commits ({deployment.github_pr_data.commits.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.commits.map((commit) => (
                    <HStack key={commit.sha} gap="space-12" align="start">
                      {commit.author.avatar_url && (
                        <img
                          src={commit.author.avatar_url}
                          alt={commit.author.username}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <VStack gap="space-4">
                        <HStack gap="space-8" align="baseline" wrap>
                          <a
                            href={commit.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                          >
                            {commit.sha.substring(0, 7)}
                          </a>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>{commit.author.username}</span>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(commit.date).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </HStack>
                        <BodyShort>{commit.message.split('\n')[0]}</BodyShort>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* GitHub Comments */}
          {deployment.github_pr_data.comments && deployment.github_pr_data.comments.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>Kommentarer ({deployment.github_pr_data.comments.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.comments.map((comment) => (
                    <HStack key={comment.id} gap="space-12" align="start">
                      {comment.user.avatar_url && (
                        <img
                          src={comment.user.avatar_url}
                          alt={comment.user.username}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <VStack gap="space-4" style={{ flex: 1 }}>
                        <HStack gap="space-8" align="baseline" wrap>
                          <a
                            href={`https://github.com/${comment.user.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {comment.user.username}
                          </a>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(comment.created_at).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                          <a
                            href={comment.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--ax-text-neutral-subtle)' }}
                          >
                            vis på GitHub
                          </a>
                        </HStack>
                        <BodyShort style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</BodyShort>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}
        </Accordion>
      )}
      {/* Resources section */}
      {deployment.resources && deployment.resources.length > 0 && (
        <div>
          <Heading size="small" spacing>
            Kubernetes Resources
          </Heading>
          <HStack gap="space-8" wrap>
            {deployment.resources.map((resource: any) => (
              <Tag data-color="info" key={`${resource.kind}:${resource.name}`} variant="outline" size="small">
                {resource.kind}: {resource.name}
              </Tag>
            ))}
          </HStack>
        </div>
      )}
      {/* PR Details section */}
      {deployment.github_pr_data && (
        <VStack gap="space-16">
          {deployment.github_pr_data.body && (
            <div>
              <Heading size="medium">Beskrivelse</Heading>
              <Box background="neutral-soft" padding="space-16" borderRadius="12" marginBlock="space-8 space-0">
                <BodyShort style={{ whiteSpace: 'pre-wrap' }}>
                  {/* biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub PR body contains safe markdown HTML */}
                  <div dangerouslySetInnerHTML={{ __html: deployment.github_pr_data.body }} />
                </BodyShort>
              </Box>
            </div>
          )}

          {/* PR Stats */}
          <HGrid gap="space-16" columns={{ xs: 2, sm: 3, md: 6 }}>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Commits</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.commits_count}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Filer endret</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.changed_files}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Linjer lagt til</Detail>
                <BodyShort style={{ color: 'var(--ax-text-success)' }}>
                  <strong>+{deployment.github_pr_data.additions}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Linjer fjernet</Detail>
                <BodyShort style={{ color: 'var(--ax-text-danger)' }}>
                  <strong>-{deployment.github_pr_data.deletions}</strong>
                </BodyShort>
              </VStack>
            </Box>
            {deployment.github_pr_data.comments_count !== undefined && (
              <Box padding="space-12" borderRadius="8" background="sunken">
                <VStack gap="space-4">
                  <Detail textColor="subtle">Kommentarer</Detail>
                  <BodyShort>
                    <strong>{deployment.github_pr_data.comments_count}</strong>
                  </BodyShort>
                </VStack>
              </Box>
            )}
            {deployment.github_pr_data.review_comments_count !== undefined && (
              <Box padding="space-12" borderRadius="8" background="sunken">
                <VStack gap="space-4">
                  <Detail textColor="subtle">Review-kommentarer</Detail>
                  <BodyShort>
                    <strong>{deployment.github_pr_data.review_comments_count}</strong>
                  </BodyShort>
                </VStack>
              </Box>
            )}
          </HGrid>

          {/* Labels */}
          {deployment.github_pr_data.labels && deployment.github_pr_data.labels.length > 0 && (
            <VStack gap="space-8">
              <Detail textColor="subtle">Labels</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.labels.map((label) => (
                  <Tag data-color="neutral" key={label} variant="outline" size="small">
                    {label}
                  </Tag>
                ))}
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
      {/* Unreviewed commits warning */}
      {deployment.github_pr_data?.unreviewed_commits && deployment.github_pr_data.unreviewed_commits.length > 0 && (
        <div>
          <Alert variant="error">
            <Heading size="small" spacing>
              <ExclamationmarkTriangleIcon aria-hidden /> Ureviewed commits funnet
            </Heading>
            <BodyShort spacing>
              Følgende commits var på main mellom PR base og merge, men mangler godkjenning:
            </BodyShort>
          </Alert>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {deployment.github_pr_data.unreviewed_commits.map((commit) => (
              <Box
                key={commit.sha}
                background="danger-soft"
                padding="space-16"
                borderRadius="8"
                borderWidth="1"
                borderColor="danger-subtleA"
              >
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                      }}
                    >
                      <a
                        href={commit.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                      >
                        {commit.sha.substring(0, 7)}
                      </a>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>{commit.author}</span>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(commit.date).toLocaleDateString('no-NO', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <BodyShort size="small" style={{ marginTop: '0.25rem' }}>
                      {commit.message.split('\n')[0]}
                    </BodyShort>
                    <Detail style={{ marginTop: '0.5rem', color: 'var(--ax-text-danger)' }}>{commit.reason}</Detail>
                  </div>
                </div>
              </Box>
            ))}
          </div>

          {/* Manual approval section */}
          {manualApproval ? (
            <Alert variant="success">
              <Heading size="small">
                <CheckmarkIcon aria-hidden /> Manuelt godkjent
              </Heading>
              <BodyShort>
                Godkjent av <strong>{manualApproval.approved_by}</strong> den{' '}
                {manualApproval.approved_at
                  ? new Date(manualApproval.approved_at).toLocaleDateString('no-NO', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'ukjent dato'}
              </BodyShort>
              {manualApproval.comment_text && (
                <BodyShort style={{ marginTop: '0.5rem', fontStyle: 'italic' }}>
                  "{manualApproval.comment_text}"
                </BodyShort>
              )}
            </Alert>
          ) : (
            <Box background="warning-soft" padding="space-16" borderRadius="8">
              <Heading size="small" spacing>
                Krever manuell godkjenning
              </Heading>
              <BodyShort spacing>
                Gjennomgå de unreviewed commits over. Hvis endringene er OK (f.eks. hotfix eller revert), godkjenn
                manuelt.
              </BodyShort>

              {!showApprovalForm ? (
                <Button variant="primary" size="small" onClick={() => setShowApprovalForm(true)}>
                  Godkjenn etter gjennomgang
                </Button>
              ) : (
                <Form method="post">
                  <input type="hidden" name="intent" value="manual_approval" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <TextField
                      label="Godkjenner (ditt navn)"
                      name="approved_by"
                      value={approvedBy}
                      onChange={(e) => setApprovedBy(e.target.value)}
                      required
                      size="small"
                    />
                    <Textarea
                      label="Begrunnelse (valgfritt)"
                      name="reason"
                      value={approvalReason}
                      onChange={(e) => setApprovalReason(e.target.value)}
                      description="F.eks: 'Hotfix godkjent i Slack' eller 'Revert av feil deployment'"
                      size="small"
                      rows={2}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Button type="submit" variant="primary" size="small">
                        Godkjenn
                      </Button>
                      <Button type="button" variant="secondary" size="small" onClick={() => setShowApprovalForm(false)}>
                        Avbryt
                      </Button>
                    </div>
                  </div>
                </Form>
              )}
            </Box>
          )}
        </div>
      )}
      {/* Comments section */}
      <VStack gap="space-16">
        <Heading size="medium">Kommentarer</Heading>

        {comments.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen kommentarer ennå.
          </BodyShort>
        ) : (
          <VStack gap="space-12">
            {comments.map((comment) => (
              <Box
                key={comment.id}
                padding="space-16"
                borderRadius="8"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
              >
                <HStack justify="space-between" align="start">
                  <VStack gap="space-4">
                    <Detail textColor="subtle">
                      {new Date(comment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </Detail>
                    <BodyShort>{comment.comment_text}</BodyShort>
                    {comment.slack_link && (
                      <BodyShort size="small">
                        <Link to={comment.slack_link} target="_blank">
                          🔗 Slack-lenke
                        </Link>
                      </BodyShort>
                    )}
                  </VStack>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_comment" />
                    <input type="hidden" name="comment_id" value={comment.id} />
                    <Button type="submit" size="small" variant="tertiary" icon={<TrashIcon aria-hidden />}>
                      Slett
                    </Button>
                  </Form>
                </HStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>
      <Button variant="tertiary" icon={<ChatIcon aria-hidden />} onClick={() => commentDialogRef.current?.showModal()}>
        Legg til kommentar
      </Button>
      <Modal ref={commentDialogRef} header={{ heading: 'Legg til kommentar' }} closeOnBackdropClick>
        <Modal.Body>
          <Form method="post" onSubmit={() => commentDialogRef.current?.close()}>
            <input type="hidden" name="intent" value="add_comment" />
            <VStack gap="space-16">
              <Textarea
                label="Kommentar"
                name="comment_text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                description="F.eks. forklaring av direct push eller andre notater"
              />
              <TextField
                label="Slack-lenke (valgfritt)"
                name="slack_link"
                value={slackLink}
                onChange={(e) => setSlackLink(e.target.value)}
                description="Lenke til Slack-tråd med code review dokumentasjon"
              />
            </VStack>
            <Modal.Footer>
              <Button type="submit">Legg til</Button>
              <Button variant="secondary" type="button" onClick={() => commentDialogRef.current?.close()}>
                Avbryt
              </Button>
            </Modal.Footer>
          </Form>
        </Modal.Body>
      </Modal>
    </VStack>
  )
}
