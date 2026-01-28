import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from '../app/db/connection';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initDatabase() {
  console.log('Initializing database...');

  const pool = getPool();
  const schemaSQL = readFileSync(join(__dirname, '../app/db/schema.sql'), 'utf-8');

  try {
    await pool.query(schemaSQL);
    console.log('✓ Database schema created successfully');
  } catch (error) {
    console.error('Error creating database schema:', error);
    throw error;
  } finally {
    await closePool();
  }
}

initDatabase()
  .then(() => {
    console.log('Database initialization complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
