import { useEffect } from 'react'
import i18n from '../i18n'
import { useTheme } from '../hooks/useTheme'
import { getConfig } from '../lib/tauri'
import { useAppStore } from '../stores/appStore'
import { AskPanel } from '../components/AskPanel'
import { ToastContainer } from '../components/Toast'

export default function AskApp() {
  useTheme()
  const setConfig = useAppStore((state) => state.setConfig)

  useEffect(() => {
    getConfig()
      .then((config) => {
        setConfig(config)
        if (config.ui_language && config.ui_language !== i18n.language) {
          i18n.changeLanguage(config.ui_language)
          localStorage.setItem('ui_language', config.ui_language)
        }
      })
      .catch((error) => {
        console.error('Failed to load config in Ask app:', error)
      })
  }, [setConfig])

  return (
    <>
      <AskPanel />
      <ToastContainer />
    </>
  )
}
