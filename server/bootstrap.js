import { Pool } from 'pg'
import { config, validateConfig } from './config/env.js'
import { createMemoryRepository } from './persistence/memoryRepository.js'
import { createPostgresRepository } from './persistence/postgresRepository.js'
import { runMigrations } from './persistence/migrations.js'

// buildApp is passed in (rather than imported) so this module never depends on
// server/app.js — app.js is the one that imports createRuntime to start itself,
// and a mutual static import there deadlocks Node's top-level-await module linking.
export const createRuntime = async (buildApp, settings = config, overrides = {}) => {
  validateConfig(settings)

  if (settings.persistenceProvider === 'memory') {
    const app = buildApp({ repository: createMemoryRepository(), ...overrides })
    return { app, pool: null, close: async () => { await app.close() } }
  }

  const pool = new Pool({ connectionString: settings.databaseUrl })
  try {
    await pool.query('SELECT 1')
  } catch (error) {
    await pool.end()
    throw new Error(`Unable to connect to PostgreSQL: ${error.message}`)
  }
  try {
    await runMigrations({ pool })
  } catch (error) {
    await pool.end()
    throw new Error(`PostgreSQL migration failed: ${error.message}`)
  }
  const repository = createPostgresRepository({ pool })
  const app = buildApp({ repository, ...overrides })
  return { app, pool, close: async () => { await app.close(); await pool.end() } }
}
