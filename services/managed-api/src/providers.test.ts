import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceConfig } from './config.js'
import { ServiceError } from './errors.js'
import { ElevenLabsGeminiProviders } from './providers.js'

function config(): ServiceConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 8787,
    apiOrigin: 'https://api.example.test',
    databaseUrl: 'postgres://test',
    databaseSsl: false,
    databasePoolMax: 2,
    runMigrationsOnStart: false,
    trustProxyHops: 0,
    authSecret: 'a'.repeat(32),
    backupKey: Buffer.alloc(32, 1),
    backupKeyId: 'primary',
    corsOrigins: new Set(['http://tauri.localhost']),
    desktopDeepLinkScheme: 'rudyopentypeless',
    elevenLabsApiKey: 'test-elevenlabs-key',
    elevenLabsModel: 'scribe_v2',
    geminiApiKey: 'test-gemini-key',
    geminiModel: 'gemini-2.5-flash',
    proMonthlyCloudWords: 100_000,
    lifetimeCloudWords: 25_000,
    logLevel: 'error',
    shutdownGraceMs: 5000,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('managed provider adapters', () => {
  it('sends WAV audio only to ElevenLabs and parses the bounded transcript', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/speech-to-text')
      expect(new Headers(init?.headers).get('xi-api-key')).toBe('test-elevenlabs-key')
      const form = init?.body as FormData
      expect(form.get('model_id')).toBe('scribe_v2')
      expect(form.get('language_code')).toBe('en')
      expect(form.get('file')).toBeInstanceOf(Blob)
      return new Response(JSON.stringify({ text: 'Hello from ElevenLabs', language_code: 'en' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new ElevenLabsGeminiProviders(config()).transcribe(Buffer.from('wav'), 'audio/wav', 'en'),
    ).resolves.toEqual({ text: 'Hello from ElevenLabs', detectedLanguage: 'en' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps cleanup messages to Gemini and reports real provider token counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-gemini-key')
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body.systemInstruction).toBeDefined()
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Polished text' }] } }],
            usageMetadata: { promptTokenCount: 22, candidatesTokenCount: 4 },
          }),
        )
      }),
    )

    await expect(
      new ElevenLabsGeminiProviders(config()).polish([
        { role: 'system', content: 'Clean this.' },
        { role: 'user', content: 'hello um world' },
      ]),
    ).resolves.toEqual({ text: 'Polished text', inputTokens: 22, outputTokens: 4 })
  })

  it('parses CRLF Gemini SSE chunks and accepts a final usage-only event', async () => {
    const stream = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Fast "}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"result"}]},"finishReason":"STOP"}]}',
      '',
      'data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}',
      '',
      '',
    ].join('\r\n')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream)),
    )
    const chunks: string[] = []
    const result = await new ElevenLabsGeminiProviders(config()).streamPolish(
      [{ role: 'user', content: 'clean this' }],
      (chunk) => chunks.push(chunk),
    )
    expect(chunks).toEqual(['Fast ', 'result'])
    expect(result).toEqual({ text: 'Fast result', inputTokens: 10, outputTokens: 2 })
  })

  it('rejects a Gemini stream that ends after partial text without a completion reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: {"candidates":[{"content":{"parts":[{"text":"Partial"}]}}]}'),
      ),
    )
    const chunks: string[] = []

    await expect(
      new ElevenLabsGeminiProviders(config()).streamPolish(
        [{ role: 'user', content: 'clean this' }],
        (chunk) => chunks.push(chunk),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(chunks).toEqual(['Partial'])
  })
  it('never exposes upstream URLs, credentials, or response bodies in service errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('token=test-secret at https://provider.invalid/private', { status: 401 }),
      ),
    )
    const error = await new ElevenLabsGeminiProviders(config())
      .polish([{ role: 'user', content: 'hello' }])
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ServiceError)
    expect(String((error as Error).message)).toBe(
      'The managed AI provider is temporarily unavailable',
    )
    expect(String(error)).not.toContain('test-secret')
    expect(String(error)).not.toContain('provider.invalid')
  })
})
