import type {
  DeploymentNotification,
  DeviationNotification,
  HomeTabInput,
  NewDeploymentNotification,
  ReminderNotification,
} from '~/lib/slack'

const BASE_URL = 'https://pensjon-deployment-audit.ansatt.nav.no'

// =============================================================================
// Deployment Notification Fixtures
// =============================================================================

const base = {
  deploymentId: 42,
  appName: 'pensjon-pen',
  environmentName: 'prod-gcp',
  teamSlug: 'pensjondeployer',
  commitSha: 'abc1234def5678',
  deployerName: 'Ola Nordmann',
  deployerUsername: 'o123456',
  detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen/deployments/42`,
} satisfies Omit<DeploymentNotification, 'status'>

export const deploymentFixtures = {
  unverified: {
    ...base,
    status: 'unverified' as const,
    commitMessage: 'feat: legg til ny pensjonsberegning for AFP',
    prNumber: 123,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/123',
  },

  unverifiedWithoutPr: {
    ...base,
    status: 'unverified' as const,
    commitMessage: 'hotfix: fiks kritisk feil i pensjonsberegning',
  },

  pending: {
    ...base,
    status: 'pending_approval' as const,
    prNumber: 456,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/456',
    commitMessage: 'chore: oppdater avhengigheter',
  },

  approved: {
    ...base,
    status: 'approved' as const,
    prNumber: 789,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/789',
    commitMessage: 'fix: korriger beregning av uføretrygd',
  },

  rejected: {
    ...base,
    status: 'rejected' as const,
    commitMessage: 'Merge branch "feature/experimental" into main',
  },

  longCommitMessage: {
    ...base,
    status: 'unverified' as const,
    commitMessage:
      'feat: implementer ny beregningsmodell for alderspensjon med støtte for gradert uttak og fleksibelt uttak fra 62 år med nye samordningsregler',
    prNumber: 999,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/999',
  },
} satisfies Record<string, DeploymentNotification>

// =============================================================================
// Home Tab Fixtures
// =============================================================================

const issueDeploymentsMap = new Map([
  [
    'pensjondeployer/prod-gcp/pensjon-pen',
    [
      {
        id: 100,
        commit_sha: 'abc1234',
        deployer_username: 'o123456',
        four_eyes_status: 'unverified_commits',
        github_pr_number: 123,
        github_pr_data: { title: 'feat: ny pensjonsberegning', creator: { username: 'dev-user' } },
        title: 'feat: ny pensjonsberegning',
        created_at: new Date('2026-02-13T10:00:00Z'),
        app_name: 'pensjon-pen',
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
      },
      {
        id: 101,
        commit_sha: 'def5678',
        deployer_username: 'k654321',
        four_eyes_status: 'pending',
        github_pr_number: 124,
        github_pr_data: { title: 'chore: bump dependencies', creator: { username: 'dependabot[bot]' } },
        title: 'chore: bump dependencies',
        created_at: new Date('2026-02-13T09:00:00Z'),
        app_name: 'pensjon-pen',
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
      },
    ],
  ],
  [
    'pensjondeployer/prod-gcp/pensjon-selvbetjening',
    [
      {
        id: 200,
        commit_sha: '9876abc',
        deployer_username: 'o123456',
        four_eyes_status: 'direct_push',
        github_pr_number: null,
        github_pr_data: null,
        title: 'hotfix: fiks login-feil',
        created_at: new Date('2026-02-12T15:00:00Z'),
        app_name: 'pensjon-selvbetjening',
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
      },
    ],
  ],
])

export const homeTabFixtures = {
  withIssues: {
    slackUserId: 'U12345678',
    githubUsername: 'ola-nordmann',
    baseUrl: BASE_URL,
    stats: {
      totalApps: 12,
      totalDeployments: 847,
      withoutFourEyes: 23,
      pendingVerification: 5,
    },
    appsWithIssues: [
      {
        app_name: 'pensjon-pen',
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
        without_four_eyes: 15,
        pending_verification: 3,
        alert_count: 1,
      },
      {
        app_name: 'pensjon-selvbetjening',
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
        without_four_eyes: 8,
        pending_verification: 2,
        alert_count: 0,
      },
    ],
    issueDeployments: issueDeploymentsMap,
  },

  noIssues: {
    slackUserId: 'U12345678',
    githubUsername: 'kari-nordmann',
    baseUrl: BASE_URL,
    stats: {
      totalApps: 12,
      totalDeployments: 847,
      withoutFourEyes: 0,
      pendingVerification: 0,
    },
    appsWithIssues: [],
    issueDeployments: new Map(),
  },

  noGithubUser: {
    slackUserId: 'U99999999',
    githubUsername: null,
    baseUrl: BASE_URL,
    stats: {
      totalApps: 5,
      totalDeployments: 123,
      withoutFourEyes: 2,
      pendingVerification: 1,
    },
    appsWithIssues: [
      {
        app_name: 'pensjon-pen',
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
        without_four_eyes: 2,
        pending_verification: 1,
        alert_count: 0,
      },
    ],
    issueDeployments: new Map([
      [
        'pensjondeployer/prod-gcp/pensjon-pen',
        [
          {
            id: 300,
            commit_sha: 'aaa1111',
            deployer_username: null,
            four_eyes_status: 'unverified_commits',
            github_pr_number: null,
            github_pr_data: null,
            title: null,
            created_at: new Date('2026-02-11T08:00:00Z'),
            app_name: 'pensjon-pen',
            team_slug: 'pensjondeployer',
            environment_name: 'prod-gcp',
          },
        ],
      ],
    ]),
  },
} satisfies Record<string, HomeTabInput>

// =============================================================================
// Deviation Notification Fixtures
// =============================================================================

export const deviationFixtures = {
  standard: {
    deploymentId: 42,
    appName: 'pensjon-pen',
    environmentName: 'prod-gcp',
    teamSlug: 'pensjondeployer',
    commitSha: 'abc1234def5678',
    reason:
      'Deployment inneholder endringer som ikke var godkjent gjennom standard PR-prosess. Hastefix for kritisk feil i produksjon.',
    breachType: 'Brudd på rutine for endringshåndtering',
    intent: 'accidental',
    severity: 'high',
    followUpRole: 'delivery_lead',
    registeredByName: 'Kari Nordmann',
    detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen/deployments/42`,
  },

  shortReason: {
    deploymentId: 99,
    appName: 'pensjon-selvbetjening',
    environmentName: 'prod-gcp',
    teamSlug: 'pensjondeployer',
    commitSha: '9876abcdef1234',
    reason: 'Direct push til main uten PR.',
    registeredByName: 'Ola Nordmann',
    detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-selvbetjening/deployments/99`,
  },

  critical: {
    deploymentId: 150,
    appName: 'pensjon-opptjening',
    environmentName: 'prod-gcp',
    teamSlug: 'pensjondeployer',
    commitSha: 'deadbeef12345678',
    reason:
      'Deployment med uautorisert tilgang til personopplysninger. Mulig GDPR-brudd oppdaget i kode som ble deployet uten godkjenning.',
    breachType: 'Brudd på personvernforordningen (GDPR)',
    intent: 'malicious',
    severity: 'critical',
    followUpRole: 'section_lead',
    registeredByName: 'Per Hansen',
    detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-opptjening/deployments/150`,
  },
} satisfies Record<string, DeviationNotification>

