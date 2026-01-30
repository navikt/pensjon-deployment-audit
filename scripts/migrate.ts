#!/usr/bin/env tsx

/**
 * Run database migrations on application startup
 * This script is called before the server starts to ensure the database schema is up to date.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations() {
  console.log('🔄 Running database migrations...');

  try {
    // Import runner function from node-pg-migrate  
    const { runner } = await import('node-pg-migrate');

    // Read config from .node-pg-migrate.json
    const configPath = join(__dirname, '..', '.node-pg-migrate.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Run migrations
    await runner({
      databaseUrl: process.env[config['database-url-var']],
      dir: join(__dirname, '..', config['migrations-dir']),
      direction: 'up',
      migrationsTable: config['migrations-table'],
      schema: config.schema,
      verbose: true,
      log: console.log,
    });

    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
