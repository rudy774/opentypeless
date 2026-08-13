import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT_PATH = path.join(ROOT, 'docs', 'managed-service.openapi.json')
const CLIENT_SOURCE_PATHS = {
  api: path.join(ROOT, 'src', 'lib', 'api.ts'),
  authClient: path.join(ROOT, 'src', 'lib', 'auth-client.ts'),
  constants: path.join(ROOT, 'src', 'lib', 'constants.ts'),
  backupSettings: path.join(ROOT, 'src', 'lib', 'backup-settings.ts'),
  account: path.join(ROOT, 'src', 'components', 'AccountPage', 'index.tsx'),
  onboarding: path.join(ROOT, 'src', 'components', 'Onboarding', 'AccountStep.tsx'),
  stt: path.join(ROOT, 'src-tauri', 'src', 'stt', 'cloud.rs'),
  llm: path.join(ROOT, 'src-tauri', 'src', 'llm', 'cloud.rs'),
  ask: path.join(ROOT, 'src-tauri', 'src', 'commands', 'ask.rs'),
  benchmark: path.join(ROOT, 'src-tauri', 'src', 'commands', 'llm.rs'),
  desktopAuthCallback: path.join(ROOT, 'src', 'lib', 'desktop-auth-callback.ts'),
  deepLink: path.join(ROOT, 'src', 'lib', 'deep-link.ts'),
  authStore: path.join(ROOT, 'src', 'stores', 'authStore.ts'),
}

const REQUIRED_OPERATIONS = {
  '/api/health/ready': ['get'],
  '/api/plans': ['get'],
  '/api/auth/sign-in/email': ['post'],
  '/api/auth/sign-up/email': ['post'],
  '/api/auth/send-verification-email': ['post'],
  '/api/auth/desktop-oauth': ['get'],
  '/api/auth/desktop/exchange': ['post'],
  '/api/opentypeless/auth/request-password-reset': ['post'],
  '/api/auth/get-session': ['get'],
  '/api/auth/sign-out': ['post'],
  '/api/auth/list-accounts': ['get'],
  '/api/auth/change-password': ['post'],
  '/api/opentypeless/auth/set-password': ['post'],
  '/api/subscription/status': ['get'],
  '/api/checkout/create': ['post'],
  '/api/subscription/portal': ['post'],
  '/api/proxy/stt': ['post'],
  '/api/proxy/llm': ['post'],
  '/api/proxy/ask': ['post'],
  '/api/backup/upload': ['post'],
  '/api/backup/download': ['get'],
  '/api/scenes': ['get'],
  '/api/account/export': ['post'],
  '/api/account': ['delete'],
}

const PUBLIC_OPERATIONS = new Set([
  'get /api/health/ready',
  'get /api/plans',
  'post /api/auth/sign-in/email',
  'post /api/auth/sign-up/email',
  'post /api/auth/send-verification-email',
  'get /api/auth/desktop-oauth',
  'post /api/auth/desktop/exchange',
  'post /api/opentypeless/auth/request-password-reset',
])

const IDEMPOTENT_OPERATIONS = new Set([
  'post /api/checkout/create',
  'post /api/backup/upload',
  'post /api/account/export',
  'delete /api/account',
])

const SUBSCRIPTION_FIELDS = [
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
]

const SUBSCRIPTION_ALLOWED_FIELDS = [...SUBSCRIPTION_FIELDS, 'licenseStatus']

const PLAN_FIELDS = [
  'product',
  'active',
  'displayName',
  'billingModel',
  'billingInterval',
  'currency',
  'priceMinor',
  'allowances',
]
const SCENE_FIELDS = [
  'id',
  'name',
  'description',
  'category',
  'promptTemplate',
  'dictionaryTerms',
  'isPro',
]

const BACKUP_HISTORY_FIELDS = [
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
]

const BACKUP_SETTINGS_FIELDS = [
  'stt_language',
  'polish_enabled',
  'context_adaptation_enabled',
  'voice_routing_flags',
  'polish_style',
  'polish_custom_prompt',
  'polish_chinese_script',
  'custom_scenes',
  'system_scene_overrides',
  'active_scene',
  'family_scene_assignments',
  'translate_enabled',
  'target_lang',
  'translation',
  'hotkey',
  'ask_hotkey',
  'hotkey_mode',
  'hotkeys',
  'output_mode',
  'insertion_strategy',
  'restore_clipboard_after_paste',
  'paste_shortcut',
  'windows_sendinput_newline_mode',
  'streaming_insert_enabled',
  'selected_text_enabled',
  'theme',
  'auto_start',
  'close_to_tray',
  'start_minimized',
  'max_recording_seconds',
  'history_enabled',
  'history_retention_days',
  'history_max_entries',
  'ui_language',
  'capsule_auto_hide',
]

const DEVICE_LOCAL_PROVIDER_ROUTING_FIELDS = [
  'stt_provider',
  'stt_custom_preset',
  'stt_custom_base_url',
  'stt_custom_model',
  'stt_volcengine_resource_id',
  'llm_provider',
  'llm_model',
  'llm_base_url',
]
const BACKUP_SECRET_NAME_TOKENS = [
  'apikey',
  'secret',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'password',
  'credential',
  'privatekey',
  'authorization',
  'cookie',
]

