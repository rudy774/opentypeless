import { API_BASE_URL, MANAGED_SERVICE_CONFIGURED } from './constants'

const DESKTOP_AUTH_TRANSACTION_KEY = 'opentypeless.desktopAuthTransaction'
const LEGACY_OAUTH_STATE_STORAGE_KEY = 'opentypeless.pendingOAuthState'
const PKCE_BYTE_LENGTH = 32
const PKCE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000
export const EMAIL_VERIFICATION_STATE_TTL_MS = 30 * 60 * 1000

interface DesktopAuthTransaction {
  state: string
  codeVerifier: string
  expiresAt: number
}

let pendingTransaction: DesktopAuthTransaction | null = null
let pendingTransactionTimer: ReturnType<typeof setTimeout> | null = null

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomBase64Url(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable')
  }
  return encodeBase64Url(cryptoApi.getRandomValues(new Uint8Array(PKCE_BYTE_LENGTH)))
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('PKCE SHA-256 is unavailable')
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  )
  return encodeBase64Url(new Uint8Array(digest))
}

function isValidTransaction(value: unknown): value is DesktopAuthTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    Object.keys(candidate).length === 3 &&
    typeof candidate.state === 'string' &&
    PKCE_VALUE_PATTERN.test(candidate.state) &&
    typeof candidate.codeVerifier === 'string' &&
    PKCE_VALUE_PATTERN.test(candidate.codeVerifier) &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt)
  )
}

function removeStoredTransaction(): void {
  try {
    sessionStorage.removeItem(DESKTOP_AUTH_TRANSACTION_KEY)
  } catch {
    // sessionStorage may be unavailable under a restrictive WebView policy.
  }
  try {
    // Clear state persisted by older releases. It is never accepted by this flow.
    localStorage.removeItem(LEGACY_OAUTH_STATE_STORAGE_KEY)
  } catch {
    // localStorage may be unavailable under a restrictive WebView policy.
  }
}

function storeTransaction(transaction: DesktopAuthTransaction): void {
  try {
    sessionStorage.setItem(DESKTOP_AUTH_TRANSACTION_KEY, JSON.stringify(transaction))
  } catch {
    // In-memory state still supports the active WebView session.
  }
}

function loadTransaction(): DesktopAuthTransaction | null {
  if (pendingTransaction) {
    if (Date.now() < pendingTransaction.expiresAt) return pendingTransaction
    clearDesktopAuthTransaction()
    return null
  }

  try {
    const raw = sessionStorage.getItem(DESKTOP_AUTH_TRANSACTION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidTransaction(parsed) || Date.now() >= parsed.expiresAt) {
      clearDesktopAuthTransaction()
      return null
    }
    pendingTransaction = parsed
    return parsed
  } catch {
    clearDesktopAuthTransaction()
    return null
  }
}

export function clearDesktopAuthTransaction(): void {
  pendingTransaction = null
  removeStoredTransaction()
  if (pendingTransactionTimer) {
    clearTimeout(pendingTransactionTimer)
    pendingTransactionTimer = null
  }
}

/**
 * Atomically consumes the verifier for a matching callback state. The verifier
 * is removed before any network exchange, so a callback can never be replayed.
 */
export function consumeDesktopAuthTransaction(state: string): string | null {
  const transaction = loadTransaction()
  if (!transaction || transaction.state !== state) return null
  clearDesktopAuthTransaction()
  return transaction.codeVerifier
}

/**
 * Creates an allow-listed service callback and a short-lived PKCE transaction.
 * Only the non-secret challenge and CSRF state enter the browser URL.
 */
export async function createDesktopAuthCallbackURL(
  stateTtlMs = OAUTH_STATE_TTL_MS,
): Promise<string> {
  if (!MANAGED_SERVICE_CONFIGURED) {
    throw new Error('Managed cloud service is not configured')
  }
  if (
    !Number.isFinite(stateTtlMs) ||
    stateTtlMs <= 0 ||
    stateTtlMs > EMAIL_VERIFICATION_STATE_TTL_MS
  ) {
    throw new Error('Desktop authentication expiry is invalid')
  }

  clearDesktopAuthTransaction()
  const state = randomBase64Url()
  const codeVerifier = randomBase64Url()
  const codeChallenge = await createCodeChallenge(codeVerifier)
  const transaction = { state, codeVerifier, expiresAt: Date.now() + stateTtlMs }
  pendingTransaction = transaction
  storeTransaction(transaction)
  pendingTransactionTimer = setTimeout(clearDesktopAuthTransaction, stateTtlMs)

  const callback = new URL('/auth/callback', API_BASE_URL)
  callback.searchParams.set('desktop', state)
  callback.searchParams.set('code_challenge', codeChallenge)
  callback.searchParams.set('code_challenge_method', 'S256')
  return callback.toString()
}
