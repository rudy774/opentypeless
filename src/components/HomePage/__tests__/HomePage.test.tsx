import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalActivityMetrics,
  getSttProviderDiagnostics,
  getSystemDiagnostics,
  type LocalActivityMetricsSummary,
  type SttProviderDiagnostics,
  type SystemDiagnosticsReport,
} from '../../../lib/tauri'
import { useAppStore } from '../../../stores/appStore'
import { HomePage } from '../index'

const tauriWindowMock = vi.hoisted(() => {
  type FocusListener = (event: { payload: boolean }) => void
  const focusListeners: FocusListener[] = []
  let visible = true

  return {
    focusListeners,
    isVisible: vi.fn(() => Promise.resolve(visible)),
    onFocusChanged: vi.fn((callback: FocusListener) => {
      focusListeners.push(callback)
      return Promise.resolve(() => {
        const index = focusListeners.indexOf(callback)
        if (index >= 0) focusListeners.splice(index, 1)
      })
    }),
    setVisible(next: boolean) {
      visible = next
    },
    emitFocus(focused: boolean) {
      for (const listener of [...focusListeners]) listener({ payload: focused })
    },
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isVisible: tauriWindowMock.isVisible,
    onFocusChanged: tauriWindowMock.onFocusChanged,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'home.transformedOutputsDetail') return `transformed:${options?.count}`
      if (key === 'home.lifetimeRetained') return `lifetime:${options?.formattedCount}`
      if (key === 'home.averageTurnaroundSamples') {
        return `timed:${options?.count}/${options?.total}`
      }
      if (key === 'home.outputOutcomeCoverage') {
        return `outcomes:${options?.count}/${options?.total}`
      }
      if (key === 'home.turnaroundCoverage') {
        return `latency:${options?.count}/${options?.total}`
      }
      if (key === 'home.durationCoverage') {
        return `durations:${options?.count}/${options?.total}`
      }
      if (key === 'home.lifetimeDurationCoverage') {
        return `lifetime-durations:${options?.count}/${options?.total}`
      }
      if (key === 'home.invalidDurationsSelected') return `invalid:${options?.count}`
      if (key === 'home.invalidDurationsLifetime') {
        return `lifetime-invalid:${options?.count}`
      }
      if (key === 'home.timingOutliersSelected') return `timing-outliers:${options?.count}`
      return key
    },
  }),
}))

vi.mock('../../../lib/tauri', () => ({
  getLocalActivityMetrics: vi.fn(),
  getSttProviderDiagnostics: vi.fn(),
  getSystemDiagnostics: vi.fn(),
}))

vi.mock('../../../stores/authStore', () => {
  const authState = {
    user: null,
    displayName: '',
    quotaModel: 'legacy_dual_meter',
    displayWordsUsedEstimate: 0,
    displayWordsLimit: 0,
    displayWordsResetAt: null,
    cloudWordsUsed: 0,
    cloudWordsLimit: 0,
    cloudWordsResetAt: null,
    sttSecondsUsed: 0,
    sttSecondsLimit: 0,
    llmTokensUsed: 0,
    llmTokensLimit: 0,
  }
  return {
    hasManagedCloudAccess: () => false,
    useAuthStore: (selector?: (state: typeof authState) => unknown) =>
      selector ? selector(authState) : authState,
  }
})

const readySystemDiagnostics: SystemDiagnosticsReport = {
  checkedAt: '2026-08-12T12:00:00',
  rows: [
    {
      id: 'microphone',
      status: 'ok',
      message: 'Default microphone / 48000 Hz',
      action: null,
      lastCheckedAt: '2026-08-12T12:00:00',
    },
    {
      id: 'hotkey',
      status: 'ok',
      message: 'Global hotkeys are configured',
      action: null,
      lastCheckedAt: '2026-08-12T12:00:00',
    },
  ],
}

const readySttDiagnostics: SttProviderDiagnostics = {
  provider: 'glm-asr',
  kind: 'byokRemote',
  endpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions',
  model: 'glm-asr-2512',
  requiresApiKey: true,
  apiKeyConfigured: true,
  ready: true,
  issues: [],
}

