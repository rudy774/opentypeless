import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, CloudApiError } from '../api'
import { API_BASE_URL, APP_VERSION_HEADER_VALUE, CLIENT_VERSION_HEADER } from '../constants'
import { createBackupSettings, InvalidBackupSettingsError } from '../backup-settings'
import { useAppStore } from '../../stores/appStore'

const invalidateCloudSessionOnce = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants')>()
  return {
    ...actual,
    API_BASE_URL: 'https://managed.example.test',
    MANAGED_SERVICE_CONFIGURED: true,
  }
})

const getCloudSessionToken = vi.hoisted(() => vi.fn<() => string | null>(() => null))

vi.mock('../cloud-session', () => ({
  getCloudSessionToken,
  invalidateCloudSessionOnce,
}))

const API_BASE = API_BASE_URL
const validSubscriptionStatus = {
  plan: 'pro',
  source: 'creem',
  displayName: 'Pro',
  subscriptionEnd: '2025-12-31T00:00:00.000Z',
  subscriptionStatus: 'active',
  licenseStatus: null,
  quotaModel: 'legacy_dual_meter',
  displayWordsUsedEstimate: 2500,
  displayWordsLimit: 100000,
  displayWordsResetAt: '2026-07-01T00:00:00.000Z',
  sttSecondsUsed: 100,
  sttSecondsLimit: 36000,
  llmTokensUsed: 5000,
  llmTokensLimit: 5000000,
  cloudWordsUsed: 2500,
  cloudWordsLimit: 100000,
  cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
  byokUnlimited: true,
}

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
    getCloudSessionToken.mockReturnValue(null)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(validSubscriptionStatus),
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
        credentials: 'omit',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CLIENT_VERSION_HEADER]: APP_VERSION_HEADER_VALUE,
        }),
      }),
    )
  })

  it('adds the active in-memory bearer token without reading browser storage', async () => {
    getCloudSessionToken.mockReturnValue('memory-token')
    const storageSpy = vi.spyOn(Storage.prototype, 'getItem')

    const { getSubscriptionStatus } = await import('../api')
    await getSubscriptionStatus()

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/subscription/status`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer memory-token' }),
      }),
    )
    expect(storageSpy).not.toHaveBeenCalledWith('session_token')
  })

  it('returns parsed JSON on success', async () => {
    const { getSubscriptionStatus } = await import('../api')
    const result = await getSubscriptionStatus()
    expect(result.plan).toBe('pro')
    expect(result.quotaModel).toBe('legacy_dual_meter')
    expect(result.displayWordsLimit).toBe(100000)
    expect(result.sttSecondsLimit).toBe(36000)
  })
  it.each([
    ['unknown plan', { ...validSubscriptionStatus, plan: 'enterprise' }],
    ['impossible plan/source pair', { ...validSubscriptionStatus, source: 'appsumo' }],
    [
      'missing entitlement field',
      (({ cloudWordsLimit: _, ...rest }) => rest)(validSubscriptionStatus),
    ],
    ['negative quota', { ...validSubscriptionStatus, cloudWordsLimit: -1 }],
    ['non-finite usage', { ...validSubscriptionStatus, sttSecondsUsed: Number.NaN }],
    ['invalid reset date', { ...validSubscriptionStatus, cloudWordsResetAt: 'tomorrow' }],
    ['unexpected field', { ...validSubscriptionStatus, isAdmin: true }],
  ])('fails closed for %s', async (_case, malformedStatus) => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(malformedStatus),
    } as Response)
    const { getSubscriptionStatus, InvalidSubscriptionStatusError } = await import('../api')

    await expect(getSubscriptionStatus()).rejects.toBeInstanceOf(InvalidSubscriptionStatusError)
  })
})

describe('request() error handling', () => {
  beforeEach(() => {
    invalidateCloudSessionOnce.mockClear()
  })

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

  it('parses AUTH_SESSION_INVALID and invalidates the cloud session once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () =>
          Promise.resolve({
            error: { code: 'AUTH_SESSION_INVALID', message: 'Session expired' },
          }),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    const error = await getSubscriptionStatus().catch((caught) => caught)

    expect(error).toBeInstanceOf(CloudApiError)
    expect(error).toMatchObject({
      status: 401,
      code: 'AUTH_SESSION_INVALID',
      message: 'Session expired',
    })
    expect(invalidateCloudSessionOnce).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['AUTH_REQUIRED', 401, 'Authentication required'],
    ['QUOTA_EXCEEDED', 403, 'Cloud quota exceeded'],
  ])('parses %s without invalidating the current identity', async (code, status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText: 'Request failed',
        json: () => Promise.resolve({ error: { code, message } }),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    const error = await getSubscriptionStatus().catch((caught) => caught)

    expect(error).toMatchObject({ status, code, message })
    expect(invalidateCloudSessionOnce).not.toHaveBeenCalled()
  })

  it('retains rollout compatibility with legacy top-level error strings', async () => {
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
    const error = await getSubscriptionStatus().catch((caught) => caught)

    expect(error).toMatchObject({ status: 403, code: null, message: 'Subscription required' })
    expect(invalidateCloudSessionOnce).not.toHaveBeenCalled()
  })
})

describe('exchangeDesktopAuthCode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts the exact code and verifier without bearer or browser credentials', async () => {
    getCloudSessionToken.mockReturnValue('existing-session-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: 'exchanged-session-token' }),
      }),
    )

    const { exchangeDesktopAuthCode } = await import('../api')
    await expect(
      exchangeDesktopAuthCode('desktop-code-123456', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).resolves.toEqual({ token: 'exchanged-session-token' })

    const options = vi.mocked(fetch).mock.calls[0][1]
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/auth/desktop/exchange`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify({
          code: 'desktop-code-123456',
          codeVerifier: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
      }),
    )
    const headers = options?.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('rejects malformed input before making a request', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { exchangeDesktopAuthCode, InvalidDesktopAuthExchangeError } = await import('../api')

    await expect(exchangeDesktopAuthCode('short', 'short')).rejects.toBeInstanceOf(
      InvalidDesktopAuthExchangeError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects extra or malformed response fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: 'exchanged-session-token', stale: true }),
      }),
    )
    const { exchangeDesktopAuthCode, InvalidDesktopAuthExchangeError } = await import('../api')

    await expect(
      exchangeDesktopAuthCode('desktop-code-123456', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).rejects.toBeInstanceOf(InvalidDesktopAuthExchangeError)
  })
})

