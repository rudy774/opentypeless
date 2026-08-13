import {
  ArrowLeft,
  AudioLines,
  BookOpen,
  Info,
  LayoutGrid,
  Mic,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

const PANES = [
  { id: 'general', labelKey: 'settings.general', icon: Settings },
  { id: 'stt', labelKey: 'settings.speechRecognition', icon: Mic },
  { id: 'llm', labelKey: 'settings.aiPolish', icon: Sparkles },
  { id: 'dictionary', labelKey: 'settings.dictionary', icon: BookOpen },
  { id: 'scenes', labelKey: 'settings.scenes', icon: LayoutGrid },
  { id: 'about', labelKey: 'settings.about', icon: Info },
] as const

export type PaneId = (typeof PANES)[number]['id']

interface Props {
  activePane: PaneId
  onSelect: (id: PaneId) => void
}

export function SettingsSidebar({ activePane, onSelect }: Props) {
  const { t } = useTranslation()

  return (
    <aside className="flex h-full w-[216px] shrink-0 flex-col border-r border-border bg-bg-elevated px-3 py-4 max-[721px]:w-[72px] max-[721px]:px-2">
      <div className="flex items-center gap-3 px-2 pb-5 pt-1" data-tauri-drag-region>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#142a25] text-[#67d8c3] dark:bg-accent-light dark:text-accent">
          <AudioLines size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 max-[721px]:hidden">
          <p className="truncate text-[14px] font-semibold tracking-[-0.02em]">{t('app.name')}</p>
          <p className="mt-0.5 truncate text-[12px] text-text-tertiary">{t('settings.title')}</p>
        </div>
      </div>

      <a
        href="#/"
        aria-label={t('nav.home')}
        className="mb-4 flex h-9 w-full items-center gap-2.5 rounded-[9px] border border-border bg-transparent px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary max-[721px]:justify-center max-[721px]:px-0"
      >
        <ArrowLeft size={15} className="shrink-0" aria-hidden="true" />
        <span className="max-[721px]:hidden">{t('nav.home')}</span>
      </a>

      <nav className="space-y-1" aria-label={t('settings.title')}>
        {PANES.map((pane) => {
          const Icon = pane.icon
          const isActive = activePane === pane.id
          const label = t(pane.labelKey)
          return (
            <button
              key={pane.id}
              type="button"
              onClick={() => onSelect(pane.id)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className={`flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] font-medium transition-colors max-[721px]:justify-center max-[721px]:px-0 ${
                isActive
                  ? 'bg-accent-light text-accent'
                  : 'bg-transparent text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
              }`}
            >
              <Icon size={17} className="shrink-0" aria-hidden="true" />
              <span className="truncate max-[721px]:hidden">{label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
