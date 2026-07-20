/** Map raw microphone RMS to a useful 0..1 display range.
 *
 * Microphone speech is commonly far below a linear value of 1.0. A decibel
 * curve makes quiet speech visible while keeping the ambient noise floor calm.
 */
export function normalizeAudioLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0

  const decibels = 20 * Math.log10(Math.max(rms, 0.00001))
  return Math.max(0, Math.min(1, (decibels + 58) / 38))
}

export function smoothAudioLevel(previous: number, target: number): number {
  const speed = target > previous ? 0.48 : 0.16
  return previous + (target - previous) * speed
}
