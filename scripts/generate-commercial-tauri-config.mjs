import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRelativePath = 'src-tauri/tauri.commercial.generated.json'
const outputPath = path.join(repositoryRoot, outputRelativePath)

function required(name) {
  const value = (process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function managedOrigin() {
  const raw = required('COMMERCIAL_API_ORIGIN')
  const parsed = new URL(raw)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('COMMERCIAL_API_ORIGIN must be an HTTPS origin without credentials or a path.')
  }
  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase()
  if (hostname === 'opentypeless.com' || hostname.endsWith('.opentypeless.com')) {
    throw new Error('COMMERCIAL_API_ORIGIN must not use the upstream OpenTypeless service.')
  }
  return parsed.origin
}

function appIdentifier() {
  const value = required('COMMERCIAL_APP_IDENTIFIER')
  if (!/^[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*){2,}$/.test(value)) {
    throw new Error('COMMERCIAL_APP_IDENTIFIER must be a reverse-domain identifier.')
  }
  if (value.toLowerCase() === 'com.opentypeless.app') {
    throw new Error('COMMERCIAL_APP_IDENTIFIER must not use the upstream identifier.')
  }
  return value
}

function deepLinkScheme() {
  const value = required('COMMERCIAL_DEEP_LINK_SCHEME').toLowerCase()
  if (!/^[a-z][a-z0-9+.-]{2,31}$/.test(value)) {
    throw new Error('COMMERCIAL_DEEP_LINK_SCHEME must be a valid URI scheme (3-32 characters).')
  }
  if (value === 'opentypeless') {
    throw new Error('COMMERCIAL_DEEP_LINK_SCHEME must not claim the upstream URI scheme.')
  }
  return value
}

function productName() {
  const value = required('COMMERCIAL_PRODUCT_NAME')
  if (value.length > 64 || /[\r\n]/.test(value)) {
    throw new Error('COMMERCIAL_PRODUCT_NAME must be a single line of at most 64 characters.')
  }
  return value
}

try {
  const origin = managedOrigin()
  const config = {
    productName: productName(),
    identifier: appIdentifier(),
    app: {
      security: {
        csp:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          `img-src 'self' data:; connect-src 'self' ${origin} https://accounts.google.com https://github.com`,
      },
    },
    plugins: {
      'deep-link': {
        desktop: { schemes: [deepLinkScheme()] },
      },
    },
    bundle: {
      createUpdaterArtifacts: false,
    },
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  console.log(`Generated ${outputRelativePath}.`)
  console.log('The updater remains disabled. No secrets were written.')
} catch (error) {
  console.error(`Commercial Tauri configuration was not generated: ${error.message}`)
  process.exit(1)
}
