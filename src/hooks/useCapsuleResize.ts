import { useEffect, useRef } from 'react'
import { useAppStore, type PipelineState } from '../stores/appStore'
import { loadCapsuleAnchor } from '../lib/capsulePreferences'

interface CapsuleSize {
  width: number
  height: number
}

export interface CapsuleVisibilityInput {
  capsuleAutoHide: boolean
  contextMenuOpen: boolean
  translationTargetMenuOpen?: boolean
  capsuleExpanded: boolean
  hasError: boolean
  pipelineState: PipelineState
}

export function getCapsuleVisibility({
  capsuleAutoHide,
  contextMenuOpen,
  translationTargetMenuOpen = false,
  capsuleExpanded,
  hasError,
  pipelineState,
}: CapsuleVisibilityInput): boolean {
  return (
    !capsuleAutoHide ||
    contextMenuOpen ||
    translationTargetMenuOpen ||
    capsuleExpanded ||
    hasError ||
    pipelineState !== 'idle'
  )
}

export function getCapsuleFocusable(): boolean {
  return false
}

interface CapsuleTopmostWindow {
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>
}

/**
 * Keep only the capsule in the topmost window band. Re-entering that band while
 * the pipeline is active moves it above other topmost windows without focusing it.
 */
export async function keepCapsuleOnTop(
  window: CapsuleTopmostWindow,
  refreshZOrder: boolean,
): Promise<void> {
  if (refreshZOrder) {
    await window.setAlwaysOnTop(false).catch(() => {})
  }
  await window.setAlwaysOnTop(true).catch(() => {})
}

export function getCapsuleContentSize(
  state: PipelineState,
  expanded: boolean,
  hasError: boolean,
  contextMenuOpen: boolean,
  translationTargetMenuOpen = false,
  moveGuideVisible = false,
): CapsuleSize {
  if (translationTargetMenuOpen) return { width: 360, height: 180 }
  if (contextMenuOpen) return { width: 220, height: 220 }
  if (moveGuideVisible) return { width: 440, height: 64 }
  if (hasError) return { width: 200, height: 36 }
  if (expanded) return { width: 220, height: 90 }
  switch (state) {
    case 'idle':
      return { width: 36, height: 36 }
    case 'preparing':
      return { width: 180, height: 36 }
    case 'recording':
    case 'transcribing':
    case 'polishing':
      return { width: 200, height: 36 }
    case 'outputting':
      return { width: 144, height: 36 }
    case 'ask_recording':
    case 'ask_thinking':
      return { width: 168, height: 36 }
    default:
      return { width: 36, height: 36 }
  }
}

