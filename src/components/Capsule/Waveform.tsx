import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/appStore'
import { normalizeAudioLevel, smoothAudioLevel } from '../../lib/audio-level'

const BAR_COUNT = 7
const MIN_SCALE = 3 / 16
const MAX_HEIGHT = 16
const BAR_SHAPES = [0.48, 0.72, 0.94, 0.68, 1, 0.76, 0.52]

export function Waveform() {
  const barsRef = useRef<(HTMLDivElement | null)[]>([])
  const meterRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number>(0)
  const reduced = useReducedMotion()
  const { t } = useTranslation()

  useEffect(() => {
    let smoothed = 0
    const animate = () => {
      const target = normalizeAudioLevel(useAppStore.getState().audioVolume)
      smoothed = smoothAudioLevel(smoothed, target)
      meterRef.current?.setAttribute('aria-valuenow', smoothed.toFixed(2))
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        // Reduced Motion still shows live input, but without decorative oscillation.
        const flutter =
          !reduced && smoothed > 0.03 ? 0.86 + Math.sin(Date.now() / 95 + i * 1.15) * 0.14 : 1
        const normalized = Math.max(0, Math.min(1, smoothed * BAR_SHAPES[i] * flutter))
        const visualMax = reduced ? 11 : MAX_HEIGHT
        const height = 3 + (visualMax - 3) * normalized
        const scale = height / MAX_HEIGHT
        const opacity = 0.45 + normalized * 0.55
        bar.style.transform = `scaleY(${scale})`
        bar.style.opacity = `${opacity}`
      })
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [reduced])

  return (
    <div
      ref={meterRef}
      className="flex items-center justify-center gap-[3px] h-4"
      role="meter"
      aria-label={t('capsule.microphoneLevel')}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={0}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="w-[2px] rounded-full bg-white/80"
          style={{
            height: `${MAX_HEIGHT}px`,
            opacity: 0.5,
            transform: `scaleY(${MIN_SCALE})`,
            transformOrigin: 'center',
            transition: reduced ? 'none' : 'transform 75ms ease-out, opacity 75ms ease-out',
          }}
        />
      ))}
    </div>
  )
}
