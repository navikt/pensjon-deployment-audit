/**
 * Server-side initialization module
 * This is imported from root.tsx and runs once when the server starts
 */

import { logger } from './lib/logger.server'
import { startReminderScheduler } from './lib/reminder-scheduler.server'
import { registerShutdownHandlers } from './lib/shutdown.server'
import { isSlackConfigured, startSlackConnection } from './lib/slack'
import { startPeriodicSync } from './lib/sync'

let initialized = false

export function initializeServer(): void {
  if (initialized) return
  initialized = true

  // Register graceful shutdown handlers
  registerShutdownHandlers()

  // Only start periodic sync in production or when explicitly enabled
  const enablePeriodicSync = process.env.ENABLE_PERIODIC_SYNC === 'true' || process.env.NODE_ENV === 'production'

  if (enablePeriodicSync) {
    logger.info('🚀 Initializing server-side services...')
    startPeriodicSync()
  } else {
    logger.info('⏸️ Periodic sync disabled (set ENABLE_PERIODIC_SYNC=true to enable)')
  }

  // Start Slack connection if configured
  if (isSlackConfigured()) {
    logger.info('🔌 Starting Slack Socket Mode connection...')
    startSlackConnection().catch((err) => {
      logger.error('Failed to start Slack connection:', err)
    })
    // Start reminder scheduler alongside Slack
    startReminderScheduler()
  } else {
    logger.info('💬 Slack not configured (set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to enable)')
  }
}
