/**
 * Format a numeric gear/ship stat for player-facing UI.
 *
 * Kills IEEE-754 subtraction noise — e.g. `1.4 - 0.9 === 0.4999999999999999`
 * would otherwise leak straight into a shop stat line («+0.4999999999999999 vs …»).
 * Rounds to at most two decimals (enough for every catalog potency, which carries
 * one decimal at most) and stringifies, so integers stay integral (`40 → "40"`)
 * and clean decimals keep their shape (`1.4 → "1.4"`, `0.4999… → "0.5"`).
 */
export function formatStat(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Signed variant for comparison deltas: always prefixes non-negative values with «+». */
export function formatStatDelta(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    // A tiny negative delta (e.g. -0.001) rounds to -0, and -0 >= 0 is true in
    // JS — without this branch it would read "+0", misreporting a negative
    // delta as non-negative.
    return Object.is(rounded, -0) ? "0" : "+0";
  }
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
