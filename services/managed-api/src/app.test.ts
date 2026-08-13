import type { RequestHandler } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBackupSettings } from '../../../src/lib/backup-settings.js'
import { useAppStore } from '../../../src/stores/appStore.js'
import { createApp } from './app.js'
import type { AuthFacade, AuthSession } from './auth.js'
import type { BillingFacade } from './billing.js'
import type { ServiceConfig } from './config.js'
import type { OAuthFacade } from './oauth.js'
import type { ChatMessage, ManagedProviders, ProviderTextResult } from './providers.js'
import type {
  DesktopCodeExchange,
  DesktopCodeInput,
  EntitlementTransition,
  IdempotencyResult,
  OAuthTransaction,
  ServiceStore,
} from './store.js'
import type {
  BackupCiphertext,
  PlanOffer,
  ReservationResult,
  SafeAuditEvent,
  SealedSecret,
  SubscriptionStatus,
  UsageReservation,
  UsageSettlement,
} from './types.js'

const verifiedSession: AuthSession = {
  user: {
    id: 'user_test',
    email: 'person@example.test',
    name: 'Test Person',
    emailVerified: true,
  },
  sessionCreatedAt: new Date(),
}

function testConfig(): ServiceConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 8787,
    apiOrigin: 'https://api.example.test',
    databaseUrl: 'postgres://test',
    databaseSsl: false,
    databasePoolMax: 2,
    runMigrationsOnStart: false,
    trustProxyHops: 0,
    authSecret: 'a'.repeat(32),
    backupKey: Buffer.alloc(32, 9),
    backupKeyId: 'primary',
    corsOrigins: new Set(['http://tauri.localhost']),
    desktopDeepLinkScheme: 'rudyopentypeless',
    elevenLabsModel: 'scribe_v2',
    geminiModel: 'gemini-2.5-flash',
    proMonthlyCloudWords: 100_000,
    lifetimeCloudWords: 25_000,
    logLevel: 'error',
    shutdownGraceMs: 5000,
  }
}

function subscription(): SubscriptionStatus {
  const reset = new Date(Date.now() + 86_400_000).toISOString()
  return {
    plan: 'pro',
    source: 'stripe',
    displayName: 'Pro',
    subscriptionEnd: reset,
    subscriptionStatus: 'active',
    licenseStatus: null,
    quotaModel: 'cloud_words',
    displayWordsUsedEstimate: 0,
    displayWordsLimit: 100_000,
    displayWordsResetAt: reset,
    sttSecondsUsed: 0,
    sttSecondsLimit: 0,
    llmTokensUsed: 0,
    llmTokensLimit: 0,
    cloudWordsUsed: 0,
    cloudWordsLimit: 100_000,
    cloudWordsResetAt: reset,
    byokUnlimited: true,
  }
}

class MemoryStore implements ServiceStore {
  backup: BackupCiphertext | null = null
  exhausted = false
  deleted = false
  rateLimitAllowed = true
  settlements: Array<{ stageKey: string; settlement: UsageSettlement }> = []
  private readonly stages = new Set<string>()
  private readonly idempotency = new Map<
    string,
    { digest: string; status?: number; body?: unknown }
  >()
  private readonly exports = new Map<string, { artifact: SealedSecret; expiresAt: Date }>()

