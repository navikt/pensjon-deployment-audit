import { ChatIcon, TrashIcon } from '@navikt/aksel-icons';
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
import { createComment, deleteComment, getCommentsByDeploymentId } from '../db/comments';
import { getDeploymentById } from '../db/deployments';
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

  const repoMismatch =
    deployment.detected_github_owner !== deployment.approved_github_owner ||
    deployment.detected_github_repo_name !== deployment.approved_github_repo_name;

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

      {repoMismatch && (
        <Alert variant="error">
          <Heading size="small" spacing>
            ⚠️ Repository mismatch oppdaget
          </Heading>
          <BodyShort>
            Dette deploymentet kom fra et annet repository enn forventet. Dette kan være et
            sikkerhetsproblem.
          </BodyShort>
          <div className={styles.marginTop1}>
            <Label>Forventet:</Label>
            <BodyShort>
              {deployment.approved_github_owner}/{deployment.approved_github_repo_name}
            </BodyShort>
            <Label className={styles.marginTop05}>Detektert:</Label>
            <BodyShort className={styles.textDangerBold}>
              {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
            </BodyShort>
          </div>
        </Alert>
      )}

      <Alert variant={status.variant}>
        <Heading size="small" spacing>
          {status.text}
        </Heading>
        <BodyShort>{status.description}</BodyShort>
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
          <BodyShort>{deployment.deployer_username}</BodyShort>
        </div>

        <div>
          <Detail>Repository (detektert)</Detail>
          <BodyShort>
            <a
              href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`}
              target="_blank"
              rel="noopener noreferrer"
              className={repoMismatch ? styles.linkDanger : styles.linkExternal}
            >
              {repoMismatch && '⚠️ '}
              {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
            </a>
          </BodyShort>
        </div>

        <div>
          <Detail>Commit SHA</Detail>
          <BodyShort>
            <a
              href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.codeMedium}
            >
              {deployment.commit_sha.substring(0, 7)}
            </a>
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