export function useCapsuleResize(moveGuideVisible = false) {
  const pipelineState = useAppStore((s) => s.pipelineState)
  const capsuleExpanded = useAppStore((s) => s.capsuleExpanded)
  const pipelineError = useAppStore((s) => s.pipelineError)
  const contextMenuOpen = useAppStore((s) => s.contextMenuOpen)
  const translationTargetMenuOpen = useAppStore((s) => s.translationTargetMenuOpen)
  const setContextMenuReady = useAppStore((s) => s.setContextMenuReady)
  const capsuleAutoHide = useAppStore((s) => s.config.capsule_auto_hide)
  const initialized = useRef(false)
  const prevWindowSize = useRef<{ width: number; height: number } | null>(null)

  const hasError = pipelineError !== null

  useEffect(() => {
    const size = getCapsuleContentSize(
      pipelineState,
      capsuleExpanded,
      hasError,
      contextMenuOpen,
      translationTargetMenuOpen,
      moveGuideVisible,
    )
    const windowWidth = size.width + 24
    const windowHeight = size.height + 24
    const shouldShow = getCapsuleVisibility({
      capsuleAutoHide,
      contextMenuOpen,
      translationTargetMenuOpen,
      capsuleExpanded,
      hasError,
      pipelineState,
    })
    const shouldRefreshTopmost = pipelineState !== 'idle' || hasError

    Promise.all([import('@tauri-apps/api/window'), import('@tauri-apps/api/webview')])
      .then(
        async ([
          {
            getCurrentWindow,
            LogicalSize,
            LogicalPosition,
            PhysicalPosition,
            currentMonitor,
            monitorFromPoint,
          },
          webviewApi,
        ]) => {
          const win = getCurrentWindow()
          const webview = webviewApi.getCurrentWebview()
          await win.setFocusable(getCapsuleFocusable()).catch(() => {})
          // WebView2 can fill newly exposed pixels with its default black surface after
          // a transparent window grows. Set the webview layer itself to fully transparent
          // both before and after resizing so the rounded capsule has no rectangular halo.
          await webview.setBackgroundColor([0, 0, 0, 0]).catch(() => {})

          if (!initialized.current) {
            // First mount: restore the user's capsule anchor when possible.
            await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
            await webview.setBackgroundColor([0, 0, 0, 0]).catch(() => {})
            let restoredPosition = false
            try {
              const anchor = await loadCapsuleAnchor()
              if (anchor) {
                const savedMonitor = await monitorFromPoint(anchor.left, anchor.centerY)
                if (savedMonitor) {
                  const physicalHeight = windowHeight * savedMonitor.scaleFactor
                  await win
                    .setPosition(
                      new PhysicalPosition(
                        Math.round(anchor.left),
                        Math.round(anchor.centerY - physicalHeight / 2),
                      ),
                    )
                    .catch(() => {})
                  restoredPosition = true
                }
              }

              if (!restoredPosition) {
                const monitor = await currentMonitor()
                if (monitor) {
                  const physicalWidth = windowWidth * monitor.scaleFactor
                  const physicalHeight = windowHeight * monitor.scaleFactor
                  const x = Math.round(
                    monitor.workArea.position.x + (monitor.workArea.size.width - physicalWidth) / 2,
                  )
                  const y = Math.round(
                    monitor.workArea.position.y +
                      monitor.workArea.size.height -
                      physicalHeight -
                      80 * monitor.scaleFactor,
                  )
                  await win.setPosition(new PhysicalPosition(x, y)).catch(() => {})
                }
              }
            } catch {
              /* ignore – monitor info unavailable */
            }
            if (shouldShow) {
              await win.show().catch(() => {})
              await keepCapsuleOnTop(win, shouldRefreshTopmost)
            } else {
              await win.hide().catch(() => {})
            }
            initialized.current = true
            prevWindowSize.current = { width: windowWidth, height: windowHeight }
            return
          }

          // Subsequent resizes: left edge + vertical center stay fixed.
          // Since content is always padded 12px each side, the capsule at x=12
          // is identical to a centered capsule — so the mic icon never moves.
          const prev = prevWindowSize.current
          if (prev) {
            const pos = await win.outerPosition().catch(() => null)
            if (pos) {
              const monitor = await currentMonitor()
              const scale = monitor?.scaleFactor ?? 1
              const oldLeftX = pos.x / scale
              const oldCenterY = pos.y / scale + prev.height / 2
              const newX = Math.round(oldLeftX)
              const newY = Math.round(oldCenterY - windowHeight / 2)
              await win.setPosition(new LogicalPosition(newX, newY)).catch(() => {})
              await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
            } else {
              await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
            }
          } else {
            await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          }

          prevWindowSize.current = { width: windowWidth, height: windowHeight }
          await webview.setBackgroundColor([0, 0, 0, 0]).catch(() => {})

          // Signal that the window has finished resizing for context menu
          if (contextMenuOpen) {
            setContextMenuReady(true)
          }

          if (shouldShow) {
            await win.show().catch(() => {})
            await keepCapsuleOnTop(win, shouldRefreshTopmost)
          } else {
            await win.hide().catch(() => {})
          }
        },
      )
      .catch(() => {})
  }, [
    pipelineState,
    capsuleExpanded,
    hasError,
    contextMenuOpen,
    translationTargetMenuOpen,
    moveGuideVisible,
    capsuleAutoHide,
    setContextMenuReady,
  ])

  return getCapsuleContentSize(
    pipelineState,
    capsuleExpanded,
    hasError,
    contextMenuOpen,
    translationTargetMenuOpen,
    moveGuideVisible,
  )
}
