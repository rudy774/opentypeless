import type {
  BackupCiphertext,
  PlanId,
  ReservationResult,
  SafeAuditEvent,
  SealedSecret,
  SubscriptionSource,
  SubscriptionStatus,
  UsageReservation,
  UsageSettlement,
} from './types.js'

export interface IdempotencyResult {
  state: 'new' | 'pending' | 'replay' | 'conflict'
  status?: number
  response?: unknown
}

export interface EntitlementTransition {
  userId: string
  plan: PlanId
  source: SubscriptionSource
  displayName: string
  subscriptionEnd: Date | null
  subscriptionStatus: string | null
  licenseStatus?: 'pending' | 'active' | 'refunded' | 'deactivated' | null
  cloudWordsLimit: number
  stripeCustomerId?: string
  stripeSubscriptionId?: string | null
}

export interface OAuthTransaction {
  clientState: string
  codeChallenge: string
  provider: 'google' | 'github'
}

export interface DesktopCodeInput extends OAuthTransaction {
  codeHash: string
  userId: string
  sessionToken: SealedSecret
  expiresAt: Date
}

export type DesktopCodeExchange =
  | { state: 'ok'; sessionToken: SealedSecret }
  | { state: 'invalid' | 'expired' | 'replayed' }

export interface ServiceStore {
  ready(): Promise<boolean>
  consumeRateLimit(
    scope: string,
    keyHash: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean>
  reconcileStaleOperations(): Promise<void>
  createOAuthTransaction(
    transactionHash: string,
    transaction: OAuthTransaction,
    expiresAt: Date,
  ): Promise<void>
  consumeOAuthTransaction(transactionHash: string): Promise<OAuthTransaction | null>
  createDesktopCode(input: DesktopCodeInput): Promise<void>
  consumeDesktopCode(codeHash: string, verifierChallenge: string): Promise<DesktopCodeExchange>
  getSubscription(userId: string): Promise<SubscriptionStatus>
  reserveUsage(reservation: UsageReservation, cloudWordLimit: number): Promise<ReservationResult>
  settleUsage(userId: string, stageKey: string, settlement: UsageSettlement): Promise<void>
  releaseUsage(userId: string, stageKey: string): Promise<void>
  beginIdempotency(
    userId: string,
    route: string,
    key: string,
    requestDigest: string,
  ): Promise<IdempotencyResult>
  completeIdempotency(
    userId: string,
    route: string,
    key: string,
    status: number,
    response: unknown,
  ): Promise<void>
  abandonIdempotency(userId: string, route: string, key: string): Promise<void>
  saveBackup(userId: string, backup: BackupCiphertext): Promise<void>
  createAccountExport(
    tokenHash: string,
    userId: string,
    artifact: SealedSecret,
    expiresAt: Date,
  ): Promise<void>
  consumeAccountExport(tokenHash: string): Promise<SealedSecret | null>
  getBackup(userId: string): Promise<BackupCiphertext | null>
  getOrCreateBillingCustomer(userId: string, email: string, name: string): Promise<string | null>
  setBillingCustomer(userId: string, customerId: string): Promise<void>
  findUserByBillingCustomer(customerId: string): Promise<string | null>
  applyEntitlement(transition: EntitlementTransition): Promise<void>
  markBillingEvent(eventId: string, eventType: string): Promise<boolean>
  completeBillingEvent(eventId: string): Promise<void>
  failBillingEvent(eventId: string): Promise<void>
  recordAudit(event: SafeAuditEvent): Promise<void>
  exportAccount(userId: string): Promise<Record<string, unknown>>
  scheduleDeletion(userId: string): Promise<void>
  deleteManagedAccount(userId: string): Promise<void>
}
