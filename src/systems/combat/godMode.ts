import type { GameMode } from "@/types";
import type { Player } from "@/domain/Player";
import { GOD_MODE_HULL_FLOOR_FRACTION } from "@/config/balance";

export interface ModeDamageResult {
  readonly hull: number;
  readonly downed: boolean;
}

export function hullFloorFor(mode: GameMode, maxHull: number): number {
  if (mode !== "GOD") return 0;
  return Math.max(1, Math.ceil(maxHull * GOD_MODE_HULL_FLOOR_FRACTION));
}

export function applyDamageWithMode(
  mode: GameMode,
  hull: number,
  damage: number,
  maxHull: number,
): ModeDamageResult {
  const floor = hullFloorFor(mode, maxHull);
  const newHull = Math.max(floor, hull - damage);
  return { hull: newHull, downed: isHullDowned(mode, newHull, maxHull) };
}

export function isHullDowned(
  mode: GameMode,
  hull: number,
  maxHull: number,
): boolean {
  return mode === "GOD" && hull <= hullFloorFor(mode, maxHull);
}

export function isDowned(player: Player): boolean {
  return isHullDowned(player.gameMode, player.ship.hullHP, player.ship.maxHull);
}
