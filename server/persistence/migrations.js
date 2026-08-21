import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MIGRATION_LOCK_KEY = 787001

export const runMigrations = async ({ pool, directory = new URL('../../migrations/', import.meta.url).pathname }) => {
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const files = (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
    for (const file of files) {
      const version = file.split('_')[0]
      const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version])
      if (applied.rowCount) continue
      const client = await pool.connect()
      try { await client.query('BEGIN'); await client.query(await readFile(join(directory, file), 'utf8')); await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]); await client.query('COMMIT') } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    lockClient.release()
  }
}