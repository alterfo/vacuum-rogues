import { SeededRNG } from "@/utils/seededRNG";
import { SYSTEM_GEOMETRY } from "@/config/balance";

export function deterministicNpcOffset(
  galaxySeed: string,
  npcId: string,
): { x: number; y: number } {
  const rng = new SeededRNG(`npcpos:${galaxySeed}:${npcId}`);
  const angle = rng.nextFloat(0, Math.PI * 2);
  const radius = rng.nextFloat(
    SYSTEM_GEOMETRY.innerRadius,
    SYSTEM_GEOMETRY.outerRadius,
  );
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function npcOrbitStep(galaxySeed: string, npcId: string): number {
  const rng = new SeededRNG(`npcdrift:${galaxySeed}:${npcId}`);
  const magnitude = rng.nextFloat(Math.PI / 60, Math.PI / 12);
  return rng.next() < 0.5 ? -magnitude : magnitude;
}

export function advanceNpcOrbit(
  offset: { x: number; y: number },
  step: number,
): { x: number; y: number } {
  const cos = Math.cos(step);
  const sin = Math.sin(step);
  return {
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos,
  };
}
