import { createServer } from 'node:http'
import { createApp } from './app.js'
import { createManagedAuth } from './auth.js'
import { createBilling } from './billing.js'
import { loadConfig } from './config.js'
import { createDatabasePool } from './db.js'
import { runDatabaseMigrations } from './migrate.js'
import { DesktopOAuth } from './oauth.js'
import { PostgresServiceStore } from './postgres-store.js'
import { ElevenLabsGeminiProviders } from './providers.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const pool = createDatabasePool(config)
  if (config.runMigrationsOnStart) await runDatabaseMigrations(config, pool)
  const store = new PostgresServiceStore(pool)
  await store.reconcileStaleOperations()
  const reconciliationTimer = setInterval(
    () => {
      store
        .reconcileStaleOperations()
        .catch(() =>
          console.error(JSON.stringify({ level: 'error', event: 'reconciliation_failed' })),
        )
    },
    5 * 60 * 1000,
  )
  reconciliationTimer.unref()
  const auth = createManagedAuth(config, pool)
  const app = createApp({
    config,
    store,
    auth,
    oauth: new DesktopOAuth(config, store, auth),
    providers: new ElevenLabsGeminiProviders(config),
    billing: createBilling(config, store),
  })
  const server = createServer(app)
  server.requestTimeout = 75_000
  server.headersTimeout = 20_000
  server.keepAliveTimeout = 65_000
  server.maxRequestsPerSocket = 1000

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => resolve())
  })
  console.log(JSON.stringify({ level: 'info', event: 'managed_api_started', port: config.port }))

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    clearInterval(reconciliationTimer)
    shuttingDown = true
    const forced = setTimeout(() => process.exit(1), config.shutdownGraceMs)
    forced.unref()
    server.close(() => {
      pool.end().finally(() => {
        clearTimeout(forced)
        process.exit(0)
      })
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(() => {
  console.error(JSON.stringify({ level: 'error', event: 'managed_api_start_failed' }))
  process.exitCode = 1
})
