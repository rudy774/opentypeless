import { createAuthClient } from 'better-auth/client'
import {
  API_BASE_URL,
  APP_VERSION_HEADER_VALUE,
  CLIENT_VERSION_HEADER,
  MANAGED_SERVICE_CONFIGURED,
} from './constants'
import { getCloudSessionToken } from './cloud-session'

const fetchWithToken: typeof fetch = (url, init) => {
  if (!MANAGED_SERVICE_CONFIGURED) throw new Error('Managed cloud service is not configured')

  const headers = new Headers(init?.headers)
  if (!headers.has(CLIENT_VERSION_HEADER)) {
    headers.set(CLIENT_VERSION_HEADER, APP_VERSION_HEADER_VALUE)
  }
  const token = getCloudSessionToken()
  if (token) {
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, { ...init, credentials: 'omit', headers })
  }
  return fetch(url, { ...init, credentials: 'omit', headers })
}

async function openTypelessAuthRequest(path: string, body: unknown): Promise<void> {
  const response = await fetchWithToken(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return

  const result = (await response.json().catch(() => null)) as {
    error?: string | { message?: string }
  } | null
  const message =
    typeof result?.error === 'string'
      ? result.error
      : (result?.error?.message ?? response.statusText)
  throw new Error(message || 'Authentication request failed')
}

export function requestOpenTypelessPasswordReset(email: string, locale: string): Promise<void> {
  return openTypelessAuthRequest('/api/opentypeless/auth/request-password-reset', { email, locale })
}

export function setOpenTypelessPassword(newPassword: string): Promise<void> {
  return openTypelessAuthRequest('/api/opentypeless/auth/set-password', { newPassword })
}

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  fetchOptions: {
    credentials: 'omit',
    customFetchImpl: fetchWithToken,
  },
})
