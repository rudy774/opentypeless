const STORE_PATH = 'settings.json'
const MOVE_GUIDE_PENDING_KEY = 'capsule_move_guide_pending_v1'
const CAPSULE_ANCHOR_KEY = 'capsule_anchor_v1'

export interface CapsuleAnchor {
  /** Physical x-coordinate of the capsule window's left edge. */
  left: number
  /** Physical y-coordinate of the capsule window's vertical center. */
  centerY: number
}

function isCapsuleAnchor(value: unknown): value is CapsuleAnchor {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CapsuleAnchor>
  return Number.isFinite(candidate.left) && Number.isFinite(candidate.centerY)
}

async function loadSettingsStore() {
  const { load } = await import('@tauri-apps/plugin-store')
  return load(STORE_PATH)
}

/** Queue the in-context movement lesson for a user who just finished setup. */
export async function queueCapsuleMoveGuide(): Promise<void> {
  try {
    const store = await loadSettingsStore()
    await store.set(MOVE_GUIDE_PENDING_KEY, true)
    await store.save()
  } catch (error) {
    console.error('Failed to queue capsule movement guide:', error)
  }
}

export async function loadCapsuleMoveGuidePending(): Promise<boolean> {
  try {
    const store = await loadSettingsStore()
    return (await store.get<boolean>(MOVE_GUIDE_PENDING_KEY)) === true
  } catch (error) {
    console.error('Failed to load capsule movement guide state:', error)
    return false
  }
}

export async function completeCapsuleMoveGuide(): Promise<void> {
  try {
    const store = await loadSettingsStore()
    await store.set(MOVE_GUIDE_PENDING_KEY, false)
    await store.save()
  } catch (error) {
    console.error('Failed to complete capsule movement guide:', error)
  }
}

export async function loadCapsuleAnchor(): Promise<CapsuleAnchor | null> {
  try {
    const store = await loadSettingsStore()
    const value = await store.get<unknown>(CAPSULE_ANCHOR_KEY)
    return isCapsuleAnchor(value) ? value : null
  } catch (error) {
    console.error('Failed to load capsule position:', error)
    return null
  }
}

export async function saveCapsuleAnchor(anchor: CapsuleAnchor): Promise<void> {
  if (!isCapsuleAnchor(anchor)) return

  try {
    const store = await loadSettingsStore()
    await store.set(CAPSULE_ANCHOR_KEY, anchor)
    await store.save()
  } catch (error) {
    console.error('Failed to save capsule position:', error)
  }
}

/** Capture the capsule's current anchor after a native window drag finishes. */
export async function saveCurrentCapsuleAnchor(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow()
    const [position, size] = await Promise.all([window.outerPosition(), window.outerSize()])
    await saveCapsuleAnchor({
      left: Math.round(position.x),
      centerY: Math.round(position.y + size.height / 2),
    })
  } catch (error) {
    console.error('Failed to capture capsule position:', error)
  }
}
