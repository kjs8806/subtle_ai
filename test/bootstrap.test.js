import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { buildApp } from '../server/app.js'
import { createRuntime } from '../server/bootstrap.js'
import { config } from '../server/config/env.js'

const googleConfig = {
  gmailProvider: 'google',
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  googleOidcRedirectUri: 'https://app.example/oidc',
  googleGmailRedirectUri: 'https://app.example/gmail',
  tokenEncryptionKey: 'a'.repeat(32),
  sessionSecret: 'a'.repeat(32),
  production: false,
}

const baseConnectionString = process.env.DATABASE_URL
const integration = baseConnectionString ? test : test.skip

// This suite's own connection-string-touching tests run their bootstrap against a
// dedicated database name, isolated from postgres.integration.test.js and
// runtimePersistence.integration.test.js, which run concurrently against the same
// DATABASE_URL under plain `npm test` and manage their own schema resets.
const BOOTSTRAP_DB_NAME = 'subtle_ai_test_bootstrap'

const withDatabaseName = (connectionString, dbName) => {
  const url = new URL(connectionString)
  url.pathname = `/${dbName}`
  return url.toString()
}

const waitForPool = async (connectionString) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pool = new Pool({ connectionString })
    try { await pool.query('SELECT 1'); return pool } catch (error) {
      await pool.end()
      if (attempt === 19) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

const ensureIsolatedDatabase = async (adminConnectionString, dbName) => {
  const admin = await waitForPool(adminConnectionString)
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.end()
  }
}

test('runtime with memory persistence boots and serves requests', async () => {
  const { app, pool, close } = await createRuntime(buildApp, { ...config, persistenceProvider: 'memory' })
  assert.equal(pool, null)
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' })
  assert.equal(response.statusCode, 200)
  await close()
})

test('postgres persistence fails startup clearly when the database is unreachable', async () => {
  await assert.rejects(
    createRuntime(buildApp, { ...config, persistenceProvider: 'postgres', databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:1/unreachable' }),
    /Unable to connect to PostgreSQL/,
  )
})

test('postgres persistence without DATABASE_URL fails validation before connecting', async () => {
  await assert.rejects(
    createRuntime(buildApp, { ...config, persistenceProvider: 'postgres', databaseUrl: '' }),
    /DATABASE_URL is required/,
  )
})

test('SEC-003: GMAIL_PROVIDER=google combined with memory persistence fails startup', async () => {
  await assert.rejects(
    createRuntime(buildApp, { ...config, ...googleConfig, persistenceProvider: 'memory' }),
    /PERSISTENCE_PROVIDER must be postgres when GMAIL_PROVIDER=google/,
  )
})

test('SEC-003: GMAIL_PROVIDER=google without DATABASE_URL fails startup', async () => {
  await assert.rejects(
    createRuntime(buildApp, { ...config, ...googleConfig, persistenceProvider: 'postgres', databaseUrl: '' }),
    /DATABASE_URL is required/,
  )
})

integration('SEC-003: GMAIL_PROVIDER=google with PostgreSQL and a complete configuration boots successfully', async () => {
  const databaseUrl = withDatabaseName(baseConnectionString, BOOTSTRAP_DB_NAME)
  await ensureIsolatedDatabase(baseConnectionString, BOOTSTRAP_DB_NAME)

  const { app, pool, close } = await createRuntime(buildApp, { ...config, ...googleConfig, persistenceProvider: 'postgres', databaseUrl })
  assert.notEqual(pool, null)
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { status: 'ok' }, 'liveness must never leak which provider/persistence backend is configured')
  // Readiness proves the postgres runtime is actually reachable, not just
  // that buildApp() was called with a truthy pool - a stronger check than
  // asserting a provider name the health endpoint deliberately no longer exposes.
  const ready = await app.inject({ method: 'GET', url: '/api/v1/health/ready' })
  assert.equal(ready.statusCode, 200)
  assert.deepEqual(ready.json(), { status: 'ok' })
  await close()
})

integration('SEC-003: a PostgreSQL migration failure fails startup and does not fall back to memory', async () => {
  const databaseUrl = withDatabaseName(baseConnectionString, BOOTSTRAP_DB_NAME)
  await ensureIsolatedDatabase(baseConnectionString, BOOTSTRAP_DB_NAME)

  const brokenDir = await mkdtemp(join(tmpdir(), 'subtle-ai-bootstrap-broken-migration-'))
  try {
    await writeFile(join(brokenDir, '999_broken.sql'), 'CREATE TABLE this is not valid sql;')
    await assert.rejects(
      createRuntime(buildApp, { ...config, persistenceProvider: 'postgres', databaseUrl }, {}, { migrationsDir: brokenDir }),
      /PostgreSQL migration failed/,
    )
  } finally {
    await rm(brokenDir, { recursive: true, force: true })
  }
})