describe('createCheckout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST with origin and checkout product in body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ url: `${API_BASE}/billing/checkout/session-123?token=opaque` }),
      }),
    )

    const { createCheckout } = await import('../api')
    const result = await createCheckout(
      'web',
      'lifetime_starter',
      '11111111-1111-4111-8111-111111111111',
    )

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/checkout/create`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        }),
        body: JSON.stringify({ origin: 'web', product: 'lifetime_starter' }),
      }),
    )
    expect(result.url).toBe(`${API_BASE}/billing/checkout/session-123?token=opaque`)
  })

  it.each([
    ['plain HTTP', 'http://managed.example.test/billing/session'],
    ['foreign origin', 'https://checkout.example.test/session'],
    ['embedded credentials', 'https://user:secret@managed.example.test/session'],
    ['fragment', 'https://managed.example.test/session#token'],
  ])('rejects a %s billing link', async (_case, url) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url }),
      }),
    )

    const { createCheckout, InvalidHostedBillingResponseError } = await import('../api')
    await expect(createCheckout()).rejects.toBeInstanceOf(InvalidHostedBillingResponseError)
  })

  it('rejects unexpected checkout response fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: `${API_BASE}/billing/session`, redirectOverride: true }),
      }),
    )

    const { createCheckout, InvalidHostedBillingResponseError } = await import('../api')
    await expect(createCheckout()).rejects.toBeInstanceOf(InvalidHostedBillingResponseError)
  })
})

describe('createPortalSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts only an exact service-origin HTTPS response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: `${API_BASE}/billing/portal/session-123` }),
      }),
    )

    const { createPortalSession } = await import('../api')
    await expect(createPortalSession()).resolves.toEqual({
      url: `${API_BASE}/billing/portal/session-123`,
    })
  })
})

describe('backup API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uploads a versioned snapshot with a stable idempotency key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, version: 1 }),
      }),
    )

    const { uploadBackup, BACKUP_SCHEMA_VERSION } = await import('../api')
    const result = await uploadBackup(
      {
        history: [{ id: 1 }],
        dictionary: { entries: [], correction_rules: [] },
        settings: { polish_enabled: true },
      },
      '22222222-2222-4222-8222-222222222222',
    )

    const options = vi.mocked(fetch).mock.calls[0][1]
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/backup/upload`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': '22222222-2222-4222-8222-222222222222',
        }),
      }),
    )
    const body = JSON.parse(String(options?.body))
    expect(body).toMatchObject({
      version: BACKUP_SCHEMA_VERSION,
      history: [{ id: 1 }],
      dictionary: { entries: [], correction_rules: [] },
      settings: { polish_enabled: true },
    })
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt)
    expect(result).toEqual({ success: true, version: 1 })
  })

  it('generates cryptographically formatted UUID retry keys', async () => {
    const { createIdempotencyKey } = await import('../api')
    expect(createIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
describe('backup download parser', () => {
  const validHistoryEntry = {
    id: 1,
    created_at: '2026-08-13T00:00:00.000Z',
    context_profile_id: 'general',
    context_label: 'General',
    context_icon_key: 'app',
    context_family: 'general' as const,
    browser_access_status: 'not_applicable' as const,
    provider_kind: 'byok' as const,
    raw_text: 'hello',
    polished_text: 'Hello.',
    language: 'en',
    duration_ms: 1000,
    stt_ms: 300,
    llm_ms: 200,
    total_ms: 500,
    active_scene_id: null,
    active_scene_source: null,
    active_scene_name: null,
    active_scene_prompt_chars: null,
    active_scene_prompt_truncated: false,
    output_status: 'inserted',
    output_error: null,
  }

  function validBackupDownload() {
    return {
      version: 1,
      createdAt: '2026-08-13T00:00:00.000Z',
      history: [validHistoryEntry],
      dictionary: {
        entries: [{ id: 1, word: 'OpenTypeless', pronunciation: null }],
        correction_rules: [
          { id: 1, pattern: 'open type less', replacement: 'OpenTypeless', enabled: true },
        ],
      },
      settings: createBackupSettings(useAppStore.getState().config),
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts only the complete bounded contract shape', async () => {
    const { parseBackupDownload } = await import('../api')
    expect(parseBackupDownload(validBackupDownload())).toEqual(validBackupDownload())

    expect(() => parseBackupDownload({ ...validBackupDownload(), unexpected: true })).toThrow()
    expect(() =>
      parseBackupDownload({
        ...validBackupDownload(),
        dictionary: { ...validBackupDownload().dictionary, entries: [{ id: 1, word: '' }] },
      }),
    ).toThrow()
    expect(() =>
      parseBackupDownload({
        ...validBackupDownload(),
        settings: {
          ...validBackupDownload().settings,
          hotkeys: {
            ...validBackupDownload().settings.hotkeys,
            openApp: { primary: 'A', modifiers: ['Ctrl'], injected: true },
          },
        },
      }),
    ).toThrow()
  })

  it('downloadBackup rejects injected endpoint routing instead of casting service JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...validBackupDownload(),
            settings: {
              ...validBackupDownload().settings,
              llm_provider: 'gemini',
              llm_base_url: 'https://attacker.example/v1',
            },
          }),
      }),
    )
    const { downloadBackup } = await import('../api')

    await expect(downloadBackup()).rejects.toBeInstanceOf(InvalidBackupSettingsError)
  })

  it.each([
    ['missing settings', (({ settings: _, ...rest }) => rest)(validBackupDownload())],
    ['future version', { ...validBackupDownload(), version: 2 }],
    ['unpaired legacy metadata', (({ createdAt: _, ...rest }) => rest)(validBackupDownload())],
    [
      'invalid history enum',
      {
        ...validBackupDownload(),
        history: [{ ...validHistoryEntry, provider_kind: 'attacker' }],
      },
    ],
  ])('downloadBackup rejects %s', async (_case, response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) }),
    )
    const { downloadBackup, InvalidManagedBackupError } = await import('../api')
    await expect(downloadBackup()).rejects.toBeInstanceOf(InvalidManagedBackupError)
  })
})
describe('proxyStt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the desktop client version without forcing a JSON content type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'transcribed text' }),
      }),
    )

    const { proxyStt } = await import('../api')
    const result = await proxyStt(new Blob(['audio'], { type: 'audio/wav' }), 'en', {
      operationId: '11111111-1111-1111-1111-111111111111',
      stageKey: '11111111-1111-1111-1111-111111111111:stt',
      requestType: 'voice_pipeline',
      clientVersion: APP_VERSION_HEADER_VALUE,
    })

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/proxy/stt`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          [CLIENT_VERSION_HEADER]: APP_VERSION_HEADER_VALUE,
        }),
      }),
    )
    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(body.get('operationId')).toBe('11111111-1111-1111-1111-111111111111')
    expect(body.get('stageKey')).toBe('11111111-1111-1111-1111-111111111111:stt')
    expect(result.text).toBe('transcribed text')
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
    const context = {
      operationId: '22222222-2222-2222-2222-222222222222',
      stageKey: '22222222-2222-2222-2222-222222222222:llm',
      requestType: 'voice_pipeline',
      clientVersion: APP_VERSION_HEADER_VALUE,
    }
    const result = await proxyLlm(messages, context)

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/proxy/llm`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          [CLIENT_VERSION_HEADER]: APP_VERSION_HEADER_VALUE,
        }),
        body: JSON.stringify({ messages, context }),
      }),
    )
    expect(result.text).toBe('polished text')
  })
})

