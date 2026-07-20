import { describe, expect, it } from 'vitest'
import { normalizeAudioLevel, smoothAudioLevel } from '../audio-level'

describe('normalizeAudioLevel', () => {
  it('keeps silence and the noise floor calm', () => {
    expect(normalizeAudioLevel(0)).toBe(0)
    expect(normalizeAudioLevel(0.001)).toBe(0)
  })

  it('makes normal microphone speech visibly responsive', () => {
    expect(normalizeAudioLevel(0.01)).toBeGreaterThan(0.4)
    expect(normalizeAudioLevel(0.05)).toBeGreaterThan(0.75)
  })

  it('clamps invalid and loud values', () => {
    expect(normalizeAudioLevel(Number.NaN)).toBe(0)
    expect(normalizeAudioLevel(1)).toBe(1)
  })
})

describe('smoothAudioLevel', () => {
  it('attacks faster than it releases', () => {
    const attack = smoothAudioLevel(0, 1)
    const release = 1 - smoothAudioLevel(1, 0)
    expect(attack).toBeGreaterThan(release)
  })
})
