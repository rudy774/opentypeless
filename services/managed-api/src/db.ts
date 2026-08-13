import { Pool } from 'pg'
import type { ServiceConfig } from './config.js'

export function createDatabasePool(config: ServiceConfig): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'opentypeless-managed-api',
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  })
  pool.on('error', () =>
    console.error(JSON.stringify({ level: 'error', event: 'database_pool_error' })),
  )
  return pool
}
