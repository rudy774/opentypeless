import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  BackupCiphertext,
  ReservationResult,
  SafeAuditEvent,
  SealedSecret,
  SubscriptionStatus,
  UsageReservation,
  UsageSettlement,
} from './types.js'
import { safeEqualText } from './crypto.js'
import type {
  DesktopCodeExchange,
  DesktopCodeInput,
  EntitlementTransition,
  IdempotencyResult,
  OAuthTransaction,
  ServiceStore,
} from './store.js'

function monthWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

function accountHash(userId: string): string {
  return createHash('sha256').update(`opentypeless-account:${userId}`).digest('hex').slice(0, 24)
}

function safeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid persisted quota value')
  return parsed
}

function safeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid persisted usage value')
  return parsed
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function ensureAccount(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO managed_accounts (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  )
  await client.query(
    `INSERT INTO entitlements (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  )
}

async function ensureUsageWindow(
  client: PoolClient,
  userId: string,
): Promise<{ start: Date; end: Date }> {
  const window = monthWindow()
  await client.query(
    `INSERT INTO usage_windows (user_id, period_start, period_end)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, period_start) DO NOTHING`,
    [userId, window.start, window.end],
  )
  return window
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.valueOf())) throw new Error('Invalid persisted date')
  return date.toISOString()
}

export class PostgresServiceStore implements ServiceStore {
  constructor(private readonly pool: Pool) {}

  async ready(): Promise<boolean> {
    const result = await this.pool.query<{ ok: number }>('SELECT 1 AS ok')
    return result.rows[0]?.ok === 1
  }

  async consumeRateLimit(
    scope: string,
    keyHash: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const result = await this.pool.query<{ request_count: number }>(
      `INSERT INTO rate_limit_buckets (scope, key_hash, request_count)
       VALUES ($1,$2,1)
       ON CONFLICT (scope, key_hash) DO UPDATE SET
         request_count = CASE
           WHEN rate_limit_buckets.window_start <= now() - ($3 * interval '1 second') THEN 1
           ELSE rate_limit_buckets.request_count + 1
         END,
         window_start = CASE
           WHEN rate_limit_buckets.window_start <= now() - ($3 * interval '1 second') THEN now()
           ELSE rate_limit_buckets.window_start
         END
       RETURNING request_count`,
      [scope, keyHash, windowSeconds],
    )
    return safeInteger(result.rows[0]?.request_count) <= limit
  }

  async reconcileStaleOperations(): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `WITH stale AS (
           UPDATE usage_stages SET status = 'reconcile', settled_at = now()
           WHERE status = 'reserved' AND created_at < now() - interval '10 minutes'
           RETURNING user_id, period_start, reserved_units
         ), totals AS (
           SELECT user_id, period_start, SUM(reserved_units) AS units
           FROM stale GROUP BY user_id, period_start
         )
         UPDATE usage_windows AS windows
         SET cloud_words_reserved = GREATEST(0, windows.cloud_words_reserved - totals.units)
         FROM totals
         WHERE windows.user_id = totals.user_id AND windows.period_start = totals.period_start`,
      )
      await client.query('DELETE FROM idempotency_records WHERE expires_at < now()')
      await client.query('DELETE FROM desktop_oauth_transactions WHERE expires_at < now()')
      await client.query('DELETE FROM desktop_oauth_codes WHERE expires_at < now()')
      await client.query(
        "DELETE FROM account_exports WHERE expires_at < now() OR consumed_at < now() - interval '1 day'",
      )
      await client.query(
        "DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 day'",
      )
      await client.query("DELETE FROM audit_events WHERE created_at < now() - interval '90 days'")
      await client.query(
        "DELETE FROM billing_events WHERE status = 'completed' AND processed_at < now() - interval '400 days'",
      )
    })
  }
  async createOAuthTransaction(
    transactionHash: string,
    oauth: OAuthTransaction,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO desktop_oauth_transactions
         (transaction_hash, client_state, code_challenge, provider, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [transactionHash, oauth.clientState, oauth.codeChallenge, oauth.provider, expiresAt],
    )
  }

  async consumeOAuthTransaction(transactionHash: string): Promise<OAuthTransaction | null> {
    const result = await this.pool.query(
      `UPDATE desktop_oauth_transactions SET consumed_at = now()
       WHERE transaction_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING client_state, code_challenge, provider`,
      [transactionHash],
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row || (row.provider !== 'google' && row.provider !== 'github')) return null
    return {
      clientState: String(row.client_state),
      codeChallenge: String(row.code_challenge),
      provider: row.provider,
    }
  }

  async createDesktopCode(input: DesktopCodeInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO desktop_oauth_codes
         (code_hash, user_id, client_state, code_challenge, token_key_id,
          token_iv, token_ciphertext, token_auth_tag, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.codeHash,
        input.userId,
        input.clientState,
        input.codeChallenge,
        input.sessionToken.keyId,
        input.sessionToken.iv,
        input.sessionToken.ciphertext,
        input.sessionToken.authTag,
        input.expiresAt,
      ],
    )
  }

  async consumeDesktopCode(
    codeHash: string,
    verifierChallenge: string,
  ): Promise<DesktopCodeExchange> {
    return transaction<DesktopCodeExchange>(this.pool, async (client) => {
      const result = await client.query(
        `SELECT code_challenge, token_key_id, token_iv, token_ciphertext,
                token_auth_tag, expires_at, consumed_at, failed_attempts
         FROM desktop_oauth_codes WHERE code_hash = $1 FOR UPDATE`,
        [codeHash],
      )
      const row = result.rows[0] as Record<string, unknown> | undefined
      if (!row) return { state: 'invalid' }
      if (row.consumed_at) return { state: 'replayed' }
      if (new Date(String(row.expires_at)).valueOf() <= Date.now()) return { state: 'expired' }
      if (!safeEqualText(String(row.code_challenge), verifierChallenge, 128)) {
        await client.query(
          `UPDATE desktop_oauth_codes
           SET failed_attempts = failed_attempts + 1,
               consumed_at = CASE WHEN failed_attempts + 1 >= 5 THEN now() ELSE consumed_at END
           WHERE code_hash = $1`,
          [codeHash],
        )
        return { state: 'invalid' }
      }
      await client.query(
        'UPDATE desktop_oauth_codes SET consumed_at = now() WHERE code_hash = $1',
        [codeHash],
      )
      return {
        state: 'ok',
        sessionToken: {
          keyId: String(row.token_key_id),
          iv: row.token_iv as Buffer,
          ciphertext: row.token_ciphertext as Buffer,
          authTag: row.token_auth_tag as Buffer,
        },
      }
    })
  }
  async getSubscription(userId: string): Promise<SubscriptionStatus> {
    return transaction<SubscriptionStatus>(this.pool, async (client) => {
      await ensureAccount(client, userId)
      const window = await ensureUsageWindow(client, userId)
      await client.query(
        `UPDATE entitlements
         SET plan = 'free', source = 'free', display_name = 'Free',
             subscription_status = NULL, subscription_end = NULL,
             cloud_words_limit = 0, stripe_subscription_id = NULL, updated_at = now()
         WHERE user_id = $1 AND plan = 'pro'
           AND (subscription_status IS NULL OR subscription_status NOT IN ('active','trialing')
                OR (subscription_end IS NOT NULL AND subscription_end <= now()))`,
        [userId],
      )
      const result = await client.query(
        `SELECT e.plan, e.source, e.display_name, e.subscription_end,
                e.subscription_status, e.license_status, e.quota_model,
                e.cloud_words_limit, e.byok_unlimited,
                u.stt_seconds_used, u.llm_tokens_used, u.cloud_words_used,
                u.period_end
         FROM entitlements e
         JOIN usage_windows u ON u.user_id = e.user_id AND u.period_start = $2
         WHERE e.user_id = $1`,
        [userId, window.start],
      )
      const row = result.rows[0] as Record<string, unknown> | undefined
      if (!row) throw new Error('Subscription state is unavailable')
      const cloudWordsUsed = safeInteger(row.cloud_words_used)
      const cloudWordsLimit = safeInteger(row.cloud_words_limit)
      return {
        plan: row.plan as SubscriptionStatus['plan'],
        source: row.source as SubscriptionStatus['source'],
        displayName: String(row.display_name),
        subscriptionEnd: toIso(row.subscription_end),
        subscriptionStatus:
          row.subscription_status === null ? null : String(row.subscription_status),
        licenseStatus:
          row.license_status === null
            ? null
            : (String(row.license_status) as NonNullable<SubscriptionStatus['licenseStatus']>),
        quotaModel: row.quota_model as SubscriptionStatus['quotaModel'],
        displayWordsUsedEstimate: cloudWordsUsed,
        displayWordsLimit: cloudWordsLimit,
        displayWordsResetAt: window.end.toISOString(),
        sttSecondsUsed: safeNumber(row.stt_seconds_used),
        sttSecondsLimit: 0,
        llmTokensUsed: safeInteger(row.llm_tokens_used),
        llmTokensLimit: 0,
        cloudWordsUsed,
        cloudWordsLimit,
        cloudWordsResetAt: window.end.toISOString(),
        byokUnlimited: Boolean(row.byok_unlimited),
      }
    })
  }

  async reserveUsage(
    reservation: UsageReservation,
    cloudWordLimit: number,
  ): Promise<ReservationResult> {
    return transaction<ReservationResult>(this.pool, async (client) => {
      await ensureAccount(client, reservation.userId)
      const window = await ensureUsageWindow(client, reservation.userId)
      const entitlement = await client.query(
        `SELECT plan, source, cloud_words_limit, subscription_status, subscription_end,
                license_status
         FROM entitlements WHERE user_id = $1 FOR UPDATE`,
        [reservation.userId],
      )
      const entitlementRow = entitlement.rows[0] as Record<string, unknown>
      const persistedLimit = safeInteger(entitlementRow.cloud_words_limit)
      const effectiveLimit = Math.min(persistedLimit, Math.max(0, Math.floor(cloudWordLimit)))
      const entitled =
        entitlementRow.plan !== 'free' &&
        entitlementRow.license_status !== 'refunded' &&
        entitlementRow.license_status !== 'deactivated' &&
        (entitlementRow.plan !== 'pro' ||
          (['active', 'trialing'].includes(String(entitlementRow.subscription_status)) &&
            (!entitlementRow.subscription_end ||
              new Date(String(entitlementRow.subscription_end)).valueOf() > Date.now())))
      if (!entitled || effectiveLimit === 0) return { state: 'exhausted' }

      const inserted = await client.query(
        `INSERT INTO usage_stages
           (user_id, operation_id, stage_key, request_type, usage_kind, status,
            reserved_units, provider_class, request_id, period_start)
         VALUES ($1,$2,$3,$4,$5,'reserved',$6,$7,$8,$9)
         ON CONFLICT (user_id, stage_key) DO NOTHING
         RETURNING stage_key`,
        [
          reservation.userId,
          reservation.operationId,
          reservation.stageKey,
          reservation.requestType,
          reservation.usageKind,
          reservation.reservedUnits,
          reservation.providerClass,
          reservation.requestId,
          window.start,
        ],
      )
      if (inserted.rowCount === 0) {
        const prior = await client.query(
          `SELECT operation_id, request_type, usage_kind, status
           FROM usage_stages WHERE user_id = $1 AND stage_key = $2`,
          [reservation.userId, reservation.stageKey],
        )
        const row = prior.rows[0] as Record<string, unknown> | undefined
        const sameStage =
          row?.operation_id === reservation.operationId &&
          row.request_type === reservation.requestType &&
          row.usage_kind === reservation.usageKind
        return { state: sameStage ? 'replay' : 'conflict' }
      }
      const usage = await client.query(
        `SELECT cloud_words_used, cloud_words_reserved
         FROM usage_windows WHERE user_id = $1 AND period_start = $2 FOR UPDATE`,
        [reservation.userId, window.start],
      )
      const usageRow = usage.rows[0] as Record<string, unknown>
      const committed = safeInteger(usageRow.cloud_words_used)
      const pending = safeInteger(usageRow.cloud_words_reserved)
      if (committed + pending + reservation.reservedUnits > effectiveLimit) {
        throw new QuotaRollback()
      }
      await client.query(
        `UPDATE usage_windows
         SET cloud_words_reserved = cloud_words_reserved + $3
         WHERE user_id = $1 AND period_start = $2`,
        [reservation.userId, window.start, reservation.reservedUnits],
      )
      return { state: 'reserved' }
    }).catch((error: unknown) => {
      if (error instanceof QuotaRollback) return { state: 'exhausted' as const }
      throw error
    })
  }

  async settleUsage(userId: string, stageKey: string, settlement: UsageSettlement): Promise<void> {
    await transaction(this.pool, async (client) => {
      const stageResult = await client.query(
        `SELECT status, reserved_units, period_start
         FROM usage_stages WHERE user_id = $1 AND stage_key = $2 FOR UPDATE`,
        [userId, stageKey],
      )
      const stage = stageResult.rows[0] as Record<string, unknown> | undefined
      if (!stage || stage.status !== 'reserved') return
      const reserved = safeInteger(stage.reserved_units)
      const settled = Math.max(0, Math.floor(settlement.cloudWords))
      const sttSeconds = Math.max(0, settlement.sttSeconds ?? 0)
      const llmTokens = Math.max(0, Math.floor(settlement.llmTokens ?? 0))
      if (
        !Number.isSafeInteger(settled) ||
        !Number.isFinite(sttSeconds) ||
        !Number.isSafeInteger(llmTokens)
      ) {
        throw new Error('Invalid usage settlement')
      }
      await client.query(
        `UPDATE usage_stages SET status = 'completed', settled_units = $3, settled_at = now()
         WHERE user_id = $1 AND stage_key = $2`,
        [userId, stageKey, settled],
      )
      await client.query(
        `UPDATE usage_windows
         SET cloud_words_reserved = GREATEST(0, cloud_words_reserved - $3),
             cloud_words_used = cloud_words_used + $4,
             stt_seconds_used = stt_seconds_used + $5,
             llm_tokens_used = llm_tokens_used + $6
         WHERE user_id = $1 AND period_start = $2`,
        [userId, stage.period_start, reserved, settled, sttSeconds, llmTokens],
      )
    })
  }

  async releaseUsage(userId: string, stageKey: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE usage_stages SET status = 'released', settled_at = now()
         WHERE user_id = $1 AND stage_key = $2 AND status = 'reserved'
         RETURNING reserved_units, period_start`,
        [userId, stageKey],
      )
      const row = result.rows[0] as Record<string, unknown> | undefined
      if (!row) return
      await client.query(
        `UPDATE usage_windows
         SET cloud_words_reserved = GREATEST(0, cloud_words_reserved - $3)
         WHERE user_id = $1 AND period_start = $2`,
        [userId, row.period_start, safeInteger(row.reserved_units)],
      )
    })
  }

  async beginIdempotency(
    userId: string,
    route: string,
    key: string,
    requestDigest: string,
  ): Promise<IdempotencyResult> {
    return transaction<IdempotencyResult>(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO idempotency_records (user_id, route, idempotency_key, request_digest)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, route, idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [userId, route, key, requestDigest],
      )
      if (inserted.rowCount === 1) return { state: 'new' }
      const prior = await client.query(
        `SELECT request_digest, state, response_status, response_body
         FROM idempotency_records
         WHERE user_id = $1 AND route = $2 AND idempotency_key = $3 FOR UPDATE`,
        [userId, route, key],
      )
      const row = prior.rows[0] as Record<string, unknown> | undefined
      if (!row || row.request_digest !== requestDigest) return { state: 'conflict' }
      if (row.state === 'completed') {
        return { state: 'replay', status: Number(row.response_status), response: row.response_body }
      }
      return { state: 'pending' }
    })
  }

  async completeIdempotency(
    userId: string,
    route: string,
    key: string,
    status: number,
    response: unknown,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_records
       SET state = 'completed', response_status = $4, response_body = $5
       WHERE user_id = $1 AND route = $2 AND idempotency_key = $3`,
      [userId, route, key, status, JSON.stringify(response)],
    )
  }

  async abandonIdempotency(userId: string, route: string, key: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM idempotency_records
       WHERE user_id = $1 AND route = $2 AND idempotency_key = $3 AND state = 'pending'`,
      [userId, route, key],
    )
  }

  async saveBackup(userId: string, backup: BackupCiphertext): Promise<void> {
    await this.pool.query(
      'INSERT INTO managed_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [userId],
    )
    await this.pool.query(
      `INSERT INTO backup_snapshots
         (user_id, schema_version, created_at, key_id, iv, ciphertext, auth_tag, plaintext_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         created_at = EXCLUDED.created_at,
         key_id = EXCLUDED.key_id,
         iv = EXCLUDED.iv,
         ciphertext = EXCLUDED.ciphertext,
         auth_tag = EXCLUDED.auth_tag,
         plaintext_digest = EXCLUDED.plaintext_digest,
         updated_at = now()`,
      [
        userId,
        backup.version,
        backup.createdAt,
        backup.keyId,
        backup.iv,
        backup.ciphertext,
        backup.authTag,
        backup.digest,
      ],
    )
  }

  async createAccountExport(
    tokenHash: string,
    userId: string,
    artifact: SealedSecret,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_exports
         (token_hash, user_id, key_id, iv, ciphertext, auth_tag, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tokenHash,
        userId,
        artifact.keyId,
        artifact.iv,
        artifact.ciphertext,
        artifact.authTag,
        expiresAt,
      ],
    )
  }

  async consumeAccountExport(tokenHash: string): Promise<SealedSecret | null> {
    const result = await this.pool.query(
      `UPDATE account_exports SET consumed_at = now()
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING key_id, iv, ciphertext, auth_tag`,
      [tokenHash],
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return {
      keyId: String(row.key_id),
      iv: row.iv as Buffer,
      ciphertext: row.ciphertext as Buffer,
      authTag: row.auth_tag as Buffer,
    }
  }
  async getBackup(userId: string): Promise<BackupCiphertext | null> {
    const result = await this.pool.query(
      `SELECT schema_version, created_at, key_id, iv, ciphertext, auth_tag, plaintext_digest
       FROM backup_snapshots WHERE user_id = $1`,
      [userId],
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return {
      version: Number(row.schema_version),
      createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
      keyId: String(row.key_id),
      iv: row.iv as Buffer,
      ciphertext: row.ciphertext as Buffer,
      authTag: row.auth_tag as Buffer,
      digest: String(row.plaintext_digest),
    }
  }

  async getOrCreateBillingCustomer(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ stripe_customer_id: string | null }>(
      `INSERT INTO managed_accounts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
       RETURNING stripe_customer_id`,
      [userId],
    )
    return result.rows[0]?.stripe_customer_id ?? null
  }

  async setBillingCustomer(userId: string, customerId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO managed_accounts (user_id, stripe_customer_id) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
         updated_at = now()`,
      [userId, customerId],
    )
  }

  async findUserByBillingCustomer(customerId: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM managed_accounts WHERE stripe_customer_id = $1',
      [customerId],
    )
    return result.rows[0]?.user_id ?? null
  }

  async applyEntitlement(transition: EntitlementTransition): Promise<void> {
    await transaction(this.pool, async (client) => {
      await ensureAccount(client, transition.userId)
      await client.query(
        `UPDATE managed_accounts SET stripe_customer_id = COALESCE($2, stripe_customer_id),
           updated_at = now() WHERE user_id = $1`,
        [transition.userId, transition.stripeCustomerId ?? null],
      )
      await client.query(
        `INSERT INTO entitlements
          (user_id, plan, source, display_name, subscription_end, subscription_status,
           license_status, quota_model, cloud_words_limit, stripe_subscription_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'cloud_words',$8,$9)
         ON CONFLICT (user_id) DO UPDATE SET
           plan = EXCLUDED.plan, source = EXCLUDED.source,
           display_name = EXCLUDED.display_name, subscription_end = EXCLUDED.subscription_end,
           subscription_status = EXCLUDED.subscription_status,
           license_status = EXCLUDED.license_status, quota_model = EXCLUDED.quota_model,
           cloud_words_limit = EXCLUDED.cloud_words_limit,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id, updated_at = now()`,
        [
          transition.userId,
          transition.plan,
          transition.source,
          transition.displayName,
          transition.subscriptionEnd,
          transition.subscriptionStatus,
          transition.licenseStatus ?? null,
          transition.cloudWordsLimit,
          transition.stripeSubscriptionId ?? null,
        ],
      )
    })
  }

  async markBillingEvent(eventId: string, eventType: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO billing_events (event_id, event_type) VALUES ($1,$2)
       ON CONFLICT (event_id) DO UPDATE SET
         event_type = EXCLUDED.event_type, status = 'processing', received_at = now()
       WHERE billing_events.status = 'failed'
          OR (billing_events.status = 'processing'
              AND billing_events.received_at < now() - interval '5 minutes')
       RETURNING event_id`,
      [eventId, eventType],
    )
    return result.rowCount === 1
  }

  async completeBillingEvent(eventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE billing_events SET status = 'completed', processed_at = now() WHERE event_id = $1`,
      [eventId],
    )
  }

  async failBillingEvent(eventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE billing_events SET status = 'failed', processed_at = now() WHERE event_id = $1`,
      [eventId],
    )
  }
  async recordAudit(event: SafeAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (account_hash, event_type, request_id, metadata)
       VALUES ($1,$2,$3,$4)`,
      [
        event.userId ? accountHash(event.userId) : null,
        event.event,
        event.requestId,
        event.metadata ?? {},
      ],
    )
  }

  async exportAccount(userId: string): Promise<Record<string, unknown>> {
    const [entitlement, usage, audit] = await Promise.all([
      this.pool.query('SELECT * FROM entitlements WHERE user_id = $1', [userId]),
      this.pool.query(
        `SELECT period_start, period_end, stt_seconds_used, llm_tokens_used, cloud_words_used
         FROM usage_windows WHERE user_id = $1 ORDER BY period_start`,
        [userId],
      ),
      this.pool.query(
        `SELECT event_type, metadata, created_at FROM audit_events
         WHERE account_hash = $1 ORDER BY created_at`,
        [accountHash(userId)],
      ),
    ])
    return { entitlement: entitlement.rows[0] ?? null, usage: usage.rows, audit: audit.rows }
  }

  async scheduleDeletion(userId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      await ensureAccount(client, userId)
      await client.query(
        `UPDATE managed_accounts SET deletion_requested_at = now(), updated_at = now()
         WHERE user_id = $1`,
        [userId],
      )
      await client.query(`INSERT INTO account_jobs (user_id, kind) VALUES ($1, 'deletion')`, [
        userId,
      ])
    })
  }

  async deleteManagedAccount(userId: string): Promise<void> {
    await transaction(this.pool, async (client) => {
      const hash = accountHash(userId)
      await client.query('DELETE FROM backup_snapshots WHERE user_id = $1', [userId])
      await client.query('DELETE FROM account_exports WHERE user_id = $1', [userId])
      await client.query('DELETE FROM usage_stages WHERE user_id = $1', [userId])
      await client.query('DELETE FROM usage_windows WHERE user_id = $1', [userId])
      await client.query('DELETE FROM idempotency_records WHERE user_id = $1', [userId])
      await client.query('DELETE FROM desktop_oauth_codes WHERE user_id = $1', [userId])
      await client.query('DELETE FROM entitlements WHERE user_id = $1', [userId])
      await client.query('DELETE FROM audit_events WHERE account_hash = $1', [hash])
      await client.query('DELETE FROM account_jobs WHERE user_id = $1', [userId])
      await client.query('DELETE FROM managed_accounts WHERE user_id = $1', [userId])
    })
  }
}

class QuotaRollback extends Error {}
