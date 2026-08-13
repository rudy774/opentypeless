import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadManagedServiceClientSources,
  loadManagedServiceContract,
  validateManagedServiceClientParity,
  validateManagedServiceContract,
} from './check-managed-service-contract.mjs'

function clone(value) {
  return structuredClone(value)
}

test('the checked-in contract matches the desktop client boundary', () => {
  const contract = loadManagedServiceContract()
  assert.deepEqual(validateManagedServiceContract(contract), [])
  assert.deepEqual(
    validateManagedServiceClientParity(contract, loadManagedServiceClientSources()),
    [],
  )
})

test('a missing desktop endpoint is rejected', () => {
  const contract = clone(loadManagedServiceContract())
  delete contract.paths['/api/proxy/stt']
  assert.ok(
    validateManagedServiceContract(contract).includes(
      'missing required operation post /api/proxy/stt',
    ),
  )
})

test('public auth and idempotency boundaries cannot be weakened', () => {
  const contract = clone(loadManagedServiceContract())
  delete contract.paths['/api/auth/sign-in/email'].post.security
  contract.paths['/api/checkout/create'].post.parameters = []
  const errors = validateManagedServiceContract(contract)
  assert.ok(
    errors.includes(
      'post /api/auth/sign-in/email must explicitly opt out of bearer authentication',
    ),
  )
  assert.ok(
    errors.includes('post /api/checkout/create must require the shared Idempotency-Key parameter'),
  )
})

test('operational routes and service implementation parity cannot drift', () => {
  const contract = clone(loadManagedServiceContract())
  delete contract.paths['/api/billing/stripe/webhook']
  contract.paths['/api/account/export/download'].get.security = [{ bearerAuth: [] }]
  contract.paths['/api/auth/desktop/complete'].get.description = 'Redirect.'
  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('missing required operation post /api/billing/stripe/webhook'))
  assert.ok(
    errors.includes(
      'get /api/account/export/download must explicitly opt out of bearer authentication',
    ),
  )
  assert.ok(errors.includes('/api/auth/desktop/complete must document atomically consumes'))

  const sources = loadManagedServiceClientSources()
  const parityErrors = validateManagedServiceClientParity(loadManagedServiceContract(), {
    ...sources,
    serviceApp: sources.serviceApp.replaceAll("'/api/account/export/download'", "'/removed'"),
  })
  assert.ok(
    parityErrors.includes('managed service implementation is missing /api/account/export/download'),
  )
})
test('desktop OAuth must use provider and callbackURL with strict callback validation', () => {
  const contract = clone(loadManagedServiceContract())
  const oauth = contract.paths['/api/auth/desktop-oauth'].get
  oauth.parameters[1].name = 'state'
  oauth.description = 'Accept any callback.'
  oauth.responses['302'].description = 'Redirect.'
  const errors = validateManagedServiceContract(contract)
  assert.ok(
    errors.includes('/api/auth/desktop-oauth query must be exactly provider and callbackURL'),
  )
  assert.ok(errors.includes('/api/auth/desktop-oauth must document /auth/callback'))
  assert.ok(errors.includes('/api/auth/desktop-oauth must document one-time'))
})

test('desktop code exchange must remain public, exact, one-time, and non-cacheable', () => {
  const contract = clone(loadManagedServiceContract())
  const exchange = contract.paths['/api/auth/desktop/exchange'].post
  exchange.security = [{ bearerAuth: [] }]
  exchange.requestBody.content['application/json'].schema.properties.state = {
    type: 'string',
  }
  exchange.responses['200'].headers['Cache-Control'].schema.const = 'private'
  exchange.description = 'Exchange a credential.'
  exchange.responses['200'].description = 'Return a token.'

  const errors = validateManagedServiceContract(contract)
  assert.ok(
    errors.includes(
      'post /api/auth/desktop/exchange must explicitly opt out of bearer authentication',
    ),
  )
  assert.ok(
    errors.includes('/api/auth/desktop/exchange request must be exactly code and codeVerifier'),
  )
  assert.ok(errors.includes('/api/auth/desktop/exchange must return Cache-Control no-store'))
  assert.ok(errors.includes('/api/auth/desktop/exchange must document atomically consume'))
  assert.ok(errors.includes('/api/auth/desktop/exchange must document rate-limit'))
})

