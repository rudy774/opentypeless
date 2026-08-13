import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useAppStore, type HistoryEntry } from '../../stores/appStore'
import {
  addCorrectionRule,
  clearHistory,
  getCorrectionRules,
  getHistoryCount,
  getHistory,
} from '../../lib/tauri'
import { toast } from '../toast-service'
import { AppContextMeta } from './AppContextMeta'
import { CreateCorrectionDialog } from './CreateCorrectionDialog'

const COLLAPSE_THRESHOLD = 240

export function History() {
  const history = useAppStore((s) => s.history)
  const setHistory = useAppStore((s) => s.setHistory)
  const activityRevision = useAppStore((s) => s.activityRevision)
  const setCorrectionRules = useAppStore((s) => s.setCorrectionRules)
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [menuEntryId, setMenuEntryId] = useState<number | null>(null)
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<number>>(() => new Set())
  const [correctionEntry, setCorrectionEntry] = useState<HistoryEntry | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [historyCount, setHistoryCount] = useState<number | null>(null)
  const menuTriggerEntryId = useRef<number | null>(null)
  const historyRequestId = useRef(0)

  useEffect(() => {
    let cancelled = false
    const requestId = ++historyRequestId.current
    Promise.all([getHistory(200, 0), getHistoryCount()])
      .then(([entries, count]) => {
        if (!cancelled && historyRequestId.current === requestId) {
          setHistory(entries)
          setHistoryCount(count)
        }
      })
      .catch((error) => console.warn('Failed to load history:', error))
    return () => {
      cancelled = true
    }
  }, [activityRevision, setHistory])

  const closeEntryMenu = useCallback(() => {
    setMenuEntryId(null)
    const entryId = menuTriggerEntryId.current
    window.setTimeout(() => {
      if (entryId === null) return
      document.querySelector<HTMLButtonElement>(`[data-history-menu-trigger="${entryId}"]`)?.focus()
    }, 0)
  }, [])

  useEffect(() => {
    if (menuEntryId === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeEntryMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeEntryMenu, menuEntryId])

  const filtered = useMemo(
    () =>
      search
        ? history.filter(
            (entry) =>
              entry.polished_text.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ||
              entry.raw_text.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ||
              entry.context_label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
        : history,
    [history, search],
  )

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id)
        window.setTimeout(() => setCopiedId(null), 1500)
      })
      .catch(() => toast.error(t('history.failedToCopy')))
  }

  const handleClear = async () => {
    try {
      historyRequestId.current += 1
      await clearHistory()
      setHistory([])
      setHistoryCount(0)
      setConfirmingClear(false)
    } catch (error) {
      console.error('Failed to clear history:', error)
      toast.error(t('history.failedToClear'))
    }
  }

  const handleCreateCorrection = async (pattern: string, replacement: string) => {
    try {
      await addCorrectionRule(pattern, replacement)
      setCorrectionRules(await getCorrectionRules())
      setCorrectionEntry(null)
      toast.success(t('history.correctionCreated'))
    } catch (error) {
      console.error('Failed to create correction from history:', error)
      toast.error(t('history.failedToCreateCorrection'))
      throw error
    }
  }

  const toggleExpanded = (entryId: number) => {
    setExpandedEntryIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  const outputStatusLabel = (status: string | null) => {
    switch (status) {
      case 'partial':
        return t('history.outputStatus.partial')
      case 'fallback':
        return t('history.outputStatus.fallback')
      case 'clipboard_fallback':
        return t('history.outputStatus.clipboardFallback')
      default:
        return null
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    for (const entry of filtered) {
      const entryDate = parseHistoryDate(entry.created_at)
      const label = !entryDate
        ? entry.created_at.split('T')[0] || entry.created_at.split(' ')[0]
        : isSameCalendarDay(entryDate, today)
          ? t('history.today')
          : isSameCalendarDay(entryDate, yesterday)
            ? t('history.yesterday')
            : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(entryDate)
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(entry)
    }
    return map
  }, [filtered, t])

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary text-text-primary">
      <header className="border-b border-border bg-bg-elevated px-5 py-4 min-[900px]:px-7">
        <div className="mx-auto flex w-full max-w-[980px] items-end justify-between gap-4">
          <h1 className="text-balance text-[19px] font-semibold tracking-[-0.025em]">
            {t('history.title')}
          </h1>
          <p className="text-[12px] tabular-nums text-text-tertiary">
            {historyCount === null ? '—' : new Intl.NumberFormat().format(historyCount)}{' '}
            {t('home.totalRecordings').toLocaleLowerCase()}
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 flex-col px-5 py-4 min-[900px]:px-7">
        <div className="flex items-center gap-2.5">
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              aria-hidden="true"
            />
            <input
              type="search"
              name="history-search"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('history.searchPlaceholder').replace(/\.\.\.$/, '…')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('history.searchPlaceholder').replace(/\.\.\.$/, '…')}
              className="h-10 w-full rounded-[10px] border border-border bg-bg-elevated pl-9 pr-3 text-[13px] text-text-primary transition-colors placeholder:text-text-tertiary focus:border-accent"
            />
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              aria-label={t('history.clearAll')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-border bg-bg-elevated text-text-tertiary transition-colors hover:border-error/30 hover:bg-error/5 hover:text-error"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        {confirmingClear && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-error/20 bg-error/8 px-3 py-2.5">
            <p className="min-w-[220px] flex-1 text-[12px] leading-relaxed text-text-secondary">
              {t('history.clearConfirm')}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="rounded-[7px] border border-border bg-bg-elevated px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-[7px] border border-error/25 bg-error/10 px-3 py-1.5 text-[12px] font-medium text-error hover:bg-error/15"
              >
                {t('history.confirmClear')}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-border bg-bg-elevated/50 p-8 text-center">
              <div>
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-[11px] bg-bg-secondary text-text-tertiary">
                  <AudioLinesIcon />
                </span>
                <p className="mt-3 text-[13px] font-medium text-text-secondary">
                  {search ? t('history.noResults') : t('history.noHistory')}
                </p>
                {!search && (
                  <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-text-tertiary">
                    {t('history.noHistoryHint')}
                  </p>
                )}
              </div>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([label, entries]) => (
              <section key={label} className="mb-6" aria-labelledby={`history-group-${label}`}>
                <div className="mb-2.5 flex items-center gap-3">
                  <h2
                    id={`history-group-${label}`}
                    className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary"
                  >
                    {label}
                  </h2>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] tabular-nums text-text-tertiary">
                    {entries.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {entries.map((entry) => {
                    const expanded = expandedEntryIds.has(entry.id)
                    const canExpand = entry.polished_text.length > COLLAPSE_THRESHOLD
                    const statusLabel = outputStatusLabel(entry.output_status)
                    return (
                      <article
                        key={entry.id}
                        className="history-entry group rounded-[12px] border border-border bg-bg-elevated px-4 py-3.5 transition-colors hover:border-accent/25"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p
                              className={`whitespace-pre-wrap text-[13px] leading-[1.65] text-text-primary ${canExpand && !expanded ? 'line-clamp-3' : ''}`}
                            >
                              {entry.polished_text}
                            </p>
                            {canExpand && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(entry.id)}
                                aria-expanded={expanded}
                                className="mt-1.5 inline-flex min-h-6 items-center gap-1 bg-transparent text-[12px] font-medium text-accent hover:underline"
                              >
                                {expanded ? t('history.showLess') : t('history.showMore')}
                                {expanded ? (
                                  <ChevronUp size={12} aria-hidden="true" />
                                ) : (
                                  <ChevronDown size={12} aria-hidden="true" />
                                )}
                              </button>
                            )}
                            <AppContextMeta
                              iconKey={entry.context_icon_key}
                              family={entry.context_family}
                              label={entry.context_label}
                              time={formatHistoryTime(entry.created_at)}
                              providerKind={entry.provider_kind}
                              browserAccessStatus={entry.browser_access_status}
                            />
                            {statusLabel && (
                              <p className="mt-1 break-words text-[11px] leading-snug text-warning">
                                {statusLabel}
                                {entry.output_error ? ` · ${entry.output_error}` : ''}
                              </p>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleCopy(entry.id, entry.polished_text)}
                              className="grid h-8 w-8 place-items-center rounded-[7px] bg-transparent text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-accent"
                              aria-label={t('history.copyText')}
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  menuTriggerEntryId.current = entry.id
                                  setMenuEntryId((current) =>
                                    current === entry.id ? null : entry.id,
                                  )
                                }}
                                data-history-menu-trigger={entry.id}
                                aria-label={t('history.moreActions')}
                                aria-haspopup="menu"
                                aria-expanded={menuEntryId === entry.id}
                                className="grid h-8 w-8 place-items-center rounded-[7px] bg-transparent text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
                              >
                                <MoreHorizontal size={14} aria-hidden="true" />
                              </button>
                              {menuEntryId === entry.id && (
                                <>
                                  <button
                                    type="button"
                                    aria-label={t('common.cancel')}
                                    className="fixed inset-0 z-30 cursor-default bg-transparent"
                                    onClick={closeEntryMenu}
                                  />
                                  <div
                                    role="menu"
                                    className="absolute right-0 top-9 z-40 min-w-40 rounded-[9px] border border-border bg-bg-elevated py-1 shadow-float"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setMenuEntryId(null)
                                        setCorrectionEntry(entry)
                                      }}
                                      className="h-8 w-full bg-transparent px-3 text-left text-[12px] text-text-primary hover:bg-bg-secondary"
                                    >
                                      {t('history.createCorrection')}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {copiedId === entry.id && (
                          <p
                            className="mt-2 text-right text-[12px] font-medium text-success"
                            role="status"
                          >
                            {t('history.copied')}
                          </p>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      {correctionEntry && (
        <CreateCorrectionDialog
          entry={correctionEntry}
          onCancel={() => {
            setCorrectionEntry(null)
            const entryId = menuTriggerEntryId.current
            window.setTimeout(() => {
              if (entryId === null) return
              document
                .querySelector<HTMLButtonElement>(`[data-history-menu-trigger="${entryId}"]`)
                ?.focus()
            }, 0)
          }}
          onSave={handleCreateCorrection}
        />
      )}
    </div>
  )
}

function AudioLinesIcon() {
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden="true">
      {[7, 14, 10, 16, 8].map((height, index) => (
        <span key={index} className="w-[2px] rounded-full bg-current" style={{ height }} />
      ))}
    </span>
  )
}

function parseHistoryDate(value: string) {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatHistoryTime(value: string) {
  const date = parseHistoryDate(value)
  return date
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
    : ''
}
