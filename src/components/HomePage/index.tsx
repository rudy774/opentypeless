import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  AlertCircle,
  ArrowRight,
  AudioLines,
  CircleCheck,
  Clipboard,
  Crown,
  Keyboard,
  Loader2,
  Mic2,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CUSTOM_WHISPER_PROVIDER, LLM_PROVIDERS, STT_PROVIDERS } from '../../lib/constants'
import { useAppStore } from '../../stores/appStore'
import { hasManagedCloudAccess, useAuthStore } from '../../stores/authStore'
import {
  getLocalActivityMetrics,
  getSttProviderDiagnostics,
  getSystemDiagnostics,
  type ActivityRangeMetrics,
  type LocalActivityMetricsSummary,
  type SttProviderDiagnostics,
  type SystemDiagnosticsReport,
} from '../../lib/tauri'
import {
  formatTranscriptionDuration,
  type TranscriptionTimeRange,
} from '../../lib/transcription-time'

const EMPTY_METRIC = '\u2014'

const EMPTY_ACTIVITY_RANGE: ActivityRangeMetrics = {
  recordingMs: 0,
  savedTranscriptions: 0,
  outputChars: 0,
  activeDays: 0,
  successfulAutomaticInsertions: 0,
  recordedFallbacks: 0,
  recordedFailures: 0,
  outputOutcomeSampleCount: 0,
  transformedOutputs: 0,
  validDurationSampleCount: 0,
  excludedDurationCount: 0,
  averageTotalMs: null,
  p50TotalMs: null,
  p95TotalMs: null,
  timingSampleCount: 0,
  excludedTimingCount: 0,
}

const EMPTY_ACTIVITY: LocalActivityMetricsSummary = {
  day: EMPTY_ACTIVITY_RANGE,
  week: EMPTY_ACTIVITY_RANGE,
  month: EMPTY_ACTIVITY_RANGE,
  totalRecordings: 0,
  validDurationSampleCount: 0,
  excludedDurationCount: 0,
}

const TIME_RANGE_KEYS: TranscriptionTimeRange[] = ['day', 'week', 'month']
const READINESS_FOCUS_REFRESH_MS = 60_000

type HomeReadiness =
  | { state: 'checking'; message: null }
  | { state: 'ready'; message: null }
  | { state: 'needsAttention'; message: string | null }

const CHECKING_READINESS: HomeReadiness = { state: 'checking', message: null }

function evaluateReadiness(
  system: SystemDiagnosticsReport,
  stt: SttProviderDiagnostics,
  hotkeyRegistrationError: string | null,
  managedCloudReady: boolean,
): HomeReadiness {
  if (hotkeyRegistrationError) {
    return { state: 'needsAttention', message: hotkeyRegistrationError }
  }

  const microphone = system.rows.find((row) => row.id === 'microphone')
  const hotkey = system.rows.find((row) => row.id === 'hotkey')
  if (!microphone || !hotkey) return { state: 'needsAttention', message: null }
  if (microphone.status === 'checking' || hotkey.status === 'checking') {
    return CHECKING_READINESS
  }
  if (microphone.status !== 'ok') {
    return { state: 'needsAttention', message: microphone.message }
  }
  if (hotkey.status !== 'ok') return { state: 'needsAttention', message: hotkey.message }
  if (!stt.ready) {
    return { state: 'needsAttention', message: stt.issues[0]?.message ?? null }
  }
  if (stt.kind === 'cloudManaged' && !managedCloudReady) {
    return { state: 'needsAttention', message: null }
  }

  return { state: 'ready', message: null }
}

function currentNativeWindow() {
  try {
    return getCurrentWindow()
  } catch {
    return null
  }
}
function isDocumentVisible(): boolean {
  return document.visibilityState !== 'hidden'
}

async function isActivityViewVisible(): Promise<boolean> {
  if (!isDocumentVisible()) return false

  const nativeWindow = currentNativeWindow()
  if (!nativeWindow) return true

  try {
    return await nativeWindow.isVisible()
  } catch {
    // Browser previews and older WebViews may not expose native visibility.
    return isDocumentVisible()
  }
}

function safeUnlisten(unlisten: () => void) {
  try {
    unlisten()
  } catch {
    // Dev reloads can invalidate a listener before React cleans it up.
  }
}