test('desktop PKCE client parity rejects a URL bearer regression', () => {
  const contract = loadManagedServiceContract()
  const sources = loadManagedServiceClientSources()
  sources.deepLink = sources.deepLink
    .replace("params.get('code')", "params.get('token')")
    .replace('consumeDesktopAuthTransaction(state)', 'loadDesktopAuthTransaction(state)')

  const errors = validateManagedServiceClientParity(contract, sources)
  assert.ok(
    errors.includes('deep-link client must accept only a one-time code bound to consumed state'),
  )
})

test('checkout and backup payload/response drift is rejected', () => {
  const contract = clone(loadManagedServiceContract())
  const checkout =
    contract.paths['/api/checkout/create'].post.requestBody.content['application/json'].schema
  checkout.required = ['plan']
  const backup = contract.components.schemas.BackupSnapshot
  backup.required = []
  backup.properties.dictionary.$ref = '#/components/schemas/UnsafeDictionary'
  const uploadResponse =
    contract.paths['/api/backup/upload'].post.responses['200'].content['application/json'].schema
  uploadResponse.required = ['ok']

  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('/api/checkout/create must require origin'))
  assert.ok(errors.includes('/api/checkout/create must require product'))
  assert.ok(errors.includes('BackupSnapshot must require version'))
  assert.ok(errors.includes('BackupSnapshot must require createdAt'))
  assert.ok(errors.includes('BackupSnapshot must require history'))
  assert.ok(errors.includes('BackupSnapshot must require dictionary'))
  assert.ok(errors.includes('BackupSnapshot must require settings'))
  assert.ok(
    errors.includes('BackupSnapshot dictionary must use the strict BackupDictionary schema'),
  )
  assert.ok(errors.includes('/api/backup/upload response must require success'))
})

test('backup schemas reject credential-like and arbitrary nested fields', () => {
  const contract = clone(loadManagedServiceContract())
  const settings = contract.components.schemas.BackupSettings
  settings.properties.stt_api_key = { type: 'string' }
  settings.required.push('stt_api_key')
  settings.properties.future_blob = {
    type: 'object',
    additionalProperties: true,
    properties: { arbitrary: { type: 'string' } },
  }
  settings.required.push('future_blob')

  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('BackupSettings permits credential-like property stt_api_key'))
  assert.ok(
    errors.includes('BackupSettings contains an object schema that permits arbitrary properties'),
  )
  assert.ok(
    errors.includes('BackupSettings properties must exactly match the desktop settings allow-list'),
  )
})

test('provider routing can never enter the cloud backup contract or client factory', () => {
  const contract = clone(loadManagedServiceContract())
  const settings = contract.components.schemas.BackupSettings
  settings.required.push('llm_provider', 'llm_base_url')
  settings.properties.llm_provider = { type: 'string', enum: ['gemini'] }
  settings.properties.llm_base_url = { type: 'string' }

  const errors = validateManagedServiceContract(contract)
  assert.ok(
    errors.includes(
      'BackupSettings must not synchronize device-local provider routing field llm_provider',
    ),
  )
  assert.ok(
    errors.includes(
      'BackupSettings must not synchronize device-local provider routing field llm_base_url',
    ),
  )

  const sources = loadManagedServiceClientSources()
  const parityErrors = validateManagedServiceClientParity(loadManagedServiceContract(), {
    ...sources,
    backupSettings: sources.backupSettings.replace(
      'stt_language: config.stt_language,',
      'llm_base_url: config.llm_base_url,\n    stt_language: config.stt_language,',
    ),
  })
  assert.ok(
    parityErrors.includes(
      'createBackupSettings must not upload device-local provider routing field llm_base_url',
    ),
  )
})