const metrics: LocalActivityMetricsSummary = {
  day: {
    recordingMs: 61_000,
    savedTranscriptions: 2,
    outputChars: 120,
    activeDays: 1,
    successfulAutomaticInsertions: 2,
    recordedFallbacks: 0,
    recordedFailures: 0,
    outputOutcomeSampleCount: 2,
    transformedOutputs: 0,
    validDurationSampleCount: 2,
    excludedDurationCount: 0,
    averageTotalMs: null,
    p50TotalMs: null,
    p95TotalMs: null,
    timingSampleCount: 0,
    excludedTimingCount: 0,
  },
  week: {
    recordingMs: 3_661_000,
    savedTranscriptions: 14,
    outputChars: 4_200,
    activeDays: 4,
    successfulAutomaticInsertions: 10,
    recordedFallbacks: 2,
    recordedFailures: 2,
    outputOutcomeSampleCount: 14,
    transformedOutputs: 9,
    validDurationSampleCount: 13,
    excludedDurationCount: 1,
    averageTotalMs: 1_250,
    p50TotalMs: 900,
    p95TotalMs: 2_500,
    timingSampleCount: 8,
    excludedTimingCount: 1,
  },
  month: {
    recordingMs: 7_200_000,
    savedTranscriptions: 31,
    outputChars: 9_800,
    activeDays: 12,
    successfulAutomaticInsertions: 25,
    recordedFallbacks: 3,
    recordedFailures: 2,
    outputOutcomeSampleCount: 30,
    transformedOutputs: 18,
    validDurationSampleCount: 30,
    excludedDurationCount: 1,
    averageTotalMs: 2_050,
    p50TotalMs: 1_600,
    p95TotalMs: 4_900,
    timingSampleCount: 20,
    excludedTimingCount: 1,
  },
  totalRecordings: 87,
  validDurationSampleCount: 86,
  excludedDurationCount: 1,
}

