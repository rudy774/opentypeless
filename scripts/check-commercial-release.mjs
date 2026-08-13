import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditCommercialRepository } from './commercial-release-check-lib.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

const commercialBuild = process.env.COMMERCIAL_BUILD === 'true'

if (!commercialBuild) {
  console.log('Commercial release check skipped (COMMERCIAL_BUILD is not true).')
  process.exit(0)
}

const required = [
  'COMMERCIAL_API_ORIGIN',
  'VITE_MANAGED_API_BASE_URL',
  'OPENTYPELESS_MANAGED_API_BASE_URL',
  'COMMERCIAL_WEBSITE_URL',
  'COMMERCIAL_REPOSITORY_URL',
  'COMMERCIAL_SUPPORT_URL',
  'COMMERCIAL_PRIVACY_URL',
  'COMMERCIAL_TERMS_URL',
  'COMMERCIAL_PRODUCT_NAME',
  'COMMERCIAL_APP_IDENTIFIER',
  'COMMERCIAL_DEEP_LINK_SCHEME',
  'COMMERCIAL_TAURI_CONFIG_PATH',
  'VITE_APP_DEEP_LINK_SCHEME',
]

const urlVariables = required.filter(
  (name) => name.endsWith('_URL') || name.endsWith('_ORIGIN') || name.endsWith('_ENDPOINT'),
)

const placeholderMarkers = [
  'example.com',
  '.example',
  'example.test',
  'localhost',
  '127.0.0.1',
  'replace-with',
  'replace_me',
  'placeholder',
  'your-domain',
  'your-repository',
  'yourcompany',
  '<',
  'your product',
  '>',
]

const errors = []
const values = new Map()

for (const name of required) {
  const value = (process.env[name] ?? '').trim()
  values.set(name, value)
  if (!value) {
    errors.push(name + ' is required.')
  }
}

function hasPlaceholder(value) {
  const normalized = value.toLowerCase()
  return placeholderMarkers.some((marker) => normalized.includes(marker))
}

function isUpstreamDefault(name, value) {
  const normalized = value.toLowerCase()

  if (name === 'COMMERCIAL_APP_IDENTIFIER') {
    return normalized === 'com.opentypeless.app'
  }

  return (
    normalized.includes('tover0314-w/opentypeless') ||
    normalized.includes('www.opentypeless.com') ||
    normalized.includes('://opentypeless.com')
  )
}

for (const name of required) {
  const value = values.get(name)
  if (!value) continue

  if (hasPlaceholder(value)) {
    errors.push(name + ' still contains an example or placeholder value.')
  }

  if (isUpstreamDefault(name, value)) {
    errors.push(name + ' still uses an upstream OpenTypeless default.')
  }
}

for (const name of urlVariables) {
  const value = values.get(name)
  if (!value) continue

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') {
      errors.push(name + ' must use HTTPS.')
    }
    if (parsed.username || parsed.password) {
      errors.push(name + ' must not contain embedded credentials.')
    }
    const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase()
    if (hostname === 'opentypeless.com' || hostname.endsWith('.opentypeless.com')) {
      errors.push(name + ' still uses an upstream OpenTypeless default.')
    }
    if (
      name === 'COMMERCIAL_API_ORIGIN' &&
      (parsed.pathname !== '/' || parsed.search || parsed.hash)
    ) {
      errors.push(name + ' must be an origin without a path, query, or fragment.')
    }
  } catch {
    errors.push(name + ' must be a valid absolute URL.')
  }
}

const identifier = values.get('COMMERCIAL_APP_IDENTIFIER')
if (identifier && !/^[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*){2,}$/.test(identifier)) {
  errors.push('COMMERCIAL_APP_IDENTIFIER must be a reverse-domain identifier.')
}