// =============================================================================
// Reminder Notification Fixtures
// =============================================================================

const appUrl = `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen`

const reminderBase = {
  appName: 'pensjon-pen',
  environmentName: 'prod-gcp',
  teamSlug: 'pensjondeployer',
  deploymentsListUrl: `${appUrl}/deployments?status=not_approved&period=all`,
} satisfies Omit<ReminderNotification, 'deployments'>

export const reminderFixtures = {
  singleDeployment: {
    ...reminderBase,
    deployments: [
      {
        id: 9700,
        commitSha: 'abc1234def5678',
        commitMessage: 'feat: legg til ny pensjonsberegning for AFP',
        deployerName: 'Ola Nordmann',
        status: 'unverified',
        createdAt: '13. feb. 2026, 10:30',
        detailsUrl: `${appUrl}/deployments/9700`,
      },
    ],
  },

  fewDeployments: {
    ...reminderBase,
    deployments: [
      {
        id: 9700,
        commitSha: 'abc1234def5678',
        commitMessage: 'feat: legg til ny pensjonsberegning for AFP',
        deployerName: 'Ola Nordmann',
        status: 'unverified',
        createdAt: '13. feb. 2026, 10:30',
        detailsUrl: `${appUrl}/deployments/9700`,
      },
      {
        id: 9698,
        commitSha: 'def5678abc1234',
        commitMessage: 'chore: bump dependencies',
        deployerName: 'Kari Nordmann',
        status: 'pending_approval',
        createdAt: '12. feb. 2026, 14:15',
        detailsUrl: `${appUrl}/deployments/9698`,
      },
      {
        id: 9695,
        commitSha: '9876abcdef1234',
        commitMessage: 'hotfix: fiks kritisk feil i beregning',
        deployerName: 'Per Hansen',
        status: 'unverified',
        createdAt: '11. feb. 2026, 09:00',
        detailsUrl: `${appUrl}/deployments/9695`,
      },
    ],
  },

  manyDeployments: {
    ...reminderBase,
    deployments: Array.from({ length: 12 }, (_, i) => ({
      id: 9700 - i,
      commitSha: `${String(i).padStart(7, 'a')}b${String(i).padStart(6, 'c')}`,
      commitMessage: `fix: endring nummer ${i + 1}`,
      deployerName: i % 2 === 0 ? 'Ola Nordmann' : 'Kari Nordmann',
      status: i % 3 === 0 ? 'unverified' : 'pending_approval',
      createdAt: `${13 - Math.floor(i / 2)}. feb. 2026, ${9 + (i % 8)}:00`,
      detailsUrl: `${appUrl}/deployments/${9700 - i}`,
    })),
  },
} satisfies Record<string, ReminderNotification>

