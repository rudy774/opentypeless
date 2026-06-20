import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from '../api'
import { API_BASE_URL } from '../constants'

const API_BASE = API_BASE_URL

describe('ApiError', () => {
  it('stores status and message', () => {
    const err = new ApiError(404, 'Not found')
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('request() via getSubscriptionStatus', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            plan: 'pro',
            subscriptionEnd: '2025-12-31',
            sttSecondsUsed: 100,
            sttSecondsLimit: 36000,
            llmTokensUsed: 5000,
            llmTokensLimit: 5000000,
          }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls fetch with correct URL and options', async () => {
    const { getSubscriptionStatus } = await import('../api')
    await getSubscriptionStatus()

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/subscription/status`,
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('returns parsed JSON on success', async () => {
    const { getSubscriptionStatus } = await import('../api')
    const result = await getSubscriptionStatus()
    expect(result.plan).toBe('pro')
    expect(result.sttSecondsLimit).toBe(36000)
  })

  it('parses AppSumo cloud words status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          plan: 'appsumo_tier2',
          source: 'appsumo',
          displayName: 'AppSumo Tier 2',
          subscriptionEnd: null,
          subscriptionStatus: null,
          licenseStatus: 'active',
          cloudWordsUsed: 12345,
          cloudWordsLimit: 700000,
          cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
          byokUnlimited: true,
          minimumDesktopVersion: '0.1.1',
          sttSecondsUsed: 0,
          sttSecondsLimit: 0,
          llmTokensUsed: 0,
          llmTokensLimit: 0,
        }),
    } as Response)

    const { getSubscriptionStatus } = await import('../api')
    const result = await getSubscriptionStatus()

    expect(result.plan).toBe('appsumo_tier2')
    expect(result.source).toBe('appsumo')
    expect(result.licenseStatus).toBe('active')
    expect(result.cloudWordsLimit).toBe(700000)
  })
})

describe('hasManagedCloudAccess', () => {
  it('requires active AppSumo license and compatible desktop version', async () => {
    const { hasManagedCloudAccess } = await import('../api')

    expect(
      hasManagedCloudAccess(
        {
          plan: 'appsumo_tier1',
          source: 'appsumo',
          displayName: 'AppSumo Tier 1',
          subscriptionEnd: null,
          subscriptionStatus: null,
          licenseStatus: 'active',
          cloudWordsUsed: 0,
          cloudWordsLimit: 200000,
          cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
          byokUnlimited: true,
          minimumDesktopVersion: '0.1.1',
          sttSecondsUsed: 0,
          sttSecondsLimit: 0,
          llmTokensUsed: 0,
          llmTokensLimit: 0,
        },
        '0.1.1',
      ),
    ).toBe(true)

    expect(
      hasManagedCloudAccess(
        {
          plan: 'appsumo_tier1',
          source: 'appsumo',
          displayName: 'AppSumo Tier 1',
          subscriptionEnd: null,
          subscriptionStatus: null,
          licenseStatus: 'pending',
          cloudWordsUsed: 0,
          cloudWordsLimit: 200000,
          cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
          byokUnlimited: true,
          minimumDesktopVersion: '0.1.1',
          sttSecondsUsed: 0,
          sttSecondsLimit: 0,
          llmTokensUsed: 0,
          llmTokensLimit: 0,
        },
        '0.1.1',
      ),
    ).toBe(false)

    expect(
      hasManagedCloudAccess(
        {
          plan: 'appsumo_tier1',
          source: 'appsumo',
          displayName: 'AppSumo Tier 1',
          subscriptionEnd: null,
          subscriptionStatus: null,
          licenseStatus: 'active',
          cloudWordsUsed: 0,
          cloudWordsLimit: 200000,
          cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
          byokUnlimited: true,
          minimumDesktopVersion: '0.1.1',
          sttSecondsUsed: 0,
          sttSecondsLimit: 0,
          llmTokensUsed: 0,
          llmTokensLimit: 0,
        },
        '0.1.0',
      ),
    ).toBe(false)
  })
})

describe('request() error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws ApiError with body.error on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'Subscription required' }),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    await expect(getSubscriptionStatus()).rejects.toThrow('Subscription required')
    await expect(getSubscriptionStatus()).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to statusText when body has no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    await expect(getSubscriptionStatus()).rejects.toThrow('Internal Server Error')
  })
})

describe('createCheckout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST with origin in body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: 'https://checkout.stripe.com/xxx' }),
      }),
    )

    const { createCheckout } = await import('../api')
    const result = await createCheckout('web')

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/checkout/create`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ origin: 'web' }),
      }),
    )
    expect(result.url).toBe('https://checkout.stripe.com/xxx')
  })
})

describe('activateAppSumoLicense', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the license key to the TalkMore activation endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            plan: 'appsumo_tier2',
            displayName: 'AppSumo Tier 2',
            cloudWordsLimit: 700000,
          }),
      }),
    )

    const { activateAppSumoLicense } = await import('../api')
    const result = await activateAppSumoLicense(' SUMO-ABC-123 ')

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/appsumo/activate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ licenseKey: ' SUMO-ABC-123 ' }),
      }),
    )
    expect(result.plan).toBe('appsumo_tier2')
    expect(result.cloudWordsLimit).toBe(700000)
  })
})

describe('proxyLlm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends messages array as POST body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'polished text' }),
      }),
    )

    const { proxyLlm } = await import('../api')
    const messages = [{ role: 'user', content: 'hello' }]
    const result = await proxyLlm(messages)

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/proxy/llm`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messages }),
      }),
    )
    expect(result.text).toBe('polished text')
  })
})