describe('getPlans', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const validPlan = {
    product: 'pro_monthly',
    active: true,
    displayName: 'Pro Monthly',
    billingModel: 'subscription',
    billingInterval: 'month',
    currency: 'USD',
    priceMinor: 499,
    allowances: { cloudWordsPerMonth: 100000 },
  }

  it('returns a strictly validated server-owned catalogue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plans: [validPlan] }),
      }),
    )

    const { getPlans } = await import('../api')
    await expect(getPlans()).resolves.toEqual([validPlan])
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/plans`,
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it.each([
    ['unsupported product', { ...validPlan, product: 'enterprise' }],
    ['negative price', { ...validPlan, priceMinor: -1 }],
    ['fractional price', { ...validPlan, priceMinor: 4.99 }],
    ['invalid currency', { ...validPlan, currency: 'usd' }],
    ['mismatched billing', { ...validPlan, billingInterval: null }],
    ['invalid allowance', { ...validPlan, allowances: { cloudWordsPerMonth: -1 } }],
  ])('rejects %s instead of exposing checkout', async (_case, invalidPlan) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plans: [invalidPlan] }),
      }),
    )

    const { getPlans, InvalidPlanCatalogueError } = await import('../api')
    await expect(getPlans()).rejects.toBeInstanceOf(InvalidPlanCatalogueError)
  })

  it('rejects duplicate products and unexpected catalogue fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plans: [validPlan, validPlan], stalePrice: '$4.99' }),
      }),
    )

    const { getPlans, InvalidPlanCatalogueError } = await import('../api')
    await expect(getPlans()).rejects.toBeInstanceOf(InvalidPlanCatalogueError)
  })
})
