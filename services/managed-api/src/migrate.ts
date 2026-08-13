import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getMigrations } from 'better-auth/db/migration'
import type { Pool } from 'pg'
import { buildManagedAuthOptions } from './auth.js'
import { loadConfig, type ServiceConfig } from './config.js'
import { createDatabasePool } from './db.js'

const MIGRATION_LOCK_ID = 7_747_742_026

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function runDatabaseMigrations(config: ServiceConfig, pool: Pool): Promise<void> {
  const lock = await pool.connect()
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    const betterAuthMigrations = await getMigrations(buildManagedAuthOptions(config, pool))
    await betterAuthMigrations.runMigrations()
    await lock.query(
      `CREATE TABLE IF NOT EXISTS managed_schema_migrations (
         filename text PRIMARY KEY,
         checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    )
    const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
    const filenames = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name))
      .sort()
    for (const filename of filenames) {
      const sql = await readFile(resolve(migrationDirectory, filename), 'utf8')
      const digest = checksum(sql)
      const existing = await lock.query<{ checksum: string }>(
        'SELECT checksum FROM managed_schema_migrations WHERE filename = $1',
        [filename],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== digest) {
          throw new Error(`Applied migration ${filename} has changed`)
        }
        continue
      }
      await lock.query('BEGIN')
      try {
        await lock.query(sql)
        await lock.query(
          'INSERT INTO managed_schema_migrations (filename, checksum) VALUES ($1,$2)',
          [filename, digest],
        )
        await lock.query('COMMIT')
      } catch (error) {
        await lock.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined)
    lock.release()
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const pool = createDatabasePool(config)
  try {
    await runDatabaseMigrations(config, pool)
    console.log(JSON.stringify({ level: 'info', event: 'database_migrations_complete' }))
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ level: 'error', event: 'database_migrations_failed' }))
    process.exitCode = 1
  })
}
