import { describe, expect, it } from 'vitest'
import {
  MAX_RECORDING_LIMIT_SECONDS,
  MIN_RECORDING_LIMIT_SECONDS,
  normalizeRecordingLimitSeconds,
} from '../recording-limit'

describe('normalizeRecordingLimitSeconds', () => {
  it('accepts a custom limit within the supported range', () => {
    expect(normalizeRecordingLimitSeconds(90)).toBe(90)
  })

  it('clamps values to the supported range', () => {
    expect(normalizeRecordingLimitSeconds(1)).toBe(MIN_RECORDING_LIMIT_SECONDS)
    expect(normalizeRecordingLimitSeconds(10_000)).toBe(MAX_RECORDING_LIMIT_SECONDS)
  })

  it('uses the minimum for invalid input', () => {
    expect(normalizeRecordingLimitSeconds(Number.NaN)).toBe(MIN_RECORDING_LIMIT_SECONDS)
  })
})
