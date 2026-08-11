import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../../stores/appStore'
import { setActiveTranslationTarget, stopAskFlow } from '../../../lib/tauri'
import {
  completeCapsuleMoveGuide,
  loadCapsuleMoveGuidePending,
} from '../../../lib/capsulePreferences'
import { Capsule } from '../index'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        (_target, tag: string) =>
        ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
          React.createElement(tag, props, children),
    },
  ),
  useReducedMotion: () => true,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../../hooks/useCapsuleResize', () => ({
  useCapsuleResize: () => ({ width: 200, height: 36 }),
}))

vi.mock('../../../lib/tauri', () => ({
  abortAskDictation: vi.fn().mockResolvedValue(undefined),
  abortRecording: vi.fn().mockResolvedValue(undefined),
  setActiveTranslationTarget: vi.fn().mockResolvedValue({
    targets: ['en', 'ja'],
    active_target: 'ja',
  }),
  setCapsuleAutoHide: vi.fn().mockResolvedValue(undefined),
  stopAskFlow: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../lib/capsulePreferences', () => ({
  completeCapsuleMoveGuide: vi.fn().mockResolvedValue(undefined),
  loadCapsuleMoveGuidePending: vi.fn().mockResolvedValue(false),
  saveCurrentCapsuleAnchor: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.clearAllMocks()
  useAppStore.setState(useAppStore.getInitialState())
})

describe('Capsule flow states', () => {
  beforeEach(() => {
    vi.mocked(loadCapsuleMoveGuidePending).mockResolvedValue(false)
    useAppStore.setState({
      pipelineState: 'idle',
      pipelineError: null,
      contextMenuOpen: false,
      contextMenuReady: false,
      translationTargetMenuOpen: false,
      activeVoiceMode: null,
      partialTranscript: '',
    })
  })

  it('renders preparing state', () => {
    useAppStore.setState({ pipelineState: 'preparing' })

    render(<Capsule />)

    expect(screen.getByText('capsule.preparing')).toBeInTheDocument()
  })

  it('renders transcribing state with partial transcript when available', () => {
    useAppStore.setState({
      pipelineState: 'transcribing',
      partialTranscript: 'hello world',
    })

    render(<Capsule />)

    expect(screen.getByText(/hello world/)).toBeInTheDocument()
  })

  it('keeps recording until explicitly stopped when the recording limit is off', () => {
    vi.useFakeTimers()
    useAppStore.setState((state) => ({
      pipelineState: 'recording',
      config: { ...state.config, max_recording_seconds: 0 },
    }))

    render(<Capsule />)
    act(() => vi.advanceTimersByTime(65_000))

    expect(invoke).not.toHaveBeenCalledWith('stop_recording')
  })

  it('shows the first-use movement guide during recording and allows dismissal', async () => {
    vi.mocked(loadCapsuleMoveGuidePending).mockResolvedValueOnce(true)
    useAppStore.setState({ pipelineState: 'recording' })

    render(<Capsule />)

    expect(await screen.findByText('capsule.moveGuide.title')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'capsule.moveGuide.dismiss' }))

    expect(completeCapsuleMoveGuide).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('capsule.moveGuide.title')).toBeNull()
  })

  it('stops recording when the configured recording limit is reached', () => {
    vi.useFakeTimers()
    useAppStore.setState((state) => ({
      pipelineState: 'recording',
      config: { ...state.config, max_recording_seconds: 5 },
    }))

    render(<Capsule />)
    act(() => vi.advanceTimersByTime(5_000))

    expect(invoke).toHaveBeenCalledWith('stop_recording')
  })

  it('renders thinking state during polishing', () => {
    useAppStore.setState({ pipelineState: 'polishing' })

    render(<Capsule />)

    expect(screen.getByText('capsule.thinking')).toBeInTheDocument()
  })

  it('does not start dictation when the idle capsule is clicked', () => {
    const { container } = render(<Capsule />)
    const shell = container.querySelector('.jelly-capsule')
    expect(shell).toBeTruthy()

    const pointerUp = new Event('pointerup', { bubbles: true })
    Object.defineProperty(pointerUp, 'button', { value: 0 })
    fireEvent(shell as Element, pointerUp)

    expect(invoke).not.toHaveBeenCalledWith('start_recording')
  })

  it('renders Ask recording in the capsule and stops Ask when clicked', () => {
    useAppStore.setState({ pipelineState: 'ask_recording' })

    render(<Capsule />)

    expect(screen.getByText('ask.title')).toBeInTheDocument()
    expect(screen.getByText('ask.title')).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('00:00')).toBeInTheDocument()

    const pointerUp = new Event('pointerup', { bubbles: true })
    Object.defineProperty(pointerUp, 'button', { value: 0 })
    fireEvent(screen.getByText('ask.title'), pointerUp)

    expect(stopAskFlow).toHaveBeenCalledTimes(1)
  })

  it('renders Ask thinking in the capsule', () => {
    useAppStore.setState({ pipelineState: 'ask_thinking' })

    render(<Capsule />)

    expect(screen.getByText('ask.title')).toBeInTheDocument()
    expect(screen.getByText('ask.title')).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('ask.thinking')).toBeInTheDocument()
  })

  it('shows the language chip only while Translate is recording', () => {
    useAppStore.setState({
      pipelineState: 'recording',
      activeVoiceMode: 'dictate',
      config: {
        ...useAppStore.getState().config,
        translation: { targets: ['en', 'ja'], active_target: 'en' },
      },
    })
    const { rerender } = render(<Capsule />)

    expect(screen.queryByRole('button', { name: 'capsule.translationTarget en' })).toBeNull()

    useAppStore.setState({ activeVoiceMode: 'translate' })
    rerender(<Capsule />)
    expect(screen.getByRole('button', { name: 'capsule.translationTarget en' })).toBeInTheDocument()

    useAppStore.setState({ pipelineState: 'transcribing' })
    rerender(<Capsule />)
    expect(screen.queryByRole('button', { name: 'capsule.translationTarget en' })).toBeNull()
  })

  it('switches the active target without restarting or stopping recording', async () => {
    useAppStore.setState({
      pipelineState: 'recording',
      activeVoiceMode: 'translate',
      config: {
        ...useAppStore.getState().config,
        translation: { targets: ['en', 'ja'], active_target: 'en' },
      },
    })
    render(<Capsule />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'capsule.translationTarget en' }))
    fireEvent.click(screen.getByRole('button', { name: 'capsule.translationTarget en' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '日本語' }))

    await waitFor(() => expect(setActiveTranslationTarget).toHaveBeenCalledWith('ja'))
    expect(invoke).not.toHaveBeenCalledWith('stop_recording')
    expect(invoke).not.toHaveBeenCalledWith('start_recording')
    expect(useAppStore.getState().config.translation.active_target).toBe('ja')
  })

  it('keeps the capsule shell at 200 by 36 and closes the target menu on Escape', async () => {
    useAppStore.setState({
      pipelineState: 'recording',
      activeVoiceMode: 'translate',
      config: {
        ...useAppStore.getState().config,
        translation: { targets: ['en', 'ja'], active_target: 'en' },
      },
    })
    const { container } = render(<Capsule />)
    const chip = screen.getByRole('button', { name: 'capsule.translationTarget en' })

    fireEvent.click(chip)
    expect(screen.getByRole('menu', { name: 'capsule.translationTargets' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'capsule.translationTargets' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'capsule.translationTarget en' })).toHaveFocus(),
    )

    const shell = container.querySelector('.jelly-capsule-active') as HTMLElement
    expect(shell.style.width).toBe('200px')
    expect(shell.style.height).toBe('36px')
  })
})
