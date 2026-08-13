import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import * as api from '../../../lib/api'
import * as tauri from '../../../lib/tauri'
import { createBackupSettings } from '../../../lib/backup-settings'
import { useAppStore } from '../../../stores/appStore'
import { useAuthStore } from '../../../stores/authStore'
import { AccountPage } from '../index'

vi.mock('../../../lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/constants')>()
  return { ...actual, MANAGED_SERVICE_CONFIGURED: true }
})
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }))
vi.mock('../../../lib/api', () => ({
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
  createPortalSession: vi.fn(),
}))
vi.mock('../../../lib/tauri')

const requestPasswordReset = vi.fn().mockResolvedValue(undefined)
const changePassword = vi.fn().mockResolvedValue(undefined)
const refreshCredentialCapability = vi.fn().mockResolvedValue(undefined)

function validBackup(overrides: Partial<api.BackupDownload> = {}): api.BackupDownload {
  return {
    version: 1,
    createdAt: '2026-08-13T00:00:00.000Z',
    history: [],
    dictionary: { entries: [], correction_rules: [] },
    settings: createBackupSettings(useAppStore.getState().config),
    ...overrides,
  }
}

function signedIn(capability: 'unknown' | 'present' | 'none') {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      email: 'person@example.com',
      name: 'Person',
      emailVerified: true,
    },
    loading: false,
    error: null,
    credentialCapability: capability,
    plan: 'free',
    source: 'free',
    displayName: 'Free',
    subscriptionStatus: null,
    cloudWordsLimit: 0,
    licenseStatus: null,
    requestPasswordReset,
    changePassword,
    refreshCredentialCapability,
  })
}

