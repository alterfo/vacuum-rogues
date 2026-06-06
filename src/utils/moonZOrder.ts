const TWO_PI = Math.PI * 2;

/**
 * Returns which rendering layer a moon at the given angle belongs to.
 * Angles [0, π) are the "far" half of the orbit (behind the planet);
 * angles [π, 2π) are the "near" half (in front of the planet).
 */
export function getMoonLayer(angle: number): "back" | "front" {
  const norm = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  return norm < Math.PI ? "back" : "front";
}
