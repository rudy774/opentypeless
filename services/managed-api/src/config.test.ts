import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

function baseEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/opentypeless',
    DATABASE_SSL_MODE: 'disable',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DESKTOP_DEEP_LINK_SCHEME: 'rudyopentypeless',
  }
}

describe('managed service configuration', () => {
  it('accepts the Tauri WebView origins in local development without weakening production API TLS', () => {
    const config = loadConfig(baseEnvironment())
    expect(config.corsOrigins).toEqual(
      new Set(['http://tauri.localhost', 'https://tauri.localhost']),
    )
    expect(config.apiOrigin).toBe('http://127.0.0.1:8787')
  })

  it('fails closed when production dependencies or database TLS are missing', () => {
    expect(() => loadConfig({ ...baseEnvironment(), NODE_ENV: 'production' })).toThrow(
      'Production MANAGED_API_ORIGIN must use HTTPS',
    )
    expect(() =>
      loadConfig({
        ...baseEnvironment(),
        NODE_ENV: 'production',
        MANAGED_API_ORIGIN: 'https://api.example.test',
      }),
    ).toThrow('Production database connections must require TLS')
  })

  it('accepts a complete production configuration and never exposes decoded secrets as strings', () => {
    const config = loadConfig({
      ...baseEnvironment(),
      NODE_ENV: 'production',
      DATABASE_SSL_MODE: 'require',
      MANAGED_API_ORIGIN: 'https://api.example.test',
      PUBLIC_WEBSITE_URL: 'https://www.example.test',
      ELEVENLABS_API_KEY: 'test-elevenlabs-key',
      GEMINI_API_KEY: 'test-gemini-key',
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
      STRIPE_PRO_MONTHLY_PRICE_ID: 'price_placeholder',
      RESEND_API_KEY: 're_placeholder',
      MAIL_FROM: 'support@example.test',
    })
    expect(config.databaseSsl).toBe(true)
    expect(config.apiOrigin).toBe('https://api.example.test')
    expect(config.backupKey).toBeInstanceOf(Buffer)
  })

  it('rejects incomplete Stripe configuration and requires an owned website origin', () => {
    expect(() =>
      loadConfig({ ...baseEnvironment(), STRIPE_SECRET_KEY: 'sk_test_placeholder' }),
    ).toThrow('Stripe configuration must include')
    expect(() =>
      loadConfig({
        ...baseEnvironment(),
        STRIPE_SECRET_KEY: 'sk_test_placeholder',
        STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
        STRIPE_PRO_MONTHLY_PRICE_ID: 'price_placeholder',
      }),
    ).toThrow('Stripe billing requires PUBLIC_WEBSITE_URL')
  })
})
