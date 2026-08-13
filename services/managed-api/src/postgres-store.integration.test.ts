import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type ServiceConfig } from './config.js'
import { createDatabasePool } from './db.js'
import { runDatabaseMigrations } from './migrate.js'
import { PostgresServiceStore } from './postgres-store.js'
import type { BackupCiphertext, SealedSecret, UsageReservation } from './types.js'

const databaseUrl = process.env.MANAGED_SERVICE_TEST_DATABASE_URL
const databaseDescribe = databaseUrl ? describe : describe.skip

function databaseConfig(): ServiceConfig {
  if (!databaseUrl) throw new Error('MANAGED_SERVICE_TEST_DATABASE_URL is not configured')
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '8787',
    MANAGED_API_ORIGIN: 'http://127.0.0.1:8787',
    DATABASE_URL: databaseUrl,
    DATABASE_SSL_MODE: 'disable',
    DATABASE_POOL_MAX: '4',
    RUN_MIGRATIONS_ON_START: 'false',
    TRUST_PROXY_HOPS: '0',
    BETTER_AUTH_SECRET: 'managed-service-integration-secret-123456789',
    BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    BACKUP_ENCRYPTION_KEY_ID: 'integration',
    CORS_ALLOWED_ORIGINS: 'http://tauri.localhost',
    DESKTOP_DEEP_LINK_SCHEME: 'rudyopentypeless',
    LOG_LEVEL: 'error',
  })
}

const managedTables = [
  'account_jobs',
  'audit_events',
  'billing_events',
  'rate_limit_buckets',
  'account_exports',
  'desktop_oauth_codes',
  'desktop_oauth_transactions',
  'backup_snapshots',
  'idempotency_records',
  'usage_stages',
  'usage_windows',
  'entitlements',
  'managed_accounts',
]

