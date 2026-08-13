import type { Request, RequestHandler } from 'express'
import { describe, expect, it } from 'vitest'
import type { AuthFacade, AuthSession } from './auth.js'
import type { ServiceConfig } from './config.js'
import { openSecret, sha256 } from './crypto.js'
import { ServiceError } from './errors.js'
import { DesktopOAuth } from './oauth.js'
import type { DesktopCodeInput, OAuthTransaction, ServiceStore } from './store.js'

const state = 's'.repeat(43)
const verifier = 'v'.repeat(43)
const challenge = Buffer.from(sha256(verifier), 'hex').toString('base64url')

function config(): ServiceConfig {
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
    backupKey: Buffer.alloc(32, 5),
    backupKeyId: 'primary',
    corsOrigins: new Set(),
    desktopDeepLinkScheme: 'rudyopentypeless',
    elevenLabsModel: 'scribe_v2',
    geminiModel: 'gemini-2.5-flash',
    proMonthlyCloudWords: 100_000,
    lifetimeCloudWords: 25_000,
    google: { clientId: 'google-id', clientSecret: 'google-secret' },
    logLevel: 'error',
    shutdownGraceMs: 5000,
  }
}

function session(): AuthSession {
  return {
    user: { id: 'user_1', email: 'person@example.test', name: 'Person', emailVerified: true },
    sessionCreatedAt: new Date(),
  }
}

function fakeAuth(): AuthFacade & { socialCallback?: string } {
  const value: AuthFacade & { socialCallback?: string } = {
    handler: ((_request, response) => response.end()) as RequestHandler,
    async getSession() {
      return session()
    },
    getSignedSessionToken() {
      return 'signed.better-auth.session'
    },
    async requestPasswordReset() {},
    async setPassword() {},
    async revokeSessions() {},
    async deleteUser() {},
    async beginSocialSignIn(_provider, callbackURL) {
      value.socialCallback = callbackURL
      return 'https://accounts.google.test/authorize'
    },
  }
  return value
}

describe('desktop OAuth PKCE', () => {
  it('binds an exact owned callback to a one-time server transaction', async () => {
    let stored: OAuthTransaction | undefined
    const store = {
      async createOAuthTransaction(_hash: string, transaction: OAuthTransaction) {
        stored = transaction
      },
    } as unknown as ServiceStore
    const auth = fakeAuth()
    const oauth = new DesktopOAuth(config(), store, auth)
    const callback = `https://api.example.test/auth/callback?desktop=${state}&code_challenge=${challenge}&code_challenge_method=S256`

    await expect(oauth.begin('google', callback, { headers: {} } as Request)).resolves.toBe(
      'https://accounts.google.test/authorize',
    )
    expect(stored).toEqual({ clientState: state, codeChallenge: challenge, provider: 'google' })
    const socialCallback = new URL(auth.socialCallback!)
    expect(socialCallback.origin).toBe('https://api.example.test')
    expect(socialCallback.pathname).toBe('/api/auth/desktop/complete')
    expect(socialCallback.searchParams.get('transaction')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects arbitrary origins, fragments, duplicate parameters, and non-S256 callbacks', async () => {
    const store = { async createOAuthTransaction() {} } as unknown as ServiceStore
    const oauth = new DesktopOAuth(config(), store, fakeAuth())
    const request = { headers: {} } as Request
    const callbacks = [
      `https://attacker.test/auth/callback?desktop=${state}&code_challenge=${challenge}&code_challenge_method=S256`,
      `https://api.example.test/auth/callback?desktop=${state}&code_challenge=${challenge}&code_challenge_method=plain`,
      `https://api.example.test/auth/callback?desktop=${state}&desktop=${state}&code_challenge=${challenge}&code_challenge_method=S256`,
      `https://api.example.test/auth/callback?desktop=${state}&code_challenge=${challenge}&code_challenge_method=S256#token`,
    ]
    for (const callback of callbacks) {
      await expect(oauth.begin('google', callback, request)).rejects.toBeInstanceOf(ServiceError)
    }
  })

  it('places only a one-time code in the deep link and releases the encrypted bearer after PKCE verification', async () => {
    let codeInput: DesktopCodeInput | undefined
    let consumed = false
    const store = {
      async consumeOAuthTransaction() {
        return { clientState: state, codeChallenge: challenge, provider: 'google' as const }
      },
      async createDesktopCode(input: DesktopCodeInput) {
        codeInput = input
      },
      async consumeDesktopCode(_codeHash: string, verifierChallenge: string) {
        if (consumed) return { state: 'replayed' as const }
        if (verifierChallenge !== challenge || !codeInput) return { state: 'invalid' as const }
        consumed = true
        return { state: 'ok' as const, sessionToken: codeInput.sessionToken }
      },
    } as unknown as ServiceStore
    const oauth = new DesktopOAuth(config(), store, fakeAuth())
    const deepLink = new URL(
      await oauth.complete('t'.repeat(43), { headers: { cookie: 'session' } } as Request),
    )

    expect(deepLink.protocol).toBe('rudyopentypeless:')
    expect(deepLink.searchParams.get('state')).toBe(state)
    expect(deepLink.href).not.toContain('signed.better-auth.session')
    expect(openSecret(codeInput!.sessionToken, config().backupKey, 'desktop-oauth-session')).toBe(
      'signed.better-auth.session',
    )

    const code = deepLink.searchParams.get('code')!
    await expect(oauth.exchange(code, verifier)).resolves.toBe('signed.better-auth.session')
    await expect(oauth.exchange(code, verifier)).rejects.toMatchObject({ status: 409 })
  })
})
