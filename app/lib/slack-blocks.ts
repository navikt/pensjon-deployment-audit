/**
 * Slack Block Kit block builders
 *
 * Pure functions that construct Slack Block Kit structures.
 * These are extracted from slack.server.ts to be usable in both
 * server context and browser context (Storybook previews).
 */

import type { KnownBlock } from '@slack/types'

// =============================================================================
// Types
// =============================================================================

export interface DeploymentNotification {
  deploymentId: number
  appName: string
  environmentName: string
  teamSlug: string
  commitSha: string
  commitMessage?: string
  deployerName: string
  deployerUsername: string
  prNumber?: number
  prUrl?: string
  status: 'unverified' | 'pending_approval' | 'approved' | 'rejected'
  detailsUrl: string
}

export interface HomeTabInput {
  slackUserId: string
  githubUsername: string | null | undefined
  baseUrl: string
  stats: {
    totalApps: number
    totalDeployments: number
    withoutFourEyes: number
    pendingVerification: number
  }
  appsWithIssues: Array<{
    app_name: string
    team_slug: string
    environment_name: string
    without_four_eyes: number
    pending_verification: number
    alert_count: number
  }>
  issueDeployments: Map<
    string,
    Array<{
      id: number
      commit_sha: string | null
      deployer_username: string | null
      four_eyes_status: string
      github_pr_number: number | null
      github_pr_data: { title?: string; creator?: { username?: string } } | null
      title: string | null
      created_at: Date
      app_name: string
      team_slug: string
      environment_name: string
    }>
  >
}

// =============================================================================
// Helpers
// =============================================================================

export function getStatusEmoji(status: DeploymentNotification['status']): string {
  switch (status) {
    case 'unverified':
      return '⚠️'
    case 'pending_approval':
      return '⏳'
    case 'approved':
      return '✅'
    case 'rejected':
      return '❌'
    default:
      return '📦'
  }
}

export function getStatusText(status: DeploymentNotification['status']): string {
  switch (status) {
    case 'unverified':
      return 'Uverifisert'
    case 'pending_approval':
      return 'Venter på godkjenning'
    case 'approved':
      return 'Godkjent'
    case 'rejected':
      return 'Avvist'
    default:
      return 'Ukjent'
  }
}

export interface DeviationNotification {
  deploymentId: number
  appName: string
  environmentName: string
  teamSlug: string
  commitSha: string
  reason: string
  registeredByName: string
  detailsUrl: string
}

// =============================================================================
// Block Builders
// =============================================================================

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text
}

/**
 * Build Slack Block Kit blocks for deployment notification
 */
export function buildDeploymentBlocks(notification: DeploymentNotification): KnownBlock[] {
  const shortSha = notification.commitSha.substring(0, 7)
  const statusEmoji = getStatusEmoji(notification.status)
  const statusText = getStatusText(notification.status)

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} Deployment krever oppmerksomhet`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*App:*\n${notification.appName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Miljø:*\n${notification.environmentName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Commit:*\n\`${shortSha}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${statusText}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Deployer:*\n${notification.deployerName}`,
        },
        {
          type: 'mrkdwn',
          text: notification.prNumber ? `*PR:*\n<${notification.prUrl}|#${notification.prNumber}>` : '*PR:*\nIngen',
        },
      ],
    },
  ]

  // Add commit message if available
  if (notification.commitMessage) {
    const truncatedMessage =
      notification.commitMessage.length > 100
        ? `${notification.commitMessage.substring(0, 100)}...`
        : notification.commitMessage
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Melding:*\n${truncatedMessage}`,
      },
    })
  }

  // Add description and link to app for review
  if (notification.status === 'unverified' || notification.status === 'pending_approval') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Denne deploymenten mangler godkjenning. Åpne deployment for å verifisere.',
      },
    })
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔍 Se deployment',
          emoji: true,
        },
        style:
          notification.status === 'unverified' || notification.status === 'pending_approval' ? 'primary' : undefined,
        action_id: 'view_details',
        url: notification.detailsUrl,
      },
    ],
  })

  // Add context with timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Team: ${notification.teamSlug} | ID: ${notification.deploymentId}`,
      },
    ],
  })

  return blocks
}

/**
 * Build blocks for deviation notification
 */
export function buildDeviationBlocks(notification: DeviationNotification): KnownBlock[] {
  const shortSha = notification.commitSha.substring(0, 7)

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '⚠️ Avvik registrert',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*App:*\n${notification.appName}` },
        { type: 'mrkdwn', text: `*Miljø:*\n${notification.environmentName}` },
        { type: 'mrkdwn', text: `*Commit:*\n\`${shortSha}\`` },
        { type: 'mrkdwn', text: `*Registrert av:*\n${notification.registeredByName}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Begrunnelse:*\n${notification.reason}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔍 Se deployment',
            emoji: true,
          },
          action_id: 'view_deviation',
          url: notification.detailsUrl,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Team: ${notification.teamSlug} | Deployment: ${notification.deploymentId}`,
        },
      ],
    },
  ]
}

/**
 * Build blocks for Slack Home Tab
 */
