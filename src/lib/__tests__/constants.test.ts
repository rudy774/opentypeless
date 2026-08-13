import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_BASE_URL, APP_REPO_URL, MANAGED_SERVICE_CONFIGURED } from '../constants'

describe('client identity defaults', () => {
  it('keeps source builds on the fork and managed access explicitly disabled', () => {
    expect(APP_REPO_URL).toBe('https://github.com/rudy774/opentypeless')
    expect(MANAGED_SERVICE_CONFIGURED).toBe(false)
    expect(API_BASE_URL).toBe('https://managed-service-unconfigured.invalid')
    expect(API_BASE_URL).not.toContain('www.opentypeless.com')
  })
})

describe('managed API build origin validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('normalizes an explicit owned HTTPS origin', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MANAGED_API_BASE_URL', '  https://api.rudyproduct.test/  ')

    const configured = await import('../constants')

    expect(configured.MANAGED_SERVICE_CONFIGURED).toBe(true)
    expect(configured.API_BASE_URL).toBe('https://api.rudyproduct.test')
  })

  it.each([
    'http://api.rudyproduct.test',
    'https://user@api.rudyproduct.test',
    'https://api.rudyproduct.test/v1',
    'https://api.rudyproduct.test?region=us',
    'https://www.opentypeless.com',
    'https://api.opentypeless.com',
    'not a URL',
  ])('fails closed for invalid or upstream origin %s', async (origin) => {
    vi.resetModules()
    vi.stubEnv('VITE_MANAGED_API_BASE_URL', origin)

    const configured = await import('../constants')

    expect(configured.MANAGED_SERVICE_CONFIGURED).toBe(false)
    expect(configured.API_BASE_URL).toBe('https://managed-service-unconfigured.invalid')
  })

  it('ignores the legacy VITE_API_BASE_URL variable', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', 'https://legacy.rudyproduct.test')

    const configured = await import('../constants')

    expect(configured.MANAGED_SERVICE_CONFIGURED).toBe(false)
    expect(configured.API_BASE_URL).toBe('https://managed-service-unconfigured.invalid')
  })
})
