import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
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
    releaseAutomation:
      'owner: rudy774\nrepo: rudyproduct\nreleaseDraft: true\n' +
      'verify-and-publish:\n  needs: [resolve-source, build]\n' +
      "  unsafe_asset_pattern='unsigned-test'\n  Get-AuthenticodeSignature artifact\n" +
      '  gh release edit "$RELEASE_TAG" --draft=false',
    translatedDocumentCount: 1,
    publicDocumentation:
      '> [!IMPORTANT]\n> **Fork status:** Rudy fork; releases and support: https://github.com/rudy774/opentypeless',
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

test('rejects unsafe release bypasses and active upstream public routes', () => {
  const snapshot = ownedSnapshot()
  snapshot.releaseAutomation +=
    '\nallow_unsigned_windows: true\nargs: --skip-stapling\nreleaseCommitish: main\n' +
    'releaseDraft: false\nTAG_VERSION="${{ github.event.inputs.tag }}"\n' +
    'node -e "p.version=\\"$VERSION\\""'
  snapshot.publicDocumentation =
    '> [!IMPORTANT]\n> **Fork status:** fork\n' +
    '[Download](https://github.com/tover0314-w/opentypeless/releases)\n' +
    '[Chat](https://discord.gg/example)\n' +
    'Click **Run anyway** or run xattr -cr /Applications/OpenTypeless.app'

  const errors = auditCommercialStaticSnapshot(snapshot)
  assert.ok(errors.some((error) => error.includes('unsigned or notarization bypass')))
  assert.ok(errors.some((error) => error.includes('publish its release directly')))
  assert.ok(errors.some((error) => error.includes('mutable branch or interpolates tag data')))
  assert.ok(errors.some((error) => error.includes('active upstream or Discord route')))
  assert.ok(errors.some((error) => error.includes('bypass OS artifact verification')))
})

test('requires draft-only platform uploads and a guarded final publication job', () => {
  const directPublish = ownedSnapshot()
  directPublish.releaseAutomation = directPublish.releaseAutomation.replace(
    'releaseDraft: true',
    'releaseDraft: false',
  )
  assert.ok(
    auditCommercialStaticSnapshot(directPublish).some((error) =>
      error.includes('publish its release directly'),
    ),
  )

  const missingGate = ownedSnapshot()
  missingGate.releaseAutomation = 'owner: rudy774\nrepo: rudyproduct\nreleaseDraft: true'
  const missingGateErrors = auditCommercialStaticSnapshot(missingGate)
  assert.ok(missingGateErrors.some((error) => error.includes('final job')))
  assert.ok(missingGateErrors.some((error) => error.includes('reject unsigned or test-labeled')))
})

test('requires exactly one fork-status banner per translated README', () => {
  const snapshot = ownedSnapshot()
  snapshot.translatedDocumentCount = 2

  assert.ok(
    auditCommercialStaticSnapshot(snapshot).some((error) =>
      error.includes('Every translated README'),
    ),
  )

  snapshot.publicDocumentation += '\n> [!IMPORTANT]\n> **Fork status:** second translated README'
  assert.deepEqual(auditCommercialStaticSnapshot(snapshot), [])
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
  assert.match(result.stderr, /VITE_MANAGED_API_BASE_URL is required/i)
  assert.doesNotMatch(result.stderr, new RegExp(updaterPublicKey))
})

