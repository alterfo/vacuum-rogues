export interface AfterburnerConfig {
  speedMultiplier: number;
  wearPerBurn: number;
  minIntegrityToEngage: number;
}

export const DEFAULT_AFTERBURNER: AfterburnerConfig = {
  speedMultiplier: 2.2,
  wearPerBurn: 0.12,
  minIntegrityToEngage: 0.05,
};

export interface EngineWearState {
  readonly integrity: number;
}

export interface AfterburnerResult {
  readonly state: EngineWearState;
  readonly multiplier: number;
  readonly engaged: boolean;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function pristineEngine(): EngineWearState {
  return { integrity: 1 };
}

export function canAfterburn(
  state: EngineWearState,
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): boolean {
  return state.integrity > Math.max(0, config.minIntegrityToEngage);
}

export function afterburnerMultiplier(
  integrity: number,
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): number {
  if (integrity <= Math.max(0, config.minIntegrityToEngage)) return 1;
  const boost = Math.max(0, config.speedMultiplier - 1) * clamp01(integrity);
  return 1 + boost;
}

export function engageAfterburner(
  state: EngineWearState,
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): AfterburnerResult {
  if (!canAfterburn(state, config)) {
    return { state, multiplier: 1, engaged: false };
  }
  const multiplier = afterburnerMultiplier(state.integrity, config);
  const integrity = Math.max(
    0,
    state.integrity - Math.max(0, config.wearPerBurn),
  );
  return { state: { integrity }, multiplier, engaged: true };
}

export function afterburnerBurnBudget(
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): number {
  const wear = Math.max(0, config.wearPerBurn);
  if (wear <= 0) return Infinity;
  const usable = 1 - Math.max(0, config.minIntegrityToEngage);
  return Math.floor(usable / wear) + 1;
}
