import {
  API_BASE_URL,
  APP_VERSION_HEADER_VALUE,
  CLIENT_VERSION_HEADER,
  MANAGED_SERVICE_CONFIGURED,
  DEFAULT_CHECKOUT_PRODUCT,
  type CheckoutProduct,
} from './constants'
import { getCloudSessionToken, invalidateCloudSessionOnce } from './cloud-session'
import { parseBackupSettings, type BackupSettings } from './backup-settings'

const DEFAULT_TIMEOUT_MS = 30_000
export const BACKUP_SCHEMA_VERSION = 1

/**
 * Create an opaque retry key without falling back to predictable randomness.
 * A caller may retain the returned value when it intentionally retries the
 * same side effect; ordinary calls generate a fresh key.
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure random UUID generation is unavailable')
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class ManagedServiceUnavailableError extends Error {
  constructor() {
    super('Managed cloud service is not configured for this build')
    this.name = 'ManagedServiceUnavailableError'
  }
}

function requireManagedService(): void {
  if (!MANAGED_SERVICE_CONFIGURED) throw new ManagedServiceUnavailableError()
}

function authHeaders(): Record<string, string> {
  const token = getCloudSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function clientHeaders(): Record<string, string> {
  return { [CLIENT_VERSION_HEADER]: APP_VERSION_HEADER_VALUE }
}

type ManagedRequestOptions = RequestInit & {
  timeoutMs?: number
  authenticate?: boolean
}

async function request<T>(path: string, options?: ManagedRequestOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, authenticate = true, ...fetchOptions } = options ?? {}
  requireManagedService()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...clientHeaders(),
        ...(authenticate ? authHeaders() : {}),
        ...fetchOptions?.headers,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw parseCloudError(res.status, body, res.statusText)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class CloudApiError extends ApiError {
  constructor(
    status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(status, message)
    this.name = 'CloudApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCloudError(
  status: number,
  body: unknown,
  fallbackMessage = `Request failed (${status})`,
): CloudApiError {
  let code: string | null = null
  let message = fallbackMessage

  if (isRecord(body)) {
    const error = body.error
    if (typeof error === 'string' && error.trim()) {
      message = error
    } else if (isRecord(error)) {
      if (typeof error.code === 'string' && error.code.trim()) code = error.code
      if (typeof error.message === 'string' && error.message.trim()) message = error.message
    }
  }

  if (code === 'AUTH_SESSION_INVALID') {
    void invalidateCloudSessionOnce().catch((error) => {
      console.error('Failed to invalidate cloud session:', error)
    })
  }
  return new CloudApiError(status, code, message)
}

export class InvalidDesktopAuthExchangeError extends Error {
  constructor() {
    super('Managed service returned an invalid desktop authentication exchange')
    this.name = 'InvalidDesktopAuthExchangeError'
  }
}

export interface DesktopAuthExchangeResponse {
  token: string
}

function parseDesktopAuthExchange(value: unknown): DesktopAuthExchangeResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.token !== 'string' ||
    value.token.length < 16 ||
    value.token.length > 4096 ||
    !/^[\w\-._~+/]+=*$/.test(value.token)
  ) {
    throw new InvalidDesktopAuthExchangeError()
  }
  return { token: value.token }
}

/**
 * Exchanges a one-time desktop authorization code using its PKCE verifier.
 * This public endpoint deliberately omits browser credentials and bearer auth.
 */
export function exchangeDesktopAuthCode(
  code: string,
  codeVerifier: string,
): Promise<DesktopAuthExchangeResponse> {
  if (
    !/^[A-Za-z0-9\-._~]{16,2048}$/.test(code) ||
    !/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)
  ) {
    return Promise.reject(new InvalidDesktopAuthExchangeError())
  }

  return request<unknown>('/api/auth/desktop/exchange', {
    method: 'POST',
    authenticate: false,
    credentials: 'omit',
    body: JSON.stringify({ code, codeVerifier }),
  }).then(parseDesktopAuthExchange)
}

