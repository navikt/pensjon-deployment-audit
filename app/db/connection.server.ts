import { readFileSync } from 'node:fs'
import { Pool, type QueryResult } from 'pg'
import { logger } from '~/lib/logger.server'

let poolInstance: Pool | null = null

function buildConnectionConfig() {
  // Nais injects individual DB_* variables with envVarPrefix: DB
  const dbHost = process.env.DB_HOST
  const dbPort = process.env.DB_PORT
  const dbDatabase = process.env.DB_DATABASE
  const dbUsername = process.env.DB_USERNAME
  const dbPassword = process.env.DB_PASSWORD
  const dbSslCert = process.env.DB_SSLCERT
  const dbSslKey = process.env.DB_SSLKEY
  const dbSslRootCert = process.env.DB_SSLROOTCERT

  if (dbHost && dbDatabase && dbUsername && dbPassword) {
    const sslConfig: { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } = {
      rejectUnauthorized: false,
    }

    // Add client certificates if available
    if (dbSslRootCert) {
      sslConfig.ca = readFileSync(dbSslRootCert, 'utf-8')
    }
    if (dbSslCert) {
      sslConfig.cert = readFileSync(dbSslCert, 'utf-8')
    }
    if (dbSslKey) {
      sslConfig.key = readFileSync(dbSslKey, 'utf-8')
    }

    return {
      host: dbHost,
      port: dbPort ? parseInt(dbPort, 10) : 5432,
      database: dbDatabase,
      user: dbUsername,
      password: dbPassword,
      ssl: sslConfig,
    }
  }

  // Fall back to DATABASE_URL for local development
  const connectionString = process.env.DATABASE_URL
  if (connectionString) {
    return { connectionString }
  }

  throw new Error('Database configuration missing. Set DB_* variables (Nais) or DATABASE_URL (local)')
}

export function getPool(): Pool {
  if (!poolInstance) {
    const config = buildConnectionConfig()

    poolInstance = new Pool({
      ...config,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    poolInstance.on('error', (err) => {
      logger.error('Unexpected error on idle client', err)
    })
  }

  return poolInstance
}

// Lazy pool proxy — defers creation until first use to avoid throwing at import time
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const instance = getPool()
    const value = (instance as any)[prop]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export async function query<T extends Record<string, any> = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const p = getPool()
  return p.query<T>(text, params)
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
  }
}