test('rejects upstream managed origins with a trailing DNS dot', () => {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
  const generatedRelativePath = 'src-tauri/tauri.commercial.generated.json'
  const generatedPath = path.join(repositoryRoot, generatedRelativePath)
  const env = {
    ...process.env,
    COMMERCIAL_BUILD: 'true',
    COMMERCIAL_API_ORIGIN: 'https://api.opentypeless.com.',
    VITE_MANAGED_API_BASE_URL: 'https://api.opentypeless.com.',
    OPENTYPELESS_MANAGED_API_BASE_URL: 'https://api.opentypeless.com.',
    COMMERCIAL_WEBSITE_URL: 'https://rudyproduct.test',
    COMMERCIAL_REPOSITORY_URL: 'https://github.com/rudy774/opentypeless',
    COMMERCIAL_SUPPORT_URL: 'https://github.com/rudy774/opentypeless/issues',
    COMMERCIAL_PRIVACY_URL: 'https://rudyproduct.test/privacy',
    COMMERCIAL_TERMS_URL: 'https://rudyproduct.test/terms',
    COMMERCIAL_PRODUCT_NAME: 'Rudy Product',
    COMMERCIAL_APP_IDENTIFIER: 'com.rudy774.rudyproduct',
    COMMERCIAL_DEEP_LINK_SCHEME: 'rudyproduct',
    VITE_APP_DEEP_LINK_SCHEME: 'rudyproduct',
    COMMERCIAL_TAURI_CONFIG_PATH: generatedRelativePath,
  }

  try {
    const generated = spawnSync(
      process.execPath,
      ['scripts/generate-commercial-tauri-config.mjs'],
      { cwd: repositoryRoot, encoding: 'utf8', env },
    )
    assert.equal(generated.status, 1)
    assert.match(generated.stderr, /must not use the upstream OpenTypeless service/i)

    const checked = spawnSync(process.execPath, ['scripts/check-commercial-release.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env,
    })
    assert.equal(checked.status, 1)
    assert.match(checked.stderr, /upstream OpenTypeless default/i)
  } finally {
    fs.rmSync(generatedPath, { force: true })
  }
})
test('legacy source identity is allowed only with an owned commercial overlay', () => {
  const snapshot = ownedSnapshot()
  snapshot.tauriConfig.identifier = 'com.opentypeless.app'
  snapshot.allowLegacyBaseIdentifier = true
  snapshot.commercialTauriConfig = {
    identifier: 'com.rudy774.rudyproduct',
    app: { security: { csp: 'connect-src https://api.rudyproduct.invalid' } },
    plugins: { 'deep-link': { desktop: { schemes: ['rudyproduct'] } } },
    bundle: { createUpdaterArtifacts: false },
  }

  assert.deepEqual(auditCommercialStaticSnapshot(snapshot), [])

  snapshot.commercialTauriConfig.identifier = 'com.opentypeless.app'
  assert.ok(
    auditCommercialStaticSnapshot(snapshot).some((error) =>
      error.includes('Generated commercial Tauri configuration uses the upstream identifier'),
    ),
  )
})

test('strict CLI passes with a generated owned overlay and matching build origins', () => {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
  const generatedRelativePath = 'src-tauri/tauri.commercial.generated.json'
  const generatedPath = path.join(repositoryRoot, generatedRelativePath)
  const env = {
    ...process.env,
    COMMERCIAL_BUILD: 'true',
    COMMERCIAL_API_ORIGIN: 'https://api.rudyproduct.test',
    VITE_MANAGED_API_BASE_URL: 'https://api.rudyproduct.test',
    OPENTYPELESS_MANAGED_API_BASE_URL: 'https://api.rudyproduct.test',
    COMMERCIAL_WEBSITE_URL: 'https://rudyproduct.test',
    COMMERCIAL_REPOSITORY_URL: 'https://github.com/rudy774/opentypeless',
    COMMERCIAL_SUPPORT_URL: 'https://github.com/rudy774/opentypeless/issues',
    COMMERCIAL_PRIVACY_URL: 'https://rudyproduct.test/privacy',
    COMMERCIAL_TERMS_URL: 'https://rudyproduct.test/terms',
    COMMERCIAL_PRODUCT_NAME: 'Rudy Product',
    COMMERCIAL_APP_IDENTIFIER: 'com.rudy774.rudyproduct',
    COMMERCIAL_DEEP_LINK_SCHEME: 'rudyproduct',
    VITE_APP_DEEP_LINK_SCHEME: 'rudyproduct',
    COMMERCIAL_TAURI_CONFIG_PATH: generatedRelativePath,
  }

  try {
    const generated = spawnSync(
      process.execPath,
      ['scripts/generate-commercial-tauri-config.mjs'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env,
      },
    )
    assert.equal(generated.status, 0, generated.stderr)

    const checked = spawnSync(process.execPath, ['scripts/check-commercial-release.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env,
    })
    assert.equal(checked.status, 0, checked.stderr)
    assert.match(checked.stdout, /passed the local ownership\/default checks/i)

    const overlay = JSON.parse(fs.readFileSync(generatedPath, 'utf8'))
    assert.equal(overlay.identifier, env.COMMERCIAL_APP_IDENTIFIER)
    assert.equal(overlay.bundle.createUpdaterArtifacts, false)
    assert.equal(overlay.plugins.updater, undefined)
  } finally {
    fs.rmSync(generatedPath, { force: true })
  }
})
