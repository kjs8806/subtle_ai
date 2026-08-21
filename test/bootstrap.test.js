import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createRuntime } from '../server/bootstrap.js'
import { config } from '../server/config/env.js'

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
