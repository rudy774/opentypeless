import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express'

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_SESSION_INVALID'
  | 'AUTH_RECENT_LOGIN_REQUIRED'
  | 'ENTITLEMENT_REQUIRED'
  | 'QUOTA_EXHAUSTED'
  | 'QUOTA_RESERVATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'PROVIDER_UNAVAILABLE'
  | 'BACKUP_NOT_FOUND'
  | 'INTERNAL_ERROR'

export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export function assertRequest(condition: unknown, message = 'Invalid request'): asserts condition {
  if (!condition) throw new ServiceError(422, 'INVALID_REQUEST', message)
}

export function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response, next).catch(next)
}

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  const requestId = request.requestId
  if (error instanceof ServiceError) {
    if (error.retryAfterMs !== null) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil(error.retryAfterMs / 1000)))
    }
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message.slice(0, 240),
        retryable: error.retryable,
        retryAfterMs: error.retryAfterMs,
      },
      requestId,
    })
    return
  }
  request.log?.('error', 'request_failed', { route: request.path })
  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The service could not complete the request',
      retryable: false,
      retryAfterMs: null,
    },
    requestId,
  })
}
