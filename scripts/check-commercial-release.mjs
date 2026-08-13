import { fileURLToPath } from 'node:url'

import { auditCommercialRepository } from './commercial-release-check-lib.mjs'

const commercialBuild = process.env.COMMERCIAL_BUILD === 'true'

if (!commercialBuild) {
  console.log('Commercial release check skipped (COMMERCIAL_BUILD is not true).')
  process.exit(0)
}

const required = [
  'COMMERCIAL_API_ORIGIN',
  'COMMERCIAL_WEBSITE_URL',
  'COMMERCIAL_REPOSITORY_URL',
  'COMMERCIAL_SUPPORT_URL',
  'COMMERCIAL_PRIVACY_URL',
  'COMMERCIAL_TERMS_URL',
  'COMMERCIAL_APP_IDENTIFIER',
  'COMMERCIAL_UPDATER_ENDPOINT',
  'COMMERCIAL_UPDATER_PUBLIC_KEY',
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
  '>',
]

const upstreamUpdaterPublicKey =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDdBNEFFRjEzN0ZCQTNBMEQKUldRTk9ycC9FKzlLZXVKSFZLNUYxdFZ2Ri9Ya0FRaGsvUEZ1bkJRTDZ6dHZ1emhtZWR6QkprS3kK'

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

const updaterPublicKey = values.get('COMMERCIAL_UPDATER_PUBLIC_KEY')
if (updaterPublicKey) {
  if (updaterPublicKey === upstreamUpdaterPublicKey) {
    errors.push('COMMERCIAL_UPDATER_PUBLIC_KEY still uses the upstream signing identity.')
  }
  if (updaterPublicKey.length < 64) {
    errors.push('COMMERCIAL_UPDATER_PUBLIC_KEY is too short to be a Tauri updater public key.')
  }
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
errors.push(...auditCommercialRepository(repositoryRoot))

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