// Server-owned checkout catalogue
export type PlanBillingModel = 'subscription' | 'one_time'
export type PlanBillingInterval = 'month' | null

export interface ManagedServicePlan {
  product: CheckoutProduct
  active: boolean
  displayName: string
  billingModel: PlanBillingModel
  billingInterval: PlanBillingInterval
  currency: string
  priceMinor: number
  allowances: {
    cloudWordsPerMonth: number
  }
}

export class InvalidPlanCatalogueError extends Error {
  constructor() {
    super('Managed service returned an invalid plan catalogue')
    this.name = 'InvalidPlanCatalogueError'
  }
}

const PLAN_KEYS = [
  'product',
  'active',
  'displayName',
  'billingModel',
  'billingInterval',
  'currency',
  'priceMinor',
  'allowances',
] as const
const PLAN_ALLOWANCE_KEYS = ['cloudWordsPerMonth'] as const
const CHECKOUT_PRODUCTS: readonly CheckoutProduct[] = ['pro_monthly', 'lifetime_starter']

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

function isCheckoutProduct(value: unknown): value is CheckoutProduct {
  return typeof value === 'string' && CHECKOUT_PRODUCTS.includes(value as CheckoutProduct)
}

function parsePlan(value: unknown): ManagedServicePlan {
  if (!isRecord(value) || !hasExactKeys(value, PLAN_KEYS)) {
    throw new InvalidPlanCatalogueError()
  }

  const allowances = value.allowances
  if (
    !isRecord(allowances) ||
    !hasExactKeys(allowances, PLAN_ALLOWANCE_KEYS) ||
    typeof allowances.cloudWordsPerMonth !== 'number' ||
    !Number.isInteger(allowances.cloudWordsPerMonth) ||
    allowances.cloudWordsPerMonth < 0
  ) {
    throw new InvalidPlanCatalogueError()
  }

  if (
    !isCheckoutProduct(value.product) ||
    typeof value.active !== 'boolean' ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    typeof value.priceMinor !== 'number' ||
    !Number.isInteger(value.priceMinor) ||
    value.priceMinor < 0
  ) {
    throw new InvalidPlanCatalogueError()
  }

  const expectedBilling =
    value.product === 'pro_monthly'
      ? { model: 'subscription', interval: 'month' }
      : { model: 'one_time', interval: null }
  if (
    value.billingModel !== expectedBilling.model ||
    value.billingInterval !== expectedBilling.interval
  ) {
    throw new InvalidPlanCatalogueError()
  }

  return {
    product: value.product,
    active: value.active,
    displayName: value.displayName.trim(),
    billingModel: value.billingModel,
    billingInterval: value.billingInterval,
    currency: value.currency,
    priceMinor: value.priceMinor,
    allowances: { cloudWordsPerMonth: allowances.cloudWordsPerMonth },
  } as ManagedServicePlan
}

export function parsePlanCatalogue(value: unknown): ManagedServicePlan[] {
  if (!isRecord(value) || !hasExactKeys(value, ['plans']) || !Array.isArray(value.plans)) {
    throw new InvalidPlanCatalogueError()
  }

  const plans = value.plans.map(parsePlan)
  if (new Set(plans.map((plan) => plan.product)).size !== plans.length) {
    throw new InvalidPlanCatalogueError()
  }
  return plans
}

export function getPlans(): Promise<ManagedServicePlan[]> {
  return request<unknown>('/api/plans').then(parsePlanCatalogue)
}
// Subscription
export type SubscriptionPlan =
  | 'free'
  | 'pro'
  | 'lifetime_starter'
  | 'appsumo_tier1'
  | 'appsumo_tier2'
  | 'appsumo_tier3'

export type SubscriptionSource = 'free' | 'stripe' | 'creem' | 'lifetime' | 'appsumo'
export type LicenseStatus = 'pending' | 'active' | 'refunded' | 'deactivated'
export type QuotaModel = 'legacy_dual_meter' | 'cloud_words'

