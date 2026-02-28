import { AsyncLocalStorage } from 'node:async_hooks'
import winston from 'winston'
import { logSyncJobMessage } from '~/db/sync-jobs.server'

// =============================================================================
// Job Context via AsyncLocalStorage
// =============================================================================

interface JobContext {
  jobId: number
  debug: boolean
}

const jobContextStorage = new AsyncLocalStorage<JobContext>()

/**
 * Run a function within a sync job context.
 * All logger calls within this context will also write to the job's DB log.
 */
export function runWithJobContext<T>(jobId: number, debug: boolean, fn: () => Promise<T>): Promise<T> {
  return jobContextStorage.run({ jobId, debug }, fn)
}

function getJobContext(): JobContext | undefined {
  return jobContextStorage.getStore()
}

// =============================================================================
// Winston Configuration
// =============================================================================

const isProd = process.env.NODE_ENV === 'production'

const applicationVersion = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'unknown'

const winstonLogger = winston.createLogger({
  level: 'debug',
  defaultMeta: { applicationVersion },
  format: isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  transports: [new winston.transports.Console()],
})

// =============================================================================
// Dual Logger (console + DB when in job context)
// =============================================================================

function stripEmoji(message: string): string {
  return message.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim()
}

function logToDb(level: 'info' | 'warn' | 'error' | 'debug', message: string, details?: Record<string, unknown>) {
  const ctx = getJobContext()
  if (!ctx) return
  if (level === 'debug' && !ctx.debug) return

  // Fire-and-forget to avoid slowing down the sync loop
  logSyncJobMessage(ctx.jobId, level, stripEmoji(message), details).catch(() => {})
}

export const logger = {
  info(message: string, details?: Record<string, unknown>) {
    winstonLogger.info(message)
    logToDb('info', message, details)
  },
  warn(message: string, details?: Record<string, unknown>) {
    winstonLogger.warn(message)
    logToDb('warn', message, details)
  },
  error(message: string, errorOrDetails?: unknown) {
    if (errorOrDetails instanceof Error) {
      winstonLogger.error(message, {
        error: errorOrDetails.message,
        stack_trace: errorOrDetails.stack,
      })
      logToDb('error', message, {
        error: errorOrDetails.message,
        stack_trace: errorOrDetails.stack,
      })
    } else {
      winstonLogger.error(message)
      logToDb('error', message, errorOrDetails as Record<string, unknown>)
    }
  },
  debug(message: string, details?: Record<string, unknown>) {
    winstonLogger.debug(message)
    logToDb('debug', message, details)
  },
}
