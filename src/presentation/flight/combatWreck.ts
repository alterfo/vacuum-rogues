export interface WreckConfig {
  driftRetentionPerMs: number;
  lifeMs: number;
  fadeMs: number;
  spinRatePerSpeed: number;
}

export const DEFAULT_WRECK: WreckConfig = {
  driftRetentionPerMs: 0.9994,
  lifeMs: 5000,
  fadeMs: 1200,
  spinRatePerSpeed: 4,
};

export interface WreckState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spinRate: number;
  ageMs: number;
  lifeMs: number;
}

export function shipVelocity(
  angle: number,
  speed: number,
): { vx: number; vy: number } {
  if (!Number.isFinite(angle) || !Number.isFinite(speed)) {
    return { vx: 0, vy: 0 };
  }
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

export function spawnWreck(
  x: number,
  y: number,
  vx: number,
  vy: number,
  angle: number,
  config: WreckConfig = DEFAULT_WRECK,
): WreckState {
  const sx = Number.isFinite(x) ? x : 0;
  const sy = Number.isFinite(y) ? y : 0;
  const svx = Number.isFinite(vx) ? vx : 0;
  const svy = Number.isFinite(vy) ? vy : 0;
  const speed = Math.hypot(svx, svy);
  return {
    x: sx,
    y: sy,
    vx: svx,
    vy: svy,
    angle: Number.isFinite(angle) ? angle : 0,
    spinRate: Math.max(0, config.spinRatePerSpeed) * speed,
    ageMs: 0,
    lifeMs: Math.max(0, config.lifeMs),
  };
}

export function advanceWreck(
  state: WreckState,
  dtMs: number,
  config: WreckConfig = DEFAULT_WRECK,
): WreckState {
  if (!(dtMs > 0) || isWreckDone(state)) return state;
  const decay = Math.pow(clamp01(config.driftRetentionPerMs), dtMs);
  return {
    ...state,
    x: state.x + state.vx * dtMs,
    y: state.y + state.vy * dtMs,
    vx: state.vx * decay,
    vy: state.vy * decay,
    angle: state.angle + state.spinRate * dtMs,
    ageMs: state.ageMs + dtMs,
  };
}

export function isWreckDone(state: WreckState): boolean {
  return state.ageMs >= state.lifeMs;
}

export function wreckAlpha(
  state: WreckState,
  config: WreckConfig = DEFAULT_WRECK,
): number {
  if (state.lifeMs <= 0 || state.ageMs >= state.lifeMs) return 0;
  const fade = Math.max(0, Math.min(config.fadeMs, state.lifeMs));
  const fadeStart = state.lifeMs - fade;
  if (fade <= 0 || state.ageMs <= fadeStart) return 1;
  return clamp01((state.lifeMs - state.ageMs) / fade);
}

export function wreckLootEmissionTimes(
  count: number,
  spreadMs: number,
): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const span = Math.max(0, spreadMs);
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(((i + 0.5) / n) * span);
  return times;
}

export function dueLootEmissions(
  prevAgeMs: number,
  currAgeMs: number,
  times: readonly number[],
): number[] {
  if (!(currAgeMs > prevAgeMs)) return [];
  const due: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t >= prevAgeMs && t < currAgeMs) due.push(i);
  }
  return due;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
