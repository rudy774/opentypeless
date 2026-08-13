import { invoke } from '@tauri-apps/api/core'

const LEGACY_SESSION_TOKEN_KEY = 'session_token'

export type SessionTokenStorage = 'os-vault' | 'session-only'

let sessionToken: string | null = null
let initializationPromise: Promise<string | null> | null = null
let invalidationHandler: (() => Promise<void>) | null = null
let invalidationPromise: Promise<void> | null = null

function normalizeToken(token: string | null | undefined): string | null {
  const normalized = token?.trim()
  return normalized ? normalized : null
}

function consumeLegacyBrowserToken(): string | null {
  let token: string | null = null
  try {
    token = normalizeToken(localStorage.getItem(LEGACY_SESSION_TOKEN_KEY))
  } catch {
    // Web Storage can be disabled by policy; native storage is still canonical.
  } finally {
    // This key is migration input only. Never leave a bearer token persisted in
    // WebView storage, including when the native vault is temporarily unavailable.
    try {
      localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY)
    } catch {
      // Some test/browser contexts disable Web Storage. Native storage remains canonical.
    }
  }
  return token
}

/** Removes browser-persisted credentials left by releases predating native storage. */
export function clearLegacyBrowserSessionToken(): void {
  consumeLegacyBrowserToken()
  /** Returns the active token from module memory; it is never read from Web Storage. */
}

export function getCloudSessionToken(): string | null {
  return sessionToken
}

/**
 * Hydrates module memory from the native store and performs the one-time
 * localStorage migration used by older desktop releases.
 */
export function initializeCloudSessionToken(): Promise<string | null> {
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    const legacyToken = consumeLegacyBrowserToken()
    if (legacyToken) {
      // Set memory first so an existing user remains authenticated during a
      // transient OS-vault failure. The native command returns session-only in
      // that case and never falls back to browser persistence.
      sessionToken = legacyToken
      await invoke<SessionTokenStorage>('set_session_token', { token: legacyToken })
      return legacyToken
    }

    const nativeToken = normalizeToken(await invoke<string>('get_session_token'))
    sessionToken = nativeToken
    return nativeToken
  })().catch((error) => {
    initializationPromise = null
    throw error
  })

  return initializationPromise
}

export async function persistSessionToken(token: string | null): Promise<void> {
  const normalized = normalizeToken(token)
  const previousToken = sessionToken

  // Remove leftovers even when this install skipped the startup migration.
  consumeLegacyBrowserToken()
  sessionToken = normalized

  try {
    await invoke<SessionTokenStorage>('set_session_token', { token: normalized ?? '' })
    initializationPromise = Promise.resolve(normalized)
  } catch (error) {
    // A failed sign-out must still stop this WebView from sending the token. For
    // failed sign-in/rotation, retain the previously working in-memory identity.
    if (normalized) sessionToken = previousToken
    initializationPromise = null
    throw error
  }
}

export function registerCloudSessionInvalidation(handler: () => Promise<void>): () => void {
  invalidationHandler = handler
  return () => {
    if (invalidationHandler === handler) invalidationHandler = null
  }
}

export function invalidateCloudSessionOnce(): Promise<void> {
  if (invalidationPromise) return invalidationPromise
  if (!invalidationHandler) return Promise.resolve()

  let result: Promise<void>
  try {
    result = invalidationHandler()
  } catch (error) {
    result = Promise.reject(error)
  }
  invalidationPromise = Promise.resolve(result)
    .then(() => undefined)
    .catch((error) => {
      invalidationPromise = null
      throw error
    })
  return invalidationPromise
}

export function markCloudSessionAuthenticated(): void {
  invalidationPromise = null
}

export function resetCloudSessionCoordinatorForTests(): void {
  sessionToken = null
  initializationPromise = null
  invalidationHandler = null
  invalidationPromise = null
}
