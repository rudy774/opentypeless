import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import Stripe from 'stripe'
import type { ServiceConfig } from './config.js'
import { ServiceError } from './errors.js'
import type { ServiceStore } from './store.js'
import type { AuthenticatedUser, PlanOffer, ProductId } from './types.js'

const HOSTED_LINK_VERSION = 1
const HOSTED_LINK_TTL_MS = 10 * 60 * 1000

function providerUnavailable(): ServiceError {
  return new ServiceError(
    503,
    'PROVIDER_UNAVAILABLE',
    'Billing is temporarily unavailable',
    true,
    1000,
  )
}

function stripeId(value: string | { id: string } | null): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function validateStripeRedirect(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw providerUnavailable()
  }
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(hostname === 'stripe.com' || hostname.endsWith('.stripe.com'))
  ) {
    throw providerUnavailable()
  }
  return url.href
}

class HostedRedirectCipher {
  constructor(
    private readonly config: ServiceConfig,
    private readonly now: () => number = Date.now,
  ) {}

  create(providerUrl: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        version: HOSTED_LINK_VERSION,
        expiresAt: this.now() + HOSTED_LINK_TTL_MS,
        url: validateStripeRedirect(providerUrl),
      }),
      'utf8',
    )
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.config.backupKey, iv)
    cipher.setAAD(Buffer.from('opentypeless-hosted-billing:v1', 'utf8'))
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
    const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
    return `${this.config.apiOrigin}/billing/redirect?token=${token}`
  }

  consume(token: string): string {
    if (!/^[A-Za-z0-9_-]{40,1800}$/.test(token))
      throw new ServiceError(404, 'INVALID_REQUEST', 'Billing link is invalid')
    try {
      const packed = Buffer.from(token, 'base64url')
      if (packed.length < 29) throw new Error('short token')
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.config.backupKey,
        packed.subarray(0, 12),
      )
      decipher.setAAD(Buffer.from('opentypeless-hosted-billing:v1', 'utf8'))
      decipher.setAuthTag(packed.subarray(12, 28))
      const raw = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString(
        'utf8',
      )
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (
        parsed.version !== HOSTED_LINK_VERSION ||
        typeof parsed.expiresAt !== 'number' ||
        parsed.expiresAt < this.now() ||
        typeof parsed.url !== 'string'
      ) {
        throw new Error('expired token')
      }
      return validateStripeRedirect(parsed.url)
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw new ServiceError(404, 'INVALID_REQUEST', 'Billing link is invalid or expired')
    }
  }
}

export interface BillingFacade {
  configured: boolean
  plans(): Promise<PlanOffer[]>
  checkout(
    user: AuthenticatedUser,
    product: ProductId,
    origin: 'desktop' | 'web',
    idempotencyKey: string,
  ): Promise<string>
  portal(user: AuthenticatedUser, idempotencyKey: string): Promise<string>
  cancelAccount(user: AuthenticatedUser): Promise<void>
  redirect(token: string): string
  webhook(rawBody: Buffer, signature: string): Promise<void>
}

class DisabledBilling implements BillingFacade {
  configured = false
  async plans(): Promise<PlanOffer[]> {
    return []
  }
  async checkout(): Promise<string> {
    throw providerUnavailable()
  }
  async portal(): Promise<string> {
    throw providerUnavailable()
  }
  async cancelAccount(): Promise<void> {}
  redirect(): string {
    throw new ServiceError(404, 'INVALID_REQUEST', 'Billing link is invalid')
  }
  async webhook(): Promise<void> {
    throw providerUnavailable()
  }
}

export class StripeBilling implements BillingFacade {
  configured = true
  private readonly stripe: Stripe
  private readonly redirects: HostedRedirectCipher
  private planCache?: { expiresAt: number; plans: PlanOffer[] }

  constructor(
    private readonly config: ServiceConfig,
    private readonly store: ServiceStore,
    stripeClient?: Stripe,
  ) {
    if (!config.stripeSecretKey || !config.stripeWebhookSecret || !config.stripeProMonthlyPriceId) {
      throw new Error('Stripe billing is not fully configured')
    }
    this.stripe =
      stripeClient ??
      new Stripe(config.stripeSecretKey, {
        maxNetworkRetries: 2,
        timeout: 15_000,
        telemetry: false,
      })
    this.redirects = new HostedRedirectCipher(config)
  }

