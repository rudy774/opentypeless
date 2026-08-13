import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { bearer } from 'better-auth/plugins'
import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import type { ServiceConfig } from './config.js'
import { sendTransactionalEmail } from './email.js'
import type { AuthenticatedUser } from './types.js'

export interface AuthSession {
  user: AuthenticatedUser
  sessionCreatedAt: Date
}

export interface AuthFacade {
  handler: RequestHandler
  getSession(headers: NodeJS.Dict<string | string[] | undefined>): Promise<AuthSession | null>
  getSignedSessionToken(headers: NodeJS.Dict<string | string[] | undefined>): string | null
  requestPasswordReset(email: string): Promise<void>
  setPassword(
    newPassword: string,
    headers: NodeJS.Dict<string | string[] | undefined>,
  ): Promise<void>
  revokeSessions(headers: NodeJS.Dict<string | string[] | undefined>): Promise<void>
  deleteUser(headers: NodeJS.Dict<string | string[] | undefined>): Promise<void>
  beginSocialSignIn(
    provider: 'google' | 'github',
    callbackURL: string,
    headers: NodeJS.Dict<string | string[] | undefined>,
  ): Promise<string>
}

export function buildManagedAuthOptions(config: ServiceConfig, pool: Pool): BetterAuthOptions {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
  if (config.google) socialProviders.google = config.google
  if (config.github) socialProviders.github = config.github

  return {
    appName: 'OpenTypeless',
    baseURL: config.apiOrigin,
    basePath: '/api/auth',
    secret: config.authSecret,
    database: pool,
    trustedOrigins: [
      ...config.corsOrigins,
      ...(config.websiteOrigin ? [config.websiteOrigin] : []),
    ],
    socialProviders,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.nodeEnv === 'production',
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendTransactionalEmail(config, {
          to: user.email,
          subject: 'Reset your OpenTypeless password',
          heading: 'Reset your password',
          actionLabel: 'Reset password',
          actionUrl: url,
        })
      },
    },
    emailVerification: {
      expiresIn: 30 * 60,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTransactionalEmail(config, {
          to: user.email,
          subject: 'Verify your OpenTypeless email',
          heading: 'Verify your email',
          actionLabel: 'Verify email',
          actionUrl: url,
        })
      },
    },
    user: { deleteUser: { enabled: true } },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: 10 * 60,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
    advanced: {
      useSecureCookies: config.nodeEnv === 'production',
      disableCSRFCheck: false,
    },
    plugins: [bearer({ requireSignature: true })],
  }
}

export function createManagedAuth(config: ServiceConfig, pool: Pool): AuthFacade {
  const options = buildManagedAuthOptions(config, pool)
  const auth = betterAuth(options)
  const configuredSocialProviders = options.socialProviders ?? {}

  return {
    handler: toNodeHandler(auth),
    async getSession(headers) {
      const result = await auth.api.getSession({ headers: fromNodeHeaders(headers) })
      if (!result) return null
      return {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          emailVerified: result.user.emailVerified,
        },
        sessionCreatedAt: result.session.createdAt,
      }
    },
    getSignedSessionToken(headers) {
      const cookieHeader = Array.isArray(headers.cookie) ? headers.cookie.join(';') : headers.cookie
      if (!cookieHeader) return null
      for (const entry of cookieHeader.split(';')) {
        const separator = entry.indexOf('=')
        if (separator < 1) continue
        const name = entry.slice(0, separator).trim()
        if (name !== 'better-auth.session_token' && name !== '__Secure-better-auth.session_token')
          continue
        const value = entry.slice(separator + 1).trim()
        if (value.length >= 16 && value.length <= 4096) return value
      }
      return null
    },
    async requestPasswordReset(email) {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: `${config.websiteOrigin ?? config.apiOrigin}/reset-password` },
      })
    },
    async setPassword(newPassword, headers) {
      await auth.api.setPassword({ headers: fromNodeHeaders(headers), body: { newPassword } })
    },
    async revokeSessions(headers) {
      await auth.api.revokeSessions({ headers: fromNodeHeaders(headers) })
    },
    async deleteUser(headers) {
      await auth.api.deleteUser({ headers: fromNodeHeaders(headers), body: {} })
    },
    async beginSocialSignIn(provider, callbackURL, headers) {
      if (!configuredSocialProviders[provider]) throw new Error('OAuth provider is not configured')
      const result = await auth.api.signInSocial({
        headers: fromNodeHeaders(headers),
        body: { provider, callbackURL, disableRedirect: true },
      })
      if (!result.url) throw new Error('OAuth provider did not return an authorization URL')
      return result.url
    },
  }
}
