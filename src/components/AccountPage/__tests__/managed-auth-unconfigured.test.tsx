import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { useAuthStore } from '../../../stores/authStore'
import { AccountPage } from '../index'
import { AccountStep } from '../../Onboarding/AccountStep'

vi.mock('../../../lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/constants')>()
  return { ...actual, MANAGED_SERVICE_CONFIGURED: false }
})
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }))

describe('unconfigured managed authentication UI', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useAuthStore.setState({
      user: null,
      loading: false,
      error: null,
      emailVerificationPending: false,
      pendingEmail: null,
    })
  })

  afterEach(cleanup)

  it('omits all account submission controls and explains local-only operation', () => {
    render(<AccountPage />)

    expect(screen.getByRole('heading', { name: 'Account service unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/no managed cloud service configured/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign up/i })).not.toBeInTheDocument()
  })

  it('omits onboarding auth controls and directs the user to local provider setup', () => {
    render(<AccountStep />)

    expect(screen.getByRole('heading', { name: 'Continue in local mode' })).toBeInTheDocument()
    expect(screen.getByText(/choose skip below/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /github/i })).not.toBeInTheDocument()
  })
})
