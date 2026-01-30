import {
  ArrowsCirclepathIcon,
  ChatIcon,
  CheckmarkCircleIcon,
  MinusCircleIcon,
  TrashIcon,
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
  Tag,
  Textarea,
  TextField,
} from '@navikt/ds-react'
import { useState } from 'react'
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
import styles from '../styles/common.module.css'
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
        deployment.commit_sha!,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
      )

      if (success) {
        return { success: '✅ Four-eyes status verifisert og oppdatert' }
      } else {
        return { error: 'Verifisering feilet - se logger for detaljer' }
      }
    } catch (error) {
      console.error('Verification error:', error)
      if (error instanceof Error && error.message.includes('rate limit')) {
        return { error: '⚠️ GitHub rate limit nådd. Prøv igjen senere.' }
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
      text: 'Four-eyes OK',
      variant: 'success',
      description: 'Dette deploymentet har blitt godkjent via en approved PR.',
    }
  }

  switch (deployment.four_eyes_status) {
    case 'approved':
    case 'approved_pr':
      return {
        text: 'Four-eyes OK',
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

  const status = getFourEyesStatus(deployment)

  // Helper to get user display info
  const getUserDisplay = (githubUsername: string | undefined | null) => {
    if (!githubUsername) return null
    const mapping = userMappings[githubUsername]
    return mapping?.display_name || mapping?.nav_email || null
  }

  // Extract app name from deployment (might not match exactly, but we have it in the data)
  const appName = deployment.app_name || deployment.detected_github_repo_name
  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${deployment.team_slug}/${deployment.environment_name}/app/${appName}`

  return (
    <div className={styles.pageContainer}>
      <div>
        <Detail>Deployment</Detail>
        <Heading size="large">
          {deployment.app_name} @ {deployment.environment_name}
        </Heading>
        <BodyShort>
          {new Date(deployment.created_at).toLocaleString('no-NO', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
        </BodyShort>
      </div>

      {/* Navigation between deployments */}
      <Box
        background="neutral-soft"
        padding="space-16"
        borderRadius="8"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        {previousDeployment ? (
          <Button as={Link} to={`/deployments/${previousDeployment.id}`} variant="secondary" size="small">
            ← Forrige
          </Button>
        ) : (
          <div />
        )}

        <Button
          as={Link}
          to={`/applications/${deployment.team_slug}/${deployment.environment_name}/${deployment.app_name}`}
          variant="tertiary"
          size="small"
        >
          Alle deployments
        </Button>

        {nextDeployment ? (
          <Button as={Link} to={`/deployments/${nextDeployment.id}`} variant="secondary" size="small">
            Neste →
          </Button>
        ) : (
          <div />
        )}
      </Box>

      {actionData?.success && <Alert variant="success">{actionData.success}</Alert>}
      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      <Alert variant={status.variant}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{ flex: 1 }}>
            <Heading size="small" spacing>
              {status.text}
            </Heading>
            <BodyShort>{status.description}</BodyShort>
          </div>
          {deployment.commit_sha &&
            ['pending', 'error', 'missing', 'direct_push', 'unverified_commits'].includes(
              deployment.four_eyes_status,
            ) && (
              <Form method="post">
                <input type="hidden" name="intent" value="verify_four_eyes" />
                <Button
                  type="submit"
                  size="small"
                  variant="secondary"
                  icon={<ArrowsCirclepathIcon aria-hidden />}
                  title="Verifiser four-eyes status mot GitHub"
                >
                  Verifiser nå
                </Button>
              </Form>
            )}
        </div>
      </Alert>

      {/* Unverified commits section */}
      {deployment.unverified_commits && deployment.unverified_commits.length > 0 && (
        <Alert variant="error">
          <Heading size="small" spacing>
            Uverifiserte commits ({deployment.unverified_commits.length})
          </Heading>
          <BodyShort spacing>Følgende commits mellom forrige og dette deploymentet har ikke godkjent PR:</BodyShort>
          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
            {deployment.unverified_commits.map((commit: any) => (
              <li key={commit.sha} style={{ marginBottom: '0.5rem' }}>
                <a href={commit.html_url} target="_blank" rel="noopener noreferrer" className={styles.codeMedium}>
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

      <div className={styles.detailsGrid}>
        <div>
          <Detail>Applikasjon</Detail>
          <BodyShort>
            <Link to={`/apps/${deployment.monitored_app_id}`}>{deployment.app_name}</Link>
          </BodyShort>
        </div>

        <div>
          <Detail>Nais Team</Detail>
          <BodyShort>{deployment.team_slug}</BodyShort>
        </div>

        <div>
          <Detail>Miljø</Detail>
          <BodyShort>{deployment.environment_name}</BodyShort>
        </div>

        <div>
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
                  <span className={styles.textSubtle}> ({getUserDisplay(deployment.deployer_username)})</span>
                )}
              </>
            ) : (
              '(ukjent)'
            )}
          </BodyShort>
        </div>

        <div>
          <Detail>Repository (detektert)</Detail>
          <BodyShort>
            <a
              href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkExternal}
            >
              {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
            </a>
          </BodyShort>
        </div>

        <div>
          <Detail>Commit SHA</Detail>
          <BodyShort>
            {deployment.commit_sha ? (
              <a
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.codeMedium}
              >
                {deployment.commit_sha.substring(0, 7)}
              </a>
            ) : (
              <span className={styles.textSubtle}>(ukjent)</span>
            )}
          </BodyShort>
        </div>

        {deployment.branch_name && (
          <div>
            <Detail>Branch</Detail>
            <BodyShort>
              <a
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/tree/${deployment.branch_name}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.codeMedium}
              >
                {deployment.branch_name}
              </a>
            </BodyShort>
          </div>
        )}

        {deployment.parent_commits && deployment.parent_commits.length > 1 && (
          <div>
            <Detail>Merge commit (parents)</Detail>
            <BodyShort>
              {deployment.parent_commits.map((parent, index) => (
                <span key={parent.sha}>
                  <a
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${parent.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.codeMedium}
                  >
                    {parent.sha.substring(0, 7)}
                  </a>
                  {index < (deployment.parent_commits?.length ?? 0) - 1 && ', '}
                </span>
              ))}
            </BodyShort>
          </div>
        )}

        {deployment.github_pr_number && deployment.github_pr_url && (
          <div>
            <Detail>Pull Request</Detail>
            <BodyShort>
              <a href={deployment.github_pr_url} target="_blank" rel="noopener noreferrer">
                #{deployment.github_pr_number}
              </a>
            </BodyShort>
          </div>
        )}

        {deployment.trigger_url && (
          <div>
            <Detail>GitHub Actions</Detail>
            <BodyShort>
              <a href={deployment.trigger_url} target="_blank" rel="noopener noreferrer">
                Se workflow run
              </a>
            </BodyShort>
          </div>
        )}

        <div>
          <Detail>Nais Console</Detail>
          <BodyShort>
            <a href={naisConsoleUrl} target="_blank" rel="noopener noreferrer">
              Åpne i Nais Console
            </a>
          </BodyShort>
        </div>

        <div>
          <Detail>Nais Deployment ID</Detail>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BodyShort>
              <code className={styles.codeSmall}>{deployment.nais_deployment_id}</code>
            </BodyShort>
            <CopyButton copyText={deployment.nais_deployment_id} size="small" title="Kopier deployment ID" />
          </div>
        </div>
      </div>

      {/* Resources section */}
      {deployment.resources && deployment.resources.length > 0 && (
        <div>
          <Heading size="small" spacing>
            Kubernetes Resources
          </Heading>
          <div className={styles.actionButtons}>
            {deployment.resources.map((resource: any) => (
              <Tag key={`${resource.kind}:${resource.name}`} variant="info" size="small">
                {resource.kind}: {resource.name}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* PR Details section */}
      {deployment.github_pr_data && (
        <Box>
          <Heading size="small" spacing>
            Pull Request Informasjon
          </Heading>

          <div className={styles.detailsGrid}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Detail>Tittel</Detail>
              <BodyShort>
                <strong>{deployment.github_pr_data.title}</strong>
              </BodyShort>
            </div>

            {deployment.github_pr_data.body && (
              <div style={{ gridColumn: '1 / -1' }}>
                <Detail>Beskrivelse</Detail>
                <Box background="neutral-soft" padding="space-16" borderRadius="12" className={styles.marginTop2}>
                  <BodyShort style={{ whiteSpace: 'pre-wrap' }}>
                    {/* biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub PR body contains safe markdown HTML */}
                    <div dangerouslySetInnerHTML={{ __html: deployment.github_pr_data.body }} />
                  </BodyShort>
                </Box>
              </div>
            )}

            <div>
              <Detail>Opprettet av</Detail>
              <BodyShort>
                <a
                  href={`https://github.com/${deployment.github_pr_data.creator.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {deployment.github_pr_data.creator.username}
                </a>
                {getUserDisplay(deployment.github_pr_data.creator.username) && (
                  <span className={styles.textSubtle}>
                    {' '}
                    ({getUserDisplay(deployment.github_pr_data.creator.username)})
                  </span>
                )}
              </BodyShort>
            </div>

            {deployment.github_pr_data.merger && (
              <div>
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
                    <span className={styles.textSubtle}>
                      {' '}
                      ({getUserDisplay(deployment.github_pr_data.merger.username)})
                    </span>
                  )}
                </BodyShort>
              </div>
            )}

            <div>
              <Detail>Opprettet</Detail>
              <BodyShort>
                {new Date(deployment.github_pr_data.created_at).toLocaleString('no-NO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </BodyShort>
            </div>

            {deployment.github_pr_data.merged_at && (
              <div>
                <Detail>Merget</Detail>
                <BodyShort>
                  {new Date(deployment.github_pr_data.merged_at).toLocaleString('no-NO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </BodyShort>
              </div>
            )}

            <div>
              <Detail>Base branch</Detail>
              <BodyShort>{deployment.github_pr_data.base_branch}</BodyShort>
            </div>

            {deployment.github_pr_data.head_branch && (
              <div>
                <Detail>Head branch</Detail>
                <BodyShort>{deployment.github_pr_data.head_branch}</BodyShort>
              </div>
            )}

            {deployment.github_pr_data.merge_commit_sha && (
              <div>
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
              </div>
            )}

            <div>
              <Detail>Status</Detail>
              <div className={styles.actionButtons}>
                {deployment.github_pr_data.draft && (
                  <Tag variant="warning" size="small">
                    Draft
                  </Tag>
                )}
                {deployment.github_pr_data.locked && (
                  <Tag variant="neutral" size="small">
                    🔒 Låst
                  </Tag>
                )}
                {deployment.github_pr_data.auto_merge && (
                  <Tag variant="info" size="small">
                    Auto-merge ({deployment.github_pr_data.auto_merge.merge_method})
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === true && (
                  <Tag variant="success" size="small">
                    ✓ Checks passed
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === false && (
                  <Tag variant="error" size="small">
                    ✗ Checks failed
                  </Tag>
                )}
              </div>
            </div>
          </div>

          {/* Assignees and Requested Reviewers */}
          {((deployment.github_pr_data.assignees && deployment.github_pr_data.assignees.length > 0) ||
            (deployment.github_pr_data.requested_reviewers &&
              deployment.github_pr_data.requested_reviewers.length > 0) ||
            (deployment.github_pr_data.requested_teams && deployment.github_pr_data.requested_teams.length > 0)) && (
            <div className={styles.detailsGrid} style={{ marginTop: '1rem' }}>
              {deployment.github_pr_data.assignees && deployment.github_pr_data.assignees.length > 0 && (
                <div>
                  <Detail>Tildelt</Detail>
                  <div className={styles.actionButtons}>
                    {deployment.github_pr_data.assignees.map((a) => (
                      <Tag key={a.username} variant="neutral" size="small">
                        {a.username}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
              {deployment.github_pr_data.requested_reviewers &&
                deployment.github_pr_data.requested_reviewers.length > 0 && (
                  <div>
                    <Detail>Forespurte reviewers</Detail>
                    <div className={styles.actionButtons}>
                      {deployment.github_pr_data.requested_reviewers.map((r) => (
                        <Tag key={r.username} variant="neutral" size="small">
                          {r.username}
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
              {deployment.github_pr_data.requested_teams && deployment.github_pr_data.requested_teams.length > 0 && (
                <div>
                  <Detail>Forespurte teams</Detail>
                  <div className={styles.actionButtons}>
                    {deployment.github_pr_data.requested_teams.map((t) => (
                      <Tag key={t.slug} variant="neutral" size="small">
                        {t.name}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Milestone */}
          {deployment.github_pr_data.milestone && (
            <div style={{ marginTop: '1rem' }}>
              <Detail>Milestone</Detail>
              <Tag variant="info" size="small">
                {deployment.github_pr_data.milestone.title} ({deployment.github_pr_data.milestone.state})
              </Tag>
            </div>
          )}

          {/* PR Stats */}
          <div className={styles.statsGrid} style={{ marginTop: '1rem' }}>
            <div className={styles.statCard}>
              <Detail>Commits</Detail>
              <BodyShort>
                <strong>{deployment.github_pr_data.commits_count}</strong>
              </BodyShort>
            </div>
            <div className={styles.statCard}>
              <Detail>Filer endret</Detail>
              <BodyShort>
                <strong>{deployment.github_pr_data.changed_files}</strong>
              </BodyShort>
            </div>
            <div className={styles.statCard}>
              <Detail>Linjer lagt til</Detail>
              <BodyShort className={styles.textSuccess}>
                <strong>+{deployment.github_pr_data.additions}</strong>
              </BodyShort>
            </div>
            <div className={styles.statCard}>
              <Detail>Linjer fjernet</Detail>
              <BodyShort className={styles.textDanger}>
                <strong>-{deployment.github_pr_data.deletions}</strong>
              </BodyShort>
            </div>
            {deployment.github_pr_data.comments_count !== undefined && (
              <div className={styles.statCard}>
                <Detail>Kommentarer</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.comments_count}</strong>
                </BodyShort>
              </div>
            )}
            {deployment.github_pr_data.review_comments_count !== undefined && (
              <div className={styles.statCard}>
                <Detail>Review-kommentarer</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.review_comments_count}</strong>
                </BodyShort>
              </div>
            )}
          </div>

          {/* Labels */}
          {deployment.github_pr_data.labels && deployment.github_pr_data.labels.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <Detail>Labels</Detail>
              <div className={styles.actionButtons}>
                {deployment.github_pr_data.labels.map((label) => (
                  <Tag key={label} variant="neutral" size="small">
                    {label}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          {/* Reviewers */}
          {deployment.github_pr_data.reviewers && deployment.github_pr_data.reviewers.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <Detail>Reviewers</Detail>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {deployment.github_pr_data.reviewers.map((reviewer) => (
                  <div
                    key={`${reviewer.username}:${reviewer.submitted_at}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    {reviewer.state === 'APPROVED' && <span style={{ fontSize: '1.2rem' }}>✅</span>}
                    {reviewer.state === 'CHANGES_REQUESTED' && <span style={{ fontSize: '1.2rem' }}>🔴</span>}
                    {reviewer.state === 'COMMENTED' && <span style={{ fontSize: '1.2rem' }}>💬</span>}
                    <a href={`https://github.com/${reviewer.username}`} target="_blank" rel="noopener noreferrer">
                      {reviewer.username}
                    </a>
                    <span className={styles.textSubtle}>
                      -{' '}
                      {new Date(reviewer.submitted_at).toLocaleString('no-NO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                    <Tag
                      variant={
                        reviewer.state === 'APPROVED'
                          ? 'success'
                          : reviewer.state === 'CHANGES_REQUESTED'
                            ? 'error'
                            : 'neutral'
                      }
                      size="small"
                    >
                      {reviewer.state}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GitHub Checks */}
          {deployment.github_pr_data.checks && deployment.github_pr_data.checks.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <Accordion>
                <Accordion.Item>
                  <Accordion.Header>
                    <Detail>GitHub Checks ({deployment.github_pr_data.checks.length})</Detail>
                  </Accordion.Header>
                  <Accordion.Content>
                    <Box background="neutral-soft" padding="space-16" borderRadius="12" className={styles.marginTop2}>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                          marginTop: '0.5rem',
                        }}
                      >
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
                            <div key={check.html_url} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {isSuccess && (
                                <CheckmarkCircleIcon style={{ color: 'var(--a-icon-success)', fontSize: '1.2rem' }} />
                              )}
                              {isFailure && (
                                <XMarkOctagonIcon style={{ color: 'var(--a-icon-danger)', fontSize: '1.2rem' }} />
                              )}
                              {isSkipped && (
                                <MinusCircleIcon style={{ color: 'var(--a-icon-subtle)', fontSize: '1.2rem' }} />
                              )}
                              {isInProgress && <span style={{ fontSize: '1.2rem' }}>⏳</span>}

                              {check.html_url ? (
                                <a href={check.html_url} target="_blank" rel="noopener noreferrer">
                                  {check.name}
                                </a>
                              ) : (
                                <span>{check.name}</span>
                              )}

                              <Tag
                                variant={
                                  isSuccess ? 'success' : isFailure ? 'error' : isSkipped ? 'neutral' : 'warning'
                                }
                                size="small"
                              >
                                {check.conclusion || check.status}
                              </Tag>

                              {check.completed_at && (
                                <span className={styles.textSubtle}>
                                  {new Date(check.completed_at).toLocaleString('no-NO', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </Box>
                  </Accordion.Content>
                </Accordion.Item>
              </Accordion>
            </div>
          )}

          {/* PR Commits */}
          {deployment.github_pr_data?.commits && deployment.github_pr_data.commits.length > 0 && (
            <div>
              <Accordion>
                <Accordion.Item>
                  <Accordion.Header>Commits i PR ({deployment.github_pr_data.commits.length})</Accordion.Header>
                  <Accordion.Content>
                    <Box background="neutral-soft" padding="space-16" borderRadius="12">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {deployment.github_pr_data.commits.map((commit) => (
                          <div
                            key={commit.sha}
                            style={{
                              display: 'flex',
                              gap: '0.75rem',
                              padding: '0.5rem',
                              background: 'var(--a-surface-default)',
                              borderRadius: '0.5rem',
                            }}
                          >
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
                                <span className={styles.textSubtle}>{commit.author.username}</span>
                                <span className={styles.textSubtle}>
                                  {new Date(commit.date).toLocaleString('no-NO', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </span>
                              </div>
                              <BodyShort style={{ marginTop: '0.25rem' }}>{commit.message.split('\n')[0]}</BodyShort>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Box>
                  </Accordion.Content>
                </Accordion.Item>
              </Accordion>
            </div>
          )}

          {/* Unreviewed commits warning */}
          {deployment.github_pr_data?.unreviewed_commits && deployment.github_pr_data.unreviewed_commits.length > 0 && (
            <div>
              <Alert variant="error">
                <Heading size="small" spacing>
                  ⚠️ Ureviewed commits funnet
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
                          <span className={styles.textSubtle}>{commit.author}</span>
                          <span className={styles.textSubtle}>
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
                        <Detail style={{ marginTop: '0.5rem', color: 'var(--a-text-danger)' }}>{commit.reason}</Detail>
                      </div>
                    </div>
                  </Box>
                ))}
              </div>

              {/* Manual approval section */}
              {manualApproval ? (
                <Alert variant="success">
                  <Heading size="small">✅ Manuelt godkjent</Heading>
                  <BodyShort>
                    Godkjent av <strong>{manualApproval.approved_by}</strong> den{' '}
                    {new Date(manualApproval.approved_at!).toLocaleDateString('no-NO', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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
                          <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            onClick={() => setShowApprovalForm(false)}
                          >
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
        </Box>
      )}

      {/* Comments section */}
      <div>
        <Heading size="medium" spacing>
          Kommentarer
        </Heading>

        {comments.length === 0 ? (
          <BodyShort className={styles.textSubtleItalic}>Ingen kommentarer ennå.</BodyShort>
        ) : (
          <div className={styles.commentsContainer}>
            {comments.map((comment) => (
              <Box key={comment.id} borderWidth="1" padding="space-16">
                <div className={styles.commentPanel}>
                  <div className={styles.commentContent}>
                    <Detail>
                      {new Date(comment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </Detail>
                    <BodyShort spacing>{comment.comment_text}</BodyShort>
                    {comment.slack_link && (
                      <BodyShort size="small">
                        <a href={comment.slack_link} target="_blank" rel="noopener noreferrer">
                          🔗 Slack-lenke
                        </a>
                      </BodyShort>
                    )}
                  </div>
                  <Form method="post" className={styles.commentActions}>
                    <input type="hidden" name="intent" value="delete_comment" />
                    <input type="hidden" name="comment_id" value={comment.id} />
                    <Button type="submit" size="small" variant="tertiary" icon={<TrashIcon aria-hidden />}>
                      Slett
                    </Button>
                  </Form>
                </div>
              </Box>
            ))}
          </div>
        )}
      </div>

      <Box borderWidth="1" padding="space-16">
        <Heading size="small" spacing>
          <ChatIcon aria-hidden /> Legg til kommentar
        </Heading>
        <Form method="post">
          <input type="hidden" name="intent" value="add_comment" />
          <div className={styles.commentForm}>
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
            <div>
              <Button type="submit">Legg til kommentar</Button>
            </div>
          </div>
        </Form>
      </Box>
    </div>
  )
}
