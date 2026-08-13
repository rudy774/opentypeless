import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../constants', () => ({
  API_BASE_URL: 'https://managed.example.test',
  MANAGED_SERVICE_CONFIGURED: true,
}))

import {
  clearDesktopAuthTransaction,
  consumeDesktopAuthTransaction,
  createDesktopAuthCallbackURL,
} from '../desktop-auth-callback'

function base64UrlOf(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

describe('createDesktopAuthCallbackURL', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    let randomCall = 0
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        randomCall += 1
        bytes.fill(randomCall)
        return bytes
      }),
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).fill(3).buffer),
      },
    })
    localStorage.clear()
    sessionStorage.clear()
    clearDesktopAuthTransaction()
  })

  it('creates an S256 callback and persists only an expiring verifier transaction', async () => {
    const callback = new URL(await createDesktopAuthCallbackURL())

    expect(callback.origin + callback.pathname).toBe('https://managed.example.test/auth/callback')
    expect(callback.searchParams.get('desktop')).toBe(base64UrlOf(1))
    expect(callback.searchParams.get('code_challenge')).toBe(base64UrlOf(3))
    expect(callback.searchParams.get('code_challenge_method')).toBe('S256')
    expect(callback.searchParams.has('token')).toBe(false)

    const persisted = JSON.parse(
      sessionStorage.getItem('opentypeless.desktopAuthTransaction') ?? '{}',
    )
    expect(persisted).toMatchObject({
      state: base64UrlOf(1),
      codeVerifier: base64UrlOf(2),
    })
    expect(persisted.expiresAt).toBeGreaterThan(Date.now())
    expect(localStorage.length).toBe(0)
  })

  it('consumes a matching verifier exactly once', async () => {
    const callback = new URL(await createDesktopAuthCallbackURL())
    const state = callback.searchParams.get('desktop')!

    expect(consumeDesktopAuthTransaction(state)).toBe(base64UrlOf(2))
    expect(consumeDesktopAuthTransaction(state)).toBeNull()
    expect(sessionStorage.getItem('opentypeless.desktopAuthTransaction')).toBeNull()
  })

  it('rejects and removes an expired transaction', async () => {
    const callback = new URL(await createDesktopAuthCallbackURL(1))
    const state = callback.searchParams.get('desktop')!
    vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER)

    expect(consumeDesktopAuthTransaction(state)).toBeNull()
    expect(sessionStorage.getItem('opentypeless.desktopAuthTransaction')).toBeNull()
  })

  it('does not consume the pending transaction for an unrelated state', async () => {
    const callback = new URL(await createDesktopAuthCallbackURL())
    const state = callback.searchParams.get('desktop')!

    expect(consumeDesktopAuthTransaction(base64UrlOf(9))).toBeNull()
    expect(consumeDesktopAuthTransaction(state)).toBe(base64UrlOf(2))
  })
})
