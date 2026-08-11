import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeCapsuleMoveGuide,
  loadCapsuleAnchor,
  loadCapsuleMoveGuidePending,
  queueCapsuleMoveGuide,
  saveCurrentCapsuleAnchor,
} from '../capsulePreferences'

const storeState = vi.hoisted(() => new Map<string, unknown>())
const storeSave = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const outerPosition = vi.hoisted(() => vi.fn().mockResolvedValue({ x: 320, y: 540 }))
const outerSize = vi.hoisted(() => vi.fn().mockResolvedValue({ width: 224, height: 60 }))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn((key: string) => Promise.resolve(storeState.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      storeState.set(key, value)
      return Promise.resolve()
    }),
    save: storeSave,
  }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ outerPosition, outerSize }),
}))

describe('capsule preferences', () => {
  beforeEach(() => {
    storeState.clear()
    storeSave.mockClear()
    outerPosition.mockClear()
    outerSize.mockClear()
  })

  it('queues and completes the first-use movement guide', async () => {
    expect(await loadCapsuleMoveGuidePending()).toBe(false)

    await queueCapsuleMoveGuide()
    expect(await loadCapsuleMoveGuidePending()).toBe(true)

    await completeCapsuleMoveGuide()
    expect(await loadCapsuleMoveGuidePending()).toBe(false)
    expect(storeSave).toHaveBeenCalledTimes(2)
  })

  it('ignores malformed saved anchors', async () => {
    storeState.set('capsule_anchor_v1', { left: 'not-a-number', centerY: 300 })

    expect(await loadCapsuleAnchor()).toBeNull()
  })

  it('captures the capsule center after a native drag', async () => {
    await saveCurrentCapsuleAnchor()

    expect(await loadCapsuleAnchor()).toEqual({ left: 320, centerY: 570 })
    expect(storeSave).toHaveBeenCalledTimes(1)
  })
})
