import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { appLogDir } from '@tauri-apps/api/path'
import i18n from '../../i18n'
import { ExternalLink, FolderOpen, Stethoscope } from 'lucide-react'
import { openPath, openUrl } from '@tauri-apps/plugin-opener'
import { useAppStore } from '../../stores/appStore'
import { APP_NAME, APP_VERSION, APP_REPO_URL, UI_LANGUAGES } from '../../lib/constants'
import { getSystemDiagnostics, type SystemDiagnosticsReport } from '../../lib/tauri'

export function AboutPane() {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const [diagnostics, setDiagnostics] = useState<SystemDiagnosticsReport | null>(null)
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null)
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false)

  const currentLang = config.ui_language || i18n.language || 'en'

  const handleSelectLanguage = (value: string) => {
    i18n.changeLanguage(value)
    localStorage.setItem('ui_language', value)
    updateConfig({ ui_language: value })
    invoke('refresh_tray_labels').catch(() => {})
  }

  const handleRunDiagnostics = async () => {
    setDiagnosticsRunning(true)
    setDiagnosticError(null)
    try {
      setDiagnostics(await getSystemDiagnostics())
    } catch (error) {
      setDiagnosticError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiagnosticsRunning(false)
    }
  }

  const handleOpenLogs = async () => {
    setDiagnosticError(null)
    try {
      await openPath(await appLogDir())
    } catch (error) {
      setDiagnosticError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="space-y-5 text-[13px]">
      {/* Header */}
      <div className="text-center py-6">
        <h2 className="text-[22px] font-semibold text-text-primary">{APP_NAME}</h2>
        <p className="text-text-secondary mt-1 text-[13px]">{APP_VERSION}</p>
      </div>

      <p className="text-text-secondary leading-relaxed">{t('settings.aboutDescription')}</p>

      {/* Language */}
      <SectionCard title={t('settings.language')}>
        <div className="grid grid-cols-2 gap-3 p-3">
          {UI_LANGUAGES.map((lang) => (
            <button
              key={lang.value}
              onClick={() => handleSelectLanguage(lang.value)}
              className={`px-4 py-3 rounded-[8px] text-[13px] border cursor-pointer transition-all ${
                currentLang === lang.value
                  ? 'bg-accent/10 border-accent text-accent font-medium'
                  : 'bg-bg-secondary border-border text-text-primary hover:border-text-tertiary'
              }`}
            >
              <div className="font-medium">{lang.label}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Open Source */}
      <SectionCard title={t('settings.openSource')}>
        <InfoRow label={t('settings.license')} value={t('settings.mit')} />
        <LinkRow label={t('settings.github')} url={APP_REPO_URL} linkText={t('settings.view')} />
        <InfoRow label={t('settings.framework')} value={t('settings.tauriReact')} />
      </SectionCard>

      <SectionCard title={t('settings.diagnosticsTitle')}>
        <div className="space-y-3 p-3">
          <p className="text-[12px] leading-relaxed text-text-secondary">
            {t('settings.diagnosticsDescription')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={diagnosticsRunning}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-bg-secondary px-3 py-2 text-[12px] text-text-primary hover:border-border-focus disabled:opacity-60"
            >
              <Stethoscope size={13} />
              {diagnosticsRunning
                ? t('settings.diagnosticsRunning')
                : t('settings.runDiagnostics')}
            </button>
            <button
              type="button"
              onClick={handleOpenLogs}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-bg-secondary px-3 py-2 text-[12px] text-text-primary hover:border-border-focus"
            >
              <FolderOpen size={13} />
              {t('settings.openDiagnosticLogs')}
            </button>
          </div>
          {diagnostics && (
            <div className="divide-y divide-border overflow-hidden rounded-[8px] border border-border">
              {diagnostics.rows.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="text-[12px] capitalize text-text-secondary">{row.id}</span>
                  <span
                    className={`text-right text-[11px] leading-relaxed ${
                      row.status === 'error'
                        ? 'text-error'
                        : row.status === 'warning'
                          ? 'text-amber-500'
                          : 'text-text-primary'
                    }`}
                  >
                    {row.message}
                  </span>
                </div>
              ))}
            </div>
          )}
          {diagnosticError && (
            <p className="rounded-[8px] border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
              {diagnosticError}
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-[10px] overflow-hidden">
      <div className="px-3 py-2.5 bg-bg-secondary/50 border-b border-border">
        <h3 className="text-[13px] font-medium text-text-primary">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3 py-2.5 border-b border-border last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}

function LinkRow({ label, url, linkText }: { label: string; url: string; linkText: string }) {
  return (
    <button
      onClick={() => openUrl(url)}
      className="flex justify-between items-center w-full px-3 py-2.5 border-b border-border last:border-b-0 bg-transparent border-x-0 border-t-0 cursor-pointer text-[13px]"
    >
      <span className="text-text-secondary">{label}</span>
      <span className="text-accent flex items-center gap-1">
        {linkText} <ExternalLink size={12} />
      </span>
    </button>
  )
}