export interface SubscriptionStatus {
  plan: SubscriptionPlan
  source: SubscriptionSource
  displayName: string
  subscriptionEnd: string | null
  subscriptionStatus: string | null
  licenseStatus?: LicenseStatus | null
  quotaModel: QuotaModel
  displayWordsUsedEstimate: number
  displayWordsLimit: number
  displayWordsResetAt: string | null
  sttSecondsUsed: number
  sttSecondsLimit: number
  llmTokensUsed: number
  llmTokensLimit: number
  cloudWordsUsed: number
  cloudWordsLimit: number
  cloudWordsResetAt: string | null
  byokUnlimited: boolean
}

export class InvalidSubscriptionStatusError extends Error {
  constructor() {
    super('Managed service returned an invalid subscription status')
    this.name = 'InvalidSubscriptionStatusError'
  }
}

const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  'free',
  'pro',
  'lifetime_starter',
  'appsumo_tier1',
  'appsumo_tier2',
  'appsumo_tier3',
]
const SUBSCRIPTION_SOURCES: readonly SubscriptionSource[] = [
  'free',
  'stripe',
  'creem',
  'lifetime',
  'appsumo',
]
const LICENSE_STATUSES: readonly LicenseStatus[] = ['pending', 'active', 'refunded', 'deactivated']
const QUOTA_MODELS: readonly QuotaModel[] = ['legacy_dual_meter', 'cloud_words']
const SUBSCRIPTION_REQUIRED_KEYS = [
  'plan',
  'source',
  'displayName',
  'subscriptionEnd',
  'subscriptionStatus',
  'quotaModel',
  'displayWordsUsedEstimate',
  'displayWordsLimit',
  'displayWordsResetAt',
  'sttSecondsUsed',
  'sttSecondsLimit',
  'llmTokensUsed',
  'llmTokensLimit',
  'cloudWordsUsed',
  'cloudWordsLimit',
  'cloudWordsResetAt',
  'byokUnlimited',
] as const
const SUBSCRIPTION_ALLOWED_KEYS = [...SUBSCRIPTION_REQUIRED_KEYS, 'licenseStatus'] as const

function isEnumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maxLength)
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string' || value.length > 64) return false
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
  return rfc3339.test(value) && Number.isFinite(Date.parse(value))
}

function isSafeNonNegativeNumber(value: unknown, integer: boolean): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER &&
    (!integer || Number.isInteger(value))
  )
}

function hasValidPlanSourcePair(plan: SubscriptionPlan, source: SubscriptionSource): boolean {
  if (plan === 'free') return source === 'free'
  if (plan === 'pro') return source === 'stripe' || source === 'creem'
  if (plan === 'lifetime_starter') return source === 'lifetime'
  return source === 'appsumo'
}

