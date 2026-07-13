export function calculateTinyPngRegistrationSuccessRate(
  successfulCount: number,
  createdCount: number,
): number | null {
  if (createdCount <= 0) return null

  return Math.round((successfulCount / createdCount) * 1000) / 10
}
