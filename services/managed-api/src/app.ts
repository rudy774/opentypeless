import { randomBytes } from 'node:crypto'
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { AuthFacade } from './auth.js'
import type { BillingFacade } from './billing.js'
import type { ServiceConfig } from './config.js'
import { decryptBackup, encryptBackup, openSecret, sealSecret, sha256 } from './crypto.js'
import { sendAccountExportEmail } from './email.js'
import { asyncRoute, errorHandler, ServiceError } from './errors.js'
import { cors, requestContext } from './observability.js'
import type { OAuthFacade } from './oauth.js'
import type { ChatMessage, ManagedProviders, ProviderTextResult } from './providers.js'
import type { ServiceStore } from './store.js'
import type { OperationContext, SubscriptionStatus, UsageKind } from './types.js'
import {
  askSchema,
  checkoutSchema,
  deleteAccountSchema,
  desktopExchangeSchema,
  llmSchema,
  parseBody,
  requireIdempotencyKey,
  sttContextSchema,
  validateBackupSnapshot,
} from './validation.js'

const JSON_LIMIT = '8mb'
const AUDIO_LIMIT_BYTES = 25 * 1024 * 1024
const RECENT_AUTH_MS = 10 * 60 * 1000
const ACCOUNT_EXPORT_TTL_MS = 30 * 60 * 1000
const ACCOUNT_EXPORT_PURPOSE = 'account-export'

export interface AppDependencies {
  config: ServiceConfig
  store: ServiceStore
  auth: AuthFacade
  oauth: OAuthFacade
  providers: ManagedProviders
  billing: BillingFacade
  sendExport?: typeof sendAccountExportEmail
}

function requireAuthentication(auth: AuthFacade): RequestHandler {
  return asyncRoute(async (request, _response, next) => {
    const session = await auth.getSession(request.headers)
    if (!session) {
      const suppliedBearer = /^Bearer\s+\S+/i.test(request.get('authorization') ?? '')
      throw new ServiceError(
        401,
        suppliedBearer ? 'AUTH_SESSION_INVALID' : 'AUTH_REQUIRED',
        suppliedBearer ? 'Session expired' : 'Authentication required',
      )
    }
    request.user = session.user
    request.authSession = session
    next()
  })
}

function requireVerifiedUser(request: Request): void {
  if (!request.user?.emailVerified) {
    throw new ServiceError(403, 'AUTH_REQUIRED', 'Verify your email before using managed services')
  }
}

function requireRecentAuthentication(request: Request): void {
  const createdAt = request.authSession?.sessionCreatedAt.valueOf() ?? 0
  if (!createdAt || Date.now() - createdAt > RECENT_AUTH_MS) {
    throw new ServiceError(
      401,
      'AUTH_RECENT_LOGIN_REQUIRED',
      'Sign in again before changing account security',
    )
  }
}

function hasManagedAccess(status: SubscriptionStatus): boolean {
  if (status.licenseStatus === 'refunded' || status.licenseStatus === 'deactivated') return false
  if (status.plan === 'pro') {
    return (
      (status.source === 'stripe' || status.source === 'creem') &&
      (status.subscriptionStatus === 'active' || status.subscriptionStatus === 'trialing') &&
      status.cloudWordsLimit > 0
    )
  }
  if (status.plan === 'lifetime_starter') {
    return status.source === 'lifetime' && status.cloudWordsLimit > 0
  }
  if (status.source === 'appsumo') {
    return status.licenseStatus === 'active' && status.cloudWordsLimit > 0
  }
  return false
}

async function enforceRateLimit(
  store: ServiceStore,
  scope: string,
  discriminator: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const allowed = await store.consumeRateLimit(scope, sha256(discriminator), limit, windowSeconds)
  if (!allowed) {
    throw new ServiceError(429, 'RATE_LIMITED', 'Too many requests', true, windowSeconds * 1000)
  }
}
async function entitledStatus(request: Request, store: ServiceStore): Promise<SubscriptionStatus> {
  requireVerifiedUser(request)
  const status = await store.getSubscription(request.user!.id)
  if (!hasManagedAccess(status)) {
    throw new ServiceError(403, 'ENTITLEMENT_REQUIRED', 'A managed cloud plan is required')
  }
  return status
}

function estimateWords(value: string): number {
  const text = value.trim()
  if (!text) return 0
  const whitespaceWords = text.split(/\s+/u).length
  const characterEstimate = Math.ceil([...text].length / 5)
  return Math.max(whitespaceWords, characterEstimate)
}

