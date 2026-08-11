import { describe, expect, it, vi } from 'vitest'
import {
  getCapsuleContentSize,
  getCapsuleFocusable,
  getCapsuleVisibility,
  keepCapsuleOnTop,
} from '../useCapsuleResize'

describe('getCapsuleVisibility', () => {
  it('hides idle capsule when auto-hide is enabled', () => {
    expect(
      getCapsuleVisibility({
        capsuleAutoHide: true,
        contextMenuOpen: false,
        capsuleExpanded: false,
        hasError: false,
        pipelineState: 'idle',
      }),
    ).toBe(false)
  })

  it('shows idle capsule when an error appears', () => {
    expect(
      getCapsuleVisibility({
        capsuleAutoHide: true,
        contextMenuOpen: false,
        capsuleExpanded: false,
        hasError: true,
        pipelineState: 'idle',
      }),
    ).toBe(true)
  })

  it('shows active capsule while recording', () => {
    expect(
      getCapsuleVisibility({
        capsuleAutoHide: true,
        contextMenuOpen: false,
        capsuleExpanded: false,
        hasError: false,
        pipelineState: 'recording',
      }),
    ).toBe(true)
  })

  it('keeps capsule visible while preparing even when auto-hide is enabled', () => {
    expect(
      getCapsuleVisibility({
        capsuleAutoHide: true,
        contextMenuOpen: false,
        capsuleExpanded: false,
        hasError: false,
        pipelineState: 'preparing',
      }),
    ).toBe(true)
  })

  it('keeps capsule visible while Ask is recording', () => {
    expect(
      getCapsuleVisibility({
        capsuleAutoHide: true,
        contextMenuOpen: false,
        capsuleExpanded: false,
        hasError: false,
        pipelineState: 'ask_recording',
      }),
    ).toBe(true)
  })

  it('shows idle capsule while the context menu is open', () => {
    expect(
      getCapsuleVisibility({
        capsuleAutoHide: true,
        contextMenuOpen: true,
        capsuleExpanded: false,
        hasError: false,
        pipelineState: 'idle',
      }),
    ).toBe(true)
  })

  it('keeps the capsule overlay from stealing keyboard output focus', () => {
    expect(getCapsuleFocusable()).toBe(false)
  })

  it('re-enters the topmost window band when transcription is active', async () => {
    const setAlwaysOnTop = vi.fn().mockResolvedValue(undefined)

    await keepCapsuleOnTop({ setAlwaysOnTop }, true)

    expect(setAlwaysOnTop.mock.calls).toEqual([[false], [true]])
  })

  it('keeps an idle visible capsule topmost without forcing a z-order jump', async () => {
    const setAlwaysOnTop = vi.fn().mockResolvedValue(undefined)

    await keepCapsuleOnTop({ setAlwaysOnTop }, false)

    expect(setAlwaysOnTop.mock.calls).toEqual([[true]])
  })

  it('makes room for the in-context movement guide without changing menu sizes', () => {
    expect(getCapsuleContentSize('recording', false, false, false, false, true)).toEqual({
      width: 440,
      height: 64,
    })
    expect(getCapsuleContentSize('recording', false, false, true, false, true)).toEqual({
      width: 220,
      height: 220,
    })
  })
})
