import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { ServiceConfig } from './config.js'

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const
const allowedMetadata = new Set([
  'route',
  'method',
  'status',
  'durationMs',
  'errorCode',
  'providerClass',
  'requestType',
  'usageKind',
  'reservedUnits',
  'settledUnits',
  'plan',
  'source',
  'eventType',
])

function sanitizeMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedMetadata.has(key)) continue
    if (typeof value === 'string') safe[key] = value.slice(0, 120)
    else safe[key] = value
  }
  return Object.keys(safe).length ? safe : undefined
}

export function requestContext(config: ServiceConfig) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const requestIdHeader = request.get('x-request-id')
    request.requestId =
      requestIdHeader && /^[A-Za-z0-9._-]{8,128}$/.test(requestIdHeader)
        ? requestIdHeader
        : randomUUID()
    response.setHeader('X-Request-Id', request.requestId)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Cache-Control', 'no-store')
    if (config.nodeEnv === 'production') {
      response.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
    }
    request.log = (level, event, metadata) => {
      if (levels[level] < levels[config.logLevel]) return
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        event: event.slice(0, 80),
        requestId: request.requestId,
        ...sanitizeMetadata(metadata),
      }
      const output = JSON.stringify(entry)
      if (level === 'error') console.error(output)
      else if (level === 'warn') console.warn(output)
      else console.log(output)
    }
    const startedAt = performance.now()
    response.on('finish', () => {
      request.log?.(response.statusCode >= 500 ? 'error' : 'info', 'request_complete', {
        route: request.route?.path ? String(request.route.path) : request.path,
        method: request.method,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      })
    })
    next()
  }
}

export function cors(config: ServiceConfig) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.get('origin')
    if (origin) {
      let normalized: string | undefined
      try {
        normalized = new URL(origin).origin
      } catch {
        response.status(403).end()
        return
      }
      if (!config.corsOrigins.has(normalized)) {
        response.status(403).end()
        return
      }
      response.setHeader('Access-Control-Allow-Origin', normalized)
      response.setHeader('Vary', 'Origin')
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Idempotency-Key, X-OpenTypeless-Version, X-Request-Id',
      )
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      response.setHeader('Access-Control-Expose-Headers', 'Set-Auth-Token, X-Request-Id')
      response.setHeader('Access-Control-Max-Age', '600')
    }
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    next()
  }
}
