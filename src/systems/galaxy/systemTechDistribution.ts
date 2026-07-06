import { SeededRNG } from "@/utils/seededRNG";
import type { StarSystem } from "@/domain/StarSystem";

/**
 * New-game system tech-level spread for galaxy seeding.
 *
 * Every star system used to keep the hardcoded default `StarSystem.techLevel`
 * of 1 (the constructor takes no tech argument), so no shop anywhere stocked
 * gear above tech 1 — and the ONLY tech-1 item in the whole `GEAR_CATALOG` is a
 * fuel tank. Weapons and hulls were therefore unbuyable across the entire galaxy
 * at game start, which made military progression (`arm-up` → battle-ready →
 * Overmind-slayer) impossible in real sessions: a 100-run autopilot diagnostic
 * recorded 0/100 arm-ups, 0/100 battle-ready, and 0/100 arc wins, with the ship
 * frozen at its starter corvette (maxHull 130, weaponDamage 14).
 *
 * These relative weights (they need not sum to anything) give the galaxy a
 * varied tech gradient — a "developed core, frontier rim" feel closer to the
 * source game — so gear is actually buyable. Tuned so a meaningful share of
 * systems reach tech ≥ 3 (where `wpn_rocket`/`wpn_scatter` unlock, the weapon
 * half of battle-ready), while apex tech-6/7 gear stays a long earned climb via
 * the daily `advanceTech` tick rather than something generated at the start.
 */
export const SYSTEM_TECH_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 3],
  [3, 3],
  [4, 2],
  [5, 1],
];

/**
 * Floor tech level for the player's home system (`systems[0]`, where a new game
 * begins — see `GameEngine`). Guarantees weapon-ready gear (the tech-3
 * `wpn_rocket`, +35 damage, which `arm-up` fits into the corvette's free second
 * weapon slot to clear `BATTLE_READY_WEAPON_DAMAGE`) is buyable right where the
 * run starts — directly breaking the land↔take-off churn the autopilot showed
 * when a system offered nothing actionable to do.
 */
export const HOME_SYSTEM_MIN_TECH = 3;

/**
 * At least one system per galaxy is raised to this tech so a battle-ready HULL
 * (`hull_warden`, tech 5 — the first frame whose 220 hp clears
 * `BATTLE_READY_MAX_HULL` of 200; nothing at tech ≤ 4 reaches it) always exists
 * somewhere to hunt. Keeps the Overmind-slayer arc winnable on every seed rather
 * than only on lucky rolls that happen to place a high-tech system.
 */
export const GALAXY_MAX_TECH_FLOOR = 5;

/**
 * Deterministically pick a weighted system tech level. `rng` only needs
 * `next()` → [0,1) (a {@link SeededRNG} satisfies this), so the draw is
 * reproducible from the seed it was built with.
 */
export function pickSystemTechLevel(rng: { next(): number }): number {
  const total = SYSTEM_TECH_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [tech, weight] of SYSTEM_TECH_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return tech;
  }
  return SYSTEM_TECH_WEIGHTS[0][0];
}

/**
 * Assign each system a generation tech level **in place**, then apply the home
 * and galaxy floors. Each system draws from an INDEPENDENT per-system seed
 * (`${seed}_tech_${i}`) rather than the shared generation RNG stream, mirroring
 * the star-type picker — so adding this never perturbs the deterministic
 * coordinate/economy/NPC seeding that downstream systems and tests depend on.
 */
export function assignSystemTechLevels(
  systems: StarSystem[],
  seed: string,
): void {
  systems.forEach((system, i) => {
    system.techLevel = pickSystemTechLevel(new SeededRNG(`${seed}_tech_${i}`));
  });
  if (systems.length === 0) return;
  // Home-system floor (systems[0]): never lower a system the roll already put
  // higher — only raise it to the floor.
  systems[0].techLevel = Math.max(systems[0].techLevel, HOME_SYSTEM_MIN_TECH);
  // Galaxy floor: ensure the galaxy's peak reaches GALAXY_MAX_TECH_FLOOR by
  // raising its current highest-tech system (lowest index among ties, for
  // determinism) when no roll got there on its own.
  let peakIdx = 0;
  for (let i = 1; i < systems.length; i++) {
    if (systems[i].techLevel > systems[peakIdx].techLevel) peakIdx = i;
  }
  if (systems[peakIdx].techLevel < GALAXY_MAX_TECH_FLOOR) {
    systems[peakIdx].techLevel = GALAXY_MAX_TECH_FLOOR;
  }
}
