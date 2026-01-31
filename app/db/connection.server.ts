import { Pool, type PoolClient, type QueryResult } from 'pg'

let poolInstance: Pool | null = null

function buildConnectionConfig() {
  // Nais injects individual DB_* variables with envVarPrefix: DB
  // Use these instead of DB_URL to avoid SSL hostname verification issues
  // Cloud SQL Proxy handles encryption, so we connect without SSL to localhost
  const dbHost = process.env.DB_HOST
  const dbPort = process.env.DB_PORT
  const dbDatabase = process.env.DB_DATABASE
  const dbUsername = process.env.DB_USERNAME
  const dbPassword = process.env.DB_PASSWORD

  if (dbHost && dbDatabase && dbUsername && dbPassword) {
    return {
      host: dbHost,
      port: dbPort ? parseInt(dbPort, 10) : 5432,
      database: dbDatabase,
      user: dbUsername,
      password: dbPassword,
      // Cloud SQL Proxy handles encryption, no SSL needed to localhost
      ssl: false,
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
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle client', err)
    })
  }

  return poolInstance
}

// Export pool directly for direct usage
export const pool = getPool()

export async function query<T extends Record<string, any> = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const p = getPool()
  return p.query<T>(text, params)
}

export async function getClient(): Promise<PoolClient> {
  const p = getPool()
  return p.connect()
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
  }
}
