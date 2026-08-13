import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalActivityMetrics, type LocalActivityMetricsSummary } from '../../../lib/tauri'
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
      if (key === 'home.activityDetails') {
        return `transformed:${options?.transformed};fallbacks:${options?.fallbacks}`
      }
      if (key === 'home.lifetimeRetained') return `lifetime:${options?.formattedCount}`
      if (key === 'home.averageTurnaroundSamples') {
        return `timed:${options?.count}/${options?.total}`
      }
      if (key === 'home.durationOutliersSelected') return `outliers:${options?.count}`
      return key
    },
  }),
}))

vi.mock('../../../lib/tauri', () => ({
  getLocalActivityMetrics: vi.fn(),
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

const metrics: LocalActivityMetricsSummary = {
  day: {
    recordingMs: 61_000,
    savedTranscriptions: 2,
    outputChars: 120,
    activeDays: 1,
    recordedFallbacks: 0,
    transformedOutputs: 0,
    excludedDurationCount: 0,
    averageTotalMs: null,
    timingSampleCount: 0,
  },
  week: {
    recordingMs: 3_661_000,
    savedTranscriptions: 14,
    outputChars: 4_200,
    activeDays: 4,
    recordedFallbacks: 2,
    transformedOutputs: 9,
    excludedDurationCount: 1,
    averageTotalMs: 1_250,
    timingSampleCount: 8,
  },
  month: {
    recordingMs: 7_200_000,
    savedTranscriptions: 31,
    outputChars: 9_800,
    activeDays: 12,
    recordedFallbacks: 3,
    transformedOutputs: 18,
    excludedDurationCount: 1,
    averageTotalMs: 2_050,
    timingSampleCount: 20,
  },
  totalRecordings: 87,
  excludedDurationCount: 1,
}

describe('Home activity instrument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tauriWindowMock.focusListeners.splice(0)
    tauriWindowMock.setVisible(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.mocked(getLocalActivityMetrics).mockResolvedValue(metrics)
    useAppStore.setState({ activityRevision: 0 })
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
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/transformed:/)).toBeNull()
    expect(screen.queryByText(/outliers:/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'home.week' }))

    expect(screen.getByText('1h 1m')).toBeInTheDocument()
    expect(screen.getByText('4,200')).toBeInTheDocument()
    expect(screen.getByText('1.3 s')).toBeInTheDocument()
    expect(screen.getByText('transformed:9;fallbacks:2')).toBeInTheDocument()
    expect(screen.getByText('timed:8/14')).toBeInTheDocument()
    expect(screen.getByText('outliers:1')).toBeInTheDocument()
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

    await waitFor(() => expect(tauriWindowMock.isVisible).toHaveBeenCalled())
    expect(getLocalActivityMetrics).not.toHaveBeenCalled()

    useAppStore.getState().markActivityChanged()
    await waitFor(() => expect(tauriWindowMock.isVisible).toHaveBeenCalledTimes(2))
    expect(getLocalActivityMetrics).not.toHaveBeenCalled()
  })

  it('refreshes pending activity when the native Main window becomes visible', async () => {
    tauriWindowMock.setVisible(false)
    render(<HomePage />)
    await waitFor(() => expect(tauriWindowMock.onFocusChanged).toHaveBeenCalled())

    useAppStore.getState().markActivityChanged()
    await waitFor(() => expect(tauriWindowMock.isVisible).toHaveBeenCalledTimes(2))
    expect(getLocalActivityMetrics).not.toHaveBeenCalled()

    tauriWindowMock.setVisible(true)
    act(() => tauriWindowMock.emitFocus(true))

    await waitFor(() => expect(getLocalActivityMetrics).toHaveBeenCalledTimes(1))
  })
})
