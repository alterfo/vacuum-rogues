/**
 * In-combat comms («Связь») — planning-phase negotiation action. Pure, PixiJS-free.
 *
 * Task 10 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). The «Связь» action is one of the
 * planning-phase choices (alongside movement / weapons / afterburner / consumable) threaded by
 * {@link import("./combatPlanning").PlannedTurn.commsAction} — a single selected id per turn
 * (Task 2). This module defines the three resolution branches from the spec and the pure rules
 * for each; the execute-phase loop consumes them once wired (a later task). It extends the
 * `NpcInteractionController` shakedown-hail pattern to be reachable **mid-fight** (today that flow
 * is pre-combat/negotiation-gated only).
 *
 * **The three branches (spec):**
 * - **bribe** — pay the target a tribute to break it off, reusing the existing
 *   {@link shakedownTribute} economy math (a fixed fraction of the player's purse). The target
 *   disengages once paid (like a shakedown payoff), even for a penniless player (tribute 0).
 *   {@link resolveBribe}.
 * - **demand-surrender** — a **role- and hull-fraction-gated** demand: an NPC yields (flees +
 *   drops its loot, **not** destroyed) only if its hull fraction is at/below a role-scaled
 *   threshold — traders are cowardly (high threshold), rangers/pirates brave (low), and the hive
 *   `OVERMIND` never surrenders. This is deliberately **not** unconditional: a fresh full-hull
 *   escort ignores the demand. {@link resolveSurrenderDemand}.
 * - **call-for-help** — a nearby friendly NPC (trader or military) within a proximity radius joins
 *   the fight on the player's side; the **closest eligible** one answers, or none if there is no
 *   eligible ally in range (the failure case). {@link findCallForHelpAlly}.
 *
 * **Surrender resolution decision (recorded, Task 10):** a surrendering NPC **flees while dropping
 * its loot** — it is removed from the fight via the existing departure/flee path (never destroyed),
 * and the player still collects the loot it yields. Chosen over "yields loot without fleeing"
 * (would leave a passive sitting target the player could then execute for free — contradicts the
 * "spared, not killed" intent) and over "flees empty-handed" (no reward for a successful demand).
 *
 * The module stays pure — it operates over plain numbers and generic candidate handles projected
 * via `posOf`/`roleOf`, so it unit-tests standalone, the same discipline as `combatPlanning` /
 * `combatConsumable` / `combatMissile`. Live tuning comes from `COMBAT_COMMS` in `balance.ts`; the
 * module mirrors it as {@link DEFAULT_COMBAT_COMMS}, kept in lockstep by `combatComms.test.ts`.
 */

import { shakedownTribute } from "@/systems/npc/NpcBrain";

/** The three in-combat comms branches; the id stored in `PlannedTurn.commsAction`. */
export type CommsAction = "bribe" | "demand-surrender" | "call-for-help";

/** Tuning for the three comms branches; mirrors `COMBAT_COMMS` in `balance.ts`. */
export interface CombatCommsConfig {
  /**
   * Per-role hull-fraction ceiling at/below which a hailed NPC surrenders. Higher = more cowardly.
   * A role absent from this map falls back to {@link defaultSurrenderThreshold}; a threshold ≤ 0
   * means "never surrenders" (the hive `OVERMIND`).
   */
  readonly surrenderHullThreshold: Readonly<Record<string, number>>;
  /** Surrender threshold for a role not present in {@link surrenderHullThreshold}. */
  readonly defaultSurrenderThreshold: number;
  /** Max distance (world px) a friendly NPC can be from the player to answer a call for help. */
  readonly allyProximityRadius: number;
  /** Roles eligible to answer a call for help (trader + military per the spec). */
  readonly allyRoles: readonly string[];
}

/** Module-local default, mirroring `COMBAT_COMMS` so this file stays import-light for tests. */
export const DEFAULT_COMBAT_COMMS: CombatCommsConfig = {
  surrenderHullThreshold: {
    TRADER: 0.6,
    PATROL: 0.35,
    RANGER: 0.3,
    PIRATE: 0.2,
    OVERMIND: 0,
  },
  defaultSurrenderThreshold: 0.25,
  allyProximityRadius: 700,
  allyRoles: ["TRADER", "PATROL", "RANGER"],
};

/** i18n key for the shared player-facing comms category label ("Связь" / "Comms"). */
export const COMBAT_COMMS_CATEGORY_KEY = "combat.comms.category";

/** A comms branch's player-facing name/desc i18n keys, for the planning-phase «Связь» panel. */
export interface CommsActionDef {
  readonly id: CommsAction;
  readonly nameKey: string;
  readonly descKey: string;
}

