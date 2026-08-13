import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpgradePage } from '../index'

const getPlans = vi.hoisted(() => vi.fn())
const createCheckout = vi.hoisted(() => vi.fn())
const openUrl = vi.hoisted(() => vi.fn())

type MockPlan =
  | 'free'
  | 'pro'
  | 'lifetime_starter'
  | 'appsumo_tier1'
  | 'appsumo_tier2'
  | 'appsumo_tier3'
type MockSource = 'free' | 'creem' | 'lifetime' | 'appsumo'
type MockLicenseStatus = 'pending' | 'active' | 'refunded' | 'deactivated' | null

const mockAuthState = {
  user: null as any,
  plan: 'free' as MockPlan,
  source: 'free' as MockSource,
  displayName: 'Free',
  licenseStatus: null as MockLicenseStatus,
  quotaModel: 'cloud_words',
  displayWordsUsedEstimate: 0,
  displayWordsLimit: 0,
  cloudWordsUsed: 0,
  cloudWordsLimit: 0,
  sttSecondsUsed: 0,
  sttSecondsLimit: 0,
  llmTokensUsed: 0,
  llmTokensLimit: 0,
}

const monthlyPlan = {
  product: 'pro_monthly' as const,
  active: true,
  displayName: 'Managed Pro',
  billingModel: 'subscription' as const,
  billingInterval: 'month' as const,
  currency: 'USD',
  priceMinor: 499,
  allowances: { cloudWordsPerMonth: 100000 },
}
const lifetimePlan = {
  product: 'lifetime_starter' as const,
  active: true,
  displayName: 'Managed Lifetime',
  billingModel: 'one_time' as const,
  billingInterval: null,
  currency: 'USD',
  priceMinor: 8999,
  allowances: { cloudWordsPerMonth: 100000 },
}

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))
vi.mock('../../../lib/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/constants')>()),
  MANAGED_SERVICE_CONFIGURED: true,
}))
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  createCheckout,
  getPlans,
}))
vi.mock('../../../stores/authStore', () => ({
  hasManagedCloudAccess: (state: typeof mockAuthState) =>
    state.licenseStatus !== 'refunded' &&
    state.licenseStatus !== 'deactivated' &&
    ((state.source === 'creem' && state.cloudWordsLimit > 0) ||
      (state.source === 'lifetime' && state.cloudWordsLimit > 0) ||
      (state.source === 'appsumo' &&
        state.cloudWordsLimit > 0 &&
        state.licenseStatus === 'active') ||
      state.plan === 'pro' ||
      state.plan === 'lifetime_starter'),
  useAuthStore: Object.assign(
    (selector: any) => (typeof selector === 'function' ? selector(mockAuthState) : mockAuthState),
    { setState: vi.fn() },
  ),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      (
        ({
          'upgrade.title': 'Upgrade',
          'upgrade.subtitle': 'Optional managed voice and AI service.',
          'upgrade.currentPlan': `Current plan: ${values?.plan ?? ''}`,
          'upgrade.month': 'month',
          'upgrade.oneTime': 'one-time',
          'upgrade.subscribeToPro': 'Subscribe to Pro',
          'upgrade.buyLifetime': 'Buy lifetime',
          'upgrade.signInFirst': 'Sign in first to subscribe.',
          'upgrade.pricingLoading': 'Loading current pricing…',
          'upgrade.pricingUnavailableTitle': 'Managed service pricing unavailable',
          'upgrade.pricingUnavailable': 'Checkout is unavailable until current pricing loads.',
          'upgrade.cloudWordsAllowance': `${values?.amount ?? ''} cloud words per month`,
          'upgrade.planDescriptions.pro': 'Flexible monthly managed-service access.',
          'upgrade.planDescriptions.lifetime': 'One-time managed-service license.',
          'upgrade.benefits.title': 'Managed-service capabilities',
          'upgrade.benefits.cloudWords': 'Cloud speech recognition and AI rewriting',
          'upgrade.benefits.noApiKey': 'No provider keys required in managed mode',
          'upgrade.benefits.backupScenes': 'Cloud backup and scene packs',
          'upgrade.monthlyActive': 'Pro is active.',
          'upgrade.monthlyActiveLifetimeHint': 'Pro is active. A lifetime offer is available.',
        }) as Record<string, string>
      )[key] ?? key,
  }),
}))

beforeEach(() => {
  Object.assign(mockAuthState, {
    user: null,
    plan: 'free' as MockPlan,
    source: 'free' as MockSource,
    displayName: 'Free',
    licenseStatus: null as MockLicenseStatus,
    quotaModel: 'cloud_words',
    displayWordsUsedEstimate: 0,
    displayWordsLimit: 0,
    cloudWordsUsed: 0,
    cloudWordsLimit: 0,
    sttSecondsUsed: 0,
    sttSecondsLimit: 0,
    llmTokensUsed: 0,
    llmTokensLimit: 0,
  })
  getPlans.mockResolvedValue([monthlyPlan, lifetimePlan])
  createCheckout.mockResolvedValue({ url: 'https://checkout.example.test' })
  openUrl.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpgradePage', () => {
  it('renders only active validated server offers with locale-aware prices', async () => {
    getPlans.mockResolvedValue([
      monthlyPlan,
      lifetimePlan,
      { ...lifetimePlan, product: 'lifetime_starter', active: false, displayName: 'Hidden' },
    ])
    render(<UpgradePage />)

    expect(screen.getByText('Loading current pricing…')).toBeInTheDocument()
    expect(await screen.findByText('Managed Pro')).toBeInTheDocument()
    expect(screen.getByText('$4.99')).toBeInTheDocument()
    expect(screen.getByText('Managed Lifetime')).toBeInTheDocument()
    expect(screen.getByText('$89.99')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('fails closed without hard-coded sale claims or checkout controls', async () => {
    getPlans.mockRejectedValue(new Error('catalogue offline'))
    render(<UpgradePage />)

    expect(await screen.findByText('Managed service pricing unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('Checkout is unavailable until current pricing loads.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /subscribe|buy/i })).not.toBeInTheDocument()
    expect(screen.queryByText('$4.99')).not.toBeInTheDocument()
    expect(screen.queryByText('$89.99')).not.toBeInTheDocument()
  })

  it('starts checkout only for a product supplied by the successful catalogue', async () => {
    Object.assign(mockAuthState, {
      user: { id: 'user-1', email: 'user@example.com', name: null },
    })
    render(<UpgradePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to Pro' }))
    await waitFor(() => expect(createCheckout).toHaveBeenCalledWith('desktop', 'pro_monthly'))
  })

  it('shows only a server-provided lifetime offer for active monthly users', async () => {
    Object.assign(mockAuthState, {
      user: { id: 'user-1', email: 'user@example.com', name: null },
      plan: 'pro' as MockPlan,
      source: 'creem' as MockSource,
      displayName: 'Pro',
      cloudWordsLimit: 100000,
    })
    render(<UpgradePage />)

    expect(await screen.findByText('Managed Lifetime')).toBeInTheDocument()
    expect(screen.queryByText('Managed Pro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy lifetime' })).toBeInTheDocument()
  })
})
