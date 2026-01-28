import {
  ArrowsCirclepathIcon,
  ChatIcon,
  CheckmarkCircleIcon,
  MinusCircleIcon,
  TrashIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons';
import {
  Alert,
  BodyShort,
  Button,
  Detail,
  Heading,
  Label,
  Panel,
  Tag,
  Textarea,
  TextField,
} from '@navikt/ds-react';
import { useState } from 'react';
import { Form, Link } from 'react-router';
import { createComment, deleteComment, getCommentsByDeploymentId } from '../db/comments.server';
import { getDeploymentById } from '../db/deployments.server';
import { verifyDeploymentFourEyes } from '../lib/sync.server';
import styles from '../styles/common.module.css';
import type { Route } from './+types/deployments.$id';

export async function loader({ params }: Route.LoaderArgs) {
  const deploymentId = parseInt(params.id, 10);
  const deployment = await getDeploymentById(deploymentId);

  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 });
  }

  const comments = await getCommentsByDeploymentId(deploymentId);

  return { deployment, comments };
}

export async function action({ request, params }: Route.ActionArgs) {
  const deploymentId = parseInt(params.id, 10);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'add_comment') {
    const commentText = formData.get('comment_text') as string;
    const slackLink = formData.get('slack_link') as string;

    if (!commentText || commentText.trim() === '') {
      return { error: 'Kommentar kan ikke være tom' };
    }

    try {
      await createComment({
        deployment_id: deploymentId,
        comment_text: commentText.trim(),
        slack_link: slackLink || undefined,
      });
      return { success: 'Kommentar lagt til' };
    } catch (_error) {
      return { error: 'Kunne ikke legge til kommentar' };
    }
  }

  if (intent === 'delete_comment') {
    const commentId = parseInt(formData.get('comment_id') as string, 10);
    try {
      await deleteComment(commentId);
      return { success: 'Kommentar slettet' };
    } catch (_error) {
      return { error: 'Kunne ikke slette kommentar' };
    }
  }

  if (intent === 'verify_four_eyes') {
    const deployment = await getDeploymentById(deploymentId);

    if (!deployment) {
      return { error: 'Deployment ikke funnet' };
    }

    // Check if deployment has required data
    if (!deployment.commit_sha) {
      return { error: 'Kan ikke verifisere: deployment mangler commit SHA' };
    }

    if (!deployment.detected_github_owner || !deployment.detected_github_repo_name) {
      return { error: 'Kan ikke verifisere: deployment mangler repository info' };
    }

    try {
      console.log(`🔍 Manually verifying deployment ${deployment.nais_deployment_id}...`);

      const success = await verifyDeploymentFourEyes(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`
      );

      if (success) {
        return { success: '✅ Four-eyes status verifisert og oppdatert' };
      } else {
        return { error: 'Verifisering feilet - se logger for detaljer' };
      }
    } catch (error) {
      console.error('Verification error:', error);
      if (error instanceof Error && error.message.includes('rate limit')) {
        return { error: '⚠️ GitHub rate limit nådd. Prøv igjen senere.' };
      }
      return {
        error: `Kunne ikke verifisere: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
      };
    }
  }

  return null;
}

function getFourEyesStatus(deployment: any): {
  text: string;
  variant: 'success' | 'warning' | 'error' | 'info';
  description: string;
} {
  if (deployment.has_four_eyes) {
    return {
      text: 'Four-eyes OK',
      variant: 'success',
      description: 'Dette deploymentet har blitt godkjent via en approved PR.',
    };
  }

  switch (deployment.four_eyes_status) {
    case 'approved_pr':
      return {
        text: 'Four-eyes OK',
        variant: 'success',
        description: 'Dette deploymentet har blitt godkjent via en approved PR.',
      };
    case 'legacy':
      return {
        text: 'Legacy (før 2025)',
        variant: 'success',
        description:
          'Dette deploymentet er for en legacy deployment og mangler informasjon om commit. Deploymentet er ignorert.',
      };
    case 'direct_push':
      return {
        text: 'Direct push',
        variant: 'warning',
        description: 'Dette var en direct push til main. Legg til Slack-lenke som bevis på review.',
      };
    case 'missing':
      return {
        text: 'Mangler godkjenning',
        variant: 'error',
        description:
          'PR-en var ikke godkjent etter siste commit, eller godkjenningen kom før siste commit.',
      };
    case 'error':
      return {
        text: 'Feil ved verifisering',
        variant: 'error',
        description: 'Det oppstod en feil ved sjekk av GitHub.',
      };
    default:
      return {
        text: 'Ukjent status',
        variant: 'info',
        description: 'Status for four-eyes kunne ikke fastslås.',
      };
  }
}

