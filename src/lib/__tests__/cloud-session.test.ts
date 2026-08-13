import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getCloudSessionToken,
  initializeCloudSessionToken,
  invalidateCloudSessionOnce,
  markCloudSessionAuthenticated,
  persistSessionToken,
  registerCloudSessionInvalidation,
  resetCloudSessionCoordinatorForTests,
} from '../cloud-session'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('cloud session coordinator', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'get_session_token') return Promise.resolve('')
      return Promise.resolve('os-vault')
    })
    resetCloudSessionCoordinatorForTests()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a new bearer token in module memory and native storage only', async () => {
    await persistSessionToken('session-token')

    expect(getCloudSessionToken()).toBe('session-token')
    expect(localStorage.getItem('session_token')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('set_session_token', { token: 'session-token' })
  })

  it('hydrates module memory from native storage without browser persistence', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('native-token')

    await expect(initializeCloudSessionToken()).resolves.toBe('native-token')

    expect(getCloudSessionToken()).toBe('native-token')
    expect(invoke).toHaveBeenCalledWith('get_session_token')
    expect(localStorage.getItem('session_token')).toBeNull()
  })

  it('migrates and removes a legacy localStorage token before native persistence', async () => {
    localStorage.setItem('session_token', 'legacy-token')

    await expect(initializeCloudSessionToken()).resolves.toBe('legacy-token')

    expect(getCloudSessionToken()).toBe('legacy-token')
    expect(localStorage.getItem('session_token')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('set_session_token', { token: 'legacy-token' })
    expect(invoke).not.toHaveBeenCalledWith('get_session_token')
  })

  it('hydrates from native storage when browser storage access is blocked', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Web Storage disabled')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Web Storage disabled')
    })
    vi.mocked(invoke).mockResolvedValueOnce('native-token')

    await expect(initializeCloudSessionToken()).resolves.toBe('native-token')
    expect(getCloudSessionToken()).toBe('native-token')
    expect(getItem).toHaveBeenCalledWith('session_token')
  })
  it('deduplicates concurrent native hydration', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('native-token')

    const first = initializeCloudSessionToken()
    const second = initializeCloudSessionToken()

    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('restores the prior in-memory token when native rotation fails', async () => {
    await persistSessionToken('previous-token')
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Rust unavailable'))

    await expect(persistSessionToken('rotated-token')).rejects.toThrow('Rust unavailable')

    expect(getCloudSessionToken()).toBe('previous-token')
    expect(localStorage.getItem('session_token')).toBeNull()
  })

  it('clears in-memory and browser tokens even when native sign-out fails', async () => {
    await persistSessionToken('previous-token')
    localStorage.setItem('session_token', 'stale-token')
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Vault unavailable'))

    await expect(persistSessionToken(null)).rejects.toThrow('Vault unavailable')

    expect(getCloudSessionToken()).toBeNull()
    expect(localStorage.getItem('session_token')).toBeNull()
  })

  it('shares one invalidation across concurrent managed-cloud failures', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = vi.fn(() => pending)
    registerCloudSessionInvalidation(handler)

    const first = invalidateCloudSessionOnce()
    const second = invalidateCloudSessionOnce()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    release()
    await Promise.all([first, second])
    await invalidateCloudSessionOnce()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('allows a new invalidation after successful authentication', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerCloudSessionInvalidation(handler)

    await invalidateCloudSessionOnce()
    markCloudSessionAuthenticated()
    await invalidateCloudSessionOnce()

    expect(handler).toHaveBeenCalledTimes(2)
  })
})
