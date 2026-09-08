import type { PoolClient } from 'pg'
import { logger } from '~/lib/logger.server'
import { pool } from './connection.server'

interface AppSetting {
  id: number
  monitored_app_id: number
  setting_key: string
  setting_value: Record<string, unknown>
  updated_at: Date
}

interface AppConfigAuditLogEntry {
  id: number
  monitored_app_id: number
  changed_by_nav_ident: string
  changed_by_name: string | null
  setting_key: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown>
  change_reason: string | null
  created_at: Date
}

export async function recordAppConfigAuditLog(
  params: {
    monitoredAppId: number
    settingKey: string
    oldValue: Record<string, unknown> | null
    newValue: Record<string, unknown>
    changedByNavIdent: string
    changedByName?: string
    changeReason?: string
  },
  client?: PoolClient,
): Promise<void> {
  const { monitoredAppId, settingKey, oldValue, newValue, changedByNavIdent, changedByName, changeReason } = params
  const queryable = client ?? pool

  await queryable.query(
    `INSERT INTO app_config_audit_log 
     (monitored_app_id, changed_by_nav_ident, changed_by_name, setting_key, old_value, new_value, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      monitoredAppId,
      changedByNavIdent,
      changedByName || null,
      settingKey,
      oldValue ? JSON.stringify(oldValue) : null,
      JSON.stringify(newValue),
      changeReason || null,
    ],
  )

  logger.info(
    `📝 Config audit log recorded for setting '${settingKey}' on app ${monitoredAppId} by ${changedByNavIdent}`,
  )
}

interface AppConfigAuditLogOptions {
  settingKey?: string | readonly string[]
  limit?: number
  offset?: number
}

export async function getAppConfigAuditLog(
  monitoredAppId: number,
  options?: AppConfigAuditLogOptions,
): Promise<AppConfigAuditLogEntry[]> {
  let query = 'SELECT * FROM app_config_audit_log WHERE monitored_app_id = $1'
  const params: (number | string | readonly string[])[] = [monitoredAppId]
  let paramIndex = 2

  if (options?.settingKey) {
    if (Array.isArray(options.settingKey)) {
      if (options.settingKey.length === 0) {
        return []
      }
      query += ` AND setting_key = ANY($${paramIndex++}::text[])`
      params.push(options.settingKey)
    } else {
      query += ` AND setting_key = $${paramIndex++}`
      params.push(options.settingKey)
    }
  }

  query += ' ORDER BY created_at DESC'

  if (options?.limit) {
    query += ` LIMIT $${paramIndex++}`
    params.push(options.limit)
  }

  if (options?.offset) {
    query += ` OFFSET $${paramIndex++}`
    params.push(options.offset)
  }

  const result = await pool.query<AppConfigAuditLogEntry>(query, params)
  return result.rows
}

async function _getAppConfigAuditLogForPeriod(
  monitoredAppId: number,
  startDate: Date,
  endDate: Date,
): Promise<AppConfigAuditLogEntry[]> {
  const result = await pool.query<AppConfigAuditLogEntry>(
    `SELECT * FROM app_config_audit_log 
     WHERE monitored_app_id = $1 AND created_at >= $2 AND created_at <= $3
     ORDER BY created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )
  return result.rows
}

async function _getAllAppSettings(monitoredAppId: number): Promise<AppSetting[]> {
  const result = await pool.query<AppSetting>(
    'SELECT * FROM app_settings WHERE monitored_app_id = $1 ORDER BY setting_key',
    [monitoredAppId],
  )
  return result.rows
}
