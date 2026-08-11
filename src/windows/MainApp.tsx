import { lazy, Suspense, useEffect, useState } from 'react'
import i18n from '../i18n'
import { useTauriEvents } from '../hooks/useTauriEvents'
import { useTheme } from '../hooks/useTheme'
import { useAppStore } from '../stores/appStore'
import { useAuthStore } from '../stores/authStore'
import { useRoute } from '../lib/router'
import {
  loadOnboardingCompleted,
  getConfig,
  getHistory,
  getDictionary,
  getCorrectionRules,
  checkAccessibilityPermission,
  getPlatformCapabilities,
  getHotkeyRegistrationError,
} from '../lib/tauri'
import { initDeepLinkListener } from '../lib/deep-link'
import { MainLayout } from '../components/MainLayout'

const Onboarding = lazy(() =>
  import('../components/Onboarding').then((module) => ({ default: module.Onboarding })),
)
const HomePage = lazy(() =>
  import('../components/HomePage').then((module) => ({ default: module.HomePage })),
)
const Settings = lazy(() =>
  import('../components/Settings').then((module) => ({ default: module.Settings })),
)
const History = lazy(() =>
  import('../components/History').then((module) => ({ default: module.History })),
)
const UpgradePage = lazy(() =>
  import('../components/UpgradePage').then((module) => ({ default: module.UpgradePage })),
)
const AccountPage = lazy(() =>
  import('../components/AccountPage').then((module) => ({ default: module.AccountPage })),
)
const ToastContainer = lazy(() =>
  import('../components/Toast').then((module) => ({ default: module.ToastContainer })),
)

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <span className="text-text-tertiary text-[13px]">Loading...</span>
    </div>
  )
}

export default function MainApp() {
  useTauriEvents()
  useTheme()

  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted)
  const setOnboardingCompleted = useAppStore((state) => state.setOnboardingCompleted)
  const setConfig = useAppStore((state) => state.setConfig)
  const setSavedConfig = useAppStore((state) => state.setSavedConfig)
  const setHistory = useAppStore((state) => state.setHistory)
  const setDictionary = useAppStore((state) => state.setDictionary)
  const setCorrectionRules = useAppStore((state) => state.setCorrectionRules)
  const setAccessibilityTrusted = useAppStore((state) => state.setAccessibilityTrusted)
  const setPlatformCapabilities = useAppStore((state) => state.setPlatformCapabilities)
  const setHotkeyRegistrationError = useAppStore((state) => state.setHotkeyRegistrationError)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const { route } = useRoute()

  useEffect(() => {
    loadOnboardingCompleted().then(async (done) => {
      setOnboardingCompleted(done)
      if (done) {
        try {
          const [
            config,
            history,
            dictionary,
            correctionRules,
            platformCapabilities,
            hotkeyRegistrationError,
          ] = await Promise.all([
            getConfig(),
            getHistory(200, 0),
            getDictionary(),
            getCorrectionRules(),
            getPlatformCapabilities(),
            getHotkeyRegistrationError(),
          ])
          setConfig(config)
          setSavedConfig(config)
          setHistory(history)
          setDictionary(dictionary)
          setCorrectionRules(correctionRules)
          setPlatformCapabilities(platformCapabilities)
          setHotkeyRegistrationError(hotkeyRegistrationError)
          if (navigator.platform.toUpperCase().indexOf('MAC') >= 0) {
            checkAccessibilityPermission().then((trusted) => {
              setAccessibilityTrusted(trusted)
            })
          }
          if (config.ui_language && config.ui_language !== i18n.language) {
            i18n.changeLanguage(config.ui_language)
            localStorage.setItem('ui_language', config.ui_language)
          }
        } catch (error) {
          console.error('Failed to load initial data:', error)
          setLoadError(true)
        }
      }
      setLoaded(true)
    })

    useAuthStore.getState().initialize()
    initDeepLinkListener()
  }, [
    setOnboardingCompleted,
    setConfig,
    setSavedConfig,
    setHistory,
    setDictionary,
    setCorrectionRules,
    setAccessibilityTrusted,
    setPlatformCapabilities,
    setHotkeyRegistrationError,
  ])

  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    if (!loaded || !user) return

    let lastRefresh = 0
    const throttledRefresh = () => {
      const now = Date.now()
      const { checkoutPending } = useAuthStore.getState()
      if (!checkoutPending && now - lastRefresh < 30_000) return
      lastRefresh = now
      useAuthStore.getState().refreshSubscription()
    }

    const interval = setInterval(
      () => {
        lastRefresh = Date.now()
        useAuthStore.getState().refreshSubscription()
      },
      5 * 60 * 1000,
    )

    window.addEventListener('focus', throttledRefresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', throttledRefresh)
    }
  }, [loaded, user])

  if (!loaded) return <LoadingScreen />
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <span className="text-error text-[13px]">Failed to load application data.</span>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-accent text-white rounded-[10px] text-[13px] border-none cursor-pointer hover:bg-accent-hover transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }
  if (!onboardingCompleted) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Onboarding />
      </Suspense>
    )
  }

  return (
    <MainLayout>
      <Suspense fallback={<LoadingScreen />}>
        {route === 'home' && <HomePage />}
        {route === 'settings' && <Settings />}
        {route === 'history' && <History />}
        {route === 'upgrade' && <UpgradePage />}
        {route === 'account' && <AccountPage />}
      </Suspense>
      <Suspense fallback={null}>
        <ToastContainer />
      </Suspense>
    </MainLayout>
  )
}