  async plans(): Promise<PlanOffer[]> {
    if (this.planCache && this.planCache.expiresAt > Date.now()) return this.planCache.plans
    const products: Array<{ product: ProductId; priceId: string; name: string; words: number }> = [
      {
        product: 'pro_monthly',
        priceId: this.config.stripeProMonthlyPriceId!,
        name: 'OpenTypeless Pro',
        words: this.config.proMonthlyCloudWords,
      },
      ...(this.config.stripeLifetimeStarterPriceId
        ? [
            {
              product: 'lifetime_starter' as const,
              priceId: this.config.stripeLifetimeStarterPriceId,
              name: 'OpenTypeless Lifetime Starter',
              words: this.config.lifetimeCloudWords,
            },
          ]
        : []),
    ]
    try {
      const prices = await Promise.all(
        products.map(async (entry) => ({
          entry,
          price: await this.stripe.prices.retrieve(entry.priceId),
        })),
      )
      const plans = prices.map(({ entry, price }): PlanOffer => {
        if (
          !Number.isSafeInteger(price.unit_amount) ||
          price.unit_amount === null ||
          price.unit_amount < 0
        )
          throw providerUnavailable()
        const subscription = entry.product === 'pro_monthly'
        if (subscription && price.recurring?.interval !== 'month') throw providerUnavailable()
        if (!subscription && price.recurring) throw providerUnavailable()
        return {
          product: entry.product,
          active: price.active,
          displayName: entry.name,
          billingModel: subscription ? 'subscription' : 'one_time',
          billingInterval: subscription ? 'month' : null,
          currency: price.currency.toUpperCase(),
          priceMinor: price.unit_amount,
          allowances: { cloudWordsPerMonth: entry.words },
        }
      })
      this.planCache = { expiresAt: Date.now() + 5 * 60 * 1000, plans }
      return plans
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw providerUnavailable()
    }
  }

