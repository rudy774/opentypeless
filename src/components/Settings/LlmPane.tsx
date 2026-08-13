import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/appStore'
import type { PolishStyle } from '../../stores/appStore'
import { hasManagedCloudAccess, useAuthStore } from '../../stores/authStore'
import {
  LLM_PROVIDERS,
  LLM_DEFAULT_CONFIG,
  MANAGED_SERVICE_CONFIGURED,
  llmProviderRequiresApiKey,
} from '../../lib/constants'
import {
  benchLlmConnection,
  fetchLlmModels,
  getLatestMappingCandidate,
  listCustomAppMappings,
  readCredential,
  setCredential,
} from '../../lib/tauri'
import type { CustomAppMappingView, MappingCandidateView } from '../../lib/tauri'
import { FormField } from './shared/FormField'
import { Toggle } from './shared/Toggle'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Crown,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react'
import { AppLogo } from '../AppLogo'
import { ContextAdaptationApps } from './ContextAdaptationApps'
import { TranslationTargets } from './TranslationTargets'
import { AppStyleMappingDialog } from './AppStyleMappingDialog'
import { ManageAppMappingsDialog } from './ManageAppMappingsDialog'

export function LlmPane() {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const llmTestStatus = useAppStore((s) => s.llmTestStatus)
  const setLlmTestStatus = useAppStore((s) => s.setLlmTestStatus)
  const llmLatencyMs = useAppStore((s) => s.llmLatencyMs)
  const setLlmLatencyMs = useAppStore((s) => s.setLlmLatencyMs)
  const lastContext = useAppStore((s) => s.lastContext)
  const { user } = useAuthStore()
  const hasCloudAccess = useAuthStore(hasManagedCloudAccess)
  const { t } = useTranslation()

  const hadUnavailableCloudProvider = !MANAGED_SERVICE_CONFIGURED && config.llm_provider === 'cloud'
  const llmProvider = (
    hadUnavailableCloudProvider ? 'openrouter' : config.llm_provider
  ) as typeof config.llm_provider
  const llmBaseUrl = hadUnavailableCloudProvider
    ? LLM_DEFAULT_CONFIG.openrouter.baseUrl
    : config.llm_base_url
  const llmModel = hadUnavailableCloudProvider
    ? LLM_DEFAULT_CONFIG.openrouter.model
    : config.llm_model
  const isCloud = MANAGED_SERVICE_CONFIGURED && llmProvider === 'cloud'
  const requiresApiKey = llmProviderRequiresApiKey(llmProvider)
  const visibleLlmProviders = LLM_PROVIDERS.filter(
    (provider) => provider.value !== 'cloud' || MANAGED_SERVICE_CONFIGURED,
  )
  const polishPromptLength = config.polish_custom_prompt.length
  const hasCustomPolishConfig = config.polish_custom_prompt.trim().length > 0
  const goUpgrade = () => {
    window.location.hash = '#/upgrade'
  }

  const models = useAppStore((s) => s.llmModels)
  const setModels = useAppStore((s) => s.setLlmModels)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testErrorMessage, setTestErrorMessage] = useState<string | null>(null)
  const [credentialErrorMessage, setCredentialErrorMessage] = useState<string | null>(null)
  const [polishAdvancedOpen, setPolishAdvancedOpen] = useState(hasCustomPolishConfig)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const credentialSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [llmApiKey, setLlmApiKey] = useState(config.llm_api_key)
  const [mappingCandidate, setMappingCandidate] = useState<MappingCandidateView | null>(null)
  const [appMappings, setAppMappings] = useState<CustomAppMappingView[]>([])
  const [appStyleMenuOpen, setAppStyleMenuOpen] = useState(false)
  const [appStyleDialogOpen, setAppStyleDialogOpen] = useState(false)
  const [manageMappingsOpen, setManageMappingsOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<CustomAppMappingView | null>(null)
  const appStyleMenuButtonRef = useRef<HTMLButtonElement>(null)
  const showBrowserAccessHint = Boolean(
    config.polish_enabled &&
    config.context_adaptation_enabled &&
    lastContext?.profileId === 'general.browser' &&
    lastContext.browserAccessStatus === 'needs_permission',
  )

  const refreshAppMappings = useCallback(async () => {
    const [candidate, mappings] = await Promise.all([
      getLatestMappingCandidate(),
      listCustomAppMappings(),
    ])
    setMappingCandidate(candidate)
    setAppMappings(mappings)
  }, [])

  useEffect(() => {
    if (MANAGED_SERVICE_CONFIGURED || config.llm_provider !== 'cloud') return
    const defaults = LLM_DEFAULT_CONFIG.openrouter
    updateConfig({
      llm_provider: 'openrouter',
      llm_base_url: defaults.baseUrl,
      llm_model: defaults.model,
    })
    setLlmTestStatus('idle')
    setLlmLatencyMs(null)
    setModels([])
    setTestErrorMessage(null)
  }, [config.llm_provider, setLlmLatencyMs, setLlmTestStatus, setModels, updateConfig])

  useEffect(() => {
    if (!lastContext) {
      setMappingCandidate(null)
      setAppMappings([])
      return
    }
    let cancelled = false
    Promise.all([getLatestMappingCandidate(), listCustomAppMappings()])
      .then(([candidate, mappings]) => {
        if (cancelled) return
        setMappingCandidate(candidate)
        setAppMappings(mappings)
      })
      .catch(() => {
        if (cancelled) return
        setMappingCandidate(null)
        setAppMappings([])
      })
    return () => {
      cancelled = true
    }
  }, [lastContext])

  const closeAppStyleMenu = useCallback((restoreFocus = false) => {
    setAppStyleMenuOpen(false)
    if (restoreFocus) requestAnimationFrame(() => appStyleMenuButtonRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!appStyleMenuOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeAppStyleMenu(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [appStyleMenuOpen, closeAppStyleMenu])

  useEffect(() => {
    if (hasCustomPolishConfig) setPolishAdvancedOpen(true)
  }, [hasCustomPolishConfig])

  useEffect(() => {
    if (isCloud || !requiresApiKey) {
      setLlmApiKey('')
      setCredentialErrorMessage(null)
      return
    }

    let cancelled = false
    const legacyApiKey = config.llm_api_key
    setLlmApiKey(legacyApiKey)
    setCredentialErrorMessage(null)
    readCredential('llm', llmProvider)
      .then((secret) => {
        if (!cancelled) setLlmApiKey(legacyApiKey || secret || '')
      })
      .catch((error) => console.error('[credentials] failed to read LLM credential', error))

    return () => {
      cancelled = true
    }
  }, [config.llm_api_key, isCloud, llmProvider, requiresApiKey])

  const persistLlmCredential = useCallback(
    (value: string, delayMs = 350) => {
      if (isCloud || !requiresApiKey) return
      if (credentialSaveRef.current) clearTimeout(credentialSaveRef.current)
      credentialSaveRef.current = setTimeout(() => {
        credentialSaveRef.current = null
        setCredential('llm', llmProvider, value)
          .then(() => setCredentialErrorMessage(null))
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            setCredentialErrorMessage(message)
            console.error('[credentials] failed to save LLM credential', error)
          })
      }, delayMs)
    },
    [isCloud, llmProvider, requiresApiKey],
  )

  const doFetchModels = useCallback(
    async (apiKey: string, provider: string, baseUrl: string) => {
      if (!baseUrl) return
      setFetchingModels(true)
      try {
        const list = await fetchLlmModels(apiKey, provider, baseUrl)
        setModels(list)
      } catch {
        // Do not clear existing cache on failure — avoids infinite retry loop
        // (clearing would re-trigger the useEffect that checks models.length > 0)
      } finally {
        setFetchingModels(false)
      }
    },
    [setModels],
  )

  // Auto-fetch when API key or base URL changes (debounced); skips if models already cached
  useEffect(() => {
    if (isCloud) return
    if ((requiresApiKey && !llmApiKey) || !llmBaseUrl) return
    if (models.length > 0) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doFetchModels(llmApiKey, llmProvider, llmBaseUrl)
    }, 500)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [llmBaseUrl, llmProvider, doFetchModels, isCloud, llmApiKey, models.length, requiresApiKey])

  const handleTest = async () => {
    setLlmTestStatus('testing')
    setLlmLatencyMs(null)
    setTestErrorMessage(null)
    try {
      const ms = await benchLlmConnection(llmApiKey, llmProvider, llmBaseUrl, llmModel)
      console.log('[LLM Test] Received latency:', ms, 'type:', typeof ms)
      setLlmLatencyMs(ms)
      setLlmTestStatus('success')
    } catch (err) {
      console.error('[LLM Test] Error:', err)
      setTestErrorMessage(err instanceof Error ? err.message : typeof err === 'string' ? err : null)
      setLlmTestStatus('error')
    }
  }

  const renderConnectionFeedback = (includeCredentialStatus: boolean) => (
    <>
      {llmTestStatus === 'success' && (
        <p className="flex items-center gap-1 text-[12px] text-success mt-2">
          <CheckCircle2 size={13} />{' '}
          {llmLatencyMs !== null ? `${llmLatencyMs}ms` : t('settings.connectionSuccess')}
        </p>
      )}
      {(llmTestStatus === 'error' || testErrorMessage) && (
        <div className="flex items-start gap-1 text-[12px] text-error mt-2">
          <XCircle size={13} className="mt-[1px] flex-shrink-0" />
          <span>{testErrorMessage || t('settings.connectionFailed')}</span>
        </div>
      )}
      {includeCredentialStatus &&
        (credentialErrorMessage ? (
          <p className="text-[12px] text-error mt-1.5">
            {t('settings.credentialSaveFailed', { details: credentialErrorMessage })}
          </p>
        ) : (
          <p className="text-[12px] text-text-tertiary mt-1.5">{t('settings.storedLocally')}</p>
        ))}
    </>
  )

  return (
    <div className="space-y-4">
      <FormField label={t('settings.provider')}>
        <select
          value={llmProvider}
          onChange={(e) => {
            const provider = e.target.value as typeof config.llm_provider
            const defaults = LLM_DEFAULT_CONFIG[provider]
            updateConfig({
              llm_provider: provider,
              llm_base_url: defaults?.baseUrl ?? llmBaseUrl,
              llm_model: defaults?.model ?? llmModel,
            })
            setLlmTestStatus('idle')
            setLlmLatencyMs(null)
            setModels([])
            setTestErrorMessage(null)
          }}
          className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
        >
          {visibleLlmProviders.map((p) => (
            <option key={p.value} value={p.value}>
              {t(p.labelKey)}
            </option>
          ))}
        </select>
      </FormField>

      {!MANAGED_SERVICE_CONFIGURED && (
        <div
          role="note"
          className="rounded-[10px] border border-border bg-bg-secondary/45 px-3 py-3 text-[12px] leading-5 text-text-secondary"
        >
          {t('settings.managedServiceUnavailableByok')}
        </div>
      )}

      {isCloud && (
        <div className="border border-border rounded-[10px] px-3 py-3 space-y-2">
          <div className="flex items-center gap-2 text-[13px]">
            <Crown size={14} className="text-accent" />
            <span className="text-text-primary font-medium">{t('settings.cloudLlmPro')}</span>
          </div>
          {!user ? (
            <p className="text-[12px] text-text-secondary">{t('settings.llmSignInHint')}</p>
          ) : !hasCloudAccess ? (
            <div className="space-y-2">
              <p className="text-[12px] text-text-secondary">{t('settings.llmUpgradeHint')}</p>
              <button
                type="button"
                onClick={goUpgrade}
                className="rounded-[8px] border border-accent bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent hover:bg-accent-hover"
              >
                {t('nav.upgrade')}
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-green-500">{t('settings.llmProActive')}</p>
          )}
        </div>
      )}

      {!isCloud && (
        <>
          {requiresApiKey && (
            <FormField label={t('settings.apiKey')}>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => {
                    setLlmApiKey(e.target.value)
                    persistLlmCredential(e.target.value)
                    setLlmTestStatus('idle')
                    setLlmLatencyMs(null)
                    setTestErrorMessage(null)
                    setCredentialErrorMessage(null)
                  }}
                  onBlur={() => persistLlmCredential(llmApiKey, 0)}
                  placeholder={t('settings.enterApiKey')}
                  className="flex-1 px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
                />
                <button
                  onClick={handleTest}
                  disabled={!llmApiKey || llmTestStatus === 'testing'}
                  className="px-4 py-2.5 bg-accent text-on-accent rounded-[10px] text-[13px] border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                >
                  {llmTestStatus === 'testing' && <Loader2 size={14} className="animate-spin" />}
                  {t('settings.test')}
                </button>
              </div>
              {renderConnectionFeedback(true)}
            </FormField>
          )}

          <FormField label={t('settings.model')}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  list="llm-model-list"
                  value={llmModel}
                  onChange={(e) => {
                    updateConfig({ llm_model: e.target.value })
                    setLlmLatencyMs(null)
                    setTestErrorMessage(null)
                  }}
                  placeholder={t('settings.llmModelPlaceholder')}
                  className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
                />
                <datalist id="llm-model-list">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <button
                onClick={() => doFetchModels(llmApiKey, llmProvider, llmBaseUrl)}
                disabled={fetchingModels || !llmBaseUrl || (requiresApiKey && !llmApiKey)}
                className="px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-secondary cursor-pointer hover:border-border-focus disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                title={t('settings.fetchModels')}
              >
                <RefreshCw size={14} className={fetchingModels ? 'animate-spin' : ''} />
              </button>
            </div>
            {models.length > 0 && (
              <p className="text-[12px] text-text-tertiary mt-1">
                {t('settings.modelsAvailable', { count: models.length })}
              </p>
            )}
          </FormField>

          <FormField label={t('settings.baseUrl')}>
            <div className="flex gap-2">
              <input
                value={llmBaseUrl}
                onChange={(e) => {
                  updateConfig({ llm_base_url: e.target.value })
                  setLlmTestStatus('idle')
                  setLlmLatencyMs(null)
                  setTestErrorMessage(null)
                }}
                placeholder={
                  LLM_DEFAULT_CONFIG[llmProvider]?.baseUrl ?? 'https://api.openai.com/v1'
                }
                className="min-w-0 flex-1 px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
              />
              {!requiresApiKey && (
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!llmBaseUrl || llmTestStatus === 'testing'}
                  className="px-4 py-2.5 bg-accent text-on-accent rounded-[10px] text-[13px] border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                >
                  {llmTestStatus === 'testing' && <Loader2 size={14} className="animate-spin" />}
                  {t('settings.test')}
                </button>
              )}
            </div>
            {!requiresApiKey && renderConnectionFeedback(false)}
          </FormField>
        </>
      )}

      <div className="space-y-3 pt-1">
        <div>
          <Toggle
            checked={config.polish_enabled}
            onChange={(checked) => updateConfig({ polish_enabled: checked })}
            label={t('settings.enableAiPolish')}
          />
        </div>
        <div>
          <Toggle
            checked={config.context_adaptation_enabled}
            disabled={!config.polish_enabled}
            onChange={(checked) => updateConfig({ context_adaptation_enabled: checked })}
            label={t('settings.contextAdaptation')}
          />
          <ContextAdaptationApps
            disabled={!config.polish_enabled || !config.context_adaptation_enabled}
          />
          {lastContext && (
            <div className="mt-2 ml-[52px] min-w-0">
              <p className="text-[12px] leading-relaxed text-text-tertiary">
                {t('settings.lastDictationContext')}
              </p>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-text-secondary">
                <AppLogo iconKey={lastContext.iconKey} family={lastContext.family} />
                <span className="min-w-0 truncate">{lastContext.appLabel}</span>
                {(mappingCandidate || appMappings.length > 0) && (
                  <div className="relative ml-auto flex-none">
                    <button
                      ref={appStyleMenuButtonRef}
                      type="button"
                      aria-label={t('settings.appStyleMenu')}
                      title={t('settings.appStyleMenu')}
                      aria-expanded={appStyleMenuOpen}
                      onClick={() => setAppStyleMenuOpen((open) => !open)}
                      className="grid h-7 w-7 place-items-center rounded-[6px] border-none bg-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {appStyleMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => closeAppStyleMenu(true)}
                        />
                        <div className="absolute right-0 top-8 z-40 min-w-[210px] rounded-[8px] border border-border bg-bg-primary py-1 shadow-float">
                          {mappingCandidate && (
                            <button
                              type="button"
                              onClick={() => {
                                closeAppStyleMenu()
                                setEditingMapping(null)
                                setAppStyleDialogOpen(true)
                              }}
                              className="block w-full px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                            >
                              {t('settings.useDifferentWritingStyle')}
                            </button>
                          )}
                          {appMappings.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                closeAppStyleMenu()
                                setManageMappingsOpen(true)
                              }}
                              className="block w-full px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                            >
                              {t('settings.manageAppMappings')}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {showBrowserAccessHint && (
                <p className="mt-1 text-[12px] leading-relaxed text-amber-600">
                  {t('settings.browserAccessHint')}
                </p>
              )}
            </div>
          )}
        </div>
        <div>
          <Toggle
            checked={config.translate_enabled}
            onChange={(checked) => updateConfig({ translate_enabled: checked })}
            label={t('settings.translationMode')}
          />
          {config.translate_enabled && (
            <div className="mt-2 ml-[52px] min-w-0">
              <TranslationTargets
                value={config.translation}
                onChange={(translation) => updateConfig({ translation })}
              />
            </div>
          )}
        </div>
      </div>

      {config.polish_enabled && (
        <FormField label={t('settings.polishStyle')}>
          <select
            value={config.polish_style}
            onChange={(e) => updateConfig({ polish_style: e.target.value as PolishStyle })}
            className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
          >
            <option value="minimal">{t('settings.polishStyleMinimal')}</option>
            <option value="clean">{t('settings.polishStyleClean')}</option>
            <option value="structured">{t('settings.polishStyleStructured')}</option>
            <option value="professional">{t('settings.polishStyleProfessional')}</option>
          </select>
        </FormField>
      )}

      <div>
        <button
          type="button"
          aria-expanded={polishAdvancedOpen}
          onClick={() => setPolishAdvancedOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-[10px] border border-border bg-bg-secondary/40 px-3 py-2 text-left text-[13px] font-medium text-text-primary transition-colors hover:border-border-focus"
        >
          <span>{t('settings.advancedPolishSettings')}</span>
          <ChevronDown
            size={14}
            className={`text-text-tertiary transition-transform ${
              polishAdvancedOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {polishAdvancedOpen && (
          <div className="mt-3 space-y-3">
            <div>
              <Toggle
                checked={config.selected_text_enabled}
                onChange={(checked) => updateConfig({ selected_text_enabled: checked })}
                label={t('settings.selectedTextContext')}
              />
              <p className="mt-1 ml-[52px] text-[12px] leading-relaxed text-text-tertiary">
                {t('settings.selectedTextContextDesc')}
              </p>
            </div>

            {config.polish_enabled && (
              <FormField label={t('settings.customPolishInstructions')}>
                <textarea
                  value={config.polish_custom_prompt}
                  onChange={(e) => updateConfig({ polish_custom_prompt: e.target.value })}
                  maxLength={2000}
                  rows={4}
                  placeholder={t('settings.customPolishInstructionsPlaceholder')}
                  className="w-full resize-y px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
                />
                <p className="text-[12px] text-text-tertiary mt-1.5">
                  {t('settings.customPolishInstructionsCount', { count: polishPromptLength })}
                </p>
              </FormField>
            )}
          </div>
        )}
      </div>

      {appStyleDialogOpen && lastContext && (
        <AppStyleMappingDialog
          candidate={editingMapping ? null : mappingCandidate}
          mapping={editingMapping}
          context={lastContext}
          config={config}
          onCancel={() => {
            setAppStyleDialogOpen(false)
            setEditingMapping(null)
          }}
          onSaved={async () => {
            await refreshAppMappings()
            setAppStyleDialogOpen(false)
            setEditingMapping(null)
          }}
        />
      )}

      {manageMappingsOpen && (
        <ManageAppMappingsDialog
          mappings={appMappings}
          onCancel={() => setManageMappingsOpen(false)}
          onChanged={refreshAppMappings}
          onEdit={(mapping) => {
            setManageMappingsOpen(false)
            setEditingMapping(mapping)
            setAppStyleDialogOpen(true)
          }}
        />
      )}
    </div>
  )
}
