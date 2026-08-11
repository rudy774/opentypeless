import { lazy, Suspense, useEffect } from 'react'
import i18n from './i18n'
import { useTauriEvents } from './hooks/useTauriEvents'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/appStore'
import { getConfig } from './lib/tauri'

const Capsule = lazy(() =>
  import('./components/Capsule').then((module) => ({ default: module.Capsule })),
)
const AskApp = lazy(() => import('./windows/AskApp'))
const MainApp = lazy(() => import('./windows/MainApp'))

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <span className="text-text-tertiary text-[13px]">Loading...</span>
    </div>
  )
}

function CapsuleApp() {
  useTauriEvents()
  useTheme()

  const setConfig = useAppStore((state) => state.setConfig)

  useEffect(() => {
    // Load config so DurationTimer gets the correct max_recording_seconds.
    getConfig()
      .then((config) => {
        setConfig(config)
        if (config.ui_language && config.ui_language !== i18n.language) {
          i18n.changeLanguage(config.ui_language)
          localStorage.setItem('ui_language', config.ui_language)
        }
      })
      .catch((error) => {
        console.error('Failed to load config in capsule:', error)
      })
  }, [setConfig])

  // Keep the event hooks mounted while the visual capsule chunk loads so a
  // hotkey pressed immediately after startup cannot lose a pipeline event.
  return (
    <Suspense fallback={null}>
      <Capsule />
    </Suspense>
  )
}

function App() {
  if (window.location.hash === '#capsule') return <CapsuleApp />
  if (window.location.hash === '#ask') {
    return (
      <Suspense fallback={null}>
        <AskApp />
      </Suspense>
    )
  }
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MainApp />
    </Suspense>
  )
}

export default App
