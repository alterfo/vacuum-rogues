export function nextRandom(state: { rngState: number }): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(
  state: { rngState: number },
  min: number,
  max: number,
): number {
  return min + nextRandom(state) * (max - min);
}

export function pickWeighted<T>(
  state: { rngState: number },
  entries: readonly { readonly item: T; readonly weight: number }[],
): T {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  let roll = nextRandom(state) * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return entries[entries.length - 1].item;
}
