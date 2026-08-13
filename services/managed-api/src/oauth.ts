import { randomBytes } from 'node:crypto'
import type { Request } from 'express'
import type { AuthFacade } from './auth.js'
import type { ServiceConfig } from './config.js'
import { openSecret, sealSecret, sha256 } from './crypto.js'
import { ServiceError } from './errors.js'
import type { ServiceStore } from './store.js'

const PKCE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const TRANSACTION_TTL_MS = 5 * 60 * 1000
const CODE_TTL_MS = 5 * 60 * 1000
const SESSION_PURPOSE = 'desktop-oauth-session'

export interface OAuthFacade {
  begin(provider: unknown, callback: unknown, request: Request): Promise<string>
  complete(transaction: unknown, request: Request): Promise<string>
  exchange(code: string, codeVerifier: string): Promise<string>
}
export class DesktopOAuth {
  constructor(
    private readonly config: ServiceConfig,
    private readonly store: ServiceStore,
    private readonly auth: AuthFacade,
  ) {}

  async begin(providerValue: unknown, callbackValue: unknown, request: Request): Promise<string> {
    if (providerValue !== 'google' && providerValue !== 'github') {
      throw new ServiceError(422, 'INVALID_REQUEST', 'OAuth provider is unavailable')
    }
    if (typeof callbackValue !== 'string' || callbackValue.length > 2048) {
      throw new ServiceError(422, 'INVALID_REQUEST', 'Desktop callback is invalid')
    }
    const callback = this.validateCallback(callbackValue)
    const clientState = callback.searchParams.get('desktop')!
    const codeChallenge = callback.searchParams.get('code_challenge')!
    const transaction = randomBytes(32).toString('base64url')
    await this.store.createOAuthTransaction(
      sha256(transaction),
      { clientState, codeChallenge, provider: providerValue },
      new Date(Date.now() + TRANSACTION_TTL_MS),
    )
    const completeUrl = new URL('/api/auth/desktop/complete', this.config.apiOrigin)
    completeUrl.searchParams.set('transaction', transaction)
    return this.auth.beginSocialSignIn(providerValue, completeUrl.href, request.headers)
  }

  async complete(transaction: unknown, request: Request): Promise<string> {
    if (typeof transaction !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(transaction)) {
      throw new ServiceError(422, 'INVALID_REQUEST', 'Desktop sign-in transaction is invalid')
    }
    const oauth = await this.store.consumeOAuthTransaction(sha256(transaction))
    if (!oauth)
      throw new ServiceError(410, 'INVALID_REQUEST', 'Desktop sign-in transaction expired')
    const session = await this.auth.getSession(request.headers)
    const signedToken = this.auth.getSignedSessionToken(request.headers)
    if (!session || !signedToken) {
      throw new ServiceError(401, 'AUTH_REQUIRED', 'Desktop sign-in was not authenticated')
    }
    const code = randomBytes(32).toString('base64url')
    await this.store.createDesktopCode({
      codeHash: sha256(code),
      userId: session.user.id,
      clientState: oauth.clientState,
      codeChallenge: oauth.codeChallenge,
      provider: oauth.provider,
      sessionToken: sealSecret(
        signedToken,
        this.config.backupKey,
        this.config.backupKeyId,
        SESSION_PURPOSE,
      ),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    const deepLink = new URL(`${this.config.desktopDeepLinkScheme}://auth/callback`)
    deepLink.searchParams.set('code', code)
    deepLink.searchParams.set('state', oauth.clientState)
    return deepLink.href
  }

  async exchange(code: string, codeVerifier: string): Promise<string> {
    const verifierChallenge = sha256Base64Url(codeVerifier)
    const result = await this.store.consumeDesktopCode(sha256(code), verifierChallenge)
    if (result.state !== 'ok') {
      const status = result.state === 'expired' ? 410 : result.state === 'replayed' ? 409 : 400
      throw new ServiceError(status, 'INVALID_REQUEST', 'Desktop authorization code is invalid')
    }
    try {
      return openSecret(result.sessionToken, this.config.backupKey, SESSION_PURPOSE)
    } catch {
      throw new ServiceError(400, 'INVALID_REQUEST', 'Desktop authorization code is invalid')
    }
  }

  private validateCallback(value: string): URL {
    let callback: URL
    try {
      callback = new URL(value)
    } catch {
      throw new ServiceError(422, 'INVALID_REQUEST', 'Desktop callback is invalid')
    }
    const expected = new URL(this.config.apiOrigin)
    const keys = [...callback.searchParams.keys()]
    if (
      callback.origin !== expected.origin ||
      callback.pathname !== '/auth/callback' ||
      callback.username ||
      callback.password ||
      callback.hash ||
      keys.length !== 3 ||
      new Set(keys).size !== 3 ||
      !keys.every((key) => ['desktop', 'code_challenge', 'code_challenge_method'].includes(key)) ||
      !PKCE_PATTERN.test(callback.searchParams.get('desktop') ?? '') ||
      !PKCE_PATTERN.test(callback.searchParams.get('code_challenge') ?? '') ||
      callback.searchParams.get('code_challenge_method') !== 'S256'
    ) {
      throw new ServiceError(422, 'INVALID_REQUEST', 'Desktop callback is invalid')
    }
    return callback
  }
}

function sha256Base64Url(value: string): string {
  return Buffer.from(sha256(value), 'hex').toString('base64url')
}
