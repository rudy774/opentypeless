import { describe, expect, it } from 'vitest'
import { formatTranscriptionDuration } from '../transcription-time'

describe('formatTranscriptionDuration', () => {
  it('shows seconds for short recordings', () => {
    expect(formatTranscriptionDuration(42_400)).toBe('42s')
  })

  it('shows minutes and seconds below one hour', () => {
    expect(formatTranscriptionDuration(754_000)).toBe('12m 34s')
  })

  it('shows hours and minutes for long totals', () => {
    expect(formatTranscriptionDuration(5_460_000)).toBe('1h 31m')
  })

  it('clamps invalid negative totals to zero', () => {
    expect(formatTranscriptionDuration(-1)).toBe('0s')
  })
})