export function parseSubscriptionStatus(value: unknown): SubscriptionStatus {
  if (!isRecord(value)) throw new InvalidSubscriptionStatusError()
  const keys = Object.keys(value)
  if (
    !SUBSCRIPTION_REQUIRED_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !(SUBSCRIPTION_ALLOWED_KEYS as readonly string[]).includes(key))
  ) {
    throw new InvalidSubscriptionStatusError()
  }

  if (
    !isEnumValue(value.plan, SUBSCRIPTION_PLANS) ||
    !isEnumValue(value.source, SUBSCRIPTION_SOURCES) ||
    !hasValidPlanSourcePair(value.plan, value.source) ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    value.displayName.length > 80 ||
    !isNullableIsoDate(value.subscriptionEnd) ||
    !isNullableString(value.subscriptionStatus, 80) ||
    !isEnumValue(value.quotaModel, QUOTA_MODELS) ||
    !isSafeNonNegativeNumber(value.displayWordsUsedEstimate, true) ||
    !isSafeNonNegativeNumber(value.displayWordsLimit, true) ||
    !isNullableIsoDate(value.displayWordsResetAt) ||
    !isSafeNonNegativeNumber(value.sttSecondsUsed, false) ||
    !isSafeNonNegativeNumber(value.sttSecondsLimit, false) ||
    !isSafeNonNegativeNumber(value.llmTokensUsed, true) ||
    !isSafeNonNegativeNumber(value.llmTokensLimit, true) ||
    !isSafeNonNegativeNumber(value.cloudWordsUsed, true) ||
    !isSafeNonNegativeNumber(value.cloudWordsLimit, true) ||
    !isNullableIsoDate(value.cloudWordsResetAt) ||
    typeof value.byokUnlimited !== 'boolean' ||
    !(
      value.licenseStatus === undefined ||
      value.licenseStatus === null ||
      isEnumValue(value.licenseStatus, LICENSE_STATUSES)
    )
  ) {
    throw new InvalidSubscriptionStatusError()
  }

  return {
    plan: value.plan,
    source: value.source,
    displayName: value.displayName.trim(),
    subscriptionEnd: value.subscriptionEnd,
    subscriptionStatus: value.subscriptionStatus,
    licenseStatus: value.licenseStatus,
    quotaModel: value.quotaModel,
    displayWordsUsedEstimate: value.displayWordsUsedEstimate,
    displayWordsLimit: value.displayWordsLimit,
    displayWordsResetAt: value.displayWordsResetAt,
    sttSecondsUsed: value.sttSecondsUsed,
    sttSecondsLimit: value.sttSecondsLimit,
    llmTokensUsed: value.llmTokensUsed,
    llmTokensLimit: value.llmTokensLimit,
    cloudWordsUsed: value.cloudWordsUsed,
    cloudWordsLimit: value.cloudWordsLimit,
    cloudWordsResetAt: value.cloudWordsResetAt,
    byokUnlimited: value.byokUnlimited,
  }
}

export function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return request<unknown>('/api/subscription/status').then(parseSubscriptionStatus)
}
// Checkout
export interface HostedBillingResponse {
  url: string
}

export class InvalidHostedBillingResponseError extends Error {
  constructor() {
    super('Managed service returned an invalid hosted billing link')
    this.name = 'InvalidHostedBillingResponseError'
  }
}

function parseHostedBillingResponse(value: unknown): HostedBillingResponse {
  if (!isRecord(value) || !hasExactKeys(value, ['url']) || typeof value.url !== 'string') {
    throw new InvalidHostedBillingResponseError()
  }

  const candidate = value.url.trim()
  if (candidate.length === 0 || candidate.length > 2048 || candidate !== value.url) {
    throw new InvalidHostedBillingResponseError()
  }

  try {
    const parsed = new URL(candidate)
    const managedOrigin = new URL(API_BASE_URL).origin
    if (
      parsed.protocol !== 'https:' ||
      parsed.origin !== managedOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new InvalidHostedBillingResponseError()
    }
    return { url: parsed.href }
  } catch (error) {
    if (error instanceof InvalidHostedBillingResponseError) throw error
    throw new InvalidHostedBillingResponseError()
  }
}

export function createCheckout(
  origin: 'desktop' | 'web' = 'desktop',
  product: CheckoutProduct = DEFAULT_CHECKOUT_PRODUCT,
  idempotencyKey = createIdempotencyKey(),
): Promise<HostedBillingResponse> {
  return request<unknown>('/api/checkout/create', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ origin, product }),
  }).then(parseHostedBillingResponse)
}

export interface CloudOperationContext {
  operationId?: string
  stageKey?: string
  requestType?: string
  clientVersion?: string
  hasSelectedText?: boolean
  translateEnabled?: boolean
  rawTextChars?: number
  selectedTextChars?: number
}