const STRICT_BACKUP_OBJECT_SCHEMAS = [
  'BackupHistoryEntry',
  'BackupDictionaryEntry',
  'BackupCorrectionRule',
  'BackupDictionary',
  'BackupShortcutBinding',
  'BackupHotkeyConfig',
  'BackupVoiceRoutingFlags',
  'BackupCustomScene',
  'BackupSystemSceneOverride',
  'BackupActiveScene',
  'BackupFamilySceneAssignment',
  'BackupTranslationConfig',
  'BackupSettings',
  'BackupSnapshot',
  'BackupDownload',
]
function hasParameter(operation, name) {
  return (operation.parameters ?? []).some(
    (entry) => entry?.name === name || entry?.$ref === `#/components/parameters/${name}`,
  )
}

function parameterByName(operation, name) {
  return (operation?.parameters ?? []).find((entry) => entry?.name === name)
}

function operationSchema(contract, route, method, contentType = 'application/json') {
  return contract.paths?.[route]?.[method]?.requestBody?.content?.[contentType]?.schema
}

function requireFields(schema, fields, label, fail) {
  for (const field of fields) {
    if (!schema?.required?.includes(field)) fail(`${label} must require ${field}`)
    if (!Object.hasOwn(schema?.properties ?? {}, field)) fail(`${label} must define ${field}`)
  }
}

function sameMembers(actual = [], expected = []) {
  return actual.length === expected.length && expected.every((entry) => actual.includes(entry))
}

function normalizedBackupPropertyName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function allowsNull(schema) {
  return (
    (Array.isArray(schema?.type) && schema.type.includes('null')) ||
    (schema?.oneOf ?? []).some((entry) => entry?.type === 'null')
  )
}

function validateStrictBackupSchemas(contract, fail) {
  const schemas = contract?.components?.schemas ?? {}

  for (const schemaName of STRICT_BACKUP_OBJECT_SCHEMAS) {
    const schema = schemas[schemaName]
    if (!schema) {
      fail(`missing strict backup schema ${schemaName}`)
      continue
    }
    if (schema.additionalProperties !== false) {
      fail(`${schemaName} must reject additional properties`)
    }

    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const entry of node) visit(entry)
        return
      }

      const isObjectSchema =
        node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))
      if (isObjectSchema && node.additionalProperties !== false) {
        fail(`${schemaName} contains an object schema that permits arbitrary properties`)
      }
      for (const propertyName of Object.keys(node.properties ?? {})) {
        const normalized = normalizedBackupPropertyName(propertyName)
        const rejected = BACKUP_SECRET_NAME_TOKENS.find((token) => normalized.includes(token))
        if (rejected) {
          fail(`${schemaName} permits credential-like property ${propertyName}`)
        }
      }
      for (const value of Object.values(node)) visit(value)
    }

    visit(schema)
  }
}

