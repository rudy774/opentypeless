import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_RECORDING_LIMIT_SECONDS,
  MIN_RECORDING_LIMIT_SECONDS,
  normalizeRecordingLimitSeconds,
} from '../../lib/recording-limit'
import { Toggle } from './shared/Toggle'

interface RecordingLimitControlProps {
  seconds: number
  onChange: (seconds: number) => void
}

export function RecordingLimitControl({ seconds, onChange }: RecordingLimitControlProps) {
  const { t } = useTranslation()
  const lastLimitRef = useRef(seconds || 60)
  const enabled = seconds > 0

  return (
    <div className="mt-3 rounded-[10px] border border-border bg-bg-secondary/40 px-3 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-primary">{t('settings.automaticStop')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-tertiary">
            {t('settings.automaticStopHint')}
          </p>
        </div>
        <Toggle
          checked={enabled}
          onChange={(checked) => onChange(checked ? lastLimitRef.current : 0)}
          label={t('settings.automaticStopToggle')}
        />
      </div>
      {enabled && (
        <label className="mt-3 flex items-center gap-2 text-[12px] text-text-secondary">
          <span>{t('settings.stopAfter')}</span>
          <input
            aria-label={t('settings.recordingLimitSeconds')}
            type="number"
            min={MIN_RECORDING_LIMIT_SECONDS}
            max={MAX_RECORDING_LIMIT_SECONDS}
            step={5}
            value={seconds}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10)
              if (!Number.isFinite(next)) return
              const normalized = normalizeRecordingLimitSeconds(next)
              lastLimitRef.current = normalized
              onChange(normalized)
            }}
            className="h-8 w-20 rounded-[8px] border border-border bg-bg-primary px-2 text-right text-[13px] tabular-nums text-text-primary outline-none transition-colors focus:border-border-focus"
          />
          <span>{t('settings.seconds')}</span>
        </label>
      )}
      {!enabled && (
        <p className="mt-2 text-[11px] font-medium text-success">
          {t('settings.manualStopActive')}
        </p>
      )}
    </div>
  )
}