// Proxy STT
export async function proxyStt(
  audioBlob: Blob,
  language: string,
  context?: CloudOperationContext,
): Promise<{ text: string }> {
  const formData = new FormData()
  requireManagedService()
  formData.append('audio', audioBlob)
  formData.append('language', language)
  if (context?.operationId) formData.append('operationId', context.operationId)
  if (context?.stageKey) formData.append('stageKey', context.stageKey)
  if (context?.requestType) formData.append('requestType', context.requestType)
  if (context?.clientVersion) formData.append('clientVersion', context.clientVersion)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(`${API_BASE_URL}/api/proxy/stt`, {
      method: 'POST',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        ...clientHeaders(),
        ...authHeaders(),
      },
      body: formData,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw parseCloudError(res.status, body, res.statusText)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Proxy LLM
export function proxyLlm(
  messages: Array<{ role: string; content: string }>,
  context?: CloudOperationContext,
): Promise<{ text: string }> {
  return request('/api/proxy/llm', {
    method: 'POST',
    body: JSON.stringify({ messages, ...(context ? { context } : {}) }),
  })
}

// Backup
export interface BackupContent {
  history?: unknown
  dictionary?: unknown
  settings?: unknown
}

export interface BackupSnapshot extends BackupContent {
  version: number
  createdAt: string
}

export interface BackupUploadResponse {
  success: boolean
  version?: number
  createdAt?: string
}

export function uploadBackup(
  data: BackupContent,
  idempotencyKey = createIdempotencyKey(),
): Promise<BackupUploadResponse> {
  const snapshot: BackupSnapshot = {
    version: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    ...data,
  }
  return request('/api/backup/upload', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(snapshot),
  })
}

export interface BackupHistoryEntry {
  id: number
  created_at: string
  context_profile_id: string
  context_label: string
  context_icon_key: string
  context_family:
    | 'email'
    | 'work_chat'
    | 'personal_chat'
    | 'document'
    | 'project_management'
    | 'developer_collaboration'
    | 'prompt_or_code'
    | 'support'
    | 'social'
    | 'general'
  browser_access_status: 'available' | 'needs_permission' | 'not_applicable' | 'unknown'
  provider_kind: 'managed_cloud' | 'byok' | 'local'
  raw_text: string
  polished_text: string
  language: string | null
  duration_ms: number | null
  stt_ms: number | null
  llm_ms: number | null
  total_ms: number | null
  active_scene_id: string | null
  active_scene_source: string | null
  active_scene_name: string | null
  active_scene_prompt_chars: number | null
  active_scene_prompt_truncated: boolean
  output_status: string | null
  output_error: string | null
}

export interface BackupDictionaryEntry {
  id: number
  word: string
  pronunciation: string | null
}

export interface BackupCorrectionRule {
  id: number
  pattern: string
  replacement: string
  enabled: boolean
}

export interface BackupDictionary {
  entries: BackupDictionaryEntry[]
  correction_rules: BackupCorrectionRule[]
}

export interface BackupDownload {
  /** Absent together only for a legacy pre-versioning snapshot. */
  version?: typeof BACKUP_SCHEMA_VERSION
  /** Absent together only for a legacy pre-versioning snapshot. */
  createdAt?: string
  history: BackupHistoryEntry[]
  dictionary: BackupDictionary
  settings: BackupSettings
}

export class InvalidManagedBackupError extends Error {
  constructor() {
    super('Managed service returned an invalid backup snapshot')
    this.name = 'InvalidManagedBackupError'
  }
}

const BACKUP_MAX_BODY_BYTES = 8 * 1024 * 1024
const BACKUP_DOWNLOAD_KEYS = ['version', 'createdAt', 'history', 'dictionary', 'settings'] as const
const BACKUP_DOWNLOAD_REQUIRED_KEYS = ['history', 'dictionary', 'settings'] as const
const BACKUP_HISTORY_KEYS = [
  'id',
  'created_at',
  'context_profile_id',
  'context_label',
  'context_icon_key',
  'context_family',
  'browser_access_status',
  'provider_kind',
  'raw_text',
  'polished_text',
  'language',
  'duration_ms',
  'stt_ms',
  'llm_ms',
  'total_ms',
  'active_scene_id',
  'active_scene_source',
  'active_scene_name',
  'active_scene_prompt_chars',
  'active_scene_prompt_truncated',
  'output_status',
  'output_error',
] as const
const BACKUP_DICTIONARY_KEYS = ['entries', 'correction_rules'] as const
const BACKUP_DICTIONARY_ENTRY_KEYS = ['id', 'word', 'pronunciation'] as const
const BACKUP_CORRECTION_RULE_KEYS = ['id', 'pattern', 'replacement', 'enabled'] as const
const BACKUP_CONTEXT_FAMILIES = [
  'email',
  'work_chat',
  'personal_chat',
  'document',
  'project_management',
  'developer_collaboration',
  'prompt_or_code',
  'support',
  'social',
  'general',
] as const
const BACKUP_BROWSER_ACCESS_STATUSES = [
  'available',
  'needs_permission',
  'not_applicable',
  'unknown',
] as const
const BACKUP_PROVIDER_KINDS = ['managed_cloud', 'byok', 'local'] as const

function invalidManagedBackup(): never {
  throw new InvalidManagedBackupError()
}

function isBackupString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return typeof value === 'string' && value.length >= minimumLength && value.length <= maximumLength
}

