import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import type { BackupCiphertext, SealedSecret } from './types.js'

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function encryptBackup(
  payload: Buffer,
  key: Buffer,
  keyId: string,
  version: number,
  createdAt: string,
): BackupCiphertext {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`opentypeless-backup:${keyId}:${version}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
  return {
    keyId,
    iv,
    ciphertext,
    authTag: cipher.getAuthTag(),
    version,
    createdAt,
    digest: sha256(payload),
  }
}

export function decryptBackup(record: BackupCiphertext, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, record.iv)
  decipher.setAAD(Buffer.from(`opentypeless-backup:${record.keyId}:${record.version}`, 'utf8'))
  decipher.setAuthTag(record.authTag)
  const plaintext = Buffer.concat([decipher.update(record.ciphertext), decipher.final()])
  if (sha256(plaintext) !== record.digest) throw new Error('Backup integrity check failed')
  return plaintext
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) {
    return false
  }
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
export function sealSecret(
  value: string,
  key: Buffer,
  keyId: string,
  purpose: string,
): SealedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`opentypeless-secret:${purpose}:${keyId}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { keyId, iv, ciphertext, authTag: cipher.getAuthTag() }
}

export function openSecret(record: SealedSecret, key: Buffer, purpose: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, record.iv)
  decipher.setAAD(Buffer.from(`opentypeless-secret:${purpose}:${record.keyId}`, 'utf8'))
  decipher.setAuthTag(record.authTag)
  return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString('utf8')
}

export function safeEqualText(left: string, right: string, maxBytes = 4096): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  if (
    leftBuffer.length > maxBytes ||
    rightBuffer.length > maxBytes ||
    leftBuffer.length !== rightBuffer.length
  ) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}