  async checkout(
    user: AuthenticatedUser,
    product: ProductId,
    origin: 'desktop' | 'web',
    idempotencyKey: string,
  ): Promise<string> {
    const plan = (await this.plans()).find(
      (candidate) => candidate.product === product && candidate.active,
    )
    if (!plan) throw new ServiceError(422, 'INVALID_REQUEST', 'The selected plan is unavailable')
    try {
      let customerId = await this.store.getOrCreateBillingCustomer(user.id, user.email, user.name)
      if (!customerId) {
        const customer = await this.stripe.customers.create(
          { email: user.email, name: user.name, metadata: { opentypelessUserId: user.id } },
          { idempotencyKey: `${idempotencyKey}:customer` },
        )
        customerId = customer.id
        await this.store.setBillingCustomer(user.id, customerId)
      }
      const priceId =
        product === 'pro_monthly'
          ? this.config.stripeProMonthlyPriceId!
          : this.config.stripeLifetimeStarterPriceId
      if (!priceId)
        throw new ServiceError(422, 'INVALID_REQUEST', 'The selected plan is unavailable')
      const metadata = { opentypelessUserId: user.id, product, origin }
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: product === 'pro_monthly' ? 'subscription' : 'payment',
          customer: customerId,
          client_reference_id: user.id,
          line_items: [{ price: priceId, quantity: 1 }],
          metadata,
          ...(product === 'pro_monthly'
            ? { subscription_data: { metadata } }
            : { payment_intent_data: { metadata } }),
          success_url: `${this.config.websiteOrigin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${this.config.websiteOrigin}/billing/cancelled`,
          allow_promotion_codes: product === 'pro_monthly',
        },
        { idempotencyKey },
      )
      if (!session.url) throw providerUnavailable()
      return this.redirects.create(session.url)
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw providerUnavailable()
    }
  }

  async portal(user: AuthenticatedUser, idempotencyKey: string): Promise<string> {
    const customerId = await this.store.getOrCreateBillingCustomer(user.id, user.email, user.name)
    if (!customerId) throw new ServiceError(404, 'INVALID_REQUEST', 'No billing account exists')
    try {
      const session = await this.stripe.billingPortal.sessions.create(
        { customer: customerId, return_url: `${this.config.websiteOrigin}/account` },
        { idempotencyKey },
      )
      return this.redirects.create(session.url)
    } catch {
      throw providerUnavailable()
    }
  }

  cancelAccount(user: AuthenticatedUser): Promise<void>
  async cancelAccount(user: AuthenticatedUser): Promise<void> {
    const customerId = await this.store.getOrCreateBillingCustomer(user.id, user.email, user.name)
    if (!customerId) return
    try {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      })
      for (const subscription of subscriptions.data) {
        if (subscription.status !== 'canceled')
          await this.stripe.subscriptions.cancel(subscription.id)
      }
      await this.stripe.customers.del(customerId)
    } catch {
      throw providerUnavailable()
    }
  }
  redirect(token: string): string {
    return this.redirects.consume(token)
  }

  async webhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.stripeWebhookSecret!,
      )
    } catch {
      throw new ServiceError(400, 'INVALID_REQUEST', 'Invalid billing webhook')
    }
    if (!(await this.store.markBillingEvent(event.id, event.type))) return
    try {
      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        await this.applyCheckout(event.data.object as Stripe.Checkout.Session)
      } else if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
      ) {
        await this.applySubscription(event.data.object as Stripe.Subscription)
      } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
        const charge = event.data.object as Stripe.Charge
        const userId = charge.metadata.opentypelessUserId
        if (userId && charge.metadata.product === 'lifetime_starter') {
          await this.store.applyEntitlement({
            userId,
            plan: 'free',
            source: 'free',
            displayName: 'Free',
            subscriptionEnd: null,
            subscriptionStatus: null,
            licenseStatus: event.type === 'charge.refunded' ? 'refunded' : 'deactivated',
            cloudWordsLimit: 0,
          })
        }
      }
      await this.store.completeBillingEvent(event.id)
    } catch {
      await this.store.failBillingEvent(event.id).catch(() => undefined)
      throw providerUnavailable()
    }
  }

  private async applyCheckout(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.opentypelessUserId ?? session.client_reference_id
    const product = session.metadata?.product
    const customerId = stripeId(session.customer)
    if (!userId || !customerId) throw providerUnavailable()
    await this.store.setBillingCustomer(userId, customerId)
    if (product === 'pro_monthly') {
      const subscriptionId = stripeId(session.subscription)
      if (!subscriptionId) throw providerUnavailable()
      await this.applySubscription(await this.stripe.subscriptions.retrieve(subscriptionId))
    } else if (product === 'lifetime_starter' && session.payment_status === 'paid') {
      await this.store.applyEntitlement({
        userId,
        plan: 'lifetime_starter',
        source: 'lifetime',
        displayName: 'Lifetime Starter',
        subscriptionEnd: null,
        subscriptionStatus: null,
        licenseStatus: 'active',
        cloudWordsLimit: this.config.lifetimeCloudWords,
        stripeCustomerId: customerId,
      })
    }
  }

  private async applySubscription(subscription: Stripe.Subscription): Promise<void> {
    const customerId = stripeId(subscription.customer)
    const userId =
      subscription.metadata.opentypelessUserId ||
      (customerId ? await this.store.findUserByBillingCustomer(customerId) : null)
    if (!userId) throw providerUnavailable()
    const active = subscription.status === 'active' || subscription.status === 'trialing'
    const currentPeriodEnd = subscription.items.data.reduce(
      (maximum, item) => Math.max(maximum, item.current_period_end),
      0,
    )
    await this.store.applyEntitlement({
      userId,
      plan: active ? 'pro' : 'free',
      source: active ? 'stripe' : 'free',
      displayName: active ? 'Pro' : 'Free',
      subscriptionEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      subscriptionStatus: subscription.status,
      licenseStatus: null,
      cloudWordsLimit: active ? this.config.proMonthlyCloudWords : 0,
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: active ? subscription.id : null,
    })
  }
}

export function createBilling(config: ServiceConfig, store: ServiceStore): BillingFacade {
  return config.stripeSecretKey && config.stripeWebhookSecret && config.stripeProMonthlyPriceId
    ? new StripeBilling(config, store)
    : new DisabledBilling()
}