function wavDurationSeconds(audio: Buffer): number {
  if (audio.length < 44) return 0
  const riff = audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE'
  if (!riff) return Math.min(15 * 60, audio.length / 32_000)
  const channels = audio.readUInt16LE(22)
  const sampleRate = audio.readUInt32LE(24)
  const bitsPerSample = audio.readUInt16LE(34)
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8)
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return 0
  return Math.min(15 * 60, Math.max(0, (audio.length - 44) / bytesPerSecond))
}

async function reserveUsage(
  request: Request,
  store: ServiceStore,
  context: OperationContext,
  usageKind: UsageKind,
  reservedUnits: number,
  providerClass: string,
): Promise<void> {
  await enforceRateLimit(store, 'inference-user', request.user!.id, 120, 60)
  const status = await entitledStatus(request, store)
  const result = await store.reserveUsage(
    {
      userId: request.user!.id,
      operationId: context.operationId,
      stageKey: context.stageKey,
      requestType: context.requestType,
      usageKind,
      reservedUnits,
      requestId: request.requestId,
      providerClass,
    },
    status.cloudWordsLimit,
  )
  if (result.state === 'exhausted') {
    throw new ServiceError(403, 'QUOTA_EXHAUSTED', 'Managed cloud quota is exhausted')
  }
  if (result.state !== 'reserved') {
    throw new ServiceError(
      409,
      'QUOTA_RESERVATION_CONFLICT',
      'This managed operation was already submitted',
    )
  }
}

async function idempotentJson(
  request: Request,
  response: Response,
  store: ServiceStore,
  route: string,
  operation: (key: string) => Promise<{ status: number; body: unknown }>,
): Promise<void> {
  const key = requireIdempotencyKey(request.get('idempotency-key') ?? undefined)
  const userId = request.user!.id
  const digest = sha256(JSON.stringify(request.body ?? null))
  const prior = await store.beginIdempotency(userId, route, key, digest)
  if (prior.state === 'replay') {
    response.status(prior.status ?? 200).json(prior.response)
    return
  }
  if (prior.state !== 'new') {
    throw new ServiceError(
      409,
      'QUOTA_RESERVATION_CONFLICT',
      prior.state === 'conflict'
        ? 'Idempotency key was used for a different request'
        : 'The request is already processing',
    )
  }
  try {
    const result = await operation(key)
    await store.completeIdempotency(userId, route, key, result.status, result.body)
    response.status(result.status).json(result.body)
  } catch (error) {
    await store.abandonIdempotency(userId, route, key).catch(() => undefined)
    throw error
  }
}

const curatedScenes = [
  {
    id: 'managed.email-clear',
    name: 'Clear email',
    description: 'Polished, concise business email.',
    category: 'communication',
    promptTemplate: 'Write a concise, natural email while preserving the speaker’s meaning.',
    dictionaryTerms: [],
    isPro: false,
  },
  {
    id: 'managed.meeting-notes',
    name: 'Meeting notes',
    description: 'Readable notes with clear actions.',
    category: 'productivity',
    promptTemplate:
      'Turn the transcript into clear notes. Preserve facts and identify explicit action items.',
    dictionaryTerms: [],
    isPro: true,
  },
]

