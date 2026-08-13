import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getCloudSessionToken = vi.hoisted(() => vi.fn<() => string | null>(() => null))
const createAuthClient = vi.hoisted(() => vi.fn((_options: unknown) => ({})))
vi.mock('better-auth/client', () => ({ createAuthClient }))
vi.mock('../constants', () => ({
  API_BASE_URL: 'https://managed.example.test',
  APP_VERSION_HEADER_VALUE: '0.1.42',
  CLIENT_VERSION_HEADER: 'X-OpenTypeless-Version',
  MANAGED_SERVICE_CONFIGURED: true,
}))

vi.mock('../cloud-session', () => ({ getCloudSessionToken }))

import { requestOpenTypelessPasswordReset } from '../auth-client'

describe('desktop auth client bearer handling', () => {
  beforeEach(() => {
    getCloudSessionToken.mockReturnValue(null)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the active in-memory bearer token without reading localStorage', async () => {
    getCloudSessionToken.mockReturnValue('memory-token')
    const storageSpy = vi.spyOn(Storage.prototype, 'getItem')

    await requestOpenTypelessPasswordReset('person@example.com', 'en')

    const request = vi.mocked(fetch).mock.calls[0]
    const headers = new Headers(request[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer memory-token')
    expect(request[1]?.credentials).toBe('omit')
    expect(storageSpy).not.toHaveBeenCalledWith('session_token')
  })

  it('omits Authorization when the native session is empty', async () => {
    await requestOpenTypelessPasswordReset('person@example.com', 'en')

    const request = vi.mocked(fetch).mock.calls[0]
    const headers = new Headers(request[1]?.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(request[1]?.credentials).toBe('omit')
  })

  it('overrides ambient cookie credentials requested by the auth library', async () => {
    const config = createAuthClient.mock.calls[0]?.[0] as {
      fetchOptions: { credentials: RequestCredentials; customFetchImpl: typeof fetch }
    }
    expect(config.fetchOptions.credentials).toBe('omit')

    await config.fetchOptions.customFetchImpl('https://managed.example.test/api/auth/get-session', {
      credentials: 'include',
    })

    const request = vi.mocked(fetch).mock.calls[0]
    expect(request[1]?.credentials).toBe('omit')
    expect(new Headers(request[1]?.headers).has('Authorization')).toBe(false)
  })
})