export function HomePage() {
  const config = useAppStore((s) => s.config)
  const activityRevision = useAppStore((s) => s.activityRevision)
  const hotkeyRegistrationError = useAppStore((s) => s.hotkeyRegistrationError)
  const {
    user,
    displayName,
    quotaModel,
    displayWordsUsedEstimate,
    displayWordsLimit,
    displayWordsResetAt,
    cloudWordsUsed,
    cloudWordsLimit,
    cloudWordsResetAt,
    sttSecondsUsed,
    sttSecondsLimit,
    llmTokensUsed,
    llmTokensLimit,
  } = useAuthStore()
  const { t } = useTranslation()
  const hasCloudAccess = useAuthStore(hasManagedCloudAccess)
  const [timeRange, setTimeRange] = useState<TranscriptionTimeRange>('day')
  const [activity, setActivity] = useState<LocalActivityMetricsSummary>(EMPTY_ACTIVITY)
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [activityLoading, setActivityLoading] = useState(true)
  const [readiness, setReadiness] = useState<HomeReadiness>(CHECKING_READINESS)

  useEffect(() => {
    let cancelled = false
    let refreshInFlight = false
    let lastCheckedAt = 0
    let unlistenFocus: (() => void) | null = null

    const refreshReadiness = async (force = false) => {
      if (refreshInFlight || cancelled) return
      const now = Date.now()
      if (!force && now - lastCheckedAt < READINESS_FOCUS_REFRESH_MS) return

      refreshInFlight = true
      try {
        if (!(await isActivityViewVisible()) || cancelled) return
        lastCheckedAt = now
        if (force) setReadiness(CHECKING_READINESS)

        const isCustomWhisper = config.stt_provider === CUSTOM_WHISPER_PROVIDER
        const [system, stt] = await Promise.all([
          getSystemDiagnostics(),
          getSttProviderDiagnostics(
            isCustomWhisper ? config.stt_custom_api_key : config.stt_api_key,
            config.stt_provider,
            isCustomWhisper ? config.stt_custom_base_url : undefined,
            isCustomWhisper ? config.stt_custom_model : undefined,
          ),
        ])
        if (!cancelled) {
          setReadiness(
            evaluateReadiness(
              system,
              stt,
              hotkeyRegistrationError,
              Boolean(user && hasCloudAccess),
            ),
          )
        }
      } catch {
        if (!cancelled) setReadiness({ state: 'needsAttention', message: null })
      } finally {
        refreshInFlight = false
      }
    }

    const onDocumentVisibility = () => {
      if (document.visibilityState !== 'hidden') void refreshReadiness()
    }
    const onWindowFocus = () => void refreshReadiness()

    document.addEventListener('visibilitychange', onDocumentVisibility)
    window.addEventListener('focus', onWindowFocus)
    currentNativeWindow()
      ?.onFocusChanged((event) => {
        if (event.payload) void refreshReadiness()
      })
      .then((unlisten) => {
        if (cancelled) safeUnlisten(unlisten)
        else unlistenFocus = unlisten
      })
      .catch(() => {})

    void refreshReadiness(true)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onDocumentVisibility)
      window.removeEventListener('focus', onWindowFocus)
      if (unlistenFocus) safeUnlisten(unlistenFocus)
    }
  }, [
    config.stt_api_key,
    config.stt_custom_api_key,
    config.stt_custom_base_url,
    config.stt_custom_model,
    config.stt_provider,
    hasCloudAccess,
    hotkeyRegistrationError,
    user,
  ])

  useEffect(() => {
    let cancelled = false
    let refreshInFlight = false
    let unlistenFocus: (() => void) | null = null

    const refreshWhenVisible = async () => {
      if (refreshInFlight || cancelled) return

      refreshInFlight = true
      try {
        if (!(await isActivityViewVisible()) || cancelled) return

        setActivityLoading(true)
        const summary = await getLocalActivityMetrics()
        if (!cancelled) {
          setActivity(summary)
          setActivityLoaded(true)
        }
      } catch (error) {
        console.warn('Failed to load Home activity totals:', error)
      } finally {
        refreshInFlight = false
        if (!cancelled) setActivityLoading(false)
      }
    }

    const onDocumentVisibility = () => {
      if (document.visibilityState !== 'hidden') void refreshWhenVisible()
    }
    const onWindowFocus = () => void refreshWhenVisible()

    document.addEventListener('visibilitychange', onDocumentVisibility)
    window.addEventListener('focus', onWindowFocus)

    currentNativeWindow()
      ?.onFocusChanged((event) => {
        if (event.payload) void refreshWhenVisible()
      })
      .then((unlisten) => {
        if (cancelled) safeUnlisten(unlisten)
        else unlistenFocus = unlisten
      })
      .catch(() => {})

    void refreshWhenVisible()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onDocumentVisibility)
      window.removeEventListener('focus', onWindowFocus)
      if (unlistenFocus) safeUnlisten(unlistenFocus)
    }
  }, [activityRevision])

  const selectedActivity = activity[timeRange]
  const wordsUsed =
    quotaModel === 'legacy_dual_meter' && displayWordsLimit > 0
      ? displayWordsUsedEstimate
      : cloudWordsUsed
  const wordsLimit =
    quotaModel === 'legacy_dual_meter' && displayWordsLimit > 0
      ? displayWordsLimit
      : cloudWordsLimit
  const wordsResetAt =
    quotaModel === 'legacy_dual_meter' && displayWordsLimit > 0
      ? displayWordsResetAt
      : cloudWordsResetAt
  const numberFormatter = new Intl.NumberFormat()

  const sttProvider = STT_PROVIDERS.find((provider) => provider.value === config.stt_provider)
  const llmProvider = LLM_PROVIDERS.find((provider) => provider.value === config.llm_provider)
  const sttLabel = sttProvider ? t(sttProvider.labelKey) : config.stt_provider
  const llmLabel = llmProvider ? t(llmProvider.labelKey) : config.llm_provider
  const outputLabel =
    config.output_mode === 'keyboard'
      ? t('settings.keyboardSimulation')
      : t('settings.clipboardPaste')
  const shortcutParts = config.hotkey
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  const managedCloudNeedsAttention = config.stt_provider === 'cloud' && (!user || !hasCloudAccess)
  const readinessNeedsAttention =
    Boolean(hotkeyRegistrationError) ||
    managedCloudNeedsAttention ||
    readiness.state === 'needsAttention'
  const readinessChecking = !readinessNeedsAttention && readiness.state === 'checking'
  const readinessMessage =
    hotkeyRegistrationError ??
    readiness.message ??
    (config.stt_provider === 'cloud' && !user
      ? t('settings.sttSignInHint')
      : config.stt_provider === 'cloud' && !hasCloudAccess
        ? t('settings.sttUpgradeHint')
        : readinessNeedsAttention
          ? t('settings.diagnosticsUnavailable')
          : null)

  return (
    <div className="mx-auto w-full max-w-[1060px] space-y-5 p-5 min-[900px]:p-7">
      <section
        className="relative overflow-hidden rounded-[18px] bg-[#14211e] px-5 py-5 text-white shadow-lg min-[760px]:px-7 min-[760px]:py-6"
        aria-labelledby="command-center-title"
      >
        <div
          className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[#2bd0b2]/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex items-center justify-between gap-4">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] ${
              readinessNeedsAttention
                ? 'border-[#ffb25f]/25 bg-[#ffb25f]/10 text-[#ffd099]'
                : readinessChecking
                  ? 'border-white/15 bg-white/[0.06] text-white/65'
                  : 'border-[#5ddcc5]/25 bg-[#5ddcc5]/10 text-[#8ce8d7]'
            }`}
            role="status"
            aria-live="polite"
          >
            {readinessNeedsAttention ? (
              <AlertCircle size={13} aria-hidden="true" />
            ) : readinessChecking ? (
              <Loader2
                size={13}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <CircleCheck size={13} aria-hidden="true" />
            )}
            {readinessNeedsAttention
              ? t('settings.healthActionRequired')
              : readinessChecking
                ? t('settings.healthChecking')
                : t('settings.healthReady')}
          </div>
          <a
            href="#/settings"
            className="inline-flex touch-manipulation items-center gap-1.5 rounded-[9px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#14211e]"
          >
            <Settings2 size={14} aria-hidden="true" />
            {t('nav.settings')}
          </a>
        </div>

        <div className="relative mt-6 grid gap-7 min-[760px]:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] min-[760px]:items-end">
          <div className="min-w-0">
            <h1
              id="command-center-title"
              className="max-w-xl text-balance text-[26px] font-semibold leading-[1.12] tracking-[-0.04em] min-[760px]:text-[31px]"
            >
              {t('home.welcome')}
            </h1>
            <p className="mt-3 max-w-[560px] text-[13px] leading-relaxed text-white/62">
              {t('home.description', { hotkey: config.hotkey })}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2" aria-label={config.hotkey}>
              {shortcutParts.map((part, index) => (
                <span key={`${part}-${index}`} className="contents">
                  {index > 0 && <span className="text-[12px] text-white/35">+</span>}
                  <kbd className="min-w-8 rounded-[7px] border border-white/14 bg-white/[0.08] px-2.5 py-1.5 text-center font-mono text-[12px] font-semibold text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)]">
                    {part}
                  </kbd>
                </span>
              ))}
              <span className="ml-1 text-[12px] text-white/55">
                {t('settings.dictationHotkey')}
              </span>
            </div>
            {readinessNeedsAttention && readinessMessage && (
              <p className="mt-4 max-w-xl rounded-[9px] border border-[#ffb25f]/20 bg-[#ffb25f]/10 px-3 py-2 text-[12px] leading-relaxed text-[#ffd9ad]">
                {readinessMessage}
              </p>
            )}
          </div>

          <div className="rounded-[14px] border border-white/10 bg-white/[0.045] p-3.5">
            <RouteStep
              icon={<Mic2 size={15} />}
              label={t('settings.speechRecognition')}
              value={sttLabel}
            />
            <RouteConnector />
            <RouteStep
              icon={<Sparkles size={15} />}
              label={t('home.aiPolish')}
              value={config.polish_enabled ? llmLabel : t('home.disabled')}
              muted={!config.polish_enabled}
            />
            <RouteConnector />
            <RouteStep
              icon={
                config.output_mode === 'keyboard' ? <Keyboard size={15} /> : <Clipboard size={15} />
              }
              label={t('home.outputMode')}
              value={outputLabel}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 min-[760px]:grid-cols-[minmax(0,1.12fr)_minmax(260px,0.88fr)]">
        <section
          className="rounded-[14px] border border-border bg-bg-elevated p-5"
          aria-labelledby="dictation-time-title"
          aria-busy={activityLoading}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-light text-accent">
                <AudioLines size={17} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p
                  id="dictation-time-title"
                  className="text-[12px] font-semibold text-text-secondary"
                >
                  {t('home.dictationTime')}
                </p>
                <p className="mt-1 font-mono text-[31px] font-semibold tabular-nums tracking-[-0.035em]">
                  {activityLoaded ? formatTranscriptionDuration(selectedActivity.recordingMs) : '—'}
                </p>
              </div>
            </div>

            <div
              className="flex shrink-0 rounded-[9px] border border-border bg-bg-secondary p-0.5"
              role="group"
              aria-label={t('home.timeRange')}
            >
              {TIME_RANGE_KEYS.map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  aria-pressed={timeRange === range}
                  aria-controls="activity-instrument-values"
                  className={`touch-manipulation rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-elevated ${
                    timeRange === range
                      ? 'bg-bg-elevated text-text-primary shadow-sm'
                      : 'bg-transparent text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {t(`home.${range}`)}
                </button>
              ))}
            </div>
          </div>
          <dl
            id="activity-instrument-values"
            className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border pt-4 min-[520px]:grid-cols-4"
          >
            <ActivityStat
              label={t('home.savedTranscriptions')}
              value={
                activityLoaded ? numberFormatter.format(selectedActivity.savedTranscriptions) : '—'
              }
            />
            <ActivityStat
              label={t('home.retainedOutputCharacters')}
              value={activityLoaded ? numberFormatter.format(selectedActivity.outputChars) : '—'}
            />
            <ActivityStat
              label={t('home.activeDays')}
              value={activityLoaded ? numberFormatter.format(selectedActivity.activeDays) : '—'}
            />
            <ActivityStat
              label={t('home.averageTurnaround')}
              value={
                activityLoaded &&
                selectedActivity.timingSampleCount > 0 &&
                selectedActivity.averageTotalMs !== null
                  ? formatTurnaround(selectedActivity.averageTotalMs)
                  : '—'
              }
              hint={
                activityLoaded && selectedActivity.timingSampleCount > 0
                  ? t('home.averageTurnaroundSamples', {
                      count: selectedActivity.timingSampleCount,
                      total: selectedActivity.savedTranscriptions,
                    })
                  : undefined
              }
            />
          </dl>
          {selectedActivity.transformedOutputs > 0 && (
            <p className="mt-4 border-t border-border pt-3 text-[12px] leading-relaxed text-text-secondary">
              {t('home.transformedOutputsDetail', {
                count: selectedActivity.transformedOutputs,
              })}
            </p>
          )}
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[12px] font-semibold text-text-secondary">
              {t('home.retainedOutputOutcomes')}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-x-5 gap-y-4">
              <ActivityStat
                label={t('home.retainedAutomaticInsertions')}
                value={
                  activityLoaded
                    ? numberFormatter.format(selectedActivity.successfulAutomaticInsertions)
                    : EMPTY_METRIC
                }
              />
              <ActivityStat
                label={t('home.retainedFallbacks')}
                value={
                  activityLoaded
                    ? numberFormatter.format(selectedActivity.recordedFallbacks)
                    : EMPTY_METRIC
                }
              />
              <ActivityStat
                label={t('home.retainedFailures')}
                value={
                  activityLoaded
                    ? numberFormatter.format(selectedActivity.recordedFailures)
                    : EMPTY_METRIC
                }
              />
            </dl>
            {activityLoaded && (
              <div className="mt-3 space-y-1 text-[11px] leading-snug text-text-tertiary">
                <p>
                  {t('home.outputOutcomeCoverage', {
                    count: selectedActivity.outputOutcomeSampleCount,
                    total: selectedActivity.savedTranscriptions,
                  })}
                </p>
                <p>{t('home.retainedOutputScope')}</p>
              </div>
            )}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[12px] font-semibold text-text-secondary">
              {t('home.turnaroundLatency')}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-4">
              <ActivityStat
                label={t('home.typicalTurnaround')}
                value={
                  activityLoaded && selectedActivity.p50TotalMs !== null
                    ? formatTurnaround(selectedActivity.p50TotalMs)
                    : EMPTY_METRIC
                }
              />
              <ActivityStat
                label={t('home.slowEndTurnaround')}
                value={
                  activityLoaded && selectedActivity.p95TotalMs !== null
                    ? formatTurnaround(selectedActivity.p95TotalMs)
                    : EMPTY_METRIC
                }
              />
            </dl>
            {activityLoaded && (
              <p className="mt-3 text-[11px] leading-snug text-text-tertiary">
                {t('home.turnaroundCoverage', {
                  count: selectedActivity.timingSampleCount,
                  total: selectedActivity.savedTranscriptions,
                })}
              </p>
            )}
          </div>
          <div className="mt-4 border-t border-border pt-3 text-[12px] leading-relaxed text-text-tertiary">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p>{t('home.localActivityDisclosure')}</p>
              <p>
                {activityLoaded
                  ? t('home.lifetimeRetained', {
                      formattedCount: numberFormatter.format(activity.totalRecordings),
                    })
                  : EMPTY_METRIC}
              </p>
            </div>
            {activityLoaded && (
              <p className="mt-1.5">
                {t('home.durationCoverage', {
                  count: selectedActivity.validDurationSampleCount,
                  total: selectedActivity.savedTranscriptions,
                })}
              </p>
            )}
            {activityLoaded && (
              <p className="mt-1">
                {t('home.lifetimeDurationCoverage', {
                  count: activity.validDurationSampleCount,
                  total: activity.totalRecordings,
                })}
              </p>
            )}
          </div>
          {selectedActivity.excludedDurationCount > 0 && (
            <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
              {t('home.invalidDurationsSelected', {
                count: selectedActivity.excludedDurationCount,
              })}
            </p>
          )}
          {activity.excludedDurationCount > selectedActivity.excludedDurationCount && (
            <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
              {t('home.invalidDurationsLifetime', {
                count: activity.excludedDurationCount,
              })}
            </p>
          )}
          {selectedActivity.excludedTimingCount > 0 && (
            <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
              {t('home.timingOutliersSelected', {
                count: selectedActivity.excludedTimingCount,
              })}
            </p>
          )}
        </section>

        <section
          className="rounded-[14px] border border-border bg-bg-elevated p-5"
          aria-labelledby="setup-summary-title"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="setup-summary-title" className="text-[16px] font-semibold tracking-[-0.02em]">
                {t('home.setupSummary')}
              </h2>
            </div>
            <a
              href="#/settings"
              aria-label={t('nav.settings')}
              className="grid h-8 w-8 touch-manipulation place-items-center rounded-[8px] border border-border bg-transparent text-text-secondary transition-colors hover:bg-bg-secondary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
            >
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
          <dl className="mt-4 divide-y divide-border border-y border-border">
            <ConfigRow label={t('settings.speechRecognition')} value={sttLabel} />
            <ConfigRow
              label={t('home.aiPolish')}
              value={config.polish_enabled ? llmLabel : t('home.disabled')}
            />
            <ConfigRow label={t('home.outputMode')} value={outputLabel} />
          </dl>
        </section>
      </div>

      {user && (
        <section className="rounded-[14px] border border-border bg-bg-elevated p-5">
          {hasCloudAccess ? (
            <>
              <div className="mb-4 flex items-center gap-2">
                <Crown size={16} className="text-warning" aria-hidden="true" />
                <h2 className="text-[13px] font-semibold">{displayName}</h2>
              </div>
              <div className="grid gap-4 min-[700px]:grid-cols-2">
                {wordsLimit > 0 ? (
                  <>
                    <RemainingWords used={wordsUsed} limit={wordsLimit} resetAt={wordsResetAt} />
                    <QuotaBar
                      label={t('account.cloudWords', 'Cloud words')}
                      used={wordsUsed}
                      limit={wordsLimit}
                      unit={t('account.quotaKWords', 'k words')}
                      divisor={1000}
                    />
                  </>
                ) : (
                  <>
                    <QuotaBar
                      label={t('upgrade.stt')}
                      used={sttSecondsUsed}
                      limit={sttSecondsLimit}
                      unit={t('account.quotaHours')}
                      divisor={3600}
                    />
                    <QuotaBar
                      label={t('upgrade.llm')}
                      used={llmTokensUsed}
                      limit={llmTokensLimit}
                      unit={t('account.quotaTokens')}
                      divisor={1000}
                    />
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-[13px] font-semibold">{t('home.freePlan')}</h2>
                <a
                  href="#/upgrade"
                  className="touch-manipulation rounded-sm bg-transparent text-[12px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
                >
                  {t('home.upgradeToPro')}
                </a>
              </div>
              {sttSecondsLimit > 0 && (
                <div className="mt-4 grid gap-4 min-[700px]:grid-cols-2">
                  <QuotaBar
                    label={t('upgrade.stt')}
                    used={sttSecondsUsed}
                    limit={sttSecondsLimit}
                    unit={t('account.quotaMin')}
                    divisor={60}
                  />
                  <QuotaBar
                    label={t('upgrade.llm')}
                    used={llmTokensUsed}
                    limit={llmTokensLimit}
                    unit={t('account.quotaTokens')}
                    divisor={1000}
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}

function RouteStep({
  icon,
  label,
  value,
  muted = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 ${muted ? 'opacity-55' : ''}`}>
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-white/[0.08] text-[#74d9c7]"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-white/58">{label}</p>
        <p className="mt-0.5 truncate text-[12px] font-medium text-white/88">{value}</p>
      </div>
    </div>
  )
}

function RouteConnector() {
  return (
    <div className="ml-[15px] h-3 border-l border-dashed border-[#74d9c7]/30" aria-hidden="true" />
  )
}

function ActivityStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] leading-snug text-text-tertiary">{label}</dt>
      <dd className="mt-1.5 font-mono text-[18px] font-semibold tabular-nums text-text-primary">
        {value}
      </dd>
      {hint && <dd className="mt-1 text-[11px] leading-snug text-text-tertiary">{hint}</dd>}
    </div>
  )
}

function formatTurnaround(durationMs: number): string {
  if (durationMs < 1_000) return `${new Intl.NumberFormat().format(Math.round(durationMs))} ms`
  const maximumFractionDigits = durationMs < 10_000 ? 1 : 0
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(durationMs / 1_000)} s`
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-[12px]">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="max-w-[58%] truncate text-right font-medium text-text-primary" title={value}>
        {value}
      </dd>
    </div>
  )
}

function RemainingWords({
  used,
  limit,
  resetAt,
}: {
  used: number
  limit: number
  resetAt: string | null
}) {
  const { t } = useTranslation()
  const remaining = Math.max(limit - used, 0)
  const formattedRemaining = new Intl.NumberFormat().format(remaining)

  return (
    <div className="rounded-[10px] bg-bg-secondary px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-text-secondary">{t('home.wordsRemaining')}</span>
        <span className="text-[18px] font-semibold tabular-nums text-text-primary">
          {formattedRemaining}
        </span>
      </div>
      {resetAt && (
        <p className="mt-1 text-[11px] text-text-tertiary">
          {t('home.wordsReset', { date: new Date(resetAt).toLocaleDateString() })}
        </p>
      )}
    </div>
  )
}

function QuotaBar({
  label,
  used,
  limit,
  unit,
  divisor,
}: {
  label: string
  used: number
  limit: number
  unit: string
  divisor: number
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const usedDisplay = (used / divisor).toFixed(1)
  const limitDisplay = (limit / divisor).toFixed(1)

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-[12px]">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-tertiary">
          {usedDisplay} / {limitDisplay} {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-secondary">
        <div
          className={`h-full rounded-full ${pct > 90 ? 'bg-error' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
