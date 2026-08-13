import { AudioLines, CircleUser, Crown, History, Home, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRoute, type Route } from '../../lib/router'
import { hasManagedCloudAccess, useAuthStore } from '../../stores/authStore'
import { AccessibilityBanner } from './AccessibilityBanner'

const mainNavItems: { id: Route; labelKey: string; icon: typeof Home }[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'history', labelKey: 'nav.history', icon: History },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
]

interface Props {
  children: React.ReactNode
}

export function MainLayout({ children }: Props) {
  const { route } = useRoute()
  const hasCloudAccess = useAuthStore(hasManagedCloudAccess)
  const { t } = useTranslation()

  if (route === 'settings') {
    return (
      <div className="flex h-full w-full flex-col bg-bg-primary text-text-primary">
        <SkipLink label={t('nav.skipToContent')} />
        <AccessibilityBanner />
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1">
          {children}
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full bg-bg-primary text-text-primary">
      <SkipLink label={t('nav.skipToContent')} />
      <aside className="flex w-[184px] shrink-0 flex-col border-r border-border bg-bg-elevated px-3 py-4 max-[721px]:w-[72px] max-[721px]:px-2">
        <div className="flex items-center gap-3 px-2 pb-6 pt-1" data-tauri-drag-region>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#142a25] text-[#67d8c3] dark:bg-accent-light dark:text-accent">
            <AudioLines size={18} />
          </span>
          <div className="min-w-0 max-[721px]:hidden">
            <p className="truncate text-[14px] font-semibold tracking-[-0.02em]">{t('app.name')}</p>
            <p className="mt-0.5 truncate text-[12px] text-text-tertiary">{t('app.tagline')}</p>
          </div>
        </div>

        <nav className="space-y-1" aria-label={t('nav.mainNavigation')}>
          {mainNavItems.map(({ id, labelKey, icon: Icon }) => {
            const active = route === id
            const label = t(labelKey)
            return (
              <a
                key={id}
                href={routeHref(id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] font-medium transition-colors max-[721px]:justify-center max-[721px]:px-0 ${
                  active
                    ? 'bg-accent-light text-accent'
                    : 'bg-transparent text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                }`}
              >
                <Icon size={17} className="shrink-0" aria-hidden="true" />
                <span className="truncate max-[721px]:hidden">{label}</span>
              </a>
            )
          })}
        </nav>

        <div className="mt-auto space-y-1 border-t border-border pt-3">
          <a
            href={routeHref('upgrade')}
            aria-label={hasCloudAccess ? t('nav.pro') : t('nav.upgrade')}
            aria-current={route === 'upgrade' ? 'page' : undefined}
            className={`flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] font-medium transition-colors max-[721px]:justify-center max-[721px]:px-0 ${
              route === 'upgrade'
                ? 'bg-accent-light text-accent'
                : 'bg-transparent text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
            }`}
          >
            <Crown size={17} className="shrink-0" aria-hidden="true" />
            <span className="truncate max-[721px]:hidden">
              {hasCloudAccess ? t('nav.pro') : t('nav.upgrade')}
            </span>
          </a>
          <a
            href={routeHref('account')}
            aria-label={t('nav.account')}
            aria-current={route === 'account' ? 'page' : undefined}
            className={`flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] font-medium transition-colors max-[721px]:justify-center max-[721px]:px-0 ${
              route === 'account'
                ? 'bg-accent-light text-accent'
                : 'bg-transparent text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
            }`}
          >
            <CircleUser size={17} className="shrink-0" aria-hidden="true" />
            <span className="truncate max-[721px]:hidden">{t('nav.account')}</span>
          </a>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        <AccessibilityBanner />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  )
}

function SkipLink({ label }: { label: string }) {
  const focusMainContent = () => document.getElementById('main-content')?.focus()

  return (
    <button
      type="button"
      onClick={focusMainContent}
      className="fixed left-4 top-0 z-[100] -translate-y-[120%] rounded-[8px] bg-text-primary px-3 py-2 text-[12px] font-medium text-bg-primary shadow-md transition-transform focus-visible:translate-y-4"
    >
      {label}
    </button>
  )
}

function routeHref(route: Route) {
  return route === 'home' ? '#/' : `#/${route}`
}
