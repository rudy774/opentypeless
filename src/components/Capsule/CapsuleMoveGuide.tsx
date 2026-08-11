import { motion, useReducedMotion } from 'framer-motion'
import { GripHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface CapsuleMoveGuideProps {
  onDismiss: () => void
}

export function CapsuleMoveGuide({ onDismiss }: CapsuleMoveGuideProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="absolute left-[224px] top-1/2 w-[228px] -translate-y-1/2 rounded-[14px] border border-border bg-bg-elevated px-2.5 py-2 shadow-float pointer-events-auto"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -6, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <div className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-accent/60" />
      <div className="flex items-center gap-2">
        <motion.div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-light text-accent"
          animate={reduceMotion ? undefined : { x: [0, 3, 0, -3, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.8 }}
          aria-hidden="true"
        >
          <GripHorizontal size={16} strokeWidth={2.2} />
        </motion.div>

        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-4 text-text-primary">
            {t('capsule.moveGuide.title')}
          </p>
          <p className="text-[10px] leading-[13px] text-text-secondary">
            {t('capsule.moveGuide.description')}
          </p>
        </div>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onDismiss}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-none bg-transparent p-0 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          aria-label={t('capsule.moveGuide.dismiss')}
          title={t('capsule.moveGuide.dismiss')}
        >
          <X size={13} />
        </button>
      </div>
    </motion.div>
  )
}