export function createApp(dependencies: AppDependencies): express.Express {
  const { config, store, auth, oauth, providers, billing } = dependencies
  const sendExport = dependencies.sendExport ?? sendAccountExportEmail
  const app = express()
  const requireAuth = requireAuthentication(auth)
  const jsonParser = express.json({
    limit: JSON_LIMIT,
    strict: true,
    verify: (request, _response, buffer) => {
      ;(request as Request).rawBodyBytes = buffer.length
    },
  })
  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AUDIO_LIMIT_BYTES, files: 1, fields: 8, fieldSize: 4096 },
  })

  app.disable('x-powered-by')
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops)
  app.use(requestContext(config))
  app.use(cors(config))

  app.post(
    '/api/billing/stripe/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    asyncRoute(async (request, response) => {
      const signature = request.get('stripe-signature')
      if (!signature || !Buffer.isBuffer(request.body)) {
        throw new ServiceError(400, 'INVALID_REQUEST', 'Invalid billing webhook')
      }
      await billing.webhook(request.body, signature)
      response.status(204).end()
    }),
  )

  app.get(
    '/api/health/ready',
    asyncRoute(async (_request, response) => {
      if (!(await store.ready()))
        throw new ServiceError(503, 'PROVIDER_UNAVAILABLE', 'Service is not ready', true, 1000)
      response.json({ ready: true })
    }),
  )

  app.get(
    '/api/plans',
    asyncRoute(async (_request, response) => response.json({ plans: await billing.plans() })),
  )

  app.get('/auth/callback', (request, response, next) => {
    const keys = Object.keys(request.query)
    const valid =
      keys.length === 3 &&
      keys.every((key) => ['desktop', 'code_challenge', 'code_challenge_method'].includes(key)) &&
      typeof request.query.desktop === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(request.query.desktop) &&
      typeof request.query.code_challenge === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(request.query.code_challenge) &&
      request.query.code_challenge_method === 'S256'
    if (!valid) {
      next(new ServiceError(422, 'INVALID_REQUEST', 'Email verification callback is invalid'))
      return
    }
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    response
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>Email verified</title><main style="font:16px system-ui;max-width:36rem;margin:10vh auto;padding:2rem"><h1>Email verified</h1><p>You can close this window and return to OpenTypeless to sign in.</p></main>',
      )
  })
  app.get(
    '/api/auth/desktop-oauth',
    asyncRoute(async (request, response) => {
      await enforceRateLimit(
        store,
        'oauth-start-ip',
        request.ip ?? request.socket.remoteAddress ?? 'unknown',
        30,
        900,
      )
      const destination = await oauth.begin(
        request.query.provider,
        request.query.callbackURL,
        request,
      )
      response.redirect(302, destination)
    }),
  )

  app.get(
    '/api/auth/desktop/complete',
    asyncRoute(async (request, response) => {
      const destination = await oauth.complete(request.query.transaction, request)
      response.redirect(302, destination)
    }),
  )

  app.post(
    '/api/auth/desktop/exchange',
    express.json({ limit: '16kb', strict: true }),
    asyncRoute(async (request, response) => {
      await enforceRateLimit(
        store,
        'oauth-exchange-ip',
        request.ip ?? request.socket.remoteAddress ?? 'unknown',
        30,
        900,
      )
      const body = parseBody(desktopExchangeSchema, request.body)
      const token = await oauth.exchange(body.code, body.codeVerifier)
      response.setHeader('Cache-Control', 'no-store')
      response.json({ token })
    }),
  )

  app.all('/api/auth/{*splat}', auth.handler)
  app.use(jsonParser)

  app.post(
    '/api/opentypeless/auth/request-password-reset',
    asyncRoute(async (request, response) => {
      const body = parseBody(
        z
          .object({ email: z.string().email().max(320), locale: z.string().max(20).optional() })
          .strict(),
        request.body,
      )
      await enforceRateLimit(
        store,
        'password-reset-ip',
        request.ip ?? request.socket.remoteAddress ?? 'unknown',
        10,
        3600,
      )
      await enforceRateLimit(store, 'password-reset-email', body.email.toLowerCase(), 5, 3600)
      await auth.requestPasswordReset(body.email)
      response.status(202).json({ requestId: request.requestId, status: 'accepted' })
    }),
  )

  app.post(
    '/api/opentypeless/auth/set-password',
    requireAuth,
    asyncRoute(async (request, response) => {
      requireRecentAuthentication(request)
      const body = parseBody(
        z.object({ newPassword: z.string().min(12).max(128) }).strict(),
        request.body,
      )
      await auth.setPassword(body.newPassword, request.headers)
      response.status(204).end()
    }),
  )

  app.get(
    '/api/subscription/status',
    requireAuth,
    asyncRoute(async (request, response) =>
      response.json(await store.getSubscription(request.user!.id)),
    ),
  )

  app.post(
    '/api/checkout/create',
    requireAuth,
    asyncRoute(async (request, response) => {
      requireVerifiedUser(request)
      const body = parseBody(checkoutSchema, request.body)
      await idempotentJson(request, response, store, '/api/checkout/create', async (key) => ({
        status: 200,
        body: { url: await billing.checkout(request.user!, body.product, body.origin, key) },
      }))
    }),
  )

  app.post(
    '/api/subscription/portal',
    requireAuth,
    asyncRoute(async (request, response) => {
      requireVerifiedUser(request)
      response.json({ url: await billing.portal(request.user!, request.requestId) })
    }),
  )

  app.get(
    '/billing/redirect',
    asyncRoute(async (request, response) => {
      if (typeof request.query.token !== 'string')
        throw new ServiceError(404, 'INVALID_REQUEST', 'Billing link is invalid')
      response.setHeader('Content-Security-Policy', "default-src 'none'")
      response.redirect(303, billing.redirect(request.query.token))
    }),
  )

  app.post(
    '/api/proxy/stt',
    requireAuth,
    audioUpload.single('audio'),
    asyncRoute(async (request, response) => {
      if (
        !request.file ||
        !['audio/wav', 'audio/x-wav', 'application/octet-stream'].includes(request.file.mimetype)
      ) {
        throw new ServiceError(422, 'INVALID_REQUEST', 'A WAV audio file is required')
      }
      const context = parseBody(sttContextSchema, {
        operationId: request.body.operationId,
        stageKey: request.body.stageKey,
        requestType: request.body.requestType,
        clientVersion: request.body.clientVersion,
        language: request.body.language,
      })
      const durationSeconds = wavDurationSeconds(request.file.buffer)
      if (durationSeconds <= 0) throw new ServiceError(422, 'INVALID_REQUEST', 'Audio is invalid')
      const reserved = Math.max(32, Math.ceil(durationSeconds * 4.5))
      await reserveUsage(request, store, context, 'stt', reserved, 'elevenlabs')
      try {
        const result = await providers.transcribe(
          request.file.buffer,
          request.file.mimetype,
          context.language,
        )
        await store.settleUsage(request.user!.id, context.stageKey, {
          cloudWords: estimateWords(result.text),
          sttSeconds: durationSeconds,
        })
        response.json({ text: result.text })
      } catch (error) {
        await store.releaseUsage(request.user!.id, context.stageKey).catch(() => undefined)
        throw error
      }
    }),
  )

  app.post(
    '/api/proxy/llm',
    requireAuth,
    asyncRoute(async (request, response) => {
      const body = parseBody(llmSchema, request.body)
      const messages = body.messages as ChatMessage[]
      const inputWords = messages.reduce(
        (total, message) => total + estimateWords(message.content),
        0,
      )
      const reserved = Math.min(100_000, Math.max(128, inputWords * 3 + 256))
      await reserveUsage(request, store, body.context, 'llm', reserved, 'gemini')
      if (!body.stream) {
        try {
          const result = await providers.polish(messages)
          await settleTextUsage(store, request, body.context, result, inputWords)
          response.json({ text: result.text })
        } catch (error) {
          await store.releaseUsage(request.user!.id, body.context.stageKey).catch(() => undefined)
          throw error
        }
        return
      }

      let wroteOutput = false
      response.status(200)
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      response.setHeader('X-Accel-Buffering', 'no')
      try {
        const result = await providers.streamPolish(messages, (delta) => {
          wroteOutput = true
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`,
          )
        })
        if (!wroteOutput && result.text) {
          response.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: result.text } }] })}\n\n`,
          )
        }
        await settleTextUsage(store, request, body.context, result, inputWords)
        response.write('data: [DONE]\n\n')
        response.end()
      } catch (error) {
        await store.releaseUsage(request.user!.id, body.context.stageKey).catch(() => undefined)
        if (response.headersSent) {
          request.log?.('error', 'stream_failed', { providerClass: 'gemini' })
          response.destroy()
          return
        }
        throw error
      }
    }),
  )

  app.post(
    '/api/proxy/ask',
    requireAuth,
    asyncRoute(async (request, response) => {
      const body = parseBody(askSchema, request.body)
      const inputWords = estimateWords(body.question)
      const reserved = Math.min(50_000, Math.max(128, inputWords * 3 + 256))
      await reserveUsage(request, store, body.context, 'ask', reserved, 'gemini')
      try {
        const result = await providers.ask(body.question)
        await settleTextUsage(store, request, body.context, result, inputWords)
        response.json({ answer: result.text })
      } catch (error) {
        await store.releaseUsage(request.user!.id, body.context.stageKey).catch(() => undefined)
        throw error
      }
    }),
  )

  app.post(
    '/api/backup/upload',
    requireAuth,
    asyncRoute(async (request, response) => {
      requireVerifiedUser(request)
      validateBackupSnapshot(
        request.body,
        request.rawBodyBytes ?? Buffer.byteLength(JSON.stringify(request.body)),
      )
      await idempotentJson(request, response, store, '/api/backup/upload', async () => {
        const encoded = Buffer.from(JSON.stringify(request.body), 'utf8')
        await store.saveBackup(
          request.user!.id,
          encryptBackup(
            encoded,
            config.backupKey,
            config.backupKeyId,
            request.body.version,
            request.body.createdAt,
          ),
        )
        return {
          status: 200,
          body: { success: true, version: request.body.version, createdAt: request.body.createdAt },
        }
      })
    }),
  )

  app.get(
    '/api/backup/download',
    requireAuth,
    asyncRoute(async (request, response) => {
      requireVerifiedUser(request)
      const record = await store.getBackup(request.user!.id)
      if (!record) throw new ServiceError(404, 'BACKUP_NOT_FOUND', 'No cloud backup exists')
      let snapshot: unknown
      try {
        const plaintext = decryptBackup(record, config.backupKey)
        snapshot = JSON.parse(plaintext.toString('utf8'))
        validateBackupSnapshot(snapshot, plaintext.length)
      } catch {
        throw new ServiceError(500, 'INTERNAL_ERROR', 'Cloud backup could not be read')
      }
      response.json(snapshot)
    }),
  )

  app.get('/api/scenes', requireAuth, (_request, response) => response.json(curatedScenes))

  app.post(
    '/api/account/export',
    requireAuth,
    asyncRoute(async (request, response) => {
      await idempotentJson(request, response, store, '/api/account/export', async (key) => {
        const managedData = await store.exportAccount(request.user!.id)
        const backupRecord = await store.getBackup(request.user!.id)
        let backup: unknown = null
        if (backupRecord) {
          const plaintext = decryptBackup(backupRecord, config.backupKey)
          backup = JSON.parse(plaintext.toString('utf8'))
        }
        const payload = JSON.stringify({
          exportedAt: new Date().toISOString(),
          user: request.user,
          managedData,
          backup,
        })
        if (Buffer.byteLength(payload, 'utf8') > 8 * 1024 * 1024) {
          throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', 'Account export is too large')
        }
        const token = randomBytes(32).toString('base64url')
        await store.createAccountExport(
          sha256(token),
          request.user!.id,
          sealSecret(payload, config.backupKey, config.backupKeyId, ACCOUNT_EXPORT_PURPOSE),
          new Date(Date.now() + ACCOUNT_EXPORT_TTL_MS),
        )
        const download = new URL('/api/account/export/download', config.apiOrigin)
        download.searchParams.set('token', token)
        await sendExport(config, request.user!.email, download.href, key)
        return { status: 202, body: { requestId: request.requestId, status: 'complete' } }
      })
    }),
  )

  app.get(
    '/api/account/export/download',
    asyncRoute(async (request, response) => {
      const token = request.query.token
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new ServiceError(404, 'INVALID_REQUEST', 'Account export link is invalid')
      }
      const artifact = await store.consumeAccountExport(sha256(token))
      if (!artifact)
        throw new ServiceError(404, 'INVALID_REQUEST', 'Account export link is invalid or expired')
      let payload: string
      try {
        payload = openSecret(artifact, config.backupKey, ACCOUNT_EXPORT_PURPOSE)
      } catch {
        throw new ServiceError(404, 'INVALID_REQUEST', 'Account export link is invalid or expired')
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.setHeader(
        'Content-Disposition',
        'attachment; filename="opentypeless-account-export.json"',
      )
      response.send(payload)
    }),
  )
  app.delete(
    '/api/account',
    requireAuth,
    asyncRoute(async (request, response) => {
      requireRecentAuthentication(request)
      parseBody(deleteAccountSchema, request.body)
      await idempotentJson(request, response, store, '/api/account', async () => {
        await billing.cancelAccount(request.user!)
        await store.scheduleDeletion(request.user!.id)
        await store.deleteManagedAccount(request.user!.id)
        await auth.deleteUser(request.headers)
        return { status: 202, body: { requestId: request.requestId, status: 'complete' } }
      })
    }),
  )

  app.use((_request, _response, next) =>
    next(new ServiceError(404, 'INVALID_REQUEST', 'Route not found')),
  )
  app.use((error: unknown, _request: Request, _response: Response, next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      next(
        new ServiceError(
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 422,
          error.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Audio exceeds the 25 MiB limit'
            : 'Invalid audio upload',
        ),
      )
      return
    }
    if (error instanceof SyntaxError && 'status' in error) {
      next(new ServiceError(400, 'INVALID_REQUEST', 'Request body is invalid'))
      return
    }
    if (
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      next(new ServiceError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'))
      return
    }
    next(error)
  })
  app.use(errorHandler)
  return app
}

async function settleTextUsage(
  store: ServiceStore,
  request: Request,
  context: OperationContext,
  result: ProviderTextResult,
  inputWords: number,
): Promise<void> {
  const outputWords = estimateWords(result.text)
  await store.settleUsage(request.user!.id, context.stageKey, {
    cloudWords: inputWords + outputWords,
    llmTokens: result.inputTokens + result.outputTokens,
  })
}
