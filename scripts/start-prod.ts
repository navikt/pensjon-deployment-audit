#!/usr/bin/env node

/**
 * Production startup script for distroless container
 * Runs migrations then starts the server
 */

import { spawn } from 'node:child_process';
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

    // Read config
    const configPath = join(__dirname, '..', '.node-pg-migrate.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Check for Nais database URL first, then fall back to config var
    const naisDbUrl = process.env.NAIS_DATABASE_PENSJON_DEPLOYMENT_AUDIT_PENSJON_DEPLOYMENT_AUDIT_URL;
    const configDbUrl = process.env[config['database-url-var']];
    const databaseUrl = naisDbUrl || configDbUrl;

    if (!databaseUrl) {
      throw new Error(`Environment variable DATABASE_URL is not set`);
    }

    // Run migrations
    await runner({
      databaseUrl,
      dir: join(__dirname, '..', config['migrations-dir']),
      direction: 'up',
      migrationsTable: config['migrations-table'],
      schema: config.schema,
      verbose: true,
      log: console.log,
    });

    console.log('✅ Migrations completed successfully');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return false;
  }
}

async function startServer() {
  console.log('🚀 Starting application server...');

  const serverPath = join(__dirname, '..', 'build', 'server', 'index.js');

  const server = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env,
  });

  server.on('error', (error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });

  server.on('exit', (code) => {
    console.log(`Server exited with code ${code}`);
    process.exit(code || 0);
  });

  // Forward signals to server
  process.on('SIGTERM', () => server.kill('SIGTERM'));
  process.on('SIGINT', () => server.kill('SIGINT'));
}

// Main execution
(async () => {
  const migrationSuccess = await runMigrations();

  if (!migrationSuccess) {
    console.error('❌ Cannot start server due to migration failure');
    process.exit(1);
  }

  await startServer();
})();
