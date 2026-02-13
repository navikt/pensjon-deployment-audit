/**
 * Slack Integration using Bolt.js with Socket Mode
 *
 * Provides functionality for:
 * - Sending deployment notifications to Slack channels
 * - Interactive buttons for approval/rejection
 * - Updating messages when deployment status changes
 *
 * Environment variables:
 * - SLACK_BOT_TOKEN: Bot User OAuth Token (xoxb-...)
 * - SLACK_APP_TOKEN: App-Level Token for Socket Mode (xapp-...)
 * - SLACK_CHANNEL_ID: Default channel for notifications
 */

import { App, type BlockAction, LogLevel } from '@slack/bolt'
import type { KnownBlock } from '@slack/types'
import {
  claimDeploymentForSlackNotification,
  getAppsWithIssues,
  getHomeTabSummaryStats,
  getIssueDeploymentsPerApp,
} from '~/db/deployments.server'
import {
  createSlackNotification,
  getSlackNotificationByMessage,
  logSlackInteraction,
  updateSlackNotification,
} from '~/db/slack-notifications.server'
import { getUserMappingBySlackId } from '~/db/user-mappings.server'
import {
  buildDeploymentBlocks,
  buildHomeTabBlocks,
  type DeploymentNotification,
  getStatusEmoji,
  getStatusText,
} from './slack-blocks'

// Re-export types and functions from slack-blocks for backward compatibility
export type { DeploymentNotification, HomeTabInput } from './slack-blocks'
export { buildDeploymentBlocks, buildHomeTabBlocks, getStatusEmoji, getStatusText } from './slack-blocks'

// Singleton Slack app instance
let slackApp: App | null = null
let isConnected = false

/**
 * Check if Slack integration is configured
 */
export function isSlackConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN)
}

/**
 * Get or initialize the Slack app instance
 */
export function getSlackApp(): App | null {
  if (!isSlackConfigured()) {
    console.log('[Slack] Not configured (missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN)')
    return null
  }

  if (!slackApp) {
    console.log('[Slack] Initializing Slack app...')
    slackApp = new App({
      token: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
      logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
    })

    // Register action handlers
    registerActionHandlers(slackApp)
    console.log('[Slack] Action handlers registered')

    // Register event handlers
    registerEventHandlers(slackApp)
  }

  return slackApp
}

/**
 * Start the Slack Socket Mode connection
 * Should be called once at app startup
 */
export async function startSlackConnection(): Promise<void> {
  if (isConnected) return

  const app = getSlackApp()
  if (!app) {
    console.log('Slack not configured, skipping connection')
    return
  }

  try {
    await app.start()
    isConnected = true
    console.log('✅ Slack Socket Mode connection established')
  } catch (error) {
    console.error('❌ Failed to start Slack connection:', error)
  }
}

/**
 * Stop the Slack connection
 */
export async function stopSlackConnection(): Promise<void> {
  if (!isConnected || !slackApp) return

  try {
    await slackApp.stop()
    isConnected = false
    console.log('Slack connection stopped')
  } catch (error) {
    console.error('Failed to stop Slack connection:', error)
  }
}

/**
 * Send a deployment notification to Slack
 * Returns the message timestamp (ts) for later updates
 */
export async function sendDeploymentNotification(
  notification: DeploymentNotification,
  channelId?: string,
  sentBy?: string,
): Promise<string | null> {
  const app = getSlackApp()
  if (!app) {
    console.log('Slack not configured, skipping notification')
    return null
  }

  const channel = channelId || process.env.SLACK_CHANNEL_ID
  if (!channel) {
    console.error('No Slack channel configured')
    return null
  }

  const blocks = buildDeploymentBlocks(notification)
  const text = `${getStatusEmoji(notification.status)} Deployment: ${notification.appName} (${notification.environmentName})`

  try {
    const result = await app.client.chat.postMessage({
      channel,
      blocks: blocks as KnownBlock[],
      text,
    })

    const messageTs = result.ts
    if (messageTs) {
      // Store notification in database
      await createSlackNotification({
        deploymentId: notification.deploymentId,
        channelId: channel,
        messageTs,
        messageBlocks: blocks as unknown as Record<string, unknown>[],
        messageText: text,
        sentBy,
      })
    }

    return messageTs || null
  } catch (error) {
    console.error('Failed to send Slack notification:', error)
    return null
  }
}

