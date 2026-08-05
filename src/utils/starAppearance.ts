import { SeededRNG } from "./seededRNG";

export interface StarAppearanceJitter {
  coronaScale: number;
  glowIntensity: number;
  tempShift: number;
}

export const CORONA_SPREAD = 0.12;
export const GLOW_SPREAD = 0.18;
const TEMP_AMOUNT = 26;

export function starAppearanceJitter(systemId: string): StarAppearanceJitter {
  const rng = new SeededRNG(`star_jitter_${systemId}`);
  return {
    coronaScale: 1 + rng.nextFloat(-CORONA_SPREAD, CORONA_SPREAD),
    glowIntensity: 1 + rng.nextFloat(-GLOW_SPREAD, GLOW_SPREAD),
    tempShift: rng.nextFloat(-1, 1),
  };
}

export function shiftTemperature(base: number, tempShift: number): number {
  const r0 = (base >> 16) & 0xff;
  const g0 = (base >> 8) & 0xff;
  const b0 = base & 0xff;
  const d = Math.round(tempShift * TEMP_AMOUNT);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v)) & 0xff;
  const r = clamp(r0 + d);
  const g = clamp(g0 + Math.round(d * 0.15)); // green barely moves
  const b = clamp(b0 - d);
  return (r << 16) | (g << 8) | b;
}