/** The three selectable comms actions and their i18n keys. */
export const COMBAT_COMMS_ACTIONS: readonly CommsActionDef[] = [
  {
    id: "bribe",
    nameKey: "combat.comms.bribe.name",
    descKey: "combat.comms.bribe.desc",
  },
  {
    id: "demand-surrender",
    nameKey: "combat.comms.surrender.name",
    descKey: "combat.comms.surrender.desc",
  },
  {
    id: "call-for-help",
    nameKey: "combat.comms.callHelp.name",
    descKey: "combat.comms.callHelp.desc",
  },
] as const;

/** Look up a comms action definition by id, or null if the id isn't a known comms action. */
export function commsActionById(
  id: string | null | undefined,
): CommsActionDef | null {
  if (!id) return null;
  return COMBAT_COMMS_ACTIONS.find((a) => a.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Branch 1 — bribe (reuses the existing shakedown economy path)
// ---------------------------------------------------------------------------

/** Outcome of a bribe attempt: the tribute owed and whether the target breaks off. */
export interface BribeResult {
  /** Whole credits owed (the existing {@link shakedownTribute} of the player's purse). */
  readonly tribute: number;
  /** Whether the target disengages once paid (always true — a bribe always buys peace this fight). */
  readonly disengages: boolean;
}

/**
 * Resolve a bribe: the tribute is the existing {@link shakedownTribute} of the player's purse (a
 * fixed, clamped fraction, never more than the player has — a penniless player owes 0). The target
 * disengages once paid, exactly like a pirate shakedown payoff, so even a 0-credit bribe still buys
 * peace for this fight. The caller moves the credits through the bank bus (`payTribute`) — this
 * function computes the amount and the disengage decision only, staying free of economy side effects.
 */
export function resolveBribe(playerCredits: number): BribeResult {
  return { tribute: shakedownTribute(playerCredits), disengages: true };
}

// ---------------------------------------------------------------------------
// Branch 2 — demand-surrender (role- and hull-fraction-gated)
// ---------------------------------------------------------------------------

/** The role-scaled hull-fraction ceiling at/below which `role` surrenders (0 ⇒ never). */
export function surrenderThreshold(
  role: string,
  config: CombatCommsConfig = DEFAULT_COMBAT_COMMS,
): number {
  const t = config.surrenderHullThreshold[role];
  return t !== undefined ? t : config.defaultSurrenderThreshold;
}

/** Outcome of a demand-surrender: whether the target yields (flees + drops loot, not destroyed). */
export interface SurrenderResult {
  readonly surrenders: boolean;
}

/**
 * Resolve a demand-surrender: the target yields only if its (clamped `[0,1]`) hull fraction is
 * at/below its role's {@link surrenderThreshold} AND that threshold is strictly positive — so the
 * hive `OVERMIND` (threshold 0) never surrenders even at 0 hull, and a fresh full-hull escort
 * ignores the demand. A yielding NPC flees while dropping its loot (recorded decision), never
 * destroyed. Deterministic — a role/hull pair always resolves the same way (no RNG).
 */
export function resolveSurrenderDemand(
  role: string,
  hullFraction: number,
  config: CombatCommsConfig = DEFAULT_COMBAT_COMMS,
): SurrenderResult {
  const threshold = surrenderThreshold(role, config);
  if (threshold <= 0) return { surrenders: false };
  const frac = Number.isFinite(hullFraction)
    ? Math.min(1, Math.max(0, hullFraction))
    : 1;
  return { surrenders: frac <= threshold };
}

// ---------------------------------------------------------------------------
// Branch 3 — call-for-help (nearest eligible friendly NPC in range)
// ---------------------------------------------------------------------------

/**
 * Find the friendly NPC that answers a call for help: the **closest** candidate that is (1) of an
 * ally-eligible role (`config.allyRoles` — trader + military), (2) within
 * `config.allyProximityRadius` of the player, and (3) `isAvailable` (the caller's predicate — e.g.
 * not itself hostile/aggressive, not departing/gone; defaults to always available). Returns the
 * chosen ally, or **null** when no eligible ally is in range (the failure case). Pure and generic —
 * `posOf`/`roleOf` project a candidate handle so the module never touches sprite internals.
 */
export function findCallForHelpAlly<T>(
  playerPos: { x: number; y: number },
  candidates: readonly T[],
  posOf: (c: T) => { x: number; y: number },
  roleOf: (c: T) => string,
  isAvailable: (c: T) => boolean = () => true,
  config: CombatCommsConfig = DEFAULT_COMBAT_COMMS,
): T | null {
  const radius = Math.max(0, config.allyProximityRadius);
  const r2 = radius * radius;
  let best: T | null = null;
  let bestD2 = Infinity;
  for (const c of candidates) {
    if (!config.allyRoles.includes(roleOf(c))) continue;
    if (!isAvailable(c)) continue;
    const p = posOf(c);
    const dx = p.x - playerPos.x;
    const dy = p.y - playerPos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  }
  return best;
}
