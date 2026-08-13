import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CreditCard, Loader2 } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { hasManagedCloudAccess, useAuthStore } from '../../stores/authStore'
import {
  CHECKOUT_PRODUCT_COPY,
  CLOUD_PLAN_BENEFITS,
  MANAGED_SERVICE_CONFIGURED,
  type CheckoutProduct,
} from '../../lib/constants'
import { createCheckout, getPlans, type ManagedServicePlan } from '../../lib/api'

function formatPlanPrice(
  plan: Pick<ManagedServicePlan, 'currency' | 'priceMinor'>,
  locale?: string,
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
  })
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(plan.priceMinor / 10 ** fractionDigits)
}

export function UpgradePage() {
  const {
    user,
    plan,
    source,
    displayName,
    quotaModel,
    displayWordsUsedEstimate,
    displayWordsLimit,
    cloudWordsUsed,
    cloudWordsLimit,
    sttSecondsUsed,
    sttSecondsLimit,
    llmTokensUsed,
    llmTokensLimit,
  } = useAuthStore()
  const { t } = useTranslation()
  const [loadingProduct, setLoadingProduct] = useState<CheckoutProduct | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalogueStatus, setCatalogueStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    MANAGED_SERVICE_CONFIGURED ? 'loading' : 'unavailable',
  )
  const [catalogue, setCatalogue] = useState<ManagedServicePlan[]>([])

  const hasCloudAccess = useAuthStore(hasManagedCloudAccess)
  const hasLifetimeAccess =
    hasCloudAccess && (plan === 'lifetime_starter' || source === 'lifetime' || source === 'appsumo')
  const hasMonthlyAccess =
    hasCloudAccess &&
    !hasLifetimeAccess &&
    (plan === 'pro' || source === 'stripe' || source === 'creem')
  const visiblePlans = hasMonthlyAccess
    ? catalogue.filter((offer) => offer.product === 'lifetime_starter')
    : catalogue
  const hasLifetimeCheckoutPlan = catalogue.some((offer) => offer.product === 'lifetime_starter')
  const wordsUsed =
    quotaModel === 'legacy_dual_meter' && displayWordsLimit > 0
      ? displayWordsUsedEstimate
      : cloudWordsUsed
  const wordsLimit =
    quotaModel === 'legacy_dual_meter' && displayWordsLimit > 0
      ? displayWordsLimit
      : cloudWordsLimit

  useEffect(() => {
    if (!MANAGED_SERVICE_CONFIGURED) {
      setCatalogue([])
      setCatalogueStatus('unavailable')
      return
    }

    let cancelled = false
    setCatalogueStatus('loading')
    getPlans()
      .then((plans) => {
        if (cancelled) return
        setCatalogue(plans.filter((offer) => offer.active))
        setCatalogueStatus('ready')
      })
      .catch((catalogueError) => {
        if (cancelled) return
        console.error('[plans] managed pricing catalogue unavailable', catalogueError)
        setCatalogue([])
        setCatalogueStatus('unavailable')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const canStartCheckout = (product: CheckoutProduct) => {
    if (catalogueStatus !== 'ready' || hasLifetimeAccess) return false
    if (product === 'lifetime_starter') return true
    return !hasCloudAccess
  }

  const handleSubscribe = async (product: CheckoutProduct) => {
    setLoadingProduct(product)
    setError(null)
    try {
      const { url } = await createCheckout('desktop', product)
      useAuthStore.setState({ checkoutPending: true })
      await openUrl(url)
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : t('account.toast.subscriptionFail'),
      )
    } finally {
      setLoadingProduct(null)
    }
  }

  return (
    <div className="max-w-[620px] mx-auto py-7 px-6 text-[13px]">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-text-primary">{t('upgrade.title')}</h1>
          <p className="mt-1 max-w-[420px] text-[13px] leading-5 text-text-secondary">
            {t('upgrade.subtitle')}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
            hasCloudAccess ? 'bg-accent-light text-accent' : 'bg-bg-secondary text-text-secondary'
          }`}
        >
          {t('upgrade.currentPlan', { plan: displayName })}
        </span>
      </header>

      {catalogueStatus === 'loading' ? (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-[14px] border border-border bg-bg-secondary/40 px-4 py-6 text-text-secondary">
          <Loader2 size={15} className="animate-spin" />
          <span>{t('upgrade.pricingLoading')}</span>
        </div>
      ) : catalogueStatus !== 'ready' || visiblePlans.length === 0 ? (
        <div className="mb-4 rounded-[14px] border border-border bg-bg-secondary/40 px-4 py-4">
          <p className="text-[13px] font-medium text-text-primary">
            {t('upgrade.pricingUnavailableTitle')}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-text-secondary">
            {t('upgrade.pricingUnavailable')}
          </p>
        </div>
      ) : (
        <div className={`grid gap-3 mb-4 ${hasMonthlyAccess ? '' : 'min-[620px]:grid-cols-2'}`}>
          {visiblePlans.map((offer) => {
            const isLoading = loadingProduct === offer.product
            const copy = CHECKOUT_PRODUCT_COPY[offer.product]
            const formattedAllowance = new Intl.NumberFormat().format(
              offer.allowances.cloudWordsPerMonth,
            )
            return (
              <section
                key={offer.product}
                className={`jelly-card flex rounded-[18px] p-4 ${
                  offer.product === 'lifetime_starter' ? 'ring-1 ring-accent/30' : ''
                }`}
              >
                <div className="relative z-[1] flex h-full w-full flex-col">
                  <h2 className="text-[14px] font-semibold text-text-primary">
                    {offer.displayName}
                  </h2>
                  <p className="mt-3 text-[24px] font-semibold leading-none text-text-primary">
                    {formatPlanPrice(offer)}
                    <span className="text-[13px] font-normal text-text-secondary">
                      {' '}
                      / {t(offer.billingInterval === 'month' ? 'upgrade.month' : 'upgrade.oneTime')}
                    </span>
                  </p>
                  <p className="mt-2 min-h-[36px] text-[12px] leading-5 text-text-secondary">
                    {t(copy.descriptionKey)}
                  </p>
                  {offer.allowances.cloudWordsPerMonth > 0 && (
                    <p className="mt-2 text-[11px] font-medium text-text-secondary">
                      {t('upgrade.cloudWordsAllowance', { amount: formattedAllowance })}
                    </p>
                  )}
                  {canStartCheckout(offer.product) && (
                    <div className="mt-auto pt-4">
                      <button
                        onClick={() => handleSubscribe(offer.product)}
                        disabled={loadingProduct !== null || !user}
                        className="jelly-btn-accent flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <CreditCard size={14} />
                        )}
                        {t(copy.ctaKey)}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <section className="mb-4 rounded-[18px] p-4 jelly-card">
        <div className="relative z-[1]">
          <h2 className="text-[12px] font-semibold text-text-primary">
            {t('upgrade.benefits.title')}
          </h2>
          <div className="mt-3 grid gap-2 min-[560px]:grid-cols-3">
            {CLOUD_PLAN_BENEFITS.map((benefit) => (
              <div key={benefit.labelKey} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-light text-accent">
                  <Check size={12} />
                </span>
                <span className="text-[13px] leading-5 text-text-primary">
                  {t(benefit.labelKey)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {hasCloudAccess && (
        <section className="mb-4 overflow-hidden rounded-[10px] border border-border">
          <div className="border-b border-border bg-bg-secondary/50 px-4 py-2.5">
            <h3 className="text-[13px] font-medium text-text-primary">
              {t('upgrade.usageThisMonth')}
            </h3>
          </div>
          <div className="px-4 py-3 space-y-3">
            {wordsLimit > 0 ? (
              <QuotaBar
                label={t('account.cloudWords', 'Cloud words')}
                used={wordsUsed}
                limit={wordsLimit}
                unit={t('account.quotaKWords', 'k words')}
                divisor={1000}
              />
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
        </section>
      )}

      {hasLifetimeAccess ? (
        <div className="py-3 text-center">
          <p className="text-text-secondary flex items-center justify-center gap-1.5">
            <Check size={14} className="text-accent" />
            {t('upgrade.thankYou')}
          </p>
        </div>
      ) : hasCloudAccess ? (
        <div className="py-3 text-center">
          <p className="text-text-secondary flex items-center justify-center gap-1.5">
            <Check size={14} className="text-accent" />
            {hasLifetimeCheckoutPlan
              ? t('upgrade.monthlyActiveLifetimeHint')
              : t('upgrade.monthlyActive')}
          </p>
          {error && <p className="text-red-500 text-[12px] mt-2 text-center">{error}</p>}
        </div>
      ) : (
        <>
          {!user && catalogueStatus === 'ready' && visiblePlans.length > 0 && (
            <p className="text-text-tertiary text-[12px] text-center mb-3">
              {t('upgrade.signInFirst')}
            </p>
          )}
          {error && <p className="text-red-500 text-[12px] mt-2 text-center">{error}</p>}
        </>
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
  const { t } = useTranslation()
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
      <div
        className="h-1.5 bg-bg-secondary rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('account.quotaUsage', {
          label,
          used: usedDisplay,
          limit: limitDisplay,
          unit,
        })}
      >
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
