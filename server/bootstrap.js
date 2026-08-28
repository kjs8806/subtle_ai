import { Pool } from 'pg'
import { config, validateConfig } from './config/env.js'
import { createGoogleProvider } from './auth/googleProvider.js'
import { createFakeGmailProvider } from './gmail/fakeProvider.js'
import { createMemoryRepository } from './persistence/memoryRepository.js'
import { createPostgresRepository } from './persistence/postgresRepository.js'
import { runMigrations } from './persistence/migrations.js'
import { createTokenVault } from './security/tokenVault.js'
import { createPostgresSessionManager } from './security/session.js'
import { createPostgresOAuthStateStore } from './security/oauthStateStore.js'

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

  // MVP-BETA-007 (#44): Cloud Run is elastic - it can run several instances
  // concurrently, each with its own independent pool - so the per-instance
  // pool size has to be conservative, not a single-server default. `pg`'s
  // own default (max: 10) times an uncapped instance count could exhaust a
  // free-tier Neon project's connection ceiling on its own, with no actual
  // traffic misbehaving. `max: 5` per instance, paired with Cloud Run's
  // documented `--max-instances` limit (see DEPLOYMENT.md) bounding how many
  // instances can exist at once, keeps the worst-case total connection count
  // small and predictable. `idleTimeoutMillis` releases connections back
  // promptly during Cloud Run's normal scale-to-zero idle periods rather
  // than holding them open against nothing; `connectionTimeoutMillis` fails
  // a request fast (surfacing as a real error) instead of hanging when the
  // database is genuinely unreachable. All three are env-overridable
  // (DB_POOL_MAX / DB_POOL_IDLE_TIMEOUT_MS / DB_POOL_CONNECTION_TIMEOUT_MS)
  // for a future environment with different constraints, without a code change.
  const pool = new Pool({
    connectionString: settings.databaseUrl,
    max: settings.dbPoolMax,
    idleTimeoutMillis: settings.dbPoolIdleTimeoutMs,
    connectionTimeoutMillis: settings.dbPoolConnectionTimeoutMs,
  })
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
  // MVP-BETA-007 (#44) production incident: sessions and OAuth state must be
  // shared across every Cloud Run instance, not held in one process's
  // memory - see server/security/session.js and
  // server/security/oauthStateStore.js for the full rationale. This is the
  // only place either Postgres-backed implementation is actually
  // constructed; buildApp's own defaults (in-memory) remain correct for
  // local dev, tests, and the persistenceProvider === 'memory' branch above.
  const sessions = createPostgresSessionManager({ pool })
  const oauthStates = createPostgresOAuthStateStore({ pool })
  // Passed through so /api/v1/health/ready can verify actual database
  // connectivity, not just that the process is running - see server/app.js.
  const app = buildApp({ repository, pool, sessions, oauthStates, ...runtimeOverrides })
  return { app, pool, close: async () => { await app.close(); await pool.end() } }
}