  async ready(): Promise<boolean> {
    return true
  }
  async consumeRateLimit(): Promise<boolean> {
    return this.rateLimitAllowed
  }
  async reconcileStaleOperations(): Promise<void> {}
  async createOAuthTransaction(): Promise<void> {}
  async consumeOAuthTransaction(): Promise<OAuthTransaction | null> {
    return null
  }
  async createDesktopCode(_input: DesktopCodeInput): Promise<void> {}
  async consumeDesktopCode(): Promise<DesktopCodeExchange> {
    return { state: 'invalid' }
  }
  async getSubscription(): Promise<SubscriptionStatus> {
    return subscription()
  }
  async reserveUsage(reservation: UsageReservation): Promise<ReservationResult> {
    if (this.exhausted) return { state: 'exhausted' }
    if (this.stages.has(reservation.stageKey)) return { state: 'replay' }
    this.stages.add(reservation.stageKey)
    return { state: 'reserved' }
  }
  async settleUsage(_userId: string, stageKey: string, settlement: UsageSettlement): Promise<void> {
    this.settlements.push({ stageKey, settlement })
  }
  async releaseUsage(): Promise<void> {}
  async beginIdempotency(
    userId: string,
    route: string,
    key: string,
    digest: string,
  ): Promise<IdempotencyResult> {
    const storageKey = `${userId}:${route}:${key}`
    const prior = this.idempotency.get(storageKey)
    if (!prior) {
      this.idempotency.set(storageKey, { digest })
      return { state: 'new' }
    }
    if (prior.digest !== digest) return { state: 'conflict' }
    if (prior.status !== undefined)
      return { state: 'replay', status: prior.status, response: prior.body }
    return { state: 'pending' }
  }
  async completeIdempotency(
    userId: string,
    route: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    const storageKey = `${userId}:${route}:${key}`
    const prior = this.idempotency.get(storageKey)
    if (prior) this.idempotency.set(storageKey, { ...prior, status, body })
  }
  async abandonIdempotency(userId: string, route: string, key: string): Promise<void> {
    this.idempotency.delete(`${userId}:${route}:${key}`)
  }
  async saveBackup(_userId: string, backup: BackupCiphertext): Promise<void> {
    this.backup = backup
  }
  async createAccountExport(
    tokenHash: string,
    _userId: string,
    artifact: SealedSecret,
    expiresAt: Date,
  ): Promise<void> {
    this.exports.set(tokenHash, { artifact, expiresAt })
  }
  async consumeAccountExport(tokenHash: string): Promise<SealedSecret | null> {
    const value = this.exports.get(tokenHash)
    this.exports.delete(tokenHash)
    return value && value.expiresAt.getTime() > Date.now() ? value.artifact : null
  }
  async getBackup(): Promise<BackupCiphertext | null> {
    return this.backup
  }
  async getOrCreateBillingCustomer(): Promise<string | null> {
    return null
  }
  async setBillingCustomer(): Promise<void> {}
  async findUserByBillingCustomer(): Promise<string | null> {
    return null
  }
  async applyEntitlement(_transition: EntitlementTransition): Promise<void> {}
  async markBillingEvent(): Promise<boolean> {
    return true
  }
  async completeBillingEvent(): Promise<void> {}
  async failBillingEvent(): Promise<void> {}
  async recordAudit(_event: SafeAuditEvent): Promise<void> {}
  async exportAccount(): Promise<Record<string, unknown>> {
    return { usage: [] }
  }
  async scheduleDeletion(): Promise<void> {}
  async deleteManagedAccount(): Promise<void> {
    this.deleted = true
  }
}

class FakeBilling implements BillingFacade {
  configured = true
  checkoutCalls = 0
  cancelCalls = 0
  async plans(): Promise<PlanOffer[]> {
    return [
      {
        product: 'pro_monthly',
        active: true,
        displayName: 'Pro',
        billingModel: 'subscription',
        billingInterval: 'month',
        currency: 'USD',
        priceMinor: 1200,
        allowances: { cloudWordsPerMonth: 100_000 },
      },
    ]
  }
  async checkout(): Promise<string> {
    this.checkoutCalls += 1
    return 'https://api.example.test/billing/redirect?token=test-token'
  }
  async portal(): Promise<string> {
    return 'https://api.example.test/billing/redirect?token=portal-token'
  }
  async cancelAccount(): Promise<void> {
    this.cancelCalls += 1
  }
  redirect(): string {
    return 'https://checkout.stripe.com/test'
  }
  async webhook(): Promise<void> {}
}

function fakeAuth(): AuthFacade & { deleted: boolean } {
  const facade: AuthFacade & { deleted: boolean } = {
    deleted: false,
    handler: ((_request, response) => response.status(404).end()) as RequestHandler,
    async getSession(headers) {
      return headers.authorization === 'Bearer valid' ? verifiedSession : null
    },
    getSignedSessionToken: () => null,
    async requestPasswordReset() {},
    async setPassword() {},
    async revokeSessions() {},
    async deleteUser() {
      facade.deleted = true
    },
    async beginSocialSignIn() {
      return 'https://accounts.example.test/oauth'
    },
  }
  return facade
}

const fakeOAuth: OAuthFacade = {
  async begin() {
    return 'https://accounts.example.test/oauth'
  },
  async complete() {
    return 'rudyopentypeless://auth/callback?code=one-time&state=test-state'
  },
  async exchange() {
    return 'signed.session.token'
  },
}

const fakeProviders: ManagedProviders = {
  async transcribe() {
    return { text: 'Hello from managed speech' }
  },
  async polish(): Promise<ProviderTextResult> {
    return { text: 'Polished sentence.', inputTokens: 12, outputTokens: 3 }
  },
  async streamPolish(
    _messages: ChatMessage[],
    onDelta: (text: string) => void,
  ): Promise<ProviderTextResult> {
    onDelta('Fast ')
    onDelta('cleanup')
    return { text: 'Fast cleanup', inputTokens: 10, outputTokens: 2 }
  },
  async ask() {
    return { text: 'A useful answer.', inputTokens: 8, outputTokens: 4 }
  },
}

