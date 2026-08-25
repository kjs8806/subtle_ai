import pg from 'pg'
import { runMigrations } from './migrations.js'

// MVP-BETA-007 (#44): a standalone, explicit migration step for production
// deployment - `npm run migrate` - separate from the automatic
// migrate-on-boot behavior in server/bootstrap.js's createRuntime.
//
// createRuntime's automatic migration run stays exactly as it is (it's
// already safe under concurrent execution - runMigrations takes a Postgres
// advisory lock and tracks applied versions in schema_migrations, so
// multiple callers racing to run it is a correctness non-issue, not a bug to
// fix). But "safe if it races" is not the same as "the right place to run
// it": letting it happen implicitly as a side effect of every Cloud Run
// instance's cold start means a migration failure surfaces only when some
// autoscaled instance happens to boot, with no single, observable point in
// the deploy where it either clearly succeeded or clearly blocked
// promotion. Running it here, as one explicit pre-deploy step invoked
// before `gcloud run deploy` (see docs/engineering/DEPLOYMENT.md), gives a
// migration failure a clean, observable, promotion-blocking exit code
// instead.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('migrate: DATABASE_URL is required')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl })
try {
  await pool.query('SELECT 1')
} catch (error) {
  console.error(`migrate: unable to connect to PostgreSQL: ${error.message}`)
  await pool.end().catch(() => {})
  process.exit(1)
}

try {
  console.log('migrate: applying any unapplied migrations...')
  await runMigrations({ pool })
  const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version')
  console.log(`migrate: schema is at version ${rows.at(-1)?.version ?? '(none applied)'} (${rows.length} total applied)`)
  console.log('migrate: done')
} catch (error) {
  console.error(`migrate: failed: ${error.message}`)
  await pool.end().catch(() => {})
  process.exit(1)
}

await pool.end()
