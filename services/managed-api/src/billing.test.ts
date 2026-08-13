import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { StripeBilling } from './billing.js'
import type { ServiceConfig } from './config.js'
import { ServiceError } from './errors.js'
import type { EntitlementTransition, ServiceStore } from './store.js'

function config(): ServiceConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 8787,
    apiOrigin: 'https://api.example.test',
    websiteOrigin: 'https://www.example.test',
    databaseUrl: 'postgres://test',
    databaseSsl: false,
    databasePoolMax: 2,
    runMigrationsOnStart: false,
    trustProxyHops: 0,
    authSecret: 'a'.repeat(32),
    backupKey: Buffer.alloc(32, 8),
    backupKeyId: 'primary',
    corsOrigins: new Set(),
    desktopDeepLinkScheme: 'rudyopentypeless',
    elevenLabsModel: 'scribe_v2',
    geminiModel: 'gemini-2.5-flash',
    stripeSecretKey: 'sk_test_placeholder',
    stripeWebhookSecret: 'whsec_placeholder',
    stripeProMonthlyPriceId: 'price_pro',
    stripeLifetimeStarterPriceId: 'price_lifetime',
    proMonthlyCloudWords: 100_000,
    lifetimeCloudWords: 25_000,
    logLevel: 'error',
    shutdownGraceMs: 5000,
  }
}

function fakeStripe(overrides: Record<string, unknown> = {}): Stripe {
  return {
    prices: {
      retrieve: async (id: string) =>
        id === 'price_pro'
          ? {
              id,
              active: true,
              unit_amount: 1200,
              currency: 'usd',
              recurring: { interval: 'month' },
            }
          : { id, active: true, unit_amount: 4900, currency: 'usd', recurring: null },
    },
    customers: {
      create: async () => ({ id: 'cus_test' }),
      del: async () => ({ id: 'cus_test', deleted: true }),
    },
    checkout: {
      sessions: {
        create: async () => ({
          id: 'cs_test',
          url: 'https://checkout.stripe.com/c/pay/cs_test#checkout',
        }),
      },
    },
    billingPortal: {
      sessions: {
        create: async () => ({ id: 'bps_test', url: 'https://billing.stripe.com/p/session/test' }),
      },
    },
    subscriptions: {
      retrieve: async () => ({
        id: 'sub_test',
        status: 'active',
        customer: 'cus_test',
        metadata: { opentypelessUserId: 'user_1' },
        items: { data: [{ current_period_end: 1_800_000_000 }] },
      }),
      list: async () => ({ data: [] }),
      cancel: async () => ({}),
    },
    webhooks: {
      constructEvent: () => {
        throw new Error('not configured in this test')
      },
    },
    ...overrides,
  } as unknown as Stripe
}

describe('Stripe billing', () => {
  it('loads authoritative prices and wraps Stripe URLs in an opaque managed-origin redirect', async () => {
    let customerId: string | undefined
    const store = {
      async getOrCreateBillingCustomer() {
        return null
      },
      async setBillingCustomer(_userId: string, value: string) {
        customerId = value
      },
    } as unknown as ServiceStore
    const billing = new StripeBilling(config(), store, fakeStripe())
    const plans = await billing.plans()
    expect(plans).toEqual([
      expect.objectContaining({
        product: 'pro_monthly',
        priceMinor: 1200,
        currency: 'USD',
        billingInterval: 'month',
      }),
      expect.objectContaining({
        product: 'lifetime_starter',
        priceMinor: 4900,
        billingModel: 'one_time',
      }),
    ])

    const hosted = await billing.checkout(
      { id: 'user_1', email: 'person@example.test', name: 'Person', emailVerified: true },
      'pro_monthly',
      'desktop',
      'checkout-intent-123456',
    )
    expect(customerId).toBe('cus_test')
    const managed = new URL(hosted)
    expect(managed.origin).toBe('https://api.example.test')
    expect(managed.pathname).toBe('/billing/redirect')
    expect(billing.redirect(managed.searchParams.get('token')!)).toBe(
      'https://checkout.stripe.com/c/pay/cs_test#checkout',
    )
    expect(() => billing.redirect(`${managed.searchParams.get('token')}tampered`)).toThrow(
      ServiceError,
    )
  })

  it('applies Stripe subscription webhooks idempotently with the configured quota', async () => {
    const transitions: EntitlementTransition[] = []
    let completed = false
    const store = {
      async markBillingEvent() {
        return true
      },
      async completeBillingEvent() {
        completed = true
      },
      async applyEntitlement(transition: EntitlementTransition) {
        transitions.push(transition)
      },
      async findUserByBillingCustomer() {
        return 'user_1'
      },
    } as unknown as ServiceStore
    const event = {
      id: 'evt_test',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test',
          status: 'active',
          customer: 'cus_test',
          metadata: {},
          items: { data: [{ current_period_end: 1_800_000_000 }] },
        },
      },
    }
    const stripe = fakeStripe({
      webhooks: { constructEvent: () => event },
    })
    const billing = new StripeBilling(config(), store, stripe)
    await billing.webhook(Buffer.from('{}'), 'test-signature')

    expect(completed).toBe(true)
    expect(transitions).toEqual([
      expect.objectContaining({
        userId: 'user_1',
        plan: 'pro',
        source: 'stripe',
        subscriptionStatus: 'active',
        cloudWordsLimit: 100_000,
        stripeSubscriptionId: 'sub_test',
      }),
    ])
  })

  it('marks a failed webhook retryable instead of permanently consuming the event', async () => {
    let claims = 0
    let failures = 0
    const store = {
      async markBillingEvent() {
        claims += 1
        return true
      },
      async failBillingEvent() {
        failures += 1
      },
      async completeBillingEvent() {
        throw new Error('should not complete')
      },
      async applyEntitlement() {
        throw new Error('transient database failure')
      },
      async findUserByBillingCustomer() {
        return 'user_1'
      },
    } as unknown as ServiceStore
    const event = {
      id: 'evt_retryable',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test',
          status: 'active',
          customer: 'cus_test',
          metadata: {},
          items: { data: [{ current_period_end: 1_800_000_000 }] },
        },
      },
    }
    const billing = new StripeBilling(
      config(),
      store,
      fakeStripe({ webhooks: { constructEvent: () => event } }),
    )

    await expect(billing.webhook(Buffer.from('{}'), 'test-signature')).rejects.toMatchObject({
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
    })
    await expect(billing.webhook(Buffer.from('{}'), 'test-signature')).rejects.toMatchObject({
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
    })
    expect(claims).toBe(2)
    expect(failures).toBe(2)
  })

  it('rejects invalid webhook signatures with a content-free stable error', async () => {
    const store = {} as ServiceStore
    const billing = new StripeBilling(config(), store, fakeStripe())
    const error = await billing
      .webhook(Buffer.from('secret body'), 'bad')
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ status: 400, code: 'INVALID_REQUEST' })
    expect(String(error)).not.toContain('secret body')
  })
})
