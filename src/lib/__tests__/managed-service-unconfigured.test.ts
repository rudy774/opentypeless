import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MANAGED_SERVICE_CONFIGURED } from '../constants'
import { requestOpenTypelessPasswordReset } from '../auth-client'
import { getSubscriptionStatus, ManagedServiceUnavailableError, proxyStt } from '../api'
import { createDesktopAuthCallbackURL } from '../desktop-auth-callback'
import { useAuthStore } from '../../stores/authStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../components/toast-service', () => ({ toast: vi.fn() }))

describe('unconfigured managed-service build', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    useAuthStore.setState({
      user: { id: 'stale', email: 'stale@example.com', name: null, emailVerified: true },
      plan: 'pro',
      loading: true,
    })
  })

  it('imports and initializes into signed-out local-only state with zero network', async () => {
    expect(MANAGED_SERVICE_CONFIGURED).toBe(false)
    localStorage.setItem('session_token', 'legacy-token')

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().plan).toBe('free')
    expect(useAuthStore.getState().loading).toBe(false)
    expect(localStorage.getItem('session_token')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('fails managed API and auth calls before any request is sent', async () => {
    await expect(getSubscriptionStatus()).rejects.toBeInstanceOf(ManagedServiceUnavailableError)
    await expect(proxyStt(new Blob(['audio'], { type: 'audio/wav' }), 'en')).rejects.toBeInstanceOf(
      ManagedServiceUnavailableError,
    )
    await expect(requestOpenTypelessPasswordReset('person@example.com', 'en')).rejects.toThrow(
      'Managed cloud service is not configured',
    )

    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects callback creation before generating or opening an inert OAuth URL', async () => {
    await expect(createDesktopAuthCallbackURL()).rejects.toThrow(
      'Managed cloud service is not configured',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