/**
 * Update an existing deployment notification
 */
export async function updateDeploymentNotification(
  messageTs: string,
  notification: DeploymentNotification,
  channelId?: string,
  triggeredBy?: string,
): Promise<boolean> {
  const app = getSlackApp()
  if (!app) return false

  const channel = channelId || process.env.SLACK_CHANNEL_ID
  if (!channel) return false

  const blocks = buildDeploymentBlocks(notification)
  const text = `${getStatusEmoji(notification.status)} Deployment: ${notification.appName} (${notification.environmentName})`

  try {
    await app.client.chat.update({
      channel,
      ts: messageTs,
      blocks: blocks as KnownBlock[],
      text,
    })

    // Log the update in database
    const existing = await getSlackNotificationByMessage(channel, messageTs)
    if (existing) {
      await updateSlackNotification(existing.id, {
        messageBlocks: blocks as unknown as Record<string, unknown>[],
        messageText: text,
        triggeredBy,
      })
    }

    return true
  } catch (error) {
    console.error('Failed to update Slack notification:', error)
    return false
  }
}

/**
 * Register action handlers for interactive components
 */
function registerActionHandlers(app: App): void {
  // Handle approve button click
  app.action<BlockAction>('approve_deployment', async ({ ack, body, client, action }) => {
    await ack()

    try {
      // Parse the action value
      const buttonAction = action as { value: string }
      const value = JSON.parse(buttonAction.value)
      const { deploymentId, appName } = value

      // Get user info
      const userId = body.user.id

      console.log(`Slack: User ${userId} approved deployment ${deploymentId}`)

      // Log the interaction
      if (body.channel?.id && body.message?.ts) {
        const notification = await getSlackNotificationByMessage(body.channel.id, body.message.ts)
        if (notification) {
          await logSlackInteraction({
            notificationId: notification.id,
            actionId: 'approve_deployment',
            slackUserId: userId,
            slackUsername: 'username' in body.user ? body.user.username : undefined,
            actionValue: value,
          })
        }

        // TODO: Call the actual approval logic
        // For now, just update the message to show it was approved
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Deployment godkjent*\n\nApp: ${appName}\nGodkjent av: <@${userId}>`,
              },
            },
          ],
          text: `Deployment ${deploymentId} godkjent av ${userId}`,
        })
      }
    } catch (error) {
      console.error('Error handling approve action:', error)
    }
  })

  // View details is a link button, but we log the interaction
  app.action<BlockAction>('view_details', async ({ ack, body, action }) => {
    await ack()

    try {
      if (body.channel?.id && body.message?.ts) {
        const buttonAction = action as { value?: string }
        const value = buttonAction.value ? JSON.parse(buttonAction.value) : {}

        const notification = await getSlackNotificationByMessage(body.channel.id, body.message.ts)
        if (notification) {
          await logSlackInteraction({
            notificationId: notification.id,
            actionId: 'view_details',
            slackUserId: body.user.id,
            slackUsername: 'username' in body.user ? body.user.username : undefined,
            actionValue: value,
          })
        }
      }
    } catch (error) {
      console.error('Error logging view_details interaction:', error)
    }
  })
}

/**
 * Send notification for a deployment if needed.
 * Uses atomic database claim to prevent duplicate notifications across pods.
 *
 * @param deployment - Deployment with app info (must include app_slack_channel_id)
 * @param baseUrl - Base URL for links (e.g., https://pensjon-deployment-audit.ansatt.nav.no)
 * @returns true if notification was sent, false if skipped (already sent or not configured)
 */
export async function notifyDeploymentIfNeeded(
  deployment: {
    id: number
    monitored_app_id: number
    commit_sha: string | null
    deployer_username: string | null
    github_pr_number: number | null
    github_pr_url: string | null
    github_pr_data: { title: string } | null
    four_eyes_status: string
    title: string | null
    slack_message_ts: string | null
    team_slug: string
    environment_name: string
    app_name: string
    app_slack_channel_id?: string | null
    slack_notifications_enabled?: boolean
  },
  baseUrl: string,
): Promise<boolean> {
  // Skip if already notified
  if (deployment.slack_message_ts) {
    return false
  }

  // Skip if Slack not enabled for this app
  if (!deployment.slack_notifications_enabled || !deployment.app_slack_channel_id) {
    return false
  }

  const app = getSlackApp()
  if (!app) {
    return false
  }

  const channelId = deployment.app_slack_channel_id

  // Determine status for notification
  const status = mapFourEyesStatus(deployment.four_eyes_status)

  // Only notify for deployments needing attention
  if (status === 'approved') {
    return false
  }

  // Build notification
  const notification: DeploymentNotification = {
    deploymentId: deployment.id,
    appName: deployment.app_name,
    environmentName: deployment.environment_name,
    teamSlug: deployment.team_slug,
    commitSha: deployment.commit_sha || 'unknown',
    commitMessage: deployment.title || deployment.github_pr_data?.title,
    deployerName: deployment.deployer_username || 'ukjent',
    deployerUsername: deployment.deployer_username || 'unknown',
    prNumber: deployment.github_pr_number || undefined,
    prUrl: deployment.github_pr_url || undefined,
    status,
    detailsUrl: `${baseUrl}/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}`,
  }

  // Send to Slack
  const messageTs = await sendDeploymentNotification(notification, channelId)
  if (!messageTs) {
    return false
  }

  // Atomically claim this deployment (prevents duplicates across pods)
  const claimed = await claimDeploymentForSlackNotification(deployment.id, channelId, messageTs)

  if (!claimed) {
    // Another pod already claimed it - delete our duplicate message
    try {
      await app.client.chat.delete({
        channel: channelId,
        ts: messageTs,
      })
    } catch {
      // Ignore deletion errors
    }
    return false
  }

  console.log(`Slack notification sent for deployment ${deployment.id} to channel ${channelId}`)
  return true
}

/**
 * Map four_eyes_status to notification status
 */
function mapFourEyesStatus(status: string): DeploymentNotification['status'] {
  switch (status) {
    case 'verified':
    case 'legacy_verified':
    case 'implicit_verified':
      return 'approved'
    case 'pending':
    case 'unverified':
      return 'unverified'
    case 'rejected':
      return 'rejected'
    default:
      return 'pending_approval'
  }
}

/**
 * Register event handlers for Slack events
 */
function registerEventHandlers(app: App): void {
  // Handle Home Tab opened
  app.event('app_home_opened', async ({ event, client }) => {
    console.log('[Slack Home Tab] Event received:', { user: event.user, tab: event.tab })

    try {
      const userId = event.user

      // Try to find matching GitHub username from user mappings using Slack member ID
      console.log('[Slack Home Tab] Looking up user mapping for Slack ID:', userId)
      const userMapping = await getUserMappingBySlackId(userId)
      const githubUsername = userMapping?.github_username
      console.log('[Slack Home Tab] User mapping result:', { githubUsername, hasMapping: !!userMapping })

      // Fetch data for Home Tab
      console.log('[Slack Home Tab] Fetching data...')

      const [stats, appsWithIssues] = await Promise.all([getHomeTabSummaryStats(), getAppsWithIssues()])

      // Fetch sample issue deployments per app
      const issueDeployments = await getIssueDeploymentsPerApp(appsWithIssues, 3)

      console.log('[Slack Home Tab] Data fetched:', {
        stats,
        appsWithIssuesCount: appsWithIssues.length,
      })

      // Build and publish Home Tab
      const blocks = buildHomeTabBlocks({
        slackUserId: userId,
        githubUsername,
        baseUrl: process.env.BASE_URL || 'https://pensjon-deployment-audit.ansatt.nav.no',
        stats,
        appsWithIssues,
        issueDeployments,
      })
      console.log('[Slack Home Tab] Built blocks, count:', blocks.length)

      console.log('[Slack Home Tab] Publishing view...')
      await client.views.publish({
        user_id: userId,
        view: {
          type: 'home',
          blocks,
        },
      })
      console.log('[Slack Home Tab] View published successfully')
    } catch (error) {
      console.error('[Slack Home Tab] Error updating Home Tab:', error)
    }
  })

  console.log('[Slack] Event handlers registered (app_home_opened)')
}