describe('Home activity instrument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tauriWindowMock.focusListeners.splice(0)
    tauriWindowMock.setVisible(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.mocked(getLocalActivityMetrics).mockResolvedValue(metrics)
    vi.mocked(getSystemDiagnostics).mockResolvedValue(readySystemDiagnostics)
    vi.mocked(getSttProviderDiagnostics).mockResolvedValue(readySttDiagnostics)
    useAppStore.setState({ activityRevision: 0, hotkeyRegistrationError: null })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(useAppStore.getInitialState())
  })

  it('shows one coherent selected range and keeps lifetime total separate', async () => {
    render(<HomePage />)

    await screen.findByText('1m 1s')
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('lifetime:87')).toBeInTheDocument()
    expect(screen.getByText('outcomes:2/2')).toBeInTheDocument()
    expect(screen.getByText('home.retainedOutputScope')).toBeInTheDocument()
    expect(screen.getByText('durations:2/2')).toBeInTheDocument()
    expect(screen.getByText('lifetime-durations:86/87')).toBeInTheDocument()
    expect(screen.getByText('lifetime-invalid:1')).toBeInTheDocument()
    expect(screen.getByText('latency:0/2')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText(/transformed:/)).toBeNull()
    expect(screen.queryByText(/^invalid:/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'home.week' }))

    expect(screen.getByText('1h 1m')).toBeInTheDocument()
    expect(screen.getByText('4,200')).toBeInTheDocument()
    expect(screen.getByText('1.3 s')).toBeInTheDocument()
    expect(screen.getByText('900 ms')).toBeInTheDocument()
    expect(screen.getByText('2.5 s')).toBeInTheDocument()
    expect(screen.getByText('transformed:9')).toBeInTheDocument()
    expect(screen.getByText('timed:8/14')).toBeInTheDocument()
    expect(screen.getByText('outcomes:14/14')).toBeInTheDocument()
    expect(screen.getByText('durations:13/14')).toBeInTheDocument()
    expect(screen.getByText('latency:8/14')).toBeInTheDocument()
    expect(screen.getByText('invalid:1')).toBeInTheDocument()
    expect(screen.queryByText(/lifetime-invalid:/)).toBeNull()
    expect(screen.getByText('timing-outliers:1')).toBeInTheDocument()
  })

  it('reloads local metrics when activityRevision changes', async () => {
    render(<HomePage />)

    await waitFor(() => expect(getLocalActivityMetrics).toHaveBeenCalledTimes(1))
    useAppStore.getState().markActivityChanged()
    await waitFor(() => expect(getLocalActivityMetrics).toHaveBeenCalledTimes(2))
  })
  it('does not query metrics while the native Main window is hidden', async () => {
    tauriWindowMock.setVisible(false)
    render(<HomePage />)

    await waitFor(() =>
      expect(tauriWindowMock.isVisible.mock.calls.length).toBeGreaterThanOrEqual(2),
    )
    expect(getLocalActivityMetrics).not.toHaveBeenCalled()

    const initialVisibilityChecks = tauriWindowMock.isVisible.mock.calls.length
    useAppStore.getState().markActivityChanged()
    await waitFor(() =>
      expect(tauriWindowMock.isVisible.mock.calls.length).toBeGreaterThan(initialVisibilityChecks),
    )
    expect(getLocalActivityMetrics).not.toHaveBeenCalled()
  })

  it('refreshes pending activity when the native Main window becomes visible', async () => {
    tauriWindowMock.setVisible(false)
    render(<HomePage />)
    await waitFor(() => expect(tauriWindowMock.onFocusChanged).toHaveBeenCalled())

    const initialVisibilityChecks = tauriWindowMock.isVisible.mock.calls.length
    useAppStore.getState().markActivityChanged()
    await waitFor(() =>
      expect(tauriWindowMock.isVisible.mock.calls.length).toBeGreaterThan(initialVisibilityChecks),
    )
    expect(getLocalActivityMetrics).not.toHaveBeenCalled()

    tauriWindowMock.setVisible(true)
    act(() => tauriWindowMock.emitFocus(true))

    await waitFor(() => expect(getLocalActivityMetrics).toHaveBeenCalledTimes(1))
  })

  it('stays neutral while readiness diagnostics are still running', async () => {
    let resolveSystem: (report: SystemDiagnosticsReport) => void = () => {}
    vi.mocked(getSystemDiagnostics).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSystem = resolve
      }),
    )

    render(<HomePage />)

    expect(screen.getByText('settings.healthChecking')).toBeInTheDocument()
    expect(screen.queryByText('settings.healthReady')).toBeNull()

    await act(async () => resolveSystem(readySystemDiagnostics))
    await screen.findByText('settings.healthReady')
  })

  it('requires the selected STT provider credential before showing ready', async () => {
    vi.mocked(getSttProviderDiagnostics).mockResolvedValueOnce({
      ...readySttDiagnostics,
      apiKeyConfigured: false,
      ready: false,
      issues: [{ code: 'missing_api_key', message: 'API key is required for this STT provider' }],
    })

    render(<HomePage />)

    await screen.findByText('settings.healthActionRequired')
    expect(screen.getByText('API key is required for this STT provider')).toBeInTheDocument()
    expect(screen.queryByText('settings.healthReady')).toBeNull()
  })

  it('requires a usable microphone before showing ready', async () => {
    vi.mocked(getSystemDiagnostics).mockResolvedValueOnce({
      ...readySystemDiagnostics,
      rows: readySystemDiagnostics.rows.map((row) =>
        row.id === 'microphone'
          ? { ...row, status: 'error', message: 'No default microphone input was found' }
          : row,
      ),
    })

    render(<HomePage />)

    await screen.findByText('settings.healthActionRequired')
    expect(screen.getByText('No default microphone input was found')).toBeInTheDocument()
    expect(screen.queryByText('settings.healthReady')).toBeNull()
  })

  it('requires successful hotkey registration before showing ready', async () => {
    vi.mocked(getSystemDiagnostics).mockResolvedValueOnce({
      ...readySystemDiagnostics,
      rows: readySystemDiagnostics.rows.map((row) =>
        row.id === 'hotkey'
          ? { ...row, status: 'error', message: 'Shortcut registration failed' }
          : row,
      ),
    })

    render(<HomePage />)

    await screen.findByText('settings.healthActionRequired')
    expect(screen.getByText('Shortcut registration failed')).toBeInTheDocument()
    expect(screen.queryByText('settings.healthReady')).toBeNull()
  })

  it('shows ready only after microphone, hotkey, and provider checks pass', async () => {
    render(<HomePage />)

    await screen.findByText('settings.healthReady')
    expect(getSystemDiagnostics).toHaveBeenCalledTimes(1)
    expect(getSttProviderDiagnostics).toHaveBeenCalledWith('', 'glm-asr', undefined, undefined)
    expect(screen.queryByText('home.configured')).toBeNull()
  })
})
