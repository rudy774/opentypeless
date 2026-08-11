import i18n, { type BackendModule, type ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'

const supportedLanguages = ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it'] as const
const localeLoaders: Record<string, () => Promise<{ default: object }>> = {
  zh: () => import('./locales/zh.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  pt: () => import('./locales/pt.json'),
  ru: () => import('./locales/ru.json'),
  it: () => import('./locales/it.json'),
}

const lazyLocaleBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const loader = localeLoaders[language]
    if (!loader) {
      callback(new Error(`Unsupported UI language: ${language}`), false)
      return
    }
    loader()
      .then((module) => callback(null, module.default as ResourceKey))
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error)), false),
      )
  },
}

const storedLanguage =
  typeof localStorage !== 'undefined' ? localStorage.getItem('ui_language') : null
const savedLang = supportedLanguages.includes(
  (storedLanguage ?? 'en') as (typeof supportedLanguages)[number],
)
  ? storedLanguage || 'en'
  : 'en'

i18n
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    lng: savedLang,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    interpolation: { escapeValue: false },
  })

export default i18n
