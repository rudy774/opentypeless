import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from '../index'

const mockAuthState = {
  user: { id: 'user-1', email: 'buyer@example.test', name: 'Buyer' },
  loading: false,
  plan: 'appsumo_tier2' as const,
  planSource: 'appsumo' as const,
  displayName: 'AppSumo Tier 2',
  subscriptionEnd: null,
  licenseStatus: 'active' as const,
  cloudWordsUsed: 123_456,
  cloudWordsLimit: 700_000,
  cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
  sttSecondsUsed: 0,
  sttSecondsLimit: 0,
  llmTokensUsed: 0,
  llmTokensLimit: 0,
  signOut: vi.fn(),
  activateAppSumoLicense: vi.fn().mockResolvedValue(undefined),
}

const mockAppState = {
  config: {},
  history: [],
  dictionary: [],
  setConfig: vi.fn(),
  setHistory: vi.fn(),
  setDictionary: vi.fn(),
}

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

vi.mock('../../../lib/api', () => ({
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
  createPortalSession: vi.fn(),
}))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(() => mockAuthState, {
    setState: vi.fn(),
  }),
}))

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (state: typeof mockAppState) => unknown) => selector(mockAppState),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      (
        ({
          'account.title': 'Account',
          'account.subtitle': 'Sign in to sync data and manage your subscription',
          'account.email': 'Email',
          'account.name': 'Name',
          'account.plan': 'Plan',
          'account.renews': 'Renews',
          'account.usageThisMonth': 'Usage This Month',
          'account.cloudWords': 'Cloud words',
          'account.words': 'words',
          'account.resets': 'Resets',
          'account.appsumoLicense': 'AppSumo license',
          'account.appsumoRedeemTitle': 'Redeem AppSumo license',
          'account.appsumoRedeemDesc':
            'Paste your AppSumo license key to unlock lifetime cloud words.',
          'account.appsumoLicensePlaceholder': 'AppSumo license key',
          'account.activateLicense': 'Activate license',
          'account.licenseActivated': 'License activated',
          'account.signOut': 'Sign Out',
          'account.quotaUsage': `${values?.label}: ${values?.used} / ${values?.limit} ${values?.unit}`,
        }) as Record<string, string>
      )[key] ?? key,
  }),
}))

beforeEach(() => {
  Object.assign(mockAuthState, {
    user: { id: 'user-1', email: 'buyer@example.test', name: 'Buyer' },
    loading: false,
    plan: 'appsumo_tier2' as const,
    planSource: 'appsumo' as const,
    displayName: 'AppSumo Tier 2',
    licenseStatus: 'active' as const,
    cloudWordsUsed: 123_456,
    cloudWordsLimit: 700_000,
    cloudWordsResetAt: '2026-07-01T00:00:00.000Z',
    sttSecondsUsed: 0,
    sttSecondsLimit: 0,
    llmTokensUsed: 0,
    llmTokensLimit: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AccountPage AppSumo', () => {
  it('shows active AppSumo plan and cloud words usage', () => {
    render(<AccountPage />)

    expect(screen.getByText('AppSumo Tier 2')).toBeInTheDocument()
    expect(screen.getByText('123.5K / 700.0K words')).toBeInTheDocument()
    expect(screen.getByText('Jul 1, 2026')).toBeInTheDocument()
  })

  it('activates AppSumo license from the account page', async () => {
    render(<AccountPage />)

    fireEvent.change(screen.getByPlaceholderText('AppSumo license key'), {
      target: { value: 'SUMO-ABC-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Activate license' }))

    await waitFor(() => {
      expect(mockAuthState.activateAppSumoLicense).toHaveBeenCalledWith('SUMO-ABC-123')
    })
    expect(await screen.findByText('License activated')).toBeInTheDocument()
  })
})
