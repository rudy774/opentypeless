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

  if (
    containsUpstreamRepository(repositoryUrl(packageJson)) ||
    containsUpstreamOrigin(packageJson.homepage) ||
    containsUpstreamRepository(packageJson.bugs?.url)
  ) {
    errors.push('package.json still publishes upstream repository, homepage, or support metadata.')
  }

  if (stringValue(tauriConfig.identifier) === UPSTREAM_IDENTIFIER) {
    errors.push('src-tauri/tauri.conf.json still uses the upstream application identifier.')
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

  const normalizedReleaseAutomation = stringValue(releaseAutomation)
  if (
    containsUpstreamRepository(normalizedReleaseAutomation) ||
    (/owner:\s*tover0314-w/i.test(normalizedReleaseAutomation) &&
      /repo:\s*opentypeless/i.test(normalizedReleaseAutomation))
  ) {
    errors.push('GitHub release automation still publishes to the upstream repository.')
  }

  return [...new Set(errors)]
}

function readJson(repositoryRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'))
}

function readText(repositoryRoot, relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
}

function readReleaseAutomation(repositoryRoot) {
  const paths = [
    '.github/workflows/release.yml',
    '.github/workflows/release-windows-signpath.yml',
    '.github/workflows/staple-macos-release.yml',
    '.github/scripts/publish-signpath-windows-release.ps1',
    '.github/scripts/upload-linux-verification-artifacts.sh',
  ]
  return paths
    .filter((relativePath) => fs.existsSync(path.join(repositoryRoot, relativePath)))
    .map((relativePath) => readText(repositoryRoot, relativePath))
    .join('\n')
}

export function auditCommercialRepository(repositoryRoot) {
  try {
    return auditCommercialStaticSnapshot({
      packageJson: readJson(repositoryRoot, 'package.json'),
      tauriConfig: readJson(repositoryRoot, 'src-tauri/tauri.conf.json'),
      capabilities: readJson(repositoryRoot, 'src-tauri/capabilities/default.json'),
      frontendConstants: readText(repositoryRoot, 'src/lib/constants.ts'),
      rustRuntime: readText(repositoryRoot, 'src-tauri/src/lib.rs'),
      releaseAutomation: readReleaseAutomation(repositoryRoot),
    })
  } catch {
    return [
      'Commercial release guard could not inspect required runtime configuration files; fail closed.',
    ]
  }
}
