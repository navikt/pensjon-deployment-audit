import { Pool, type PoolClient, type QueryResult } from 'pg';

let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    poolInstance = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return poolInstance;
}

// Export pool directly for direct usage
export const pool = getPool();

export async function query<T extends Record<string, any> = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const p = getPool();
  return p.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  const p = getPool();
  return p.connect();
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
