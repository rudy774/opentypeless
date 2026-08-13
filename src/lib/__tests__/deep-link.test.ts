import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deepLinkHandler: null as null | ((urls: string[]) => Promise<void> | void),
  handleDeepLinkCode: vi.fn(),
  refreshSubscription: vi.fn(),
}))

vi.mock('../constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants')>()
  return {
    ...actual,
    API_BASE_URL: 'https://managed.example.test',
    MANAGED_SERVICE_CONFIGURED: true,
  }
})

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(async (handler: (urls: string[]) => Promise<void> | void) => {
    mocks.deepLinkHandler = handler
  }),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      handleDeepLinkCode: mocks.handleDeepLinkCode,
      refreshSubscription: mocks.refreshSubscription,
    }),
  },
}))

function base64UrlOf(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function beginDesktopAuth() {
  const callbackModule = await import('../desktop-auth-callback')
  const callback = new URL(await callbackModule.createDesktopAuthCallbackURL())
  return {
    state: callback.searchParams.get('desktop')!,
    verifier: base64UrlOf(2),
  }
}

describe('deep-link OAuth callback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
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
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = ''
    mocks.deepLinkHandler = null
    mocks.handleDeepLinkCode.mockReset()
    mocks.handleDeepLinkCode.mockResolvedValue(true)
    mocks.refreshSubscription.mockReset()
  })

  it('accepts a one-time code after reload loses in-memory transaction state', async () => {
    const { state, verifier } = await beginDesktopAuth()

    vi.resetModules()
    const secondModule = await import('../deep-link')
    await secondModule.initDeepLinkListener()
    await mocks.deepLinkHandler?.([
      `rudyopentypeless://auth/callback?code=desktop-code-123456&state=${state}`,
    ])

    expect(mocks.handleDeepLinkCode).toHaveBeenCalledWith('desktop-code-123456', verifier)
    expect(window.location.hash).toBe('#/account')
  })

  it('returns true when a pasted authorization-code callback signs the user in', async () => {
    const { state, verifier } = await beginDesktopAuth()
    const module = await import('../deep-link')

    const handled = await module.handleDeepLinkUrl(
      `rudyopentypeless://auth/callback?code=desktop-code-123456&state=${state}`,
    )

    expect(handled).toBe(true)
    expect(mocks.handleDeepLinkCode).toHaveBeenCalledWith('desktop-code-123456', verifier)
    expect(window.location.hash).toBe('#/account')
  })

  it('accepts single-slash desktop callback URLs forwarded by some systems', async () => {
    const { state, verifier } = await beginDesktopAuth()
    const module = await import('../deep-link')

    const handled = await module.handleDeepLinkUrl(
      `rudyopentypeless:/auth/callback?code=desktop-code-123456&state=${state}`,
    )

    expect(handled).toBe(true)
    expect(mocks.handleDeepLinkCode).toHaveBeenCalledWith('desktop-code-123456', verifier)
  })

  it('consumes a callback transaction before exchange so it cannot be replayed', async () => {
    const { state } = await beginDesktopAuth()
    const module = await import('../deep-link')
    const callback = `rudyopentypeless://auth/callback?code=desktop-code-123456&state=${state}`

    expect(await module.handleDeepLinkUrl(callback)).toBe(true)
    expect(await module.handleDeepLinkUrl(callback)).toBe(false)
    expect(mocks.handleDeepLinkCode).toHaveBeenCalledTimes(1)
  })

  it('does not navigate when authorization-code exchange or session validation fails', async () => {
    mocks.handleDeepLinkCode.mockResolvedValue(false)
    const { state } = await beginDesktopAuth()
    const module = await import('../deep-link')

    const handled = await module.handleDeepLinkUrl(
      `rudyopentypeless://auth/callback?code=invalid-code-123456&state=${state}`,
    )

    expect(handled).toBe(false)
    expect(window.location.hash).toBe('')
  })

  it('rejects legacy bearer-token callback query parameters', async () => {
    const { state } = await beginDesktopAuth()
    const module = await import('../deep-link')

    const handled = await module.handleDeepLinkUrl(
      `rudyopentypeless://auth/callback?token=sensitive-token-12345&state=${state}`,
    )

    expect(handled).toBe(false)
    expect(mocks.handleDeepLinkCode).not.toHaveBeenCalled()
  })

  it('never writes callback code, state, or verifier into logs', async () => {
    const { state, verifier } = await beginDesktopAuth()
    const code = 'sensitive-code-123456'
    const module = await import('../deep-link')

    await module.handleDeepLinkUrl(`rudyopentypeless://auth/callback?code=${code}&state=${state}`)

    const serializedLogs = JSON.stringify(vi.mocked(console.info).mock.calls)
    expect(serializedLogs).not.toContain(code)
    expect(serializedLogs).not.toContain(state)
    expect(serializedLogs).not.toContain(verifier)
    expect(serializedLogs).toContain('rudyopentypeless')
    expect(serializedLogs).toContain('auth/callback')
    expect(serializedLogs).toContain('authenticated')
  })
})

describe('deep-link identity isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    let randomCall = 0
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        randomCall += 1
        bytes.fill(randomCall)
        return bytes
      }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(3).buffer) },
    })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    sessionStorage.clear()
    mocks.handleDeepLinkCode.mockReset()
  })

  it('rejects the inherited upstream URI scheme', async () => {
    const { state } = await beginDesktopAuth()
    const module = await import('../deep-link')
    const handled = await module.handleDeepLinkUrl(
      `opentypeless://auth/callback?code=desktop-code-123456&state=${state}`,
    )
    expect(handled).toBe(false)
    expect(mocks.handleDeepLinkCode).not.toHaveBeenCalled()
  })
})