export function buildHomeTabBlocks({ baseUrl, stats, appsWithIssues, issueDeployments }: HomeTabInput): KnownBlock[] {
  const blocks: KnownBlock[] = []

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 Deployment Audit',
      emoji: true,
    },
  })

  blocks.push({ type: 'divider' })

  // Section 1: Overview stats
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*📈 Oversikt*',
    },
  })

  blocks.push({
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Overvåkede apper:*\n${stats.totalApps}`,
      },
      {
        type: 'mrkdwn',
        text: `*Totalt deployments:*\n${stats.totalDeployments}`,
      },
      {
        type: 'mrkdwn',
        text: `*⚠️ Mangler godkjenning:*\n${stats.withoutFourEyes}`,
      },
      {
        type: 'mrkdwn',
        text: `*⏳ Venter verifisering:*\n${stats.pendingVerification}`,
      },
    ],
  })

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🏠 Åpne dashboard',
          emoji: true,
        },
        url: baseUrl,
        action_id: 'open_dashboard',
      },
    ],
  })

  blocks.push({ type: 'divider' })

  // Section 2: Apps with issues + sample deployments
  if (appsWithIssues.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🔔 Applikasjoner med mangler* (${appsWithIssues.length})`,
      },
    })

    for (const app of appsWithIssues) {
      const issues: string[] = []
      if (app.without_four_eyes > 0) {
        issues.push(`⚠️ ${app.without_four_eyes} uten godkjenning`)
      }
      if (app.pending_verification > 0) {
        issues.push(`⏳ ${app.pending_verification} venter verifisering`)
      }
      if (app.alert_count > 0) {
        issues.push(`🚨 ${app.alert_count} varsler`)
      }

      const deploymentsUrl = `${baseUrl}/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/deployments?status=not_approved`
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${deploymentsUrl}|${app.app_name}>* (${app.environment_name})\n${issues.join('  •  ')}`,
        },
      })

      // Show sample deployments with issues for this app
      const key = `${app.team_slug}/${app.environment_name}/${app.app_name}`
      const deployments = issueDeployments.get(key)
      if (deployments && deployments.length > 0) {
        const lines = deployments.map((d) => {
          const shortSha = d.commit_sha?.substring(0, 7) || 'ukjent'
          const deployer = d.deployer_username || 'ukjent'
          const prAuthor = d.github_pr_data?.creator?.username
          const prTitle = d.github_pr_data?.title || d.title
          const prNumber = d.github_pr_number ? `#${d.github_pr_number}` : ''
          const statusEmoji = d.four_eyes_status === 'pending' ? '⏳' : '⚠️'

          let line = `${statusEmoji} \`${shortSha}\``
          if (prNumber && prTitle) {
            line += ` ${prNumber} _${prTitle.substring(0, 50)}${prTitle.length > 50 ? '…' : ''}_`
          }
          line += ` · ${prAuthor || deployer}`
          return line
        })

        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: lines.join('\n'),
            },
          ],
        })
      }
    }

    blocks.push({ type: 'divider' })
  }

  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Oppdatert ${new Date().toLocaleString('nb-NO')}_`,
      },
    ],
  })

  return blocks
}

// =============================================================================
// Reminder Blocks
// =============================================================================

export interface ReminderDeployment {
  id: number
  commitSha: string
  commitMessage?: string
  deployerName: string
  status: string
  createdAt: string
  detailsUrl: string
}

export interface ReminderNotification {
  appName: string
  environmentName: string
  teamSlug: string
  deployments: ReminderDeployment[]
  /** URL to the filtered deployment list */
  deploymentsListUrl: string
}

const REMINDER_DETAIL_LIMIT = 5

/**
 * Build Slack Block Kit blocks for a reminder notification.
 * Shows individual deployments if ≤5, otherwise a summary.
 */
export function buildReminderBlocks(notification: ReminderNotification): KnownBlock[] {
  const { appName, environmentName, deployments, deploymentsListUrl } = notification
  const count = deployments.length

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🔔 ${count} deployment${count === 1 ? '' : 's'} mangler godkjenning`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${appName}* (${environmentName})`,
      },
    },
  ]

  if (count <= REMINDER_DETAIL_LIMIT) {
    for (const dep of deployments) {
      const shortSha = dep.commitSha.substring(0, 7)
      const title = dep.commitMessage ? truncate(dep.commitMessage, 60) : `Commit ${shortSha}`
      const statusEmoji = getStatusEmoji(dep.status as DeploymentNotification['status'])

      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *<${dep.detailsUrl}|#${dep.id}>* ${title}\n\`${shortSha}\` — ${dep.deployerName} — ${dep.createdAt}`,
          },
        },
      )
    }
  } else {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Det er *${count} deployments* som mangler godkjenning. Gå til deployment-oversikten for å se detaljer.`,
        },
      },
    )
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📋 Se alle deployments',
            emoji: true,
          },
          action_id: 'view_reminder_deployments',
          url: deploymentsListUrl,
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Team: ${notification.teamSlug} | Automatisk påminnelse`,
        },
      ],
    },
  )

  return blocks
}
