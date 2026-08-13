import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useAuthStore } from '../stores/authStore'
import { APP_DEEP_LINK_SCHEME } from './constants'
import {
  EMAIL_VERIFICATION_STATE_TTL_MS,
  OAUTH_STATE_TTL_MS,
  clearDesktopAuthTransaction,
  consumeDesktopAuthTransaction,
} from './desktop-auth-callback'

export { EMAIL_VERIFICATION_STATE_TTL_MS, OAUTH_STATE_TTL_MS }

type SafeDeepLinkPath = 'auth/callback' | 'checkout/success' | 'unknown'

function logDeepLinkResult(scheme: string, path: SafeDeepLinkPath, result: string): void {
  // Never log the raw URL: callback query parameters contain an authorization
  // code and anti-CSRF state. These fields are static or protocol-only metadata.
  console.info('[deep-link]', { scheme, path, result })
}

/** Clear the pending state and PKCE verifier when the user cancels or times out. */
export function clearOAuthState(): void {
  clearDesktopAuthTransaction()
}

export async function initDeepLinkListener() {
  try {
    await onOpenUrl(async (urls) => {
      for (const rawUrl of urls) {
        await handleDeepLinkUrl(rawUrl)
      }
    })
  } catch {
    // Deep link plugin not available (e.g. web dev mode)
  }
}

function isValidAuthorizationCode(code: string): boolean {
  return /^[A-Za-z0-9\-._~]+$/.test(code) && code.length >= 16 && code.length <= 2048
}

function hasExactCallbackQuery(params: URLSearchParams): boolean {
  const keys = [...params.keys()]
  return (
    keys.length === 2 && params.getAll('code').length === 1 && params.getAll('state').length === 1
  )
}

export async function handleDeepLinkUrl(rawUrl: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    logDeepLinkResult('invalid', 'unknown', 'rejected-malformed')
    return false
  }

  const scheme = url.protocol.replace(/:$/, '')
  if (url.protocol !== `${APP_DEEP_LINK_SCHEME}:`) {
    logDeepLinkResult(scheme, 'unknown', 'rejected-scheme')
    return false
  }

  const path = url.hostname ? url.hostname + url.pathname : url.pathname.replace(/^\/+/, '')
  const params = url.searchParams

  // <configured-scheme>://auth/callback?code=<one-time-code>&state=<client-state>
  if (path === 'auth/callback' || path === 'auth/callback/') {
    if (url.hash || !hasExactCallbackQuery(params)) {
      logDeepLinkResult(scheme, 'auth/callback', 'rejected-query')
      return false
    }

    const code = params.get('code') ?? ''
    const state = params.get('state') ?? ''
    if (!isValidAuthorizationCode(code)) {
      logDeepLinkResult(scheme, 'auth/callback', 'rejected-code-shape')
      return false
    }

    // A matching transaction is consumed before the exchange, making callback
    // handling single-use even if the service or network later rejects it.
    const codeVerifier = consumeDesktopAuthTransaction(state)
    if (!codeVerifier) {
      logDeepLinkResult(scheme, 'auth/callback', 'rejected-state')
      return false
    }

    const authenticated = await useAuthStore.getState().handleDeepLinkCode(code, codeVerifier)
    if (!authenticated) {
      logDeepLinkResult(scheme, 'auth/callback', 'rejected-authentication')
      return false
    }

    window.location.hash = '#/account'
    logDeepLinkResult(scheme, 'auth/callback', 'authenticated')
    return true
  }

  // <configured-scheme>://checkout/success
  if (path === 'checkout/success' || path === 'checkout/success/') {
    await useAuthStore.getState().refreshSubscription()
    window.location.hash = '#/upgrade'
    logDeepLinkResult(scheme, 'checkout/success', 'refreshed')
    return true
  }

  logDeepLinkResult(scheme, 'unknown', 'rejected-path')
  return false
}
