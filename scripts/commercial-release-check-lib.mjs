import fs from 'node:fs'
import path from 'node:path'

const UPSTREAM_REPOSITORY = 'tover0314-w/opentypeless'
const UPSTREAM_ORIGIN = 'opentypeless.com'
const UPSTREAM_IDENTIFIER = 'com.opentypeless.app'
const UPSTREAM_DEEP_LINK_SCHEME = 'opentypeless'
const UPSTREAM_UPDATER_PUBLIC_KEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdBNEFFRjEzN0ZCQTNBMEQKUldRTk9ycC9FKzlLZXVKSFZLNUYxdFZ2Ri9Ya0FRaGsvUEZ1bkJRTDZ6dHZ1emhtZWR6QkprS3kK'

function stringValue(value) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function repositoryUrl(packageJson) {
  const repository = packageJson?.repository
  if (typeof repository === 'string') return repository
  return repository?.url
}

function containsUpstreamRepository(value) {
  return stringValue(value).includes(UPSTREAM_REPOSITORY)
}

function containsUpstreamOrigin(value) {
  return stringValue(value).includes(UPSTREAM_ORIGIN)
}

export function auditCommercialStaticSnapshot(snapshot) {
  const errors = []
  const packageJson = snapshot.packageJson ?? {}
  const tauriConfig = snapshot.tauriConfig ?? {}
  const capabilities = snapshot.capabilities ?? {}
  const frontendConstants = snapshot.frontendConstants ?? ''
  const rustRuntime = snapshot.rustRuntime ?? ''
  const releaseAutomation = snapshot.releaseAutomation ?? ''
  const operationalIdentity = snapshot.operationalIdentity ?? ''
  const certifiedModels = snapshot.certifiedModels ?? ''
  const publicDocumentation = snapshot.publicDocumentation ?? ''
  const commercialTauriConfig = snapshot.commercialTauriConfig

  if (
    containsUpstreamRepository(repositoryUrl(packageJson)) ||
    containsUpstreamOrigin(packageJson.homepage) ||
    containsUpstreamRepository(packageJson.bugs?.url)
  ) {
    errors.push('package.json still publishes upstream repository, homepage, or support metadata.')
  }

  const allowLegacyBaseIdentifier = snapshot.allowLegacyBaseIdentifier === true
  if (!allowLegacyBaseIdentifier && stringValue(tauriConfig.identifier) === UPSTREAM_IDENTIFIER) {
    errors.push('Commercial Tauri configuration still uses the upstream application identifier.')
  }

  const csp = tauriConfig.app?.security?.csp
  if (containsUpstreamOrigin(csp)) {
    errors.push('src-tauri/tauri.conf.json CSP still permits the upstream service origin.')
  }

  const deepLinkSchemes = tauriConfig.plugins?.['deep-link']?.desktop?.schemes
  if (
    Array.isArray(deepLinkSchemes) &&
    deepLinkSchemes.some((scheme) => stringValue(scheme) === UPSTREAM_DEEP_LINK_SCHEME)
  ) {
    errors.push('src-tauri/tauri.conf.json still claims the upstream deep-link scheme.')
  }

  const updater = tauriConfig.plugins?.updater
  if (updater) {
    const endpoints = Array.isArray(updater.endpoints) ? updater.endpoints : []
    if (
      endpoints.some(containsUpstreamRepository) ||
      updater.pubkey === UPSTREAM_UPDATER_PUBLIC_KEY
    ) {
      errors.push('src-tauri/tauri.conf.json still trusts the upstream updater feed or key.')
    } else {
      errors.push(
        'The updater is enabled in src-tauri/tauri.conf.json; prove the configured feed and signing identity are Rudy-owned before release.',
      )
    }
  }

  if (tauriConfig.bundle?.createUpdaterArtifacts) {
    errors.push(
      'src-tauri/tauri.conf.json still creates updater artifacts before an owned feed and signing identity have been verified.',
    )
  }

  if (/tauri_plugin_updater\s*::\s*Builder/i.test(rustRuntime)) {
    errors.push('src-tauri/src/lib.rs still registers the updater plugin.')
  }

  const permissions = Array.isArray(capabilities.permissions) ? capabilities.permissions : []
  if (permissions.some((permission) => stringValue(permission).startsWith('updater:'))) {
    errors.push('src-tauri/capabilities/default.json still grants updater permissions.')
  }

  if (
    /APP_REPO_URL[^\n]*tover0314-w\/opentypeless/i.test(frontendConstants) ||
    /API_BASE_URL[^\n]*opentypeless\.com/i.test(frontendConstants)
  ) {
    errors.push(
      'src/lib/constants.ts still defaults the client to upstream repository or API URLs.',
    )
  }

  if (/DEFAULT_API_BASE_URL[^\n]*opentypeless\.com/i.test(rustRuntime)) {
    errors.push('src-tauri/src/lib.rs still defaults managed requests to the upstream API origin.')
  }

  if (commercialTauriConfig) {
    if (stringValue(commercialTauriConfig.identifier) === UPSTREAM_IDENTIFIER) {
      errors.push('Generated commercial Tauri configuration uses the upstream identifier.')
    }
    if (containsUpstreamOrigin(commercialTauriConfig.app?.security?.csp)) {
      errors.push('Generated commercial Tauri CSP permits the upstream service origin.')
    }
    const schemes = commercialTauriConfig.plugins?.['deep-link']?.desktop?.schemes
    if (
      Array.isArray(schemes) &&
      schemes.some((scheme) => stringValue(scheme) === UPSTREAM_DEEP_LINK_SCHEME)
    ) {
      errors.push('Generated commercial Tauri configuration claims the upstream URI scheme.')
    }
    if (
      commercialTauriConfig.plugins?.updater ||
      commercialTauriConfig.bundle?.createUpdaterArtifacts
    ) {
      errors.push('Generated commercial Tauri configuration enables the updater.')
    }
  }

  if (
    containsUpstreamRepository(operationalIdentity) ||
    containsUpstreamOrigin(operationalIdentity)
  ) {
    errors.push(
      'Operational ownership, funding, support, or release documentation still targets upstream.',
    )
  }

  if (containsUpstreamOrigin(certifiedModels)) {
    errors.push('Certified model metadata still trusts the upstream managed service.')
  }

  const normalizedReleaseAutomation = stringValue(releaseAutomation)
  if (
    containsUpstreamRepository(normalizedReleaseAutomation) ||
    (/owner:\s*tover0314-w/i.test(normalizedReleaseAutomation) &&
      /repo:\s*opentypeless/i.test(normalizedReleaseAutomation))
  ) {
    errors.push('GitHub release automation still publishes to the upstream repository.')
  }

  if (/allow_unsigned_windows|skip_stapling|--skip-stapling/i.test(releaseAutomation)) {
    errors.push('Release automation or scripts still contain an unsigned or notarization bypass.')
  }

  if (/releaseDraft:\s*false/i.test(releaseAutomation)) {
    errors.push(
      'A platform build can publish its release directly instead of uploading to a draft.',
    )
  }

  const hasDraftUpload = /releaseDraft:\s*true/i.test(releaseAutomation)
  const hasFinalPublishGate =
    /verify-and-publish:[\s\S]*needs:\s*\[[^\]]*\bbuild\b[^\]]*\][\s\S]*gh\s+release\s+edit[^\n]*--draft=false/i.test(
      releaseAutomation,
    )
  if (!hasDraftUpload || !hasFinalPublishGate) {
    errors.push(
      'Release automation must upload to a draft and publish only from a final job that needs every selected build.',
    )
  }

  if (
    !/Get-AuthenticodeSignature/i.test(releaseAutomation) ||
    !/unsafe_asset_pattern[^\n]*(?:unsigned[^\n]*test|test[^\n]*unsigned)/i.test(releaseAutomation)
  ) {
    errors.push(
      'Release automation must verify Windows signatures and reject unsigned or test-labeled public assets.',
    )
  }

  if (
    /releaseCommitish:\s*main/i.test(releaseAutomation) ||
    /TAG_VERSION="\$\{\{[^\n]+\}\}"/i.test(releaseAutomation) ||
    /node\s+-e[^\n]*\$VERSION/i.test(releaseAutomation)
  ) {
    errors.push(
      'Release automation still uses a mutable branch or interpolates tag data into code.',
    )
  }

  if (
    /(?:tover0314-w\/opentypeless|discord\.gg|https?:\/\/(?:www\.)?opentypeless\.com)/i.test(
      publicDocumentation,
    )
  ) {
    errors.push('Public fork documentation still contains an active upstream or Discord route.')
  }

  const translatedBannerCount = (publicDocumentation.match(/\*\*fork status:\*\*/gi) ?? []).length
  const translatedDocumentCount = snapshot.translatedDocumentCount ?? 0
  if (translatedDocumentCount > 0 && translatedBannerCount !== translatedDocumentCount) {
    errors.push('Every translated README must contain exactly one prominent fork-status banner.')
  }

  if (/run anyway|xattr\s+-cr|click\s+\*\*unblock\*\*/i.test(publicDocumentation)) {
    errors.push('Public installation docs still tell users to bypass OS artifact verification.')
  }

  return [...new Set(errors)]
}