function isBackupNullableString(value: unknown, maximumLength: number): value is string | null {
  return value === null || isBackupString(value, 0, maximumLength)
}

function isBackupInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function isBackupNullableInteger(value: unknown): value is number | null {
  return value === null || isBackupInteger(value)
}

function parseBackupHistoryEntry(value: unknown): BackupHistoryEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BACKUP_HISTORY_KEYS) ||
    !isBackupInteger(value.id) ||
    !isBackupString(value.created_at, 1, 64) ||
    !isBackupString(value.context_profile_id, 0, 200) ||
    !isBackupString(value.context_label, 0, 200) ||
    !isBackupString(value.context_icon_key, 0, 100) ||
    !isEnumValue(value.context_family, BACKUP_CONTEXT_FAMILIES) ||
    !isEnumValue(value.browser_access_status, BACKUP_BROWSER_ACCESS_STATUSES) ||
    !isEnumValue(value.provider_kind, BACKUP_PROVIDER_KINDS) ||
    !isBackupString(value.raw_text, 0, 1_000_000) ||
    !isBackupString(value.polished_text, 0, 1_000_000) ||
    (value.raw_text.length === 0 && value.polished_text.length === 0) ||
    !isBackupNullableString(value.language, 100) ||
    !isBackupNullableInteger(value.duration_ms) ||
    !isBackupNullableInteger(value.stt_ms) ||
    !isBackupNullableInteger(value.llm_ms) ||
    !isBackupNullableInteger(value.total_ms) ||
    !isBackupNullableString(value.active_scene_id, 200) ||
    !isBackupNullableString(value.active_scene_source, 100) ||
    !isBackupNullableString(value.active_scene_name, 200) ||
    !isBackupNullableInteger(value.active_scene_prompt_chars) ||
    typeof value.active_scene_prompt_truncated !== 'boolean' ||
    !isBackupNullableString(value.output_status, 100) ||
    !isBackupNullableString(value.output_error, 2000)
  ) {
    return invalidManagedBackup()
  }

  return {
    id: value.id,
    created_at: value.created_at,
    context_profile_id: value.context_profile_id,
    context_label: value.context_label,
    context_icon_key: value.context_icon_key,
    context_family: value.context_family,
    browser_access_status: value.browser_access_status,
    provider_kind: value.provider_kind,
    raw_text: value.raw_text,
    polished_text: value.polished_text,
    language: value.language,
    duration_ms: value.duration_ms,
    stt_ms: value.stt_ms,
    llm_ms: value.llm_ms,
    total_ms: value.total_ms,
    active_scene_id: value.active_scene_id,
    active_scene_source: value.active_scene_source,
    active_scene_name: value.active_scene_name,
    active_scene_prompt_chars: value.active_scene_prompt_chars,
    active_scene_prompt_truncated: value.active_scene_prompt_truncated,
    output_status: value.output_status,
    output_error: value.output_error,
  }
}

