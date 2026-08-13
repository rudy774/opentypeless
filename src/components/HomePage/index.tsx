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
  Mic2,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LLM_PROVIDERS, STT_PROVIDERS } from '../../lib/constants'
import { useAppStore } from '../../stores/appStore'
import { hasManagedCloudAccess, useAuthStore } from '../../stores/authStore'
import {
  getLocalActivityMetrics,
  type ActivityRangeMetrics,
  type LocalActivityMetricsSummary,
} from '../../lib/tauri'
import {
  formatTranscriptionDuration,
  type TranscriptionTimeRange,
} from '../../lib/transcription-time'

const EMPTY_ACTIVITY_RANGE: ActivityRangeMetrics = {
  recordingMs: 0,
  savedTranscriptions: 0,
  outputChars: 0,
  activeDays: 0,
  recordedFallbacks: 0,
  transformedOutputs: 0,
  excludedDurationCount: 0,
  averageTotalMs: null,
  timingSampleCount: 0,
}

const EMPTY_ACTIVITY: LocalActivityMetricsSummary = {
  day: EMPTY_ACTIVITY_RANGE,
  week: EMPTY_ACTIVITY_RANGE,
  month: EMPTY_ACTIVITY_RANGE,
  totalRecordings: 0,
  excludedDurationCount: 0,
}

const TIME_RANGE_KEYS: TranscriptionTimeRange[] = ['day', 'week', 'month']

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
  const hasShortcutIssue = Boolean(hotkeyRegistrationError)

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
              hasShortcutIssue
                ? 'border-[#ffb25f]/25 bg-[#ffb25f]/10 text-[#ffd099]'
                : 'border-[#5ddcc5]/25 bg-[#5ddcc5]/10 text-[#8ce8d7]'
            }`}
          >
            {hasShortcutIssue ? (
              <AlertCircle size={13} aria-hidden="true" />
            ) : (
              <CircleCheck size={13} aria-hidden="true" />
            )}
            {hasShortcutIssue ? t('settings.healthActionRequired') : t('home.configured')}
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
            {hasShortcutIssue && hotkeyRegistrationError && (
              <p className="mt-4 max-w-xl rounded-[9px] border border-[#ffb25f]/20 bg-[#ffb25f]/10 px-3 py-2 text-[12px] leading-relaxed text-[#ffd9ad]">
                {hotkeyRegistrationError}
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
              label={t('home.charactersDrafted')}
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
          {(selectedActivity.transformedOutputs > 0 || selectedActivity.recordedFallbacks > 0) && (
            <p className="mt-4 border-t border-border pt-3 text-[12px] leading-relaxed text-text-secondary">
              {t('home.activityDetails', {
                transformed: numberFormatter.format(selectedActivity.transformedOutputs),
                fallbacks: numberFormatter.format(selectedActivity.recordedFallbacks),
              })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] leading-relaxed text-text-tertiary">
            <p>{t('home.localActivityDisclosure')}</p>
            <p>
              {activityLoaded
                ? t('home.lifetimeRetained', {
                    formattedCount: numberFormatter.format(activity.totalRecordings),
                  })
                : '—'}
            </p>
          </div>
          {selectedActivity.excludedDurationCount > 0 && (
            <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
              {t('home.durationOutliersSelected', {
                count: selectedActivity.excludedDurationCount,
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
