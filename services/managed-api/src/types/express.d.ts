import type { AuthSession } from '../auth.js'
import type { AuthenticatedUser } from '../types.js'

declare global {
  namespace Express {
    interface Request {
      requestId: string
      user?: AuthenticatedUser
      authSession?: AuthSession
      rawBodyBytes?: number
      log?: (
        level: 'debug' | 'info' | 'warn' | 'error',
        event: string,
        metadata?: Record<string, string | number | boolean | null>,
      ) => void
    }
  }
}

export {}
