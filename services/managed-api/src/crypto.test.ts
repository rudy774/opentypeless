import { describe, expect, it } from 'vitest'
import {
  decryptBackup,
  encryptBackup,
  openSecret,
  safeEqualHex,
  safeEqualText,
  sealSecret,
} from './crypto.js'

describe('managed service encryption', () => {
  const key = Buffer.alloc(32, 4)

  it('encrypts backups with authenticated metadata and detects tampering', () => {
    const payload = Buffer.from('{"portable":true}')
    const encrypted = encryptBackup(payload, key, 'primary', 1, '2026-08-13T00:00:00.000Z')
    expect(decryptBackup(encrypted, key)).toEqual(payload)

    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) }
    tampered.ciphertext[0] ^= 1
    expect(() => decryptBackup(tampered, key)).toThrow()
  })

  it('seals one-time session tokens under a purpose-specific AAD boundary', () => {
    const sealed = sealSecret('signed.session.token', key, 'primary', 'desktop-oauth-session')
    expect(openSecret(sealed, key, 'desktop-oauth-session')).toBe('signed.session.token')
    expect(() => openSecret(sealed, key, 'different-purpose')).toThrow()
  })

  it('uses length-checked constant-time comparison helpers', () => {
    expect(safeEqualHex('aabb', 'aabb')).toBe(true)
    expect(safeEqualHex('aabb', 'aabc')).toBe(false)
    expect(safeEqualText('challenge', 'challenge')).toBe(true)
    expect(safeEqualText('challenge', 'different')).toBe(false)
  })
})
