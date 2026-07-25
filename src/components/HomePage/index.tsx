import { useEffect, useState } from 'react'
import { Mic, Settings, History, Crown, AudioLines } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { spring } from '../../lib/animations'
import { useAppStore } from '../../stores/appStore'
import { hasManagedCloudAccess, useAuthStore } from '../../stores/authStore'
import { useRoute } from '../../lib/router'
import { getTranscriptionTimeStats, type TranscriptionTimeStats } from '../../lib/tauri'
import {
  formatTranscriptionDuration,
  type TranscriptionTimeRange,
} from '../../lib/transcription-time'

const EMPTY_TRANSCRIPTION_TIME: TranscriptionTimeStats = {
  dayMs: 0,
  weekMs: 0,
  monthMs: 0,
  excludedCount: 0,
}

const TIME_RANGE_KEYS: TranscriptionTimeRange[] = ['day', 'week', 'month']

export function HomePage() {
  const config = useAppStore((s) => s.config)
  const history = useAppStore((s) => s.history)
  const { navigate } = useRoute()
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
  const [transcriptionTime, setTranscriptionTime] =
    useState<TranscriptionTimeStats>(EMPTY_TRANSCRIPTION_TIME)

  useEffect(() => {
    let cancelled = false
    getTranscriptionTimeStats()
      .then((stats) => {
        if (!cancelled) setTranscriptionTime(stats)
      })
      .catch((error) => {
        console.warn('Failed to load transcription time:', error)
      })
    return () => {
      cancelled = true
    }
  }, [history])

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayCount = history.filter((h) => h.created_at.startsWith(today)).length
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
  const durationByRange: Record<TranscriptionTimeRange, number> = {
    day: transcriptionTime.dayMs,
    week: transcriptionTime.weekMs,
    month: transcriptionTime.monthMs,
  }

  return (
    <div className="p-6 space-y-6">
      {/* Welcome */}
      <div className="rounded-[18px] p-5 jelly-card">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(145deg, rgba(42,187,167,0.15), rgba(42,187,167,0.08))',
            }}
          >
            <Mic size={18} className="text-text-secondary" />
          </div>
          <h2 className="text-[17px] font-semibold">{t('home.welcome')}</h2>
        </div>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          {t('home.description', { hotkey: config.hotkey })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[18px] p-4 jelly-card">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
            {t('home.totalRecordings')}
          </p>
          <p className="text-[22px] font-semibold">{history.length}</p>
        </div>
        <div className="rounded-[18px] p-4 jelly-card">
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
            {t('home.today')}
          </p>
          <p className="text-[22px] font-semibold">{todayCount}</p>
        </div>
      </div>

      <section className="rounded-[18px] p-4 jelly-card" aria-labelledby="dictation-time-title">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
              <AudioLines size={16} />
            </div>
            <div className="min-w-0">
              <p
                id="dictation-time-title"
                className="text-[11px] text-text-tertiary uppercase tracking-wider"
              >
                {t('home.dictationTime')}
              </p>
              <p className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.02em]">
                {formatTranscriptionDuration(durationByRange[timeRange])}
              </p>
            </div>
          </div>

          <div
            className="flex shrink-0 rounded-[9px] bg-bg-secondary/80 p-0.5"
            role="group"
            aria-label={t('home.timeRange')}
          >
            {TIME_RANGE_KEYS.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                aria-pressed={timeRange === range}
                className={`rounded-[7px] px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  timeRange === range
                    ? 'bg-bg-primary text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {t(`home.${range}`)}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-text-tertiary">{t('home.savedRecordingTime')}</p>
        {transcriptionTime.excludedCount > 0 && (
          <p className="mt-2 rounded-[8px] border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary">
            {t('home.durationOutliersExcluded', {
              count: transcriptionTime.excludedCount,
            })}
          </p>
        )}
      </section>

      {/* Plan / Quota summary */}
      {user && (
        <div className="rounded-[18px] p-5 jelly-card">
          {hasCloudAccess ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Crown size={16} className="text-amber-500" />
                <h3 className="text-[13px] font-medium">{displayName}</h3>
              </div>
              <div className="space-y-3">
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
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-medium">{t('home.freePlan')}</h3>
                <button
                  onClick={() => navigate('upgrade')}
                  className="text-[12px] text-accent font-medium bg-transparent border-none cursor-pointer hover:underline"
                >
                  {t('home.upgradeToPro')}
                </button>
              </div>
              {sttSecondsLimit > 0 && (
                <div className="space-y-3 mt-3">
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
        </div>
      )}

      {/* Current config */}
      <div className="rounded-[18px] p-5 jelly-card">
        <h3 className="text-[13px] font-medium mb-3">{t('home.currentConfig')}</h3>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-text-secondary">{t('home.sttProvider')}</span>
            <span className="text-text-primary font-medium">{config.stt_provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">{t('home.llmProvider')}</span>
            <span className="text-text-primary font-medium">{config.llm_provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">{t('home.aiPolish')}</span>
            <span className="text-text-primary font-medium">
              {config.polish_enabled ? t('home.enabled') : t('home.disabled')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">{t('home.outputMode')}</span>
            <span className="text-text-primary font-medium">{config.output_mode}</span>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <motion.button
          onClick={() => navigate('settings')}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scaleX: 1.06, scaleY: 0.94 }}
          transition={spring.jellyGentle}
          className="flex items-center gap-2.5 rounded-[14px] p-4 cursor-pointer text-left jelly-btn"
        >
          <Settings size={16} className="text-text-secondary" />
          <span className="text-[13px] font-medium">{t('nav.settings')}</span>
        </motion.button>
        <motion.button
          onClick={() => navigate('history')}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scaleX: 1.06, scaleY: 0.94 }}
          transition={spring.jellyGentle}
          className="flex items-center gap-2.5 rounded-[14px] p-4 cursor-pointer text-left jelly-btn"
        >
          <History size={16} className="text-text-secondary" />
          <span className="text-[13px] font-medium">{t('nav.history')}</span>
        </motion.button>
      </div>
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
    <div className="rounded-[10px] bg-bg-secondary/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-text-secondary">{t('home.wordsRemaining')}</span>
        <span className="text-[18px] font-semibold text-text-primary tabular-nums">
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
    <div className="space-y-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-tertiary">
          {usedDisplay} / {limitDisplay} {unit}
        </span>
      </div>
      <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