export function validateManagedServiceContract(contract) {
  const errors = []
  const fail = (message) => errors.push(message)

  if (typeof contract?.openapi !== 'string' || !contract.openapi.startsWith('3.1.')) {
    fail('openapi must declare the 3.1 specification')
  }
  if (!contract?.security?.some((entry) => Object.hasOwn(entry, 'bearerAuth'))) {
    fail('global bearerAuth security is required')
  }
  const bearer = contract?.components?.securitySchemes?.bearerAuth
  if (bearer?.type !== 'http' || bearer?.scheme !== 'bearer') {
    fail('components.securitySchemes.bearerAuth must be an HTTP bearer scheme')
  }

  for (const [route, methods] of Object.entries(REQUIRED_OPERATIONS)) {
    for (const method of methods) {
      const operation = contract?.paths?.[route]?.[method]
      const key = `${method} ${route}`
      if (!operation) {
        fail(`missing required operation ${key}`)
        continue
      }
      const isPublic = PUBLIC_OPERATIONS.has(key)
      if (isPublic && (operation.security?.length ?? -1) !== 0) {
        fail(`${key} must explicitly opt out of bearer authentication`)
      }
      if (!isPublic && Array.isArray(operation.security) && operation.security.length === 0) {
        fail(`${key} must remain authenticated`)
      }
      if (IDEMPOTENT_OPERATIONS.has(key) && !hasParameter(operation, 'IdempotencyKey')) {
        fail(`${key} must require the shared Idempotency-Key parameter`)
      }
    }
  }

  if (contract?.components?.parameters?.IdempotencyKey?.name !== 'Idempotency-Key') {
    fail('IdempotencyKey must use the Idempotency-Key HTTP header')
  }
  if (contract?.components?.parameters?.ClientVersion?.name !== 'X-OpenTypeless-Version') {
    fail('ClientVersion must use the desktop X-OpenTypeless-Version header')
  }

  const oauth = contract?.paths?.['/api/auth/desktop-oauth']?.get
  const oauthNames = (oauth?.parameters ?? []).map((entry) => entry?.name)
  if (!sameMembers(oauthNames, ['provider', 'callbackURL'])) {
    fail('/api/auth/desktop-oauth query must be exactly provider and callbackURL')
  }
  const provider = parameterByName(oauth, 'provider')
  if (!sameMembers(provider?.schema?.enum, ['google', 'github'])) {
    fail('/api/auth/desktop-oauth provider must support google and github')
  }
  const callback = parameterByName(oauth, 'callbackURL')
  if (!callback?.required || callback?.schema?.format !== 'uri') {
    fail('/api/auth/desktop-oauth must require callbackURL as a URI')
  }
  const oauthDescription = `${oauth?.description ?? ''} ${oauth?.responses?.['302']?.description ?? ''}`
  for (const term of [
    'exact configured HTTPS API origin',
    '/auth/callback',
    'state',
    'one-time',
    'code_challenge',
    'S256',
    'never put a bearer token in a URL',
  ]) {
    if (!oauthDescription.includes(term)) fail(`/api/auth/desktop-oauth must document ${term}`)
  }

  const exchange = contract?.paths?.['/api/auth/desktop/exchange']?.post
  const exchangeRequest = operationSchema(contract, '/api/auth/desktop/exchange', 'post')
  if (
    !sameMembers(exchangeRequest?.required, ['code', 'codeVerifier']) ||
    !sameMembers(Object.keys(exchangeRequest?.properties ?? {}), ['code', 'codeVerifier']) ||
    exchangeRequest?.additionalProperties !== false
  ) {
    fail('/api/auth/desktop/exchange request must be exactly code and codeVerifier')
  }
  if (
    exchangeRequest?.properties?.codeVerifier?.minLength !== 43 ||
    exchangeRequest?.properties?.codeVerifier?.maxLength !== 128
  ) {
    fail('/api/auth/desktop/exchange must enforce the RFC 7636 verifier length')
  }
  const exchangeResponse = exchange?.responses?.['200']?.content?.['application/json']?.schema
  if (
    !sameMembers(exchangeResponse?.required, ['token']) ||
    !sameMembers(Object.keys(exchangeResponse?.properties ?? {}), ['token']) ||
    exchangeResponse?.additionalProperties !== false
  ) {
    fail('/api/auth/desktop/exchange response must contain exactly token')
  }
  if (exchange?.responses?.['200']?.headers?.['Cache-Control']?.schema?.const !== 'no-store') {
    fail('/api/auth/desktop/exchange must return Cache-Control no-store')
  }
  const exchangeDescription = `${exchange?.description ?? ''} ${exchange?.responses?.['200']?.description ?? ''}`
  for (const term of [
    'one-time',
    'five minutes',
    'SHA-256',
    'constant time',
    'atomically consume',
    'rate-limit',
    'never log',
  ]) {
    if (!exchangeDescription.includes(term)) {
      fail(`/api/auth/desktop/exchange must document ${term}`)
    }
  }
  for (const status of ['400', '409', '410', '429']) {
    if (!exchange?.responses?.[status]) {
      fail(`/api/auth/desktop/exchange must define a ${status} failure response`)
    }
  }

  const plansOperation = contract?.paths?.['/api/plans']?.get
  if (plansOperation?.operationId !== 'getPlans') {
    fail('/api/plans operationId must be getPlans')
  }
  const plansResponse = plansOperation?.responses?.['200']?.content?.['application/json']?.schema
  requireFields(plansResponse, ['plans'], '/api/plans response', fail)
  if (plansResponse?.additionalProperties !== false) {
    fail('/api/plans response must reject additional properties')
  }
  if (plansResponse?.properties?.plans?.items?.$ref !== '#/components/schemas/Plan') {
    fail('/api/plans response must use the Plan schema')
  }

  const plan = contract?.components?.schemas?.Plan
  if (!sameMembers(plan?.required, PLAN_FIELDS)) {
    fail('Plan must require the exact desktop catalogue shape')
  }
  if (!sameMembers(Object.keys(plan?.properties ?? {}), PLAN_FIELDS)) {
    fail('Plan properties must exactly match the desktop catalogue shape')
  }
  if (plan?.additionalProperties !== false) {
    fail('Plan must reject additional properties')
  }
  if (!sameMembers(plan?.properties?.product?.enum, ['pro_monthly', 'lifetime_starter'])) {
    fail('Plan product must match CheckoutProduct')
  }
  if (plan?.properties?.active?.type !== 'boolean') {
    fail('Plan active must be boolean')
  }
  if (plan?.properties?.currency?.pattern !== '^[A-Z]{3}$') {
    fail('Plan currency must be an uppercase three-letter code')
  }
  if (
    plan?.properties?.priceMinor?.type !== 'integer' ||
    plan?.properties?.priceMinor?.minimum !== 0
  ) {
    fail('Plan priceMinor must be a nonnegative integer')
  }
  if (plan?.properties?.allowances?.$ref !== '#/components/schemas/PlanAllowances') {
    fail('Plan allowances must use the strict PlanAllowances schema')
  }
  const allowances = contract?.components?.schemas?.PlanAllowances
  if (
    !sameMembers(allowances?.required, ['cloudWordsPerMonth']) ||
    !sameMembers(Object.keys(allowances?.properties ?? {}), ['cloudWordsPerMonth']) ||
    allowances?.additionalProperties !== false ||
    allowances?.properties?.cloudWordsPerMonth?.type !== 'integer' ||
    allowances?.properties?.cloudWordsPerMonth?.minimum !== 0
  ) {
    fail('PlanAllowances must define only nonnegative integer cloudWordsPerMonth')
  }
  const planConditions = JSON.stringify(plan?.allOf ?? [])
  for (const value of ['pro_monthly', 'subscription', 'month', 'lifetime_starter', 'one_time']) {
    if (!planConditions.includes(value)) fail(`Plan billing rules must constrain ${value}`)
  }
  const checkout = operationSchema(contract, '/api/checkout/create', 'post')
  requireFields(checkout, ['origin', 'product'], '/api/checkout/create', fail)
  if (!sameMembers(checkout?.properties?.origin?.enum, ['desktop', 'web'])) {
    fail('/api/checkout/create origin must match the desktop/web client type')
  }
  if (!sameMembers(checkout?.properties?.product?.enum, ['pro_monthly', 'lifetime_starter'])) {
    fail('/api/checkout/create product must match CheckoutProduct')
  }

  const stt = operationSchema(contract, '/api/proxy/stt', 'post', 'multipart/form-data')
  requireFields(stt, ['audio', 'operationId', 'stageKey', 'requestType'], '/api/proxy/stt', fail)
  if (!stt?.properties?.requestType?.enum?.includes('voice_pipeline')) {
    fail('/api/proxy/stt requestType must allow the Rust voice_pipeline payload')
  }
  const llm = operationSchema(contract, '/api/proxy/llm', 'post')
  requireFields(llm, ['messages', 'context'], '/api/proxy/llm', fail)
  for (const field of ['stream', 'contextMetadata', 'voiceIntentMetadata']) {
    if (!Object.hasOwn(llm?.properties ?? {}, field)) fail(`/api/proxy/llm must define ${field}`)
  }
  const ask = operationSchema(contract, '/api/proxy/ask', 'post')
  requireFields(ask, ['question', 'context'], '/api/proxy/ask', fail)
  if (!Object.hasOwn(ask?.properties ?? {}, 'voiceIntentMetadata')) {
    fail('/api/proxy/ask must define voiceIntentMetadata')
  }
  const operationContext = contract?.components?.schemas?.OperationContext
  requireFields(
    operationContext,
    ['operationId', 'stageKey', 'requestType'],
    'OperationContext',
    fail,
  )
  for (const requestType of ['voice_pipeline', 'ask_anything', 'connection_benchmark']) {
    if (!operationContext?.properties?.requestType?.enum?.includes(requestType)) {
      fail(`OperationContext must allow Rust requestType ${requestType}`)
    }
  }

  const schemas = contract?.components?.schemas ?? {}
  const backup = schemas.BackupSnapshot
  requireFields(
    backup,
    ['version', 'createdAt', 'history', 'dictionary', 'settings'],
    'BackupSnapshot',
    fail,
  )
  if (backup?.properties?.version?.const !== 1) {
    fail('BackupSnapshot version must be pinned to the current desktop schema version 1')
  }
  if (backup?.properties?.history?.items?.$ref !== '#/components/schemas/BackupHistoryEntry') {
    fail('BackupSnapshot history must use the strict BackupHistoryEntry schema')
  }
  if (backup?.properties?.dictionary?.$ref !== '#/components/schemas/BackupDictionary') {
    fail('BackupSnapshot dictionary must use the strict BackupDictionary schema')
  }
  if (backup?.properties?.settings?.$ref !== '#/components/schemas/BackupSettings') {
    fail('BackupSnapshot settings must use the strict BackupSettings schema')
  }

  const history = schemas.BackupHistoryEntry
  if (!sameMembers(history?.required, BACKUP_HISTORY_FIELDS)) {
    fail('BackupHistoryEntry must require the complete desktop history shape')
  }
  if (!sameMembers(Object.keys(history?.properties ?? {}), BACKUP_HISTORY_FIELDS)) {
    fail('BackupHistoryEntry properties must exactly match the desktop history allow-list')
  }
  for (const field of [
    'language',
    'duration_ms',
    'stt_ms',
    'llm_ms',
    'total_ms',
    'active_scene_id',
    'active_scene_source',
    'active_scene_name',
    'active_scene_prompt_chars',
    'output_status',
    'output_error',
  ]) {
    if (!allowsNull(history?.properties?.[field])) {
      fail(`BackupHistoryEntry ${field} must preserve the desktop nullable shape`)
    }
  }

  const dictionary = schemas.BackupDictionary
  if (!sameMembers(dictionary?.required, ['entries', 'correction_rules'])) {
    fail('BackupDictionary must require entries and correction_rules')
  }
  if (
    dictionary?.properties?.entries?.items?.$ref !== '#/components/schemas/BackupDictionaryEntry'
  ) {
    fail('BackupDictionary entries must use BackupDictionaryEntry')
  }
  if (
    dictionary?.properties?.correction_rules?.items?.$ref !==
    '#/components/schemas/BackupCorrectionRule'
  ) {
    fail('BackupDictionary correction_rules must use BackupCorrectionRule')
  }
  if (!allowsNull(schemas.BackupDictionaryEntry?.properties?.pronunciation)) {
    fail('BackupDictionaryEntry pronunciation must remain nullable')
  }

  const settings = schemas.BackupSettings
  if (!sameMembers(settings?.required, BACKUP_SETTINGS_FIELDS)) {
    fail('BackupSettings must require the complete current desktop settings allow-list')
  }
  if (!sameMembers(Object.keys(settings?.properties ?? {}), BACKUP_SETTINGS_FIELDS)) {
    fail('BackupSettings properties must exactly match the desktop settings allow-list')
  }
  for (const field of DEVICE_LOCAL_PROVIDER_ROUTING_FIELDS) {
    if (settings?.required?.includes(field) || Object.hasOwn(settings?.properties ?? {}, field)) {
      fail(`BackupSettings must not synchronize device-local provider routing field ${field}`)
    }
  }
  if (!allowsNull(schemas.BackupActiveScene)) {
    fail('BackupActiveScene must preserve the desktop nullable shape')
  }
  for (const field of ['ask', 'translate', 'editSelection', 'switchScene', 'openApp']) {
    if (!allowsNull(schemas.BackupHotkeyConfig?.properties?.[field])) {
      fail(`BackupHotkeyConfig ${field} must preserve the desktop nullable shape`)
    }
  }

  const policy = backup?.['x-backup-policy']
  if (policy?.maxBodyBytes !== 8 * 1024 * 1024) {
    fail('BackupSnapshot must cap the encoded request body at 8 MiB')
  }
  if (policy?.maxJsonDepth !== 8) {
    fail('BackupSnapshot must cap parsed JSON depth at 8')
  }
  if (!sameMembers(policy?.rejectPropertyNameTokens, BACKUP_SECRET_NAME_TOKENS)) {
    fail('BackupSnapshot must define the complete defensive secret-name rejection list')
  }
  if (!String(policy?.propertyNameNormalization ?? '').includes('remove non-alphanumeric')) {
    fail('BackupSnapshot must define deterministic secret-name normalization')
  }
  if (policy?.rejectUrlCredentialsAndSecretQueryParameters !== true) {
    fail('BackupSnapshot must reject credentials and secret query parameters in URL settings')
  }
  const backupUpload = contract?.paths?.['/api/backup/upload']?.post
  if (backupUpload?.['x-enforce-backup-policy-before-storage'] !== true) {
    fail('/api/backup/upload must enforce the backup policy before storage')
  }
  for (const status of ['413', '422']) {
    if (!backupUpload?.responses?.[status]) {
      fail(`/api/backup/upload must document ${status} rejection`)
    }
  }
  if (backup?.properties?.history?.maxItems !== 5000) {
    fail('BackupSnapshot history must be capped at 5000 entries')
  }
  if (dictionary?.properties?.entries?.maxItems !== 10000) {
    fail('BackupDictionary entries must be capped at 10000')
  }
  if (dictionary?.properties?.correction_rules?.maxItems !== 10000) {
    fail('BackupDictionary correction_rules must be capped at 10000')
  }
  if (settings?.properties?.custom_scenes?.maxItems !== 100) {
    fail('BackupSettings custom_scenes must be capped at 100')
  }
  for (const field of ['dictationBindings', 'askBindings', 'translateBindings']) {
    const bindings = schemas.BackupHotkeyConfig?.properties?.[field]
    if (bindings?.maxItems !== 3) {
      fail(`BackupHotkeyConfig ${field} must be capped at 3 bindings`)
    }
    if (bindings?.uniqueItems !== true) {
      fail(`BackupHotkeyConfig ${field} must reject duplicate bindings`)
    }
  }
  if (schemas.BackupHotkeyConfig?.properties?.dictationBindings?.minItems !== 1) {
    fail('BackupHotkeyConfig dictationBindings must retain at least one binding')
  }
  const hotkeyConsistency = String(
    schemas.BackupHotkeyConfig?.['x-scalar-binding-consistency'] ?? '',
  )
  for (const term of ['dictation', 'ask', 'translate', 'first element', 'null']) {
    if (!hotkeyConsistency.includes(term)) {
      fail(`BackupHotkeyConfig must document scalar/list consistency for ${term}`)
    }
  }
  const maxSafeInteger = Number.MAX_SAFE_INTEGER
  for (const field of [
    'id',
    'duration_ms',
    'stt_ms',
    'llm_ms',
    'total_ms',
    'active_scene_prompt_chars',
  ]) {
    if (history?.properties?.[field]?.maximum !== maxSafeInteger) {
      fail(`BackupHistoryEntry ${field} must fit a JavaScript safe integer`)
    }
  }
  if (schemas.BackupDictionaryEntry?.properties?.id?.maximum !== maxSafeInteger) {
    fail('BackupDictionaryEntry id must fit a JavaScript safe integer')
  }
  if (schemas.BackupCorrectionRule?.properties?.id?.maximum !== maxSafeInteger) {
    fail('BackupCorrectionRule id must fit a JavaScript safe integer')
  }
  validateStrictBackupSchemas(contract, fail)

  const hostedUrlResponse = contract?.components?.responses?.Url
  const hostedUrlSchema = hostedUrlResponse?.content?.['application/json']?.schema
  if (
    !sameMembers(hostedUrlSchema?.required, ['url']) ||
    !sameMembers(Object.keys(hostedUrlSchema?.properties ?? {}), ['url']) ||
    hostedUrlSchema?.additionalProperties !== false ||
    hostedUrlSchema?.properties?.url?.format !== 'uri' ||
    hostedUrlSchema?.properties?.url?.maxLength !== 2048
  ) {
    fail('hosted billing response must be the exact bounded { url } shape')
  }
  const hostedUrlDescription = `${hostedUrlResponse?.description ?? ''} ${hostedUrlSchema?.description ?? ''} ${hostedUrlSchema?.properties?.url?.description ?? ''}`
  for (const term of [
    'exact configured managed API origin',
    'no user-info credentials or fragment',
    'external browser',
    'never opens an arbitrary provider origin directly',
  ]) {
    if (!hostedUrlDescription.includes(term)) {
      fail(`hosted billing response must document ${term}`)
    }
  }
  for (const route of ['/api/checkout/create', '/api/subscription/portal']) {
    if (contract?.paths?.[route]?.post?.responses?.['200']?.$ref !== '#/components/responses/Url') {
      fail(`${route} must use the strict managed-origin hosted URL response`)
    }
  }
  const backupResponse =
    contract?.paths?.['/api/backup/upload']?.post?.responses?.['200']?.content?.['application/json']
      ?.schema
  requireFields(backupResponse, ['success'], '/api/backup/upload response', fail)
  if (
    contract?.paths?.['/api/backup/download']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema?.$ref !== '#/components/schemas/BackupDownload'
  ) {
    fail('/api/backup/download must use the legacy-tolerant BackupDownload client shape')
  }
  const download = schemas.BackupDownload
  if (download?.['x-max-encoded-response-bytes'] !== 8 * 1024 * 1024) {
    fail('BackupDownload must cap the encoded response at 8 MiB')
  }
  if (!sameMembers(download?.required, ['history', 'dictionary', 'settings'])) {
    fail('BackupDownload must require all current backup content sections')
  }
  if (download?.properties?.history?.items?.$ref !== '#/components/schemas/BackupHistoryEntry') {
    fail('BackupDownload history must use BackupHistoryEntry')
  }
  if (download?.properties?.dictionary?.$ref !== '#/components/schemas/BackupDictionary') {
    fail('BackupDownload dictionary must use BackupDictionary')
  }
  if (download?.properties?.settings?.$ref !== '#/components/schemas/BackupSettings') {
    fail('BackupDownload settings must use BackupSettings')
  }

  const subscriptionStatus = contract?.components?.schemas?.SubscriptionStatus
  requireFields(subscriptionStatus, SUBSCRIPTION_FIELDS, 'SubscriptionStatus', fail)
  if (
    !sameMembers(subscriptionStatus?.required, SUBSCRIPTION_FIELDS) ||
    !sameMembers(Object.keys(subscriptionStatus?.properties ?? {}), SUBSCRIPTION_ALLOWED_FIELDS) ||
    subscriptionStatus?.additionalProperties !== false
  ) {
    fail('SubscriptionStatus must use the exact fail-closed desktop entitlement shape')
  }
  if (
    !sameMembers(subscriptionStatus?.properties?.plan?.enum, [
      'free',
      'pro',
      'lifetime_starter',
      'appsumo_tier1',
      'appsumo_tier2',
      'appsumo_tier3',
    ]) ||
    !sameMembers(subscriptionStatus?.properties?.source?.enum, [
      'free',
      'creem',
      'lifetime',
      'appsumo',
    ]) ||
    !sameMembers(subscriptionStatus?.properties?.quotaModel?.enum, [
      'legacy_dual_meter',
      'cloud_words',
    ])
  ) {
    fail('SubscriptionStatus must constrain plan, source, and quota model enums')
  }
  requireFields(contract?.components?.schemas?.ScenePack, SCENE_FIELDS, 'ScenePack', fail)

  const codes =
    contract?.components?.schemas?.ErrorEnvelope?.properties?.error?.properties?.code?.enum ?? []
  for (const code of ['AUTH_SESSION_INVALID', 'QUOTA_EXHAUSTED', 'QUOTA_RESERVATION_CONFLICT']) {
    if (!codes.includes(code)) fail(`ErrorEnvelope must define stable code ${code}`)
  }

  const serialized = JSON.stringify(contract).toLowerCase()
  for (const upstreamIdentity of ['opentypeless.com', 'github.com/opentypeless']) {
    if (serialized.includes(upstreamIdentity)) {
      fail(`contract contains upstream identity ${upstreamIdentity}`)
    }
  }
  const servers = contract?.servers ?? []
  if (servers.some((server) => !String(server?.url ?? '').startsWith('https://'))) {
    fail('all managed-service server URLs must use HTTPS')
  }

  return errors
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : ''
}

