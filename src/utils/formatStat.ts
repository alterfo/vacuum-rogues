export function formatStat(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function formatStatDelta(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) {
    return Object.is(rounded, -0) ? "0" : "+0";
  }
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