test('download parsing and ambient-cookie isolation cannot regress', () => {
  const contract = loadManagedServiceContract()
  const sources = loadManagedServiceClientSources()
  const errors = validateManagedServiceClientParity(contract, {
    ...sources,
    api: sources.api
      .replace("credentials: 'omit'", "credentials: 'include'")
      .replace(
        "request<unknown>('/api/backup/download').then(parseBackupDownload)",
        "request<BackupDownload>('/api/backup/download')",
      ),
    authClient: sources.authClient.replaceAll("credentials: 'omit'", "credentials: 'include'"),
  })

  assert.ok(errors.includes('managed WebView request helper must omit ambient browser credentials'))
  assert.ok(errors.includes('managed API client must never include ambient browser credentials'))
  assert.ok(
    errors.includes('managed auth client must use bearer-only fetches with credentials omitted'),
  )
  assert.ok(
    errors.includes(
      "downloadBackup must strictly validate service JSON with request<unknown>('/api/backup/download').then(parseBackupDownload)",
    ),
  )
})

test('hosted billing redirects remain exact and managed-origin only', () => {
  const contract = clone(loadManagedServiceContract())
  const hosted = contract.components.responses.Url.content['application/json'].schema
  hosted.additionalProperties = true
  hosted.properties.url.maxLength = 4096
  hosted.description = 'Open any payment provider URL.'
  hosted.properties.url.description = 'Arbitrary URL.'

  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('hosted billing response must be the exact bounded { url } shape'))
  assert.ok(
    errors.includes('hosted billing response must document exact configured managed API origin'),
  )
  assert.ok(
    errors.includes(
      'hosted billing response must document never opens an arbitrary provider origin directly',
    ),
  )

  const sources = loadManagedServiceClientSources()
  const parityErrors = validateManagedServiceClientParity(loadManagedServiceContract(), {
    ...sources,
    api: sources.api.replace('parsed.origin !== managedOrigin', 'false'),
  })
  assert.ok(
    parityErrors.includes('hosted billing client must validate parsed.origin !== managedOrigin'),
  )
})
test('backup body, depth, collection, and hotkey limits cannot be weakened', () => {
  const contract = clone(loadManagedServiceContract())
  const schemas = contract.components.schemas
  schemas.BackupSnapshot['x-backup-policy'].maxBodyBytes = 16 * 1024 * 1024
  schemas.BackupSnapshot['x-backup-policy'].maxJsonDepth = 32
  contract.paths['/api/backup/upload'].post['x-enforce-backup-policy-before-storage'] = false
  delete contract.paths['/api/backup/upload'].post.responses['413']
  schemas.BackupSnapshot.properties.history.maxItems = 5001
  schemas.BackupDictionary.properties.entries.maxItems = 10001
  schemas.BackupDictionary.properties.correction_rules.maxItems = 10001
  schemas.BackupSettings.properties.custom_scenes.maxItems = 101
  schemas.BackupHotkeyConfig.properties.dictationBindings.maxItems = 4
  schemas.BackupHotkeyConfig.properties.dictationBindings.minItems = 0
  schemas.BackupHotkeyConfig.properties.dictationBindings.uniqueItems = false
  schemas.BackupHotkeyConfig['x-scalar-binding-consistency'] = ''
  schemas.BackupHistoryEntry.properties.duration_ms.maximum = Number.MAX_SAFE_INTEGER + 1
  schemas.BackupDownload['x-max-encoded-response-bytes'] = 16 * 1024 * 1024

  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('BackupSnapshot must cap the encoded request body at 8 MiB'))
  assert.ok(errors.includes('BackupSnapshot must cap parsed JSON depth at 8'))
  assert.ok(errors.includes('/api/backup/upload must enforce the backup policy before storage'))
  assert.ok(errors.includes('/api/backup/upload must document 413 rejection'))
  assert.ok(errors.includes('BackupSnapshot history must be capped at 5000 entries'))
  assert.ok(errors.includes('BackupDictionary entries must be capped at 10000'))
  assert.ok(errors.includes('BackupDictionary correction_rules must be capped at 10000'))
  assert.ok(errors.includes('BackupSettings custom_scenes must be capped at 100'))
  assert.ok(errors.includes('BackupHotkeyConfig dictationBindings must be capped at 3 bindings'))
  assert.ok(
    errors.includes('BackupHotkeyConfig dictationBindings must retain at least one binding'),
  )
  assert.ok(errors.includes('BackupHotkeyConfig dictationBindings must reject duplicate bindings'))
  assert.ok(
    errors.includes('BackupHotkeyConfig must document scalar/list consistency for dictation'),
  )
  assert.ok(errors.includes('BackupHistoryEntry duration_ms must fit a JavaScript safe integer'))
  assert.ok(errors.includes('BackupDownload must cap the encoded response at 8 MiB'))
})