function readJson(repositoryRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'))
}

function readText(repositoryRoot, relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
}

function readExistingTexts(repositoryRoot, paths) {
  return paths
    .filter((relativePath) => fs.existsSync(path.join(repositoryRoot, relativePath)))
    .map((relativePath) => readText(repositoryRoot, relativePath))
    .join('\n')
}

function readTranslatedReadmes(repositoryRoot) {
  const translatedReadmes = fs
    .readdirSync(repositoryRoot)
    .filter((name) => /^README_[^.]+\.md$/i.test(name))
    .sort()
  return {
    count: translatedReadmes.length,
    text: readExistingTexts(repositoryRoot, translatedReadmes),
  }
}

function readReleaseAutomation(repositoryRoot) {
  const paths = [
    '.github/workflows/release.yml',
    '.github/scripts/import-windows-certificate.ps1',
    '.github/scripts/upload-linux-verification-artifacts.sh',
  ]
  return paths
    .filter((relativePath) => fs.existsSync(path.join(repositoryRoot, relativePath)))
    .map((relativePath) => readText(repositoryRoot, relativePath))
    .join('\n')
}

export function auditCommercialRepository(repositoryRoot) {
  try {
    const translatedReadmes = readTranslatedReadmes(repositoryRoot)
    return auditCommercialStaticSnapshot({
      packageJson: readJson(repositoryRoot, 'package.json'),
      tauriConfig: readJson(repositoryRoot, 'src-tauri/tauri.conf.json'),
      capabilities: readJson(repositoryRoot, 'src-tauri/capabilities/default.json'),
      frontendConstants: readText(repositoryRoot, 'src/lib/constants.ts'),
      rustRuntime: readText(repositoryRoot, 'src-tauri/src/lib.rs'),
      releaseAutomation: readReleaseAutomation(repositoryRoot),
      allowLegacyBaseIdentifier: true,
      operationalIdentity: readExistingTexts(repositoryRoot, [
        '.github/CODEOWNERS',
        '.github/FUNDING.yml',
        '.github/ISSUE_TEMPLATE/config.yml',
        '.github/workflows/welcome.yml',
        'scripts/create-labels.sh',
        'docs/release-signing.md',
      ]),
      certifiedModels: readText(repositoryRoot, 'src-tauri/tests/fixtures/certified_models.json'),
      translatedDocumentCount: translatedReadmes.count + 1,
      publicDocumentation: [
        translatedReadmes.text,
        readExistingTexts(repositoryRoot, [
          'README.md',
          'CONTRIBUTING.md',
          'SUPPORT.md',
          'SECURITY.md',
          '.github/workflows/welcome.yml',
        ]),
      ].join('\n'),
    })
  } catch {
    return [
      'Commercial release guard could not inspect required runtime configuration files; fail closed.',
    ]
  }
}
