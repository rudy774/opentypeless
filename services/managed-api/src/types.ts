export type ProductId = 'pro_monthly' | 'lifetime_starter'
export type PlanId =
  | 'free'
  | 'pro'
  | 'lifetime_starter'
  | 'appsumo_tier1'
  | 'appsumo_tier2'
  | 'appsumo_tier3'
export type SubscriptionSource = 'free' | 'stripe' | 'lifetime' | 'appsumo' | 'creem'
export type QuotaModel = 'legacy_dual_meter' | 'cloud_words'
export type RequestType = 'voice_pipeline' | 'ask_anything' | 'connection_benchmark'
export type UsageKind = 'stt' | 'llm' | 'ask'

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
}

export interface OperationContext {
  operationId: string
  stageKey: string
  requestType: RequestType
}

export interface PlanOffer {
  product: ProductId
  active: boolean
  displayName: string
  billingModel: 'subscription' | 'one_time'
  billingInterval: 'month' | null
  currency: string
  priceMinor: number
  allowances: { cloudWordsPerMonth: number }
}

export interface SubscriptionStatus {
  plan: PlanId
  source: SubscriptionSource
  displayName: string
  subscriptionEnd: string | null
  subscriptionStatus: string | null
  licenseStatus?: 'pending' | 'active' | 'refunded' | 'deactivated' | null
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

export interface UsageReservation {
  userId: string
  operationId: string
  stageKey: string
  requestType: RequestType
  usageKind: UsageKind
  reservedUnits: number
  requestId: string
  providerClass: string
}

export interface UsageSettlement {
  cloudWords: number
  sttSeconds?: number
  llmTokens?: number
}

export interface ReservationResult {
  state: 'reserved' | 'replay' | 'conflict' | 'exhausted'
  response?: unknown
}

export interface SealedSecret {
  keyId: string
  iv: Buffer
  ciphertext: Buffer
  authTag: Buffer
}

export interface BackupCiphertext {
  keyId: string
  iv: Buffer
  ciphertext: Buffer
  authTag: Buffer
  version: number
  createdAt: string
  digest: string
}

export interface BillingEvent {
  id: string
  type: string
  created: number
  payload: unknown
}

export interface SafeAuditEvent {
  userId?: string
  event: string
  requestId: string
  metadata?: Record<string, string | number | boolean | null>
}
