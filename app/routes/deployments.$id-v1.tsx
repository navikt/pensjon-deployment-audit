import { ChatIcon, TrashIcon } from '@navikt/aksel-icons';
import {
  Alert,
  BodyShort,
  Button,
  Detail,
  Heading,
  Label,
  Panel,
  Textarea,
  TextField,
} from '@navikt/ds-react';
import { useState } from 'react';
import { Form, Link } from 'react-router';
import { createComment, deleteComment, getCommentsByDeploymentId } from '../db/comments';
import { getDeploymentById } from '../db/deployments';
import { getRepositoryById } from '../db/repositories';
import type { Route } from './+types/deployments.$id';

export async function loader({ params }: Route.LoaderArgs) {
  const deploymentId = parseInt(params.id, 10);
  const deployment = await getDeploymentById(deploymentId);

  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 });
  }

  const repo = await getRepositoryById(deployment.repo_id);
  const comments = await getCommentsByDeploymentId(deploymentId);

  return { deployment, repo, comments };
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
    case 'direct_push':
      return {
        text: 'Direct push',
        variant: 'warning',
        description: 'Dette var en direct push til main. Legg til Slack-lenke som bevis på review.',
      };
    case 'pr_not_approved':
      return {
        text: 'PR ikke godkjent',
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
  const { deployment, repo, comments } = loaderData;
  const [commentText, setCommentText] = useState('');
  const [slackLink, setSlackLink] = useState('');

  const status = getFourEyesStatus(deployment);
  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${deployment.team_slug}/${deployment.environment_name}/app/${deployment.repository.split('/')[1]}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <Detail>Deployment</Detail>
        <Heading size="large">
          {deployment.repository} @ {deployment.environment_name}
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
        <Heading size="small" spacing>
          {status.text}
        </Heading>
        <BodyShort>{status.description}</BodyShort>
      </Alert>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
        <div>
          <Detail>Repository</Detail>
          <BodyShort>
            <Link to={`/repos/${repo?.id}`}>{deployment.repository}</Link>
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
          <Detail>Commit SHA</Detail>
          <BodyShort>
            <a
              href={`https://github.com/${deployment.repository}/commit/${deployment.commit_sha}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'monospace' }}
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

        <div>
          <Detail>Nais Console</Detail>
          <BodyShort>
            <a href={naisConsoleUrl} target="_blank" rel="noopener noreferrer">
              Åpne i Nais Console
            </a>
          </BodyShort>
        </div>

        {deployment.trigger_url && (
          <div>
            <Detail>GitHub Actions</Detail>
            <BodyShort>
              <a href={deployment.trigger_url} target="_blank" rel="noopener noreferrer">
                Se workflow
              </a>
            </BodyShort>
          </div>
        )}
      </div>

      <div>
        <Heading size="medium" spacing>
          Kommentarer ({comments.length})
        </Heading>

        {comments.length === 0 ? (
          <Alert variant="info">Ingen kommentarer ennå. Legg til en kommentar under.</Alert>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {comments.map((comment) => (
              <Panel key={comment.id} border>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <BodyShort>{comment.comment_text}</BodyShort>
                  {comment.slack_link && (
                    <div>
                      <Label size="small">Slack-lenke:</Label>
                      <BodyShort>
                        <a href={comment.slack_link} target="_blank" rel="noopener noreferrer">
                          {comment.slack_link}
                        </a>
                      </BodyShort>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <Detail>{new Date(comment.created_at).toLocaleString('no-NO')}</Detail>
                    <Form method="post" style={{ display: 'inline' }}>
                      <input type="hidden" name="intent" value="delete_comment" />
                      <input type="hidden" name="comment_id" value={comment.id} />
                      <Button
                        type="submit"
                        size="xsmall"
                        variant="tertiary"
                        icon={<TrashIcon aria-hidden />}
                      >
                        Slett
                      </Button>
                    </Form>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>

      <Panel border>
        <Form
          method="post"
          onSubmit={() => {
            setCommentText('');
            setSlackLink('');
          }}
        >
          <input type="hidden" name="intent" value="add_comment" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <Heading size="small">Legg til kommentar</Heading>

            <Textarea
              label="Kommentar"
              name="comment_text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              description="Beskriv konteksten eller legg til notater om deploymentet"
              rows={3}
            />

            <TextField
              label="Slack-lenke (valgfri)"
              name="slack_link"
              value={slackLink}
              onChange={(e) => setSlackLink(e.target.value)}
              description="Lenke til Slack-tråd som bevis på review for direct pushes"
              placeholder="https://nav-it.slack.com/archives/..."
            />

            <Button type="submit" icon={<ChatIcon aria-hidden />}>
              Legg til kommentar
            </Button>
          </div>
        </Form>
      </Panel>
    </div>
  );
}
