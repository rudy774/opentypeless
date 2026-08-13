import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { auditCommercialStaticSnapshot } from './commercial-release-check-lib.mjs'

function ownedSnapshot() {
  return {
    packageJson: {
      repository: { url: 'https://github.com/rudy774/rudyproduct' },
      homepage: 'https://rudyproduct.invalid',
      bugs: { url: 'https://github.com/rudy774/rudyproduct/issues' },
    },
    tauriConfig: {
      identifier: 'com.rudy774.rudyproduct',
      app: { security: { csp: "default-src 'self'; connect-src https://api.rudyproduct.invalid" } },
      plugins: { 'deep-link': { desktop: { schemes: ['rudyproduct'] } } },
      bundle: { createUpdaterArtifacts: false },
    },
    capabilities: { permissions: ['core:default'] },
    frontendConstants:
      "export const APP_REPO_URL = 'https://github.com/rudy774/rudyproduct'\n" +
      "export const API_BASE_URL = 'https://api.rudyproduct.invalid'",
    rustRuntime:
      'pub const DEFAULT_API_BASE_URL: &str = "https://api.rudyproduct.invalid";\n' +
      '// Updater intentionally disabled until the release feed is owned.',
    releaseAutomation: 'owner: rudy774\nrepo: rudyproduct',
  }
}

test('accepts owned static defaults with the updater disabled', () => {
  assert.deepEqual(auditCommercialStaticSnapshot(ownedSnapshot()), [])
})

test('rejects upstream runtime identity and updater wiring', () => {
  const snapshot = ownedSnapshot()
  snapshot.packageJson.repository.url = 'https://github.com/tover0314-w/opentypeless'
  snapshot.tauriConfig.identifier = 'com.opentypeless.app'
  snapshot.tauriConfig.app.security.csp += ' https://*.opentypeless.com'
  snapshot.tauriConfig.plugins['deep-link'].desktop.schemes = ['opentypeless']
  snapshot.tauriConfig.plugins.updater = {
    endpoints: ['https://github.com/tover0314-w/opentypeless/releases/latest/download/latest.json'],
    pubkey:
      'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdBNEFFRjEzN0ZCQTNBMEQKUldRTk9ycC9FKzlLZXVKSFZLNUYxdFZ2Ri9Ya0FRaGsvUEZ1bkJRTDZ6dHZ1emhtZWR6QkprS3kK',
  }
  snapshot.tauriConfig.bundle.createUpdaterArtifacts = true
  snapshot.capabilities.permissions.push('updater:default')
  snapshot.frontendConstants += "\nexport const API_BASE_URL = 'https://www.opentypeless.com'"
  snapshot.rustRuntime +=
    '\npub const DEFAULT_API_BASE_URL: &str = "https://www.opentypeless.com";' +
    '\n.plugin(tauri_plugin_updater::Builder::new().build())'
  snapshot.releaseAutomation = 'owner: tover0314-w\nrepo: opentypeless'

  const errors = auditCommercialStaticSnapshot(snapshot)

  assert.ok(errors.length >= 9)
  assert.ok(errors.some((error) => error.includes('application identifier')))
  assert.ok(errors.some((error) => error.includes('upstream updater')))
  assert.ok(errors.some((error) => error.includes('creates updater artifacts')))
  assert.ok(errors.some((error) => error.includes('registers the updater plugin')))
  assert.ok(errors.some((error) => error.includes('release automation')))
})

test('strict CLI cannot be bypassed with plausible environment values', () => {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
  const updaterPublicKey = 'R'.repeat(96)
  const result = spawnSync(process.execPath, ['scripts/check-commercial-release.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      COMMERCIAL_BUILD: 'true',
      COMMERCIAL_API_ORIGIN: 'https://api.rudyproduct.invalid',
      COMMERCIAL_WEBSITE_URL: 'https://rudyproduct.invalid',
      COMMERCIAL_REPOSITORY_URL: 'https://github.com/rudy774/rudyproduct',
      COMMERCIAL_SUPPORT_URL: 'https://support.rudyproduct.invalid',
      COMMERCIAL_PRIVACY_URL: 'https://rudyproduct.invalid/privacy',
      COMMERCIAL_TERMS_URL: 'https://rudyproduct.invalid/terms',
      COMMERCIAL_APP_IDENTIFIER: 'com.rudy774.rudyproduct',
      COMMERCIAL_UPDATER_ENDPOINT: 'https://updates.rudyproduct.invalid/latest.json',
      COMMERCIAL_UPDATER_PUBLIC_KEY: updaterPublicKey,
    },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /tauri\.conf\.json still uses the upstream application identifier/i)
  assert.doesNotMatch(result.stderr, new RegExp(updaterPublicKey))
})
