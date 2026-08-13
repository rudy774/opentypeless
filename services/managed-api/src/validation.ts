import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormatsModule, { type FormatsPlugin } from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { ServiceError } from './errors.js'

const addFormats = addFormatsModule as unknown as FormatsPlugin

const identifier = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/)
export const operationContextSchema = z
  .object({
    operationId: identifier.max(128),
    stageKey: identifier,
    requestType: z.enum(['voice_pipeline', 'ask_anything', 'connection_benchmark']),
  })
  .passthrough()

export const sttContextSchema = z
  .object({
    operationId: identifier.max(128),
    stageKey: identifier,
    requestType: z.literal('voice_pipeline'),
    clientVersion: z.string().max(40).optional(),
    language: z.string().max(32).optional(),
  })
  .strict()
export const checkoutSchema = z
  .object({
    origin: z.enum(['desktop', 'web']),
    product: z.enum(['pro_monthly', 'lifetime_starter']),
  })
  .strict()

export const llmSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string().max(100_000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    stream: z.boolean().optional().default(false),
    context: operationContextSchema,
    contextMetadata: z.record(z.string(), z.unknown()).optional(),
    voiceIntentMetadata: z.record(z.string(), z.unknown()).optional(),
    stageKey: identifier.optional(),
  })
  .strict()

export const askSchema = z
  .object({
    question: z.string().min(1).max(6000),
    context: operationContextSchema,
    voiceIntentMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const desktopExchangeSchema = z
  .object({
    code: z
      .string()
      .min(16)
      .max(2048)
      .regex(/^[A-Za-z0-9\-._~]+$/),
    codeVerifier: z
      .string()
      .min(43)
      .max(128)
      .regex(/^[A-Za-z0-9\-._~]+$/),
  })
  .strict()

export const deleteAccountSchema = z.object({ confirmation: z.literal('DELETE') }).strict()

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ServiceError(422, 'INVALID_REQUEST', 'Invalid request')
  return result.data
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{16,200}$/.test(value)) {
    throw new ServiceError(422, 'INVALID_REQUEST', 'A valid Idempotency-Key is required')
  }
  return value
}

let backupValidator: ValidateFunction | undefined

function buildBackupValidator(): ValidateFunction {
  const openApiPath = resolve(
    process.env.MANAGED_OPENAPI_PATH ?? 'docs/managed-service.openapi.json',
  )
  const openApi = JSON.parse(readFileSync(openApiPath, 'utf8')) as Record<string, unknown>
  const ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: true })
  addFormats(ajv)
  ajv.addSchema(openApi, 'managed-service')
  return ajv.compile({ $ref: 'managed-service#/components/schemas/BackupSnapshot' })
}

const secretPropertyTokens = [
  'apikey',
  'secret',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'password',
  'credential',
  'privatekey',
  'authorization',
  'cookie',
]

function validateBackupTree(value: unknown, depth = 0): void {
  if (depth > 8) throw new ServiceError(422, 'INVALID_REQUEST', 'Backup nesting is too deep')
  if (Array.isArray(value)) {
    for (const item of value) validateBackupTree(item, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (secretPropertyTokens.some((token) => normalized.includes(token))) {
      throw new ServiceError(422, 'INVALID_REQUEST', 'Backup contains a forbidden field')
    }
    validateBackupTree(child, depth + 1)
  }
}

export function validateBackupSnapshot(
  value: unknown,
  encodedBytes: number,
): asserts value is {
  version: 1
  createdAt: string
  history: unknown[]
  dictionary: unknown
  settings: unknown
} {
  if (encodedBytes > 8 * 1024 * 1024) {
    throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', 'Backup exceeds the 8 MiB limit')
  }
  validateBackupTree(value)
  backupValidator ??= buildBackupValidator()
  if (!backupValidator(value)) {
    throw new ServiceError(422, 'INVALID_REQUEST', 'Backup does not match schema version 1')
  }
}