// =============================================================================
// New Deployment Notification Fixtures
// =============================================================================

const deployNotifyBase = {
  deploymentId: 42,
  appName: 'pensjon-pen',
  environmentName: 'prod-gcp',
  teamSlug: 'pensjondeployer',
  commitSha: 'abc1234def5678',
  deployerUsername: 'o123456',
  detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen/deployments/42`,
} satisfies Partial<NewDeploymentNotification>

export const newDeploymentFixtures = {
  withPr: {
    ...deployNotifyBase,
    fourEyesStatus: 'verified',
    deployMethod: 'pull_request' as const,
    prTitle: 'feat: legg til ny pensjonsberegning for AFP',
    prNumber: 123,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/123',
    prCreator: 'ola.nordmann',
    prApprovers: ['kari.nordmann', 'per.hansen'],
    prMerger: 'kari.nordmann',
    branchName: 'feature/afp-beregning',
    commitsCount: 3,
  },

  directPush: {
    ...deployNotifyBase,
    fourEyesStatus: 'no_pr',
    deployMethod: 'direct_push' as const,
  },

  violation: {
    ...deployNotifyBase,
    fourEyesStatus: 'self_approved',
    deployMethod: 'pull_request' as const,
    prTitle: 'hotfix: fiks kritisk feil i beregning',
    prNumber: 456,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/456',
    prCreator: 'per.hansen',
    prApprovers: [],
    prMerger: 'per.hansen',
    branchName: 'hotfix/beregning',
    commitsCount: 1,
  },

  legacy: {
    ...deployNotifyBase,
    fourEyesStatus: 'legacy_verified',
    deployMethod: 'legacy' as const,
    prTitle: 'chore: bump dependencies',
    prNumber: 789,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/789',
    prCreator: 'dependabot[bot]',
    prApprovers: ['ola.nordmann'],
    prMerger: 'ola.nordmann',
    branchName: 'dependabot/npm/lodash-4.17.21',
    commitsCount: 1,
  },
} satisfies Record<string, NewDeploymentNotification>
