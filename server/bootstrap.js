import { Pool } from 'pg'
import { config, validateConfig } from './config/env.js'
import { createGoogleProvider } from './auth/googleProvider.js'
import { createFakeGmailProvider } from './gmail/fakeProvider.js'
import { createMemoryRepository } from './persistence/memoryRepository.js'
import { createPostgresRepository } from './persistence/postgresRepository.js'
import { runMigrations } from './persistence/migrations.js'
import { createTokenVault } from './security/tokenVault.js'

// buildApp is passed in (rather than imported) so this module never depends on
// server/app.js — app.js is the one that imports createRuntime to start itself,
// and a mutual static import there deadlocks Node's top-level-await module linking.
export const createRuntime = async (buildApp, settings = config, overrides = {}, { migrationsDir } = {}) => {
  validateConfig(settings)

  // Derive the provider/security posture explicitly from the *validated* settings
  // object, not from buildApp's own defaults (which read the global `config`
  // singleton). Without this, a runtime booted against a non-default `settings`
  // (e.g. real Google + PostgreSQL) could silently build a mock provider or run
  // with the wrong cookie/origin posture if the process-wide env didn't happen to
  // match - exactly the kind of accidental fallback this bootstrap must not allow.
  const provider = settings.gmailProvider === 'google'
    ? createGoogleProvider({ clientId: settings.googleClientId, clientSecret: settings.googleClientSecret, oidcRedirectUri: settings.googleOidcRedirectUri, gmailRedirectUri: settings.googleGmailRedirectUri })
    : createFakeGmailProvider()
  const tokenVault = settings.tokenEncryptionKey ? createTokenVault({ secret: settings.tokenEncryptionKey }) : null
  const runtimeOverrides = { gmailProvider: settings.gmailProvider, production: settings.production, publicOrigin: settings.publicOrigin, provider, tokenVault, ...overrides }

  if (settings.persistenceProvider === 'memory') {
    const app = buildApp({ repository: createMemoryRepository(), ...runtimeOverrides })
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
    await runMigrations({ pool, ...(migrationsDir ? { directory: migrationsDir } : {}) })
  } catch (error) {
    await pool.end()
    throw new Error(`PostgreSQL migration failed: ${error.message}`)
  }
  const repository = createPostgresRepository({ pool })
  const app = buildApp({ repository, ...runtimeOverrides })
  return { app, pool, close: async () => { await app.close(); await pool.end() } }
}
