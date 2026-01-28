import { Form, useNavigation } from 'react-router';
import { Alert, BodyShort, Button, Heading, TextField, Loader } from '@navikt/ds-react';
import { CheckmarkCircleIcon } from '@navikt/aksel-icons';
import { verifyDeploymentsFourEyes } from '../lib/sync';
import { getAllDeployments } from '../db/deployments';
import type { Route } from './+types/deployments.verify';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiser deployments - Pensjon Deployment Audit' }];
}

export async function loader() {
  // Get stats on unverified deployments
  const allDeployments = await getAllDeployments();

  const pending = allDeployments.filter((d) => d.four_eyes_status === 'pending').length;
  const missing = allDeployments.filter((d) => d.four_eyes_status === 'missing').length;
  const error = allDeployments.filter((d) => d.four_eyes_status === 'error').length;
  const needsVerification = pending + missing + error;

  return {
    stats: {
      total: allDeployments.length,
      needsVerification,
      pending,
      missing,
      error,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const limit = Number(formData.get('limit')) || 50;

  try {
    console.log(`🔍 Starting batch verification (limit: ${limit})`);

    const result = await verifyDeploymentsFourEyes({ limit });

    return {
      success: `✅ Verifisert ${result.verified} deployments. ${result.failed > 0 ? `❌ ${result.failed} feilet.` : ''} ${result.skipped > 0 ? `⏭️ ${result.skipped} hoppet over.` : ''}`,
      error: null,
      result,
    };
  } catch (error) {
    console.error('Batch verification error:', error);

    if (error instanceof Error && error.message.includes('rate limit')) {
      return {
        success: null,
        error: '⚠️ GitHub rate limit nådd! Vent 1 time før du prøver igjen.',
        result: null,
      };
    }

    return {
      success: null,
      error: error instanceof Error ? error.message : 'Kunne ikke verifisere deployments',
      result: null,
    };
  }
}

export default function DeploymentsVerify({ loaderData, actionData }: Route.ComponentProps) {
  const { stats } = loaderData;
  const navigation = useNavigation();
  const isVerifying = navigation.state === 'submitting';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <Heading size="large" spacing>
          Batch GitHub-verifisering
        </Heading>
        <BodyShort>
          Verifiser four-eyes status for flere deployments samtidig. Dette kaller GitHub API og
          bruker rate limit.
        </BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
          {actionData.result && (
            <div style={{ marginTop: '0.5rem' }}>
              <BodyShort size="small">
                Verifisert: {actionData.result.verified} • Feilet: {actionData.result.failed} •
                Hoppet over: {actionData.result.skipped}
              </BodyShort>
            </div>
          )}
        </Alert>
      )}

      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

      <div
        style={{
          padding: '1.5rem',
          background: '#f9f9f9',
          borderRadius: '0.5rem',
          border: '1px solid #ccc',
        }}
      >
        <Heading size="small" spacing>
          Status
        </Heading>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          <div>
            <BodyShort size="small" style={{ color: '#666' }}>
              Totalt deployments
            </BodyShort>
            <Heading size="medium">{stats.total}</Heading>
          </div>
          <div>
            <BodyShort size="small" style={{ color: '#ff9800' }}>
              Trenger verifisering
            </BodyShort>
            <Heading size="medium" style={{ color: '#ff9800' }}>
              {stats.needsVerification}
            </Heading>
          </div>
          <div>
            <BodyShort size="small" style={{ color: '#666' }}>
              Pending
            </BodyShort>
            <Heading size="medium">{stats.pending}</Heading>
          </div>
          <div>
            <BodyShort size="small" style={{ color: '#c30000' }}>
              Error
            </BodyShort>
            <Heading size="medium" style={{ color: '#c30000' }}>
              {stats.error}
            </Heading>
          </div>
        </div>
      </div>

      <Alert variant="info">
        <Heading size="small" spacing>
          Om GitHub Rate Limits
        </Heading>
        <BodyShort>
          GitHub har en rate limit på 5000 requests per time for autentiserte requests. Hver
          verifisering bruker 2-3 requests. Hvis du når limit, må du vente 1 time.
        </BodyShort>
      </Alert>

      <Form method="post">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
        </div>
      </Form>

      {isVerifying && (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
            background: '#f0f8ff',
            borderRadius: '0.5rem',
          }}
        >
          <Loader size="2xlarge" title="Verifiserer deployments med GitHub..." />
          <BodyShort style={{ marginTop: '1rem' }}>
            Dette kan ta litt tid. Ikke lukk vinduet.
          </BodyShort>
        </div>
      )}
    </div>
  );
}