export default function DeploymentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { deployment, comments } = loaderData;
  const [commentText, setCommentText] = useState('');
  const [slackLink, setSlackLink] = useState('');

  const status = getFourEyesStatus(deployment);

  // Extract app name from deployment (might not match exactly, but we have it in the data)
  const appName = deployment.app_name || deployment.detected_github_repo_name;
  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${deployment.team_slug}/${deployment.environment_name}/app/${appName}`;

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
          {deployment.commit_sha && (
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

      <div className={styles.detailsGrid}>
        <div>
          <Detail>Applikasjon</Detail>
          <BodyShort>
            <strong>{deployment.app_name}</strong>
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
          <BodyShort>{deployment.deployer_username || '(ukjent)'}</BodyShort>
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
          <BodyShort>
            <code className={styles.codeSmall}>{deployment.nais_deployment_id}</code>
          </BodyShort>
        </div>
      </div>

      {/* Resources section */}
      {deployment.resources && deployment.resources.length > 0 && (
        <div>
          <Heading size="small" spacing>
            Kubernetes Resources
          </Heading>
          <div className={styles.actionButtons}>
            {deployment.resources.map((resource: any, idx: number) => (
              <Tag key={idx} variant="info" size="small">
                {resource.kind}: {resource.name}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* PR Details section */}
      {deployment.github_pr_data && (
        <Panel>
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
                <BodyShort style={{ whiteSpace: 'pre-wrap' }}>
                  {deployment.github_pr_data.body}
                </BodyShort>
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

            <div>
              <Detail>Status</Detail>
              <div className={styles.actionButtons}>
                {deployment.github_pr_data.draft && (
                  <Tag variant="warning" size="small">
                    Draft
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
          </div>

          {/* Labels */}
          {deployment.github_pr_data.labels && deployment.github_pr_data.labels.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <Detail>Labels</Detail>
              <div className={styles.actionButtons}>
                {deployment.github_pr_data.labels.map((label, idx) => (
                  <Tag key={idx} variant="neutral" size="small">
                    {label}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          {/* Reviewers */}
          {deployment.github_pr_data.reviewers &&
            deployment.github_pr_data.reviewers.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <Detail>Reviewers</Detail>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {deployment.github_pr_data.reviewers.map((reviewer, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {reviewer.state === 'APPROVED' && (
                        <span style={{ fontSize: '1.2rem' }}>✅</span>
                      )}
                      {reviewer.state === 'CHANGES_REQUESTED' && (
                        <span style={{ fontSize: '1.2rem' }}>🔴</span>
                      )}
                      {reviewer.state === 'COMMENTED' && (
                        <span style={{ fontSize: '1.2rem' }}>💬</span>
                      )}
                      <a
                        href={`https://github.com/${reviewer.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
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
              <Detail>GitHub Checks ({deployment.github_pr_data.checks.length})</Detail>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  marginTop: '0.5rem',
                }}
              >
                {deployment.github_pr_data.checks.map((check, idx) => {
                  const isSuccess = check.conclusion === 'success';
                  const isFailure =
                    check.conclusion === 'failure' ||
                    check.conclusion === 'timed_out' ||
                    check.conclusion === 'action_required';
                  const isSkipped =
                    check.conclusion === 'skipped' ||
                    check.conclusion === 'neutral' ||
                    check.conclusion === 'cancelled';
                  const isInProgress = check.status === 'in_progress' || check.status === 'queued';

                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {isSuccess && (
                        <CheckmarkCircleIcon
                          style={{ color: 'var(--a-icon-success)', fontSize: '1.2rem' }}
                        />
                      )}
                      {isFailure && (
                        <XMarkOctagonIcon
                          style={{ color: 'var(--a-icon-danger)', fontSize: '1.2rem' }}
                        />
                      )}
                      {isSkipped && (
                        <MinusCircleIcon
                          style={{ color: 'var(--a-icon-subtle)', fontSize: '1.2rem' }}
                        />
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
                          isSuccess
                            ? 'success'
                            : isFailure
                              ? 'error'
                              : isSkipped
                                ? 'neutral'
                                : 'warning'
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
                  );
                })}
              </div>
            </div>
          )}
        </Panel>
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
              <Panel key={comment.id} border>
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
                    <Button
                      type="submit"
                      size="small"
                      variant="tertiary"
                      icon={<TrashIcon aria-hidden />}
                    >
                      Slett
                    </Button>
                  </Form>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>

      <Panel border>
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
      </Panel>
    </div>
  );
}