test('source parity check catches missing client headers and new Rust request types', () => {
  const contract = loadManagedServiceContract()
  const sources = loadManagedServiceClientSources()
  const drifted = {
    ...sources,
    api: sources.api.replace("'Idempotency-Key': idempotencyKey", "'X-Retry-Key': idempotencyKey"),
    account: sources.account.replace('history: snapshot.history', 'records: snapshot.history'),
    backupSettings: sources.backupSettings.replace(
      'capsule_auto_hide: config.capsule_auto_hide',
      'capsule_hidden: config.capsule_auto_hide',
    ),
    stt: sources.stt.replace('"voice_pipeline"', '"future_voice_mode"'),
  }
  const errors = validateManagedServiceClientParity(contract, drifted)
  assert.ok(
    errors.includes('createCheckout must send its idempotency key in the Idempotency-Key header'),
  )
  assert.ok(errors.includes('AccountPage backup payload must include history: snapshot.history'))
  assert.ok(errors.includes('createBackupSettings is missing contracted field capsule_auto_hide'))
  assert.ok(
    errors.includes('OpenAPI OperationContext is missing Rust requestType future_voice_mode'),
  )
})

test('subscription entitlements remain exact and fail closed in the client', () => {
  const contract = clone(loadManagedServiceContract())
  contract.components.schemas.SubscriptionStatus.properties.admin = { type: 'boolean' }
  contract.components.schemas.SubscriptionStatus.properties.plan.enum.push('enterprise')
  const errors = validateManagedServiceContract(contract)
  assert.ok(
    errors.includes('SubscriptionStatus must use the exact fail-closed desktop entitlement shape'),
  )
  assert.ok(
    errors.includes('SubscriptionStatus must constrain plan, source, and quota model enums'),
  )

  const sources = loadManagedServiceClientSources()
  const parityErrors = validateManagedServiceClientParity(contract, {
    ...sources,
    api: sources.api.replace(
      "request<unknown>('/api/subscription/status').then(parseSubscriptionStatus)",
      "request<SubscriptionStatus>('/api/subscription/status')",
    ),
  })
  assert.ok(
    parityErrors.includes(
      'getSubscriptionStatus must validate unknown service data before exposing entitlements',
    ),
  )
})

test('upstream identities and missing stable quota errors are rejected', () => {
  const contract = clone(loadManagedServiceContract())
  contract.servers[0].url = 'https://api.opentypeless.com'
  const codes = contract.components.schemas.ErrorEnvelope.properties.error.properties.code.enum
  codes.splice(codes.indexOf('QUOTA_EXHAUSTED'), 1)
  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('contract contains upstream identity opentypeless.com'))
  assert.ok(errors.includes('ErrorEnvelope must define stable code QUOTA_EXHAUSTED'))
})

test('plan catalogue pricing and client validation cannot drift', () => {
  const contract = clone(loadManagedServiceContract())
  contract.paths['/api/plans'].get.operationId = 'listPlans'
  const plan = contract.components.schemas.Plan
  plan.properties.product.enum.push('enterprise')
  plan.properties.currency.pattern = '.*'
  plan.properties.priceMinor.minimum = -1
  plan.properties.allowances = { type: 'object' }

  const errors = validateManagedServiceContract(contract)
  assert.ok(errors.includes('/api/plans operationId must be getPlans'))
  assert.ok(errors.includes('Plan product must match CheckoutProduct'))
  assert.ok(errors.includes('Plan currency must be an uppercase three-letter code'))
  assert.ok(errors.includes('Plan priceMinor must be a nonnegative integer'))
  assert.ok(errors.includes('Plan allowances must use the strict PlanAllowances schema'))

  const sources = loadManagedServiceClientSources()
  const parityErrors = validateManagedServiceClientParity(contract, {
    ...sources,
    api: sources.api.replace("request<unknown>('/api/plans')", "request<unknown>('/api/offers')"),
  })
  assert.ok(parityErrors.includes("getPlans client must include request<unknown>('/api/plans')"))
})
