export const MIN_RECORDING_LIMIT_SECONDS = 5
export const MAX_RECORDING_LIMIT_SECONDS = 720

export function normalizeRecordingLimitSeconds(value: number): number {
  if (!Number.isFinite(value)) return MIN_RECORDING_LIMIT_SECONDS
  return Math.min(
    MAX_RECORDING_LIMIT_SECONDS,
    Math.max(MIN_RECORDING_LIMIT_SECONDS, Math.round(value)),
  )
}
