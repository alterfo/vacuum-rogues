import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";

function distance(a: StarSystem, b: StarSystem): number {
  const dq = a.coordinates.q - b.coordinates.q;
  const dr = a.coordinates.r - b.coordinates.r;
  return Math.sqrt(dq * dq + dr * dr);
}

/** Days a hop takes: warp-path cost if connected, else coordinate distance. */
export function travelDays(
  galaxy: Galaxy,
  fromId: string,
  toId: string,
): number {
  const from = galaxy.systems.find((s) => s.id === fromId);
  const warp = from?.connections.find((c) => c.toSystemId === toId);
  if (warp) return Math.max(1, Math.round(warp.fuelCost));

  const to = galaxy.systems.find((s) => s.id === toId);
  if (from && to) return Math.max(1, Math.round(distance(from, to) / 10));
  return 1;
}
