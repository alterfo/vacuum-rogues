import type {
  FactionType,
  NpcRole,
  NpcState,
  NpcGoal,
  NpcShipInit,
  NpcSizeTier,
} from "@/types";

import type { Faction } from "@/types/faction";

/**
 * Autonomous NPC ship that lives in the galaxy independent of the player
 * (other rangers, traders, pirates, patrols). Mostly a data class — behaviour is
 * driven by NpcSimulator / NpcBrain. The few methods it carries (hostility
 * state) are safe across save/load because GameEngine.rehydrateLoadedState
 * re-attaches the prototype to every loaded NpcShip.
 */
export class NpcShip {
  id: string;
  name: string;
  race: FactionType;
  faction: Faction;
  role: NpcRole;
  hullHP: number;
  maxHull: number;
  shields: number;
  speed: number;
  damage: number;
  currentSystemId: string;
  state: NpcState;
  goal: NpcGoal | null;
  destinationSystemId: string | null;
  daysToArrival: number;
  credits: number;
  reputation: number;
  shieldPower: number;
  loadoutSummary: string[];
  /** Goods a trader NPC carries between systems; influences market prices on arrival. */
  cargo: { goodId: string; qty: number }[];
  /** System ID this ranger NPC is traveling toward to complete an off-screen quest. */
  activeQuestTarget: string | null;
  /** Shared ID grouping ships travelling together as a military convoy. */
  convoyId?: string;
  /**
   * Persisted world position as an offset from the system's star centre
   * (`null` until first placed). Owned solely by the simulation/placement layer
   * and mutated only via {@link setWorldPosition} — so a system's ships keep
   * their spots across scene transitions and save/load (no per-entry re-scatter).
   */
  worldX: number | null;
  worldY: number | null;
  /**
   * True when this NPC is openly hostile to the player: garrison/pirate ships
   * spawn hostile, and any neutral ship the player attacks (plus its same-faction
   * neighbours in-system) is flagged hostile. Drives the threat indicator and
   * {@link isAggressive}.
   */
  hostile: boolean;
  /**
   * Overmind hull size tier (small/medium/large/boss) — scales spawn stats and
   * selects per-tier ship art. Unset on non-Overmind ships and on old saves
   * (readers default to the medium tier).
   */
  sizeTier?: NpcSizeTier;

  constructor(init: NpcShipInit) {
    this.id = init.id;
    this.name = init.name;
    this.race = init.race;
    this.faction = init.faction;
    this.role = init.role;
    this.hullHP = init.hullHP;
    this.maxHull = init.maxHull;
    this.shields = init.shields;
    this.speed = init.speed;
    this.damage = init.damage;
    this.currentSystemId = init.currentSystemId;
    this.state = init.state;
    this.goal = init.goal;
    this.destinationSystemId = init.destinationSystemId;
    this.daysToArrival = init.daysToArrival;
    this.credits = init.credits;
    this.reputation = init.reputation;
    this.shieldPower = init.shieldPower ?? 0;
    this.loadoutSummary = init.loadoutSummary ?? [];
    this.cargo = init.cargo ?? [];
    this.activeQuestTarget = init.activeQuestTarget ?? null;
    this.convoyId = init.convoyId;
    this.worldX = init.worldX ?? null;
    this.worldY = init.worldY ?? null;
    this.hostile = init.hostile ?? false;
    this.sizeTier = init.sizeTier;
  }

  /**
   * Set the persisted world position (offset from the system star centre). The
   * only mutator of {@link worldX}/{@link worldY}: the simulation/placement layer
   * calls this, so position change is tracked, never an incidental side-effect.
   */
  setWorldPosition(x: number, y: number): void {
    this.worldX = x;
    this.worldY = y;
  }

  /** Whether this NPC has a persisted world position yet. */
  hasWorldPosition(): boolean {
    // `!= null` (not `!== null`) so an absent field (`undefined`) reads as
    // "unplaced", matching the migration's own `=== undefined`/`=== null`
    // backfill check. A loaded ship can carry `undefined` here — SaveManager
    // returns the raw parsed object (the schema's `.default(null)` applies only
    // to the discarded validated copy) and rehydration re-attaches the prototype
    // without running the constructor's `?? null`. Treating `undefined` as
    // "placed" would spawn the sprite at `cx + undefined` = NaN and then the
    // tracked-orbit tick would persist NaN forever.
    return this.worldX != null && this.worldY != null;
  }

  /** Flag this NPC as openly hostile to the player (turns it aggressive). */
  markHostile(): void {
    this.hostile = true;
  }

  /** Whether this NPC will actively attack the player on sight. */
  isAggressive(): boolean {
    return this.hostile === true;
  }
}