const deepLinkScheme = values.get('COMMERCIAL_DEEP_LINK_SCHEME')
if (deepLinkScheme) {
  if (!/^[a-z][a-z0-9+.-]{2,31}$/.test(deepLinkScheme)) {
    errors.push('COMMERCIAL_DEEP_LINK_SCHEME must be a valid lowercase URI scheme.')
  }
  if (deepLinkScheme === 'opentypeless') {
    errors.push('COMMERCIAL_DEEP_LINK_SCHEME still uses the upstream URI scheme.')
  }
}

const apiOrigin = values.get('COMMERCIAL_API_ORIGIN')
for (const alias of ['VITE_MANAGED_API_BASE_URL', 'OPENTYPELESS_MANAGED_API_BASE_URL']) {
  if (apiOrigin && values.get(alias) !== apiOrigin) {
    errors.push(`${alias} must exactly match COMMERCIAL_API_ORIGIN.`)
  }
}

if (deepLinkScheme && values.get('VITE_APP_DEEP_LINK_SCHEME') !== deepLinkScheme) {
  errors.push('VITE_APP_DEEP_LINK_SCHEME must exactly match COMMERCIAL_DEEP_LINK_SCHEME.')
}

const configRelativePath = values.get('COMMERCIAL_TAURI_CONFIG_PATH')
if (configRelativePath) {
  const configPath = path.resolve(repositoryRoot, configRelativePath)
  const relative = path.relative(repositoryRoot, configPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    errors.push('COMMERCIAL_TAURI_CONFIG_PATH must stay inside the repository.')
  } else {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.identifier !== values.get('COMMERCIAL_APP_IDENTIFIER')) {
        errors.push('Generated Tauri identifier does not match COMMERCIAL_APP_IDENTIFIER.')
      }
      if (config.productName !== values.get('COMMERCIAL_PRODUCT_NAME')) {
        errors.push('Generated Tauri product name does not match COMMERCIAL_PRODUCT_NAME.')
      }
      const schemes = config.plugins?.['deep-link']?.desktop?.schemes
      if (!Array.isArray(schemes) || schemes.length !== 1 || schemes[0] !== deepLinkScheme) {
        errors.push('Generated Tauri deep-link scheme does not match commercial configuration.')
      }
      const csp = config.app?.security?.csp
      if (typeof csp !== 'string' || !apiOrigin || !csp.includes(apiOrigin)) {
        errors.push('Generated Tauri CSP does not allow the configured managed API origin.')
      }
      if (config.plugins?.updater || config.bundle?.createUpdaterArtifacts !== false) {
        errors.push('Generated Tauri configuration must keep the updater disabled.')
      }
    } catch {
      errors.push(
        'COMMERCIAL_TAURI_CONFIG_PATH is missing or invalid; run generate-commercial-tauri-config.mjs first.',
      )
    }
  }
}

const staticErrors = auditCommercialRepository(repositoryRoot)
if (configRelativePath) {
  try {
    const commercialTauriConfig = JSON.parse(
      fs.readFileSync(path.resolve(repositoryRoot, configRelativePath), 'utf8'),
    )
    const baseSnapshotErrors = staticErrors.filter(
      (error) => !error.includes('application identifier'),
    )
    errors.push(...baseSnapshotErrors)
    if (commercialTauriConfig.identifier !== identifier) {
      errors.push('Generated commercial Tauri identity does not match the guarded identifier.')
    }
  } catch {
    errors.push(...staticErrors)
  }
} else {
  errors.push(...staticErrors)
}

const uniqueErrors = [...new Set(errors)]
if (uniqueErrors.length > 0) {
  console.error('Commercial release configuration is not ready:')
  for (const error of uniqueErrors) {
    console.error('- ' + error)
  }
  console.error('No secret values were printed. See docs/COMMERCIALIZATION.md.')
  process.exit(1)
}

console.log('Commercial release configuration passed the local ownership/default checks.')
console.log(
  'This does not verify external ownership, deployment, legal readiness, or runtime wiring.',
)
