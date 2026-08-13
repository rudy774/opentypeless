import { z } from 'zod'

const localHttpHost = new Set(['localhost', '127.0.0.1', '[::1]', 'tauri.localhost'])

function managedUrl(value: string, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute URL`)
  }
  const normalizedHost = parsed.hostname.replace(/\.$/, '').toLowerCase()
  const safeLocalHttp = parsed.protocol === 'http:' && localHttpHost.has(normalizedHost)
  if (
    (parsed.protocol !== 'https:' && !safeLocalHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(`${label} must use HTTPS (or loopback HTTP) without credentials or fragments`)
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/'
  return parsed.origin
}

function secretBase64(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    throw new Error(`${label} must be exactly 32 random bytes encoded as base64`)
  }
  return decoded
}

const rawEnvironment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  MANAGED_API_ORIGIN: z.string().default('http://127.0.0.1:8787'),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_MODE: z.enum(['require', 'disable']).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
  RUN_MIGRATIONS_ON_START: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  BETTER_AUTH_SECRET: z.string().min(32),
  BACKUP_ENCRYPTION_KEY: z.string().min(1),
  BACKUP_ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .default('primary'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://tauri.localhost,https://tauri.localhost'),
  DESKTOP_DEEP_LINK_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]{1,31}$/),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_STT_MODEL: z.string().min(1).default('scribe_v2'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().min(1).optional(),
  STRIPE_LIFETIME_STARTER_PRICE_ID: z.string().min(1).optional(),
  PRO_MONTHLY_CLOUD_WORDS: z.coerce.number().int().min(1000).max(10000000).default(100000),
  LIFETIME_CLOUD_WORDS: z.coerce.number().int().min(1000).max(10000000).default(25000),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().email().optional(),
  PUBLIC_WEBSITE_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
})

export interface ServiceConfig {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  apiOrigin: string
  databaseUrl: string
  databaseSsl: boolean
  databasePoolMax: number
  runMigrationsOnStart: boolean
  trustProxyHops: number
  authSecret: string
  backupKey: Buffer
  backupKeyId: string
  corsOrigins: ReadonlySet<string>
  desktopDeepLinkScheme: string
  elevenLabsApiKey?: string
  elevenLabsModel: string
  geminiApiKey?: string
  geminiModel: string
  stripeSecretKey?: string
  stripeWebhookSecret?: string
  stripeProMonthlyPriceId?: string
  stripeLifetimeStarterPriceId?: string
  proMonthlyCloudWords: number
  lifetimeCloudWords: number
  google?: { clientId: string; clientSecret: string }
  github?: { clientId: string; clientSecret: string }
  resendApiKey?: string
  mailFrom?: string
  websiteOrigin?: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  shutdownGraceMs: number
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const env = rawEnvironment.parse(environment)
  const apiOrigin = managedUrl(env.MANAGED_API_ORIGIN, 'MANAGED_API_ORIGIN')
  const websiteOrigin = env.PUBLIC_WEBSITE_URL
    ? managedUrl(env.PUBLIC_WEBSITE_URL, 'PUBLIC_WEBSITE_URL')
    : undefined
  const corsOrigins = new Set(
    env.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => managedUrl(origin, 'CORS_ALLOWED_ORIGINS')),
  )
  const stripeValues = [
    env.STRIPE_SECRET_KEY,
    env.STRIPE_WEBHOOK_SECRET,
    env.STRIPE_PRO_MONTHLY_PRICE_ID,
  ]
  const hasAnyStripe = stripeValues.some(Boolean)
  if (hasAnyStripe && stripeValues.some((value) => !value)) {
    throw new Error(
      'Stripe configuration must include secret, webhook secret, and monthly price ID',
    )
  }
  if (hasAnyStripe && !websiteOrigin) {
    throw new Error('Stripe billing requires PUBLIC_WEBSITE_URL')
  }
  if (env.NODE_ENV === 'production') {
    if (!apiOrigin.startsWith('https://'))
      throw new Error('Production MANAGED_API_ORIGIN must use HTTPS')
    if (env.DATABASE_SSL_MODE !== 'require')
      throw new Error('Production database connections must require TLS')
    if (!env.ELEVENLABS_API_KEY || !env.GEMINI_API_KEY) {
      throw new Error('Production managed inference requires ElevenLabs and Gemini API keys')
    }
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_PRO_MONTHLY_PRICE_ID) {
      throw new Error('Production billing requires complete Stripe configuration')
    }
    if (!websiteOrigin) throw new Error('Production PUBLIC_WEBSITE_URL is required')
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
      throw new Error('Production email authentication requires Resend and MAIL_FROM')
    }
  }
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    apiOrigin,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL_MODE === 'require',
    databasePoolMax: env.DATABASE_POOL_MAX,
    runMigrationsOnStart: env.RUN_MIGRATIONS_ON_START === 'true',
    trustProxyHops: env.TRUST_PROXY_HOPS,
    authSecret: env.BETTER_AUTH_SECRET,
    backupKey: secretBase64(env.BACKUP_ENCRYPTION_KEY, 'BACKUP_ENCRYPTION_KEY'),
    backupKeyId: env.BACKUP_ENCRYPTION_KEY_ID,
    corsOrigins,
    desktopDeepLinkScheme: env.DESKTOP_DEEP_LINK_SCHEME,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    elevenLabsModel: env.ELEVENLABS_STT_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    stripeProMonthlyPriceId: env.STRIPE_PRO_MONTHLY_PRICE_ID,
    stripeLifetimeStarterPriceId: env.STRIPE_LIFETIME_STARTER_PRICE_ID,
    proMonthlyCloudWords: env.PRO_MONTHLY_CLOUD_WORDS,
    lifetimeCloudWords: env.LIFETIME_CLOUD_WORDS,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
        : undefined,
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM,
    websiteOrigin,
    logLevel: env.LOG_LEVEL,
    shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
  }
}