function wav(seconds = 1): Buffer {
  const dataBytes = 32_000 * seconds
  const output = Buffer.alloc(44 + dataBytes)
  output.write('RIFF', 0, 'ascii')
  output.writeUInt32LE(output.length - 8, 4)
  output.write('WAVE', 8, 'ascii')
  output.write('fmt ', 12, 'ascii')
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(16_000, 24)
  output.writeUInt32LE(32_000, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36, 'ascii')
  output.writeUInt32LE(dataBytes, 40)
  return output
}

function operation(stageKey: string, requestType = 'voice_pipeline') {
  return { operationId: 'operation-test-1234', stageKey, requestType }
}

describe('managed service HTTP application', () => {
  let store: MemoryStore
  let billing: FakeBilling
  let auth: ReturnType<typeof fakeAuth>
  let exportUrl: string | undefined
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    store = new MemoryStore()
    billing = new FakeBilling()
    auth = fakeAuth()
    exportUrl = undefined
    app = createApp({
      config: testConfig(),
      store,
      billing,
      auth,
      oauth: fakeOAuth,
      providers: fakeProviders,
      sendExport: async (_config, _recipient, downloadUrl) => {
        exportUrl = downloadUrl
      },
    })
  })

  it('serves readiness and a strict server-owned plan catalogue with desktop CORS', async () => {
    await request(app).get('/api/health/ready').expect(200, { ready: true })
    const response = await request(app)
      .get('/api/plans')
      .set('Origin', 'http://tauri.localhost')
      .expect(200)
    expect(response.headers['access-control-allow-origin']).toBe('http://tauri.localhost')
    expect(response.body.plans[0].priceMinor).toBe(1200)
  })

  it('distinguishes a missing bearer from an invalid persisted session', async () => {
    expect((await request(app).get('/api/subscription/status').expect(401)).body.error.code).toBe(
      'AUTH_REQUIRED',
    )
    expect(
      (
        await request(app)
          .get('/api/subscription/status')
          .set('Authorization', 'Bearer invalid')
          .expect(401)
      ).body.error.code,
    ).toBe('AUTH_SESSION_INVALID')
  })

  it('meters non-stream and streaming Gemini cleanup without replaying a stage', async () => {
    const first = await request(app)
      .post('/api/proxy/llm')
      .set('Authorization', 'Bearer valid')
      .send({
        messages: [{ role: 'user', content: 'hello um world' }],
        context: operation('operation-test-1234:llm'),
      })
      .expect(200)
    expect(first.body).toEqual({ text: 'Polished sentence.' })
    expect(store.settlements[0].settlement.llmTokens).toBe(15)

    const replay = await request(app)
      .post('/api/proxy/llm')
      .set('Authorization', 'Bearer valid')
      .send({
        messages: [{ role: 'user', content: 'hello um world' }],
        context: operation('operation-test-1234:llm'),
      })
      .expect(409)
    expect(replay.body.error.code).toBe('QUOTA_RESERVATION_CONFLICT')

    const streamed = await request(app)
      .post('/api/proxy/llm')
      .set('Authorization', 'Bearer valid')
      .send({
        messages: [{ role: 'user', content: 'clean quickly' }],
        stream: true,
        context: operation('operation-test-5678:llm'),
      })
      .expect(200)
    expect(streamed.text).toContain('Fast ')
    expect(streamed.text).toContain('data: [DONE]')
  })

  it('forwards bounded WAV audio to managed STT and records actual duration', async () => {
    const response = await request(app)
      .post('/api/proxy/stt')
      .set('Authorization', 'Bearer valid')
      .attach('audio', wav(2), { filename: 'audio.wav', contentType: 'audio/wav' })
      .field('operationId', 'operation-audio-1234')
      .field('stageKey', 'operation-audio-1234:stt')
      .field('requestType', 'voice_pipeline')
      .field('language', 'en')
      .expect(200)
    expect(response.body.text).toBe('Hello from managed speech')
    expect(store.settlements[0].settlement.sttSeconds).toBeCloseTo(2, 2)
  })

  it('encrypts and round-trips only contract-valid portable backups idempotently', async () => {
    const snapshot = {
      version: 1,
      createdAt: '2026-08-13T10:00:00.000Z',
      history: [],
      dictionary: { entries: [], correction_rules: [] },
      settings: createBackupSettings(useAppStore.getState().config),
    }
    const first = await request(app)
      .post('/api/backup/upload')
      .set('Authorization', 'Bearer valid')
      .set('Idempotency-Key', 'backup-intent-123456')
      .send(snapshot)
      .expect(200)
    expect(first.body.success).toBe(true)
    expect(store.backup?.ciphertext.toString('utf8')).not.toContain('polish_enabled')

    await request(app)
      .post('/api/backup/upload')
      .set('Authorization', 'Bearer valid')
      .set('Idempotency-Key', 'backup-intent-123456')
      .send(snapshot)
      .expect(200)
    const downloaded = await request(app)
      .get('/api/backup/download')
      .set('Authorization', 'Bearer valid')
      .expect(200)
    expect(downloaded.body).toEqual(snapshot)
  })

  it('rejects secret-bearing backup fields before storage', async () => {
    const response = await request(app)
      .post('/api/backup/upload')
      .set('Authorization', 'Bearer valid')
      .set('Idempotency-Key', 'hostile-backup-123456')
      .send({
        version: 1,
        createdAt: new Date().toISOString(),
        history: [],
        dictionary: {},
        settings: { geminiApiKey: 'secret' },
      })
      .expect(422)
    expect(response.body.error.code).toBe('INVALID_REQUEST')
    expect(store.backup).toBeNull()
  })

  it('returns only a managed-origin billing URL and replays checkout idempotently', async () => {
    const send = () =>
      request(app)
        .post('/api/checkout/create')
        .set('Authorization', 'Bearer valid')
        .set('Idempotency-Key', 'checkout-intent-123456')
        .send({ origin: 'desktop', product: 'pro_monthly' })
    const first = await send().expect(200)
    const second = await send().expect(200)
    expect(first.body.url).toMatch(/^https:\/\/api\.example\.test\/billing\/redirect/)
    expect(second.body).toEqual(first.body)
    expect(billing.checkoutCalls).toBe(1)
  })

  it('delivers an encrypted one-time account-export link instead of email attachment data', async () => {
    await request(app)
      .post('/api/account/export')
      .set('Authorization', 'Bearer valid')
      .set('Idempotency-Key', 'export-intent-123456')
      .send({})
      .expect(202)
    expect(exportUrl).toMatch(
      /^https:\/\/api\.example\.test\/api\/account\/export\/download\?token=/,
    )

    const download = new URL(exportUrl!)
    const first = await request(app)
      .get(download.pathname + download.search)
      .expect(200)
    expect(first.headers['content-disposition']).toContain('opentypeless-account-export.json')
    expect(first.body).toEqual(
      expect.objectContaining({ user: verifiedSession.user, managedData: { usage: [] } }),
    )
    await request(app)
      .get(download.pathname + download.search)
      .expect(404)
  })

  it('enforces the shared public endpoint rate limiter before PKCE exchange', async () => {
    store.rateLimitAllowed = false
    const response = await request(app)
      .post('/api/auth/desktop/exchange')
      .send({ code: 'a'.repeat(43), codeVerifier: 'b'.repeat(43) })
      .expect(429)
    expect(response.body.error.code).toBe('RATE_LIMITED')
  })

  it('rate-limits authenticated password changes and account deletion', async () => {
    store.rateLimitAllowed = false

    const passwordResponse = await request(app)
      .post('/api/opentypeless/auth/set-password')
      .set('Authorization', 'Bearer valid')
      .send({ newPassword: 'a-secure-new-password' })
      .expect(429)
    expect(passwordResponse.body.error.code).toBe('RATE_LIMITED')

    const deletionResponse = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer valid')
      .set('Idempotency-Key', 'delete-rate-limit-123456')
      .send({ confirmation: 'DELETE' })
      .expect(429)
    expect(deletionResponse.body.error.code).toBe('RATE_LIMITED')
  })

  it('applies in-process burst limits to both sensitive account routes', async () => {
    const passwordRequest = () =>
      request(app)
        .post('/api/opentypeless/auth/set-password')
        .set('Authorization', 'Bearer valid')
        .send({ newPassword: 'a-secure-new-password' })
    for (let attempt = 0; attempt < 5; attempt += 1) await passwordRequest().expect(204)
    expect((await passwordRequest().expect(429)).body.error.code).toBe('RATE_LIMITED')

    const deletionRequest = (attempt: number) =>
      request(app)
        .delete('/api/account')
        .set('Authorization', 'Bearer valid')
        .set('Idempotency-Key', 'delete-burst-' + attempt + '-123456')
        .send({ confirmation: 'DELETE' })
    for (let attempt = 0; attempt < 3; attempt += 1) await deletionRequest(attempt).expect(202)
    expect((await deletionRequest(4).expect(429)).body.error.code).toBe('RATE_LIMITED')
  })

  it('accepts only a recent authenticated destructive deletion and cancels billing first', async () => {
    await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer valid')
      .set('Idempotency-Key', 'delete-intent-123456')
      .send({ confirmation: 'DELETE' })
      .expect(202)
    expect(billing.cancelCalls).toBe(1)
    expect(store.deleted).toBe(true)
    expect(auth.deleted).toBe(true)
  })

  it('delegates public PKCE exchange without accepting ambient browser credentials', async () => {
    const response = await request(app)
      .post('/api/auth/desktop/exchange')
      .send({ code: 'a'.repeat(43), codeVerifier: 'b'.repeat(43) })
      .expect(200)
    expect(response.body).toEqual({ token: 'signed.session.token' })
    expect(response.headers['cache-control']).toBe('no-store')
  })
})