databaseDescribe('PostgreSQL managed-service persistence', () => {
  const config = databaseUrl ? databaseConfig() : null
  if (!config) {
    it.skip('requires MANAGED_SERVICE_TEST_DATABASE_URL', () => undefined)
    return
  }
  const pool = createDatabasePool(config)
  const store = new PostgresServiceStore(pool)

  beforeAll(async () => {
    await runDatabaseMigrations(config, pool)
    await runDatabaseMigrations(config, pool)
  }, 60_000)

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${managedTables.join(', ')} RESTART IDENTITY CASCADE`)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('runs idempotent migrations and persists rate limits, OAuth artifacts, and billing retries', async () => {
    await expect(store.ready()).resolves.toBe(true)
    await expect(store.consumeRateLimit('oauth-ip', 'hash', 2, 60)).resolves.toBe(true)
    await expect(store.consumeRateLimit('oauth-ip', 'hash', 2, 60)).resolves.toBe(true)
    await expect(store.consumeRateLimit('oauth-ip', 'hash', 2, 60)).resolves.toBe(false)

    const oauth = {
      clientState: 's'.repeat(43),
      codeChallenge: 'c'.repeat(43),
      provider: 'google' as const,
    }
    await store.createOAuthTransaction('transaction-hash', oauth, new Date(Date.now() + 60_000))
    await expect(store.consumeOAuthTransaction('transaction-hash')).resolves.toEqual(oauth)
    await expect(store.consumeOAuthTransaction('transaction-hash')).resolves.toBeNull()

    const sessionToken: SealedSecret = {
      keyId: 'integration',
      iv: Buffer.alloc(12, 1),
      ciphertext: Buffer.from('encrypted-session'),
      authTag: Buffer.alloc(16, 2),
    }
    await store.createDesktopCode({
      codeHash: 'code-hash',
      userId: 'user-oauth',
      ...oauth,
      sessionToken,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(store.consumeDesktopCode('code-hash', 'wrong')).resolves.toEqual({
      state: 'invalid',
    })
    await expect(store.consumeDesktopCode('code-hash', oauth.codeChallenge)).resolves.toEqual({
      state: 'ok',
      sessionToken,
    })
    await expect(store.consumeDesktopCode('code-hash', oauth.codeChallenge)).resolves.toEqual({
      state: 'replayed',
    })

    await expect(
      store.markBillingEvent('evt_retry', 'customer.subscription.updated'),
    ).resolves.toBe(true)
    await expect(
      store.markBillingEvent('evt_retry', 'customer.subscription.updated'),
    ).resolves.toBe(false)
    await store.failBillingEvent('evt_retry')
    await expect(
      store.markBillingEvent('evt_retry', 'customer.subscription.updated'),
    ).resolves.toBe(true)
    await store.completeBillingEvent('evt_retry')
    await expect(
      store.markBillingEvent('evt_retry', 'customer.subscription.updated'),
    ).resolves.toBe(false)
  })

  it('settles quota exactly once and replays completed idempotent responses', async () => {
    const userId = 'user-quota'
    await store.applyEntitlement({
      userId,
      plan: 'pro',
      source: 'stripe',
      displayName: 'Pro',
      subscriptionEnd: new Date(Date.now() + 86_400_000),
      subscriptionStatus: 'active',
      licenseStatus: null,
      cloudWordsLimit: 100,
      stripeCustomerId: 'cus_quota',
      stripeSubscriptionId: 'sub_quota',
    })
    const reservation: UsageReservation = {
      userId,
      operationId: 'operation-quota-1234',
      stageKey: 'operation-quota-1234:llm',
      requestType: 'voice_pipeline',
      usageKind: 'llm',
      reservedUnits: 30,
      requestId: 'request-quota-1234',
      providerClass: 'gemini',
    }
    await expect(store.reserveUsage(reservation, 100)).resolves.toEqual({ state: 'reserved' })
    await expect(store.reserveUsage(reservation, 100)).resolves.toEqual({ state: 'replay' })
    await expect(
      store.reserveUsage(
        { ...reservation, operationId: 'operation-other-1234', usageKind: 'ask' },
        100,
      ),
    ).resolves.toEqual({ state: 'conflict' })
    await expect(
      store.reserveUsage(
        {
          ...reservation,
          operationId: 'operation-quota-5678',
          stageKey: 'operation-quota-5678:llm',
          reservedUnits: 80,
        },
        100,
      ),
    ).resolves.toEqual({ state: 'exhausted' })

    await store.settleUsage(userId, reservation.stageKey, { cloudWords: 25, llmTokens: 44 })
    await store.settleUsage(userId, reservation.stageKey, { cloudWords: 99, llmTokens: 99 })
    await expect(store.getSubscription(userId)).resolves.toEqual(
      expect.objectContaining({
        plan: 'pro',
        source: 'stripe',
        cloudWordsUsed: 25,
        llmTokensUsed: 44,
      }),
    )

    await expect(
      store.beginIdempotency(userId, '/api/checkout/create', 'intent-1234567890', 'digest-a'),
    ).resolves.toEqual({ state: 'new' })
    await expect(
      store.beginIdempotency(userId, '/api/checkout/create', 'intent-1234567890', 'digest-a'),
    ).resolves.toEqual({ state: 'pending' })
    await store.completeIdempotency(userId, '/api/checkout/create', 'intent-1234567890', 200, {
      url: 'https://api.example.test/billing/redirect?token=opaque',
    })
    await expect(
      store.beginIdempotency(userId, '/api/checkout/create', 'intent-1234567890', 'digest-a'),
    ).resolves.toEqual({
      state: 'replay',
      status: 200,
      response: { url: 'https://api.example.test/billing/redirect?token=opaque' },
    })
    await expect(
      store.beginIdempotency(userId, '/api/checkout/create', 'intent-1234567890', 'digest-b'),
    ).resolves.toEqual({ state: 'conflict' })
  })

  it('round-trips encrypted records, consumes exports once, and deletes all account-owned data', async () => {
    const userId = 'user-portability'
    const backup: BackupCiphertext = {
      keyId: 'integration',
      iv: Buffer.alloc(12, 3),
      ciphertext: Buffer.from('encrypted-backup'),
      authTag: Buffer.alloc(16, 4),
      version: 1,
      createdAt: new Date().toISOString(),
      digest: 'd'.repeat(64),
    }
    await store.saveBackup(userId, backup)
    await expect(store.getBackup(userId)).resolves.toEqual(backup)

    const artifact: SealedSecret = {
      keyId: 'integration',
      iv: Buffer.alloc(12, 5),
      ciphertext: Buffer.from('encrypted-export'),
      authTag: Buffer.alloc(16, 6),
    }
    await store.createAccountExport(
      'one-time-export',
      userId,
      artifact,
      new Date(Date.now() + 60_000),
    )
    await expect(store.consumeAccountExport('one-time-export')).resolves.toEqual(artifact)
    await expect(store.consumeAccountExport('one-time-export')).resolves.toBeNull()

    await store.createAccountExport(
      'delete-with-account',
      userId,
      artifact,
      new Date(Date.now() + 60_000),
    )
    await store.recordAudit({ userId, event: 'backup_uploaded', requestId: 'request-portability' })
    await store.deleteManagedAccount(userId)
    await expect(store.getBackup(userId)).resolves.toBeNull()
    await expect(store.consumeAccountExport('delete-with-account')).resolves.toBeNull()
    const counts = await pool.query<{ backups: string; exports: string; audits: string }>(
      `SELECT
        (SELECT count(*) FROM backup_snapshots WHERE user_id = $1) AS backups,
        (SELECT count(*) FROM account_exports WHERE user_id = $1) AS exports,
        (SELECT count(*) FROM audit_events) AS audits`,
      [userId],
    )
    expect(counts.rows[0]).toEqual({ backups: '0', exports: '0', audits: '0' })
  })
})
