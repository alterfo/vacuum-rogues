import {
  ARCADE_ARMOR_CAP,
  ARCADE_ARMOR_STEP,
  ARCADE_BOMB_CAP,
  ARCADE_DRONE_CAP,
  ARCADE_HULL_CAP,
  ARCADE_MAGNET_MS,
  ARCADE_PLATING_STEP,
  ARCADE_REPAIR_SMALL,
  ARCADE_SHIELD_CAP,
  ARCADE_SHIELD_PICKUP,
  ARCADE_WEAPON_MAX_LEVEL,
} from "./arcadeConfig";
import { pickWeighted } from "./arcadeRng";
import type {
  ArcadePickupKind,
  ArcadePlayer,
  ArcadeWeaponId,
} from "./arcadeTypes";

export interface PickupOutcome {
  chipCredits: number;
  score: number;
}

const WEAPON_PICKUP: Readonly<Record<string, ArcadeWeaponId>> = {
  weapon_vulcan: "vulcan",
  weapon_laser: "laser",
  weapon_homing: "homing",
  weapon_wave: "wave",
  weapon_plasma: "plasma",
  weapon_arc: "arc",
};

export function weaponOfPickup(kind: ArcadePickupKind): ArcadeWeaponId | null {
  return WEAPON_PICKUP[kind] ?? null;
}

export function chipValue(level: number): number {
  return 25 + level * 10;
}

export function applyPickup(
  player: ArcadePlayer,
  kind: ArcadePickupKind,
  level: number,
): PickupOutcome {
  const outcome: PickupOutcome = { chipCredits: 0, score: 100 };
  const weapon = weaponOfPickup(kind);
  if (weapon) {
    if (player.weapon === weapon) {
      player.weaponLevel = Math.min(
        ARCADE_WEAPON_MAX_LEVEL,
        player.weaponLevel + 1,
      );
    } else {
      player.weapon = weapon;
    }
    return outcome;
  }
  switch (kind) {
    case "power":
      if (player.weaponLevel >= ARCADE_WEAPON_MAX_LEVEL) outcome.score += 900;
      player.weaponLevel = Math.min(
        ARCADE_WEAPON_MAX_LEVEL,
        player.weaponLevel + 1,
      );
      break;
    case "repair_small":
      player.hull = Math.min(player.maxHull, player.hull + ARCADE_REPAIR_SMALL);
      break;
    case "repair_full":
      player.hull = player.maxHull;
      break;
    case "plating":
      player.maxHull = Math.min(
        ARCADE_HULL_CAP,
        player.maxHull + ARCADE_PLATING_STEP,
      );
      player.hull = Math.min(player.maxHull, player.hull + ARCADE_PLATING_STEP);
      break;
    case "armor_coat":
      player.armor = Math.min(
        ARCADE_ARMOR_CAP,
        Math.round((player.armor + ARCADE_ARMOR_STEP) * 100) / 100,
      );
      break;
    case "shield":
      player.shieldMax = Math.min(
        ARCADE_SHIELD_CAP,
        player.shieldMax + ARCADE_SHIELD_PICKUP,
      );
      player.shield = player.shieldMax;
      break;
    case "bomb":
      player.bombs = Math.min(ARCADE_BOMB_CAP, player.bombs + 1);
      break;
    case "wingman":
      player.drones = Math.min(ARCADE_DRONE_CAP, player.drones + 1);
      break;
    case "magnet":
      player.magnetMs = ARCADE_MAGNET_MS;
      break;
    case "chip":
      outcome.chipCredits = chipValue(level);
      break;
  }
  return outcome;
}

const RANDOM_DROPS: readonly { item: ArcadePickupKind; weight: number }[] = [
  { item: "weapon_vulcan", weight: 7 },
  { item: "weapon_laser", weight: 7 },
  { item: "weapon_homing", weight: 7 },
  { item: "weapon_wave", weight: 7 },
  { item: "weapon_plasma", weight: 7 },
  { item: "weapon_arc", weight: 7 },
  { item: "power", weight: 14 },
  { item: "repair_small", weight: 14 },
  { item: "repair_full", weight: 3 },
  { item: "plating", weight: 6 },
  { item: "armor_coat", weight: 8 },
  { item: "shield", weight: 8 },
  { item: "bomb", weight: 6 },
  { item: "wingman", weight: 4 },
  { item: "magnet", weight: 4 },
  { item: "chip", weight: 10 },
];

const CAPSULE_DROPS: readonly { item: ArcadePickupKind; weight: number }[] = [
  { item: "weapon_vulcan", weight: 12 },
  { item: "weapon_laser", weight: 12 },
  { item: "weapon_homing", weight: 12 },
  { item: "weapon_wave", weight: 12 },
  { item: "weapon_plasma", weight: 12 },
  { item: "weapon_arc", weight: 12 },
  { item: "power", weight: 24 },
  { item: "shield", weight: 12 },
  { item: "armor_coat", weight: 10 },
  { item: "plating", weight: 8 },
  { item: "repair_full", weight: 8 },
  { item: "bomb", weight: 8 },
  { item: "wingman", weight: 8 },
];

export const BOSS_REWARD_DROPS: readonly ArcadePickupKind[] = [
  "repair_full",
  "shield",
  "plating",
  "armor_coat",
  "power",
];

export function rollRandomDrop(rng: { rngState: number }): ArcadePickupKind {
  return pickWeighted(rng, RANDOM_DROPS);
}

export function rollCapsuleDrop(rng: { rngState: number }): ArcadePickupKind {
  return pickWeighted(rng, CAPSULE_DROPS);
}
