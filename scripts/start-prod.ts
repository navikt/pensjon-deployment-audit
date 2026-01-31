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

  // Log available database-related environment variables for debugging
  const allKeys = Object.keys(process.env);
  const dbKeys = allKeys.filter(
    (key) =>
      key.includes('DATABASE') ||
      key.includes('NAIS_DATABASE') ||
      key.includes('DB_') ||
      key.includes('POSTGRES'),
  );
  console.log(`📋 Environment variables: ${allKeys.length} total, ${dbKeys.length} database-related:`);
  for (const key of dbKeys) {
    console.log(`  - ${key}`);
  }

  try {
    // Import runner function from node-pg-migrate
    const { runner } = await import('node-pg-migrate');

    // Read config
    const configPath = join(__dirname, '..', '.node-pg-migrate.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Check for Nais individual DB_* variables first, then fall back to DATABASE_URL
    const dbHost = process.env.DB_HOST;
    const dbPort = process.env.DB_PORT;
    const dbDatabase = process.env.DB_DATABASE;
    const dbUsername = process.env.DB_USERNAME;
    const dbPassword = process.env.DB_PASSWORD;
    const dbSslCert = process.env.DB_SSLCERT;
    const dbSslKey = process.env.DB_SSLKEY;
    const dbSslRootCert = process.env.DB_SSLROOTCERT;
    const isNais = !!(dbHost && dbDatabase && dbUsername && dbPassword);

    const configDbUrl = process.env[config['database-url-var']];

    console.log(`🔍 Using database from: ${isNais ? 'DB_* variables' : configDbUrl ? 'DATABASE_URL' : 'NOT FOUND'}`);

    if (!isNais && !configDbUrl) {
      throw new Error(`Environment variable DATABASE_URL is not set`);
    }

    // Build database config with client certificates for Cloud SQL
    type SslConfig = { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string };
    let databaseUrl: string | { host: string; port: number; database: string; user: string; password: string; ssl: SslConfig };

    if (isNais) {
      const sslConfig: SslConfig = { rejectUnauthorized: false };
      if (dbSslRootCert) sslConfig.ca = readFileSync(dbSslRootCert, 'utf-8');
      if (dbSslCert) sslConfig.cert = readFileSync(dbSslCert, 'utf-8');
      if (dbSslKey) sslConfig.key = readFileSync(dbSslKey, 'utf-8');

      databaseUrl = {
        host: dbHost!,
        port: dbPort ? parseInt(dbPort, 10) : 5432,
        database: dbDatabase!,
        user: dbUsername!,
        password: dbPassword!,
        ssl: sslConfig,
      };
    } else {
      databaseUrl = configDbUrl!;
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
  const reactRouterServePath = join(__dirname, '..', 'node_modules', '.bin', 'react-router-serve');

  // Use react-router-serve to run the server (React Router 7 requirement)
  const server = spawn(process.execPath, [reactRouterServePath, serverPath], {
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