function parseBackupDictionaryEntry(value: unknown): BackupDictionaryEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BACKUP_DICTIONARY_ENTRY_KEYS) ||
    !isBackupInteger(value.id) ||
    !isBackupString(value.word, 1, 100) ||
    !isBackupNullableString(value.pronunciation, 100)
  ) {
    return invalidManagedBackup()
  }
  return { id: value.id, word: value.word, pronunciation: value.pronunciation }
}

function parseBackupCorrectionRule(value: unknown): BackupCorrectionRule {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BACKUP_CORRECTION_RULE_KEYS) ||
    !isBackupInteger(value.id) ||
    !isBackupString(value.pattern, 1, 120) ||
    !isBackupString(value.replacement, 1, 120) ||
    typeof value.enabled !== 'boolean'
  ) {
    return invalidManagedBackup()
  }
  return {
    id: value.id,
    pattern: value.pattern,
    replacement: value.replacement,
    enabled: value.enabled,
  }
}

function parseBackupDictionary(value: unknown): BackupDictionary {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BACKUP_DICTIONARY_KEYS) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 10_000 ||
    !Array.isArray(value.correction_rules) ||
    value.correction_rules.length > 10_000
  ) {
    return invalidManagedBackup()
  }
  return {
    entries: value.entries.map(parseBackupDictionaryEntry),
    correction_rules: value.correction_rules.map(parseBackupCorrectionRule),
  }
}

function hasAcceptableBackupEncodedSize(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= BACKUP_MAX_BODY_BYTES
  } catch {
    return false
  }
}

export function parseBackupDownload(value: unknown): BackupDownload {
  if (!isRecord(value) || !hasAcceptableBackupEncodedSize(value)) {
    return invalidManagedBackup()
  }

  const keys = Object.keys(value)
  if (
    !BACKUP_DOWNLOAD_REQUIRED_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    keys.some((key) => !(BACKUP_DOWNLOAD_KEYS as readonly string[]).includes(key))
  ) {
    return invalidManagedBackup()
  }

  const hasVersion = Object.prototype.hasOwnProperty.call(value, 'version')
  const hasCreatedAt = Object.prototype.hasOwnProperty.call(value, 'createdAt')
  if (
    hasVersion !== hasCreatedAt ||
    (hasVersion && value.version !== BACKUP_SCHEMA_VERSION) ||
    (hasCreatedAt && !isNullableIsoDate(value.createdAt)) ||
    value.createdAt === null ||
    !Array.isArray(value.history) ||
    value.history.length > 5000
  ) {
    return invalidManagedBackup()
  }

  const parsed: BackupDownload = {
    history: value.history.map(parseBackupHistoryEntry),
    dictionary: parseBackupDictionary(value.dictionary),
    settings: parseBackupSettings(value.settings),
  }
  if (hasVersion && hasCreatedAt) {
    parsed.version = BACKUP_SCHEMA_VERSION
    parsed.createdAt = value.createdAt as string
  }
  return parsed
}

export function downloadBackup(): Promise<BackupDownload> {
  return request<unknown>('/api/backup/download').then(parseBackupDownload)
}
// Scenes
export interface ScenePack {
  id: string
  name: string
  description: string
  category: string
  promptTemplate: string
  dictionaryTerms: Array<{ word: string; pronunciation?: string }>
  isPro: boolean
}

export function getScenes(): Promise<ScenePack[]> {
  return request('/api/scenes')
}

// Subscription portal
export function createPortalSession(): Promise<HostedBillingResponse> {
  return request<unknown>('/api/subscription/portal', { method: 'POST' }).then(
    parseHostedBillingResponse,
  )
}
