export function arrivalHeadingFromExitVector(exitVector: {
  x: number;
  y: number;
}): number {
  return Math.atan2(exitVector.y, exitVector.x);
}

export function departureVectorFromExitPoint(
  exitPoint: { x: number; y: number } | null,
  center: { x: number; y: number },
  fallbackExitVector: { x: number; y: number },
): { x: number; y: number } {
  if (!exitPoint) return fallbackExitVector;
  const dx = exitPoint.x - center.x;
  const dy = exitPoint.y - center.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-6 ? { x: dx / len, y: dy / len } : fallbackExitVector;
}