function rustRequestTypes(source) {
  const values = []
  const pattern = /"requestType"[\s\S]{0,80}?"([a-z_]+)"/g
  for (const match of source.matchAll(pattern)) values.push(match[1])
  return values
}

export function loadManagedServiceClientSources() {
  return Object.fromEntries(
    Object.entries(CLIENT_SOURCE_PATHS).map(([name, sourcePath]) => [
      name,
      fs.readFileSync(sourcePath, 'utf8'),
    ]),
  )
}

export function validateManagedServiceClientParity(contract, sources) {
  const errors = []
  const fail = (message) => errors.push(message)
  const api = sources?.api ?? ''
  const plans = sourceBetween(api, 'export function getPlans(', '// Subscription')
  for (const fragment of ["request<unknown>('/api/plans')", '.then(parsePlanCatalogue)']) {
    if (!plans.includes(fragment)) fail(`getPlans client must include ${fragment}`)
  }
  if (!api.includes('export function parsePlanCatalogue(value: unknown)')) {
    fail('getPlans must validate unknown catalogue data before exposing offers')
  }
  const subscription = sourceBetween(api, 'export function parseSubscriptionStatus(', '// Checkout')
  for (const fragment of [
    'InvalidSubscriptionStatusError',
    'SUBSCRIPTION_REQUIRED_KEYS.every',
    'SUBSCRIPTION_ALLOWED_KEYS',
    'hasValidPlanSourcePair',
    'isSafeNonNegativeNumber',
  ]) {
    if (!subscription.includes(fragment)) {
      fail(`getSubscriptionStatus client must fail closed with ${fragment}`)
    }
  }
  if (!api.includes("request<unknown>('/api/subscription/status').then(parseSubscriptionStatus)")) {
    fail('getSubscriptionStatus must validate unknown service data before exposing entitlements')
  }

  const checkout = sourceBetween(
    api,
    'export function createCheckout(',
    'export interface CloudOperationContext',
  )
  const backup = sourceBetween(
    api,
    'export function uploadBackup(',
    'export interface BackupDownload',
  )
  const idempotency = sourceBetween(
    api,
    'export function createIdempotencyKey(',
    'export class ManagedServiceUnavailableError',
  )

  for (const [name, block] of [
    ['createCheckout', checkout],
    ['uploadBackup', backup],
  ]) {
    if (!block.includes("'Idempotency-Key': idempotencyKey")) {
      fail(`${name} must send its idempotency key in the Idempotency-Key header`)
    }
    if (!block.includes('idempotencyKey = createIdempotencyKey()')) {
      fail(`${name} must securely generate a default idempotency key`)
    }
  }
  if (!checkout.includes('JSON.stringify({ origin, product })')) {
    fail('createCheckout client payload must remain { origin, product }')
  }
  for (const fragment of [
    'version: BACKUP_SCHEMA_VERSION',
    'createdAt: new Date().toISOString()',
    '...data',
  ]) {
    if (!backup.includes(fragment)) fail(`uploadBackup client payload must include ${fragment}`)
  }

  const hostedBilling = sourceBetween(api, '// Checkout', 'export interface CloudOperationContext')
  const portalBilling =
    sourceBetween(api, '// Subscription portal', '') ||
    api.slice(api.indexOf('// Subscription portal'))
  for (const fragment of [
    "hasExactKeys(value, ['url'])",
    "parsed.protocol !== 'https:'",
    'parsed.origin !== managedOrigin',
    'parsed.username',
    'parsed.password',
    'parsed.hash',
    '.then(parseHostedBillingResponse)',
  ]) {
    if (!hostedBilling.includes(fragment) && !portalBilling.includes(fragment)) {
      fail(`hosted billing client must validate ${fragment}`)
    }
  }
  const accountBackup = sourceBetween(
    sources?.account ?? '',
    'const handleBackup = async () => {',
    'const handleRestore = async () => {',
  )
  for (const fragment of [
    'history: snapshot.history',
    'dictionary: snapshot.dictionary',
    'settings: safeConfig',
  ]) {
    if (!accountBackup.includes(fragment)) {
      fail(`AccountPage backup payload must include ${fragment}`)
    }
  }

  const settingsFactory = sourceBetween(
    sources?.backupSettings ?? '',
    'export function createBackupSettings(',
    'export function mergeBackupSettings(',
  )
  for (const field of BACKUP_SETTINGS_FIELDS) {
    const objectProperty = new RegExp(`(?:^|\\n)\\s*${field}\\s*:`)
    const conditionalAssignment = new RegExp(`settings\\.${field}\\s*=`)
    if (!objectProperty.test(settingsFactory) && !conditionalAssignment.test(settingsFactory)) {
      fail(`createBackupSettings is missing contracted field ${field}`)
    }
  }
  if (!idempotency.includes('randomUUID') || !idempotency.includes('getRandomValues')) {
    fail('createIdempotencyKey must use Web Crypto UUID or secure random bytes')
  }
  if (idempotency.includes('Math.random')) {
    fail('createIdempotencyKey must never use Math.random')
  }

  const headerMatch = sources?.constants?.match(/CLIENT_VERSION_HEADER\s*=\s*['"]([^'"]+)['"]/)
  if (headerMatch?.[1] !== contract?.components?.parameters?.ClientVersion?.name) {
    fail('OpenAPI ClientVersion header must match src/lib/constants.ts')
  }

  const oauthTemplate =
    'desktop-oauth?provider=${provider}&callbackURL=${encodeURIComponent(callbackURL)}'
  for (const sourceName of ['account', 'onboarding']) {
    if (!sources?.[sourceName]?.includes(oauthTemplate)) {
      fail(`${sourceName} OAuth bridge must send provider and callbackURL`)
    }
  }

  const exchangeClient = sourceBetween(
    api,
    'export function exchangeDesktopAuthCode(',
    '// Server-owned checkout catalogue',
  )
  for (const fragment of [
    "request<unknown>('/api/auth/desktop/exchange'",
    'authenticate: false',
    "credentials: 'omit'",
    'JSON.stringify({ code, codeVerifier })',
    '.then(parseDesktopAuthExchange)',
  ]) {
    if (!exchangeClient.includes(fragment)) {
      fail(`exchangeDesktopAuthCode client must include ${fragment}`)
    }
  }
  if (
    !sources?.desktopAuthCallback?.includes(
      "callback.searchParams.set('code_challenge_method', 'S256')",
    ) ||
    !sources?.desktopAuthCallback?.includes('crypto.subtle.digest') ||
    !sources?.desktopAuthCallback?.includes('sessionStorage.setItem')
  ) {
    fail('desktop callback client must create and session-store an S256 PKCE transaction')
  }
  if (
    sources?.deepLink?.includes("params.get('token')") ||
    !sources?.deepLink?.includes("params.get('code')") ||
    !sources?.deepLink?.includes('consumeDesktopAuthTransaction(state)')
  ) {
    fail('deep-link client must accept only a one-time code bound to consumed state')
  }
  if (
    !sources?.authStore?.includes('exchangeDesktopAuthCode(code, codeVerifier)') ||
    !sources?.authStore?.includes('await persistSessionToken(token)')
  ) {
    fail('auth store must exchange and validate the code before persisting its token')
  }

  const requestHelper = sourceBetween(api, 'async function request<T>(', 'export class ApiError')
  if (!requestHelper.includes("credentials: 'omit'")) {
    fail('managed WebView request helper must omit ambient browser credentials')
  }
  if (api.includes("credentials: 'include'")) {
    fail('managed API client must never include ambient browser credentials')
  }
  const authClient = sources?.authClient ?? ''
  if (
    authClient.includes("credentials: 'include'") ||
    !authClient.includes("credentials: 'omit'") ||
    !authClient.includes('customFetchImpl: fetchWithToken')
  ) {
    fail('managed auth client must use bearer-only fetches with credentials omitted')
  }

  const backupDownload = sourceBetween(api, 'export function parseBackupDownload(', '// Scenes')
  for (const fragment of [
    'parseBackupSettings(value.settings)',
    "request<unknown>('/api/backup/download').then(parseBackupDownload)",
    'BACKUP_DOWNLOAD_REQUIRED_KEYS.every',
    'keys.some',
  ]) {
    if (!backupDownload.includes(fragment)) {
      fail(`downloadBackup must strictly validate service JSON with ${fragment}`)
    }
  }
  for (const field of DEVICE_LOCAL_PROVIDER_ROUTING_FIELDS) {
    const objectProperty = new RegExp(`(?:^|\\n)\\s*${field}\\s*:`)
    if (objectProperty.test(settingsFactory)) {
      fail(`createBackupSettings must not upload device-local provider routing field ${field}`)
    }
  }
  const operationTypes = new Set([
    ...rustRequestTypes(sources?.stt ?? ''),
    ...rustRequestTypes(sources?.llm ?? ''),
    ...rustRequestTypes(sources?.ask ?? ''),
    ...rustRequestTypes(sources?.benchmark ?? ''),
  ])
  const allowedTypes =
    contract?.components?.schemas?.OperationContext?.properties?.requestType?.enum ?? []
  for (const requestType of operationTypes) {
    if (!allowedTypes.includes(requestType)) {
      fail(`OpenAPI OperationContext is missing Rust requestType ${requestType}`)
    }
  }

  return errors
}

export function loadManagedServiceContract(contractPath = CONTRACT_PATH) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'))
}

export function runManagedServiceContractCheck(contractPath = CONTRACT_PATH) {
  const contract = loadManagedServiceContract(contractPath)
  const errors = [
    ...validateManagedServiceContract(contract),
    ...validateManagedServiceClientParity(contract, loadManagedServiceClientSources()),
  ]
  if (errors.length > 0) {
    console.error('Managed service contract check failed:')
    for (const error of errors) console.error(`- ${error}`)
    return 1
  }
  const operationCount = Object.values(REQUIRED_OPERATIONS).reduce(
    (total, methods) => total + methods.length,
    0,
  )
  console.log(
    `Managed service contract matches the desktop client boundary (${operationCount} operations).`,
  )
  console.log(
    'This check does not claim that a production service, billing, policies, or support exist.',
  )
  return 0
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) process.exitCode = runManagedServiceContractCheck()