describe('AccountPage password controls', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    useAuthStore.setState({
      user: null,
      loading: false,
      error: null,
      emailVerificationPending: false,
      pendingEmail: null,
      credentialCapability: 'unknown',
      requestPasswordReset,
      changePassword,
      refreshCredentialCapability,
    })
  })

  afterEach(cleanup)

  it('places forgot password beneath the signed-out password field and uses the current locale', async () => {
    await i18n.changeLanguage('zh')
    render(<AccountPage />)

    const password = screen.getByLabelText('密码')
    const forgot = screen.getByRole('button', { name: '忘记密码？' })
    expect(password.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(forgot)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'person@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }))

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledWith('person@example.com', 'zh')
    })
    expect(screen.getByText('请检查邮箱')).toBeInTheDocument()
  })

  it('opens credential password controls in a focused modal and keeps invalid forms disabled', () => {
    signedIn('present')
    render(<AccountPage />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Change password' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Change password' })
    expect(dialog.parentElement).toHaveClass('z-[9999]')
    expect(within(dialog).getByLabelText('Current password')).toHaveFocus()
    const submit = within(dialog).getByRole('button', { name: 'Change password' })
    expect(submit).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'old-password' },
    })
    fireEvent.change(within(dialog).getByLabelText('New password'), {
      target: { value: 'new-password' },
    })
    fireEvent.change(within(dialog).getByLabelText('Confirm password'), {
      target: { value: 'different' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Confirm password'), {
      target: { value: 'new-password' },
    })
    expect(submit).toBeEnabled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('renders Set password for OAuth-only accounts', () => {
    signedIn('none')
    render(<AccountPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    const dialog = screen.getByRole('dialog', { name: 'Set password' })
    expect(within(dialog).queryByLabelText('Current password')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('New password')).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument()
  })

  it('persists allow-listed cloud settings and keeps device credentials local', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const current = {
      ...useAppStore.getState().config,
      llm_api_key: 'local-secret',
      system_scene_overrides: [],
    }
    const restored = {
      ...current,
      polish_enabled: false,
      system_scene_overrides: [{ id: 'system_email', prompt_template: 'Use concise paragraphs.' }],
    }
    useAppStore.getState().setConfig(current)
    useAppStore.getState().setSavedConfig(current)
    vi.mocked(api.downloadBackup).mockResolvedValue(
      validBackup({
        settings: {
          ...createBackupSettings(current),
          polish_enabled: false,
          system_scene_overrides: restored.system_scene_overrides,
        },
      }),
    )
    vi.mocked(tauri.updateConfig).mockResolvedValue(undefined)
    vi.mocked(tauri.restoreBackupData).mockResolvedValue({
      history: [],
      dictionary: [],
      correctionRules: [],
    })
    vi.mocked(tauri.getConfig).mockResolvedValue(restored)

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(tauri.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          polish_enabled: false,
          llm_api_key: 'local-secret',
          system_scene_overrides: restored.system_scene_overrides,
        }),
      )
      expect(useAppStore.getState().config).toEqual(restored)
      expect(useAppStore.getState().savedConfig).toEqual(restored)
    })
  })

  it('uploads a fresh database snapshot even when all UI caches are empty', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const persistedHistory = [{ id: 11, raw_text: 'persisted raw' }]
    const persistedDictionary = [{ id: 7, word: 'OpenTypeless', pronunciation: null }]
    const persistedCorrections = [
      {
        id: 9,
        pattern: 'open type less',
        replacement: 'OpenTypeless',
        enabled: true,
      },
    ]
    useAppStore.setState({ history: [], dictionary: [], correctionRules: [] })
    vi.mocked(tauri.exportBackupData).mockResolvedValue({
      history: persistedHistory,
      dictionary: {
        entries: persistedDictionary,
        correction_rules: persistedCorrections,
      },
    } as never)
    vi.mocked(api.uploadBackup).mockResolvedValue({ success: true })

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Backup' }))

    await waitFor(() => {
      expect(tauri.exportBackupData).toHaveBeenCalledTimes(1)
      expect(api.uploadBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          history: persistedHistory,
          dictionary: {
            entries: persistedDictionary,
            correction_rules: persistedCorrections,
          },
        }),
      )
    })
  })

  it('persists restored cloud data before replacing the desktop stores', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const cloudHistory = [{ id: 1, raw_text: 'cloud raw' }]
    const cloudDictionary = {
      entries: [{ id: 2, word: 'TalkMore', pronunciation: null }],
      correction_rules: [{ id: 3, pattern: 'talk more', replacement: 'TalkMore', enabled: true }],
    }
    const restoredHistory = [{ id: 11, raw_text: 'persisted raw' }]
    const restoredDictionary = [{ id: 12, word: 'TalkMore', pronunciation: null }]
    const restoredCorrections = [
      { id: 13, pattern: 'talk more', replacement: 'TalkMore', enabled: true },
    ]
    vi.mocked(api.downloadBackup).mockResolvedValue(
      validBackup({
        history: cloudHistory as never,
        dictionary: cloudDictionary,
      }),
    )
    vi.mocked(tauri.restoreBackupData).mockResolvedValue({
      history: restoredHistory as never,
      dictionary: restoredDictionary,
      correctionRules: restoredCorrections,
    })

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(tauri.validateBackupData).toHaveBeenCalledWith(cloudHistory, cloudDictionary)
      expect(tauri.restoreBackupData).toHaveBeenCalledWith(cloudHistory, cloudDictionary)
      expect(vi.mocked(tauri.validateBackupData).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(tauri.restoreBackupData).mock.invocationCallOrder[0]!,
      )
      expect(useAppStore.getState().history).toEqual(restoredHistory)
      expect(useAppStore.getState().dictionary).toEqual(restoredDictionary)
      expect(useAppStore.getState().correctionRules).toEqual(restoredCorrections)
    })
  })

  it('leaves config and autostart untouched when native backup validation fails', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const current = {
      ...useAppStore.getState().config,
      auto_start: false,
      polish_enabled: true,
    }
    useAppStore.getState().setConfig(current)
    useAppStore.getState().setSavedConfig(current)
    const invalidHistory = [{ created_at: 'not-a-date', raw_text: 'invalid' }]
    vi.mocked(api.downloadBackup).mockResolvedValue(
      validBackup({
        settings: {
          ...createBackupSettings(current),
          auto_start: true,
          polish_enabled: false,
        },
        history: invalidHistory as never,
      }),
    )
    vi.mocked(tauri.validateBackupData).mockRejectedValue(
      new Error('backup_history_created_at_invalid'),
    )

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(screen.getByText('backup_history_created_at_invalid')).toBeInTheDocument()
    })
    expect(tauri.validateBackupData).toHaveBeenCalledWith(invalidHistory, {
      entries: [],
      correction_rules: [],
    })
    expect(tauri.setAutoStart).not.toHaveBeenCalled()
    expect(tauri.updateConfig).not.toHaveBeenCalled()
    expect(tauri.restoreBackupData).not.toHaveBeenCalled()
    expect(useAppStore.getState().config).toEqual(current)
    expect(useAppStore.getState().savedConfig).toEqual(current)
  })

  it('rejects injected provider routing before any local restore mutation', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const current = {
      ...useAppStore.getState().config,
      stt_provider: 'custom-whisper' as const,
      stt_custom_preset: 'custom' as const,
      stt_custom_base_url: 'https://trusted-stt.example/v1',
      stt_custom_model: 'trusted-stt-model',
      stt_volcengine_resource_id: 'trusted-resource',
      llm_provider: 'gemini' as const,
      llm_model: 'trusted-llm-model',
      llm_base_url: 'https://trusted-llm.example/v1',
    }
    useAppStore.getState().setConfig(current)
    useAppStore.getState().setSavedConfig(current)
    vi.mocked(api.downloadBackup).mockResolvedValue(
      validBackup({
        settings: {
          ...createBackupSettings(current),
          stt_provider: 'custom-whisper',
          stt_custom_preset: 'custom',
          stt_custom_base_url: 'https://attacker.example/v1',
          stt_custom_model: 'steal-audio',
          stt_volcengine_resource_id: 'attacker-resource',
          llm_provider: 'gemini',
          llm_model: 'steal-prompts',
          llm_base_url: 'https://attacker.example/openai',
        } as never,
      }) as never,
    )
    vi.mocked(tauri.validateBackupData).mockResolvedValue(undefined)

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(
        screen.getByText('Managed service returned invalid backup settings'),
      ).toBeInTheDocument()
    })
    expect(tauri.setAutoStart).not.toHaveBeenCalled()
    expect(tauri.updateConfig).not.toHaveBeenCalled()
    expect(tauri.restoreBackupData).not.toHaveBeenCalled()
    expect(useAppStore.getState().config).toEqual(current)
    expect(useAppStore.getState().savedConfig).toEqual(current)
  })
  it('rolls config and autostart back when database restore fails before commit', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const current = {
      ...useAppStore.getState().config,
      auto_start: false,
      polish_enabled: true,
    }
    const restored = { ...current, auto_start: true, polish_enabled: false }
    useAppStore.getState().setConfig(current)
    useAppStore.getState().setSavedConfig(current)
    const history = [{ raw_text: 'valid' }]
    vi.mocked(api.downloadBackup).mockResolvedValue(
      validBackup({
        settings: {
          ...createBackupSettings(current),
          auto_start: true,
          polish_enabled: false,
        },
        history: history as never,
      }),
    )
    vi.mocked(tauri.getConfig).mockResolvedValueOnce(current)
    vi.mocked(tauri.validateBackupData).mockResolvedValue(undefined)
    vi.mocked(tauri.setAutoStart).mockResolvedValue(undefined)
    vi.mocked(tauri.updateConfig).mockResolvedValue(undefined)
    vi.mocked(tauri.restoreBackupData).mockRejectedValue(
      new Error('backup_restore_not_committed:database unavailable'),
    )

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(
        screen.getByText('backup_restore_not_committed:database unavailable'),
      ).toBeInTheDocument()
    })
    expect(tauri.setAutoStart).toHaveBeenNthCalledWith(1, true)
    expect(tauri.setAutoStart).toHaveBeenNthCalledWith(2, false)
    expect(tauri.updateConfig).toHaveBeenNthCalledWith(1, restored)
    expect(tauri.updateConfig).toHaveBeenNthCalledWith(2, current)
    expect(useAppStore.getState().config).toEqual(current)
    expect(useAppStore.getState().savedConfig).toEqual(current)
  })

  it('reports committed restore refresh failure without creating mixed settings', async () => {
    signedIn('present')
    useAuthStore.setState({
      plan: 'pro',
      source: 'creem',
      subscriptionStatus: 'active',
      cloudWordsLimit: 1000,
      licenseStatus: 'active',
    })
    const current = {
      ...useAppStore.getState().config,
      auto_start: false,
      polish_enabled: true,
    }
    const restored = { ...current, auto_start: true, polish_enabled: false }
    useAppStore.getState().setConfig(current)
    useAppStore.getState().setSavedConfig(current)
    vi.mocked(api.downloadBackup).mockResolvedValue(
      validBackup({
        settings: {
          ...createBackupSettings(current),
          auto_start: true,
          polish_enabled: false,
        },
        history: [{ raw_text: 'valid' }] as never,
      }),
    )
    vi.mocked(tauri.getConfig).mockResolvedValueOnce(current).mockResolvedValueOnce(restored)
    vi.mocked(tauri.validateBackupData).mockResolvedValue(undefined)
    vi.mocked(tauri.setAutoStart).mockResolvedValue(undefined)
    vi.mocked(tauri.updateConfig).mockResolvedValue(undefined)
    vi.mocked(tauri.restoreBackupData).mockRejectedValue(
      new Error('backup_restore_committed_refresh_failed:database busy'),
    )

    render(<AccountPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Restore completed, but the app could not refresh the restored lists. Restart OpenTypeless to reload them.',
        ),
      ).toBeInTheDocument()
    })
    expect(tauri.setAutoStart).toHaveBeenCalledTimes(1)
    expect(tauri.updateConfig).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().config).toEqual(restored)
    expect(useAppStore.getState().savedConfig).toEqual(restored)
  })

  it('explains why passwords longer than 128 characters cannot be submitted', () => {
    signedIn('none')
    render(<AccountPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    const dialog = screen.getByRole('dialog', { name: 'Set password' })
    const tooLong = 'a'.repeat(129)
    fireEvent.change(within(dialog).getByLabelText('New password'), {
      target: { value: tooLong },
    })
    fireEvent.change(within(dialog).getByLabelText('Confirm password'), {
      target: { value: tooLong },
    })

    expect(within(dialog).getByText('Password must be 12 to 128 characters')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Set password' })).toBeDisabled()
  })

  it('keeps Tab and Shift+Tab focus inside the password dialog', () => {
    signedIn('present')
    render(<AccountPage />)

    const backgroundSignOut = screen.getByRole('button', { name: 'Sign Out' })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    const dialog = screen.getByRole('dialog', { name: 'Change password' })
    const firstField = within(dialog).getByLabelText('Current password')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })

    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(firstField).toHaveFocus()
    expect(backgroundSignOut).not.toHaveFocus()

    firstField.focus()
    fireEvent.keyDown(firstField, { key: 'Tab', shiftKey: true })
    expect(cancel).toHaveFocus()
    expect(backgroundSignOut).not.toHaveFocus()
  })

  it('renders neither password action while capability is unknown', () => {
    signedIn('unknown')
    render(<AccountPage />)

    expect(screen.queryByRole('button', { name: 'Set password' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument()
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument()
  })
})
