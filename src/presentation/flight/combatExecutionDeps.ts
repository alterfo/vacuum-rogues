/**
 * Build the {@link CombatExecutionHost} object `SpaceFlightScene` passes to
 * `createCombatExecution` (Task 14.5c). Extracted in the established
 * `combatModuleDeps`/`npcManagerDeps` pattern so the scene stays a thin
 * controller under its line-count guard: the scene supplies a compact host of
 * lazy closures over its own members; every projection/mapping lives here.
 */

import type { Container } from "pixi.js";
import { t } from "@/i18n/i18n";
import { payTribute, type BankAccess } from "@/systems/banking/economy";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShip } from "@/domain/NpcShip";
import type { Player } from "@/domain/Player";
import type { PlanetSprite } from "../PlanetSprite";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { CombatModule } from "./CombatModule";
import type { CombatExecutionHost } from "./combatExecution";

/** The `NpcShipManager` surface the execute-window mechanics read. */
export interface ExecutionNpcManager {
  getNpcSpritesView(): readonly NpcShipSprite[];
  spawnLootForNpc(
    npc: NpcShip,
    worldX: number,
    worldY: number,
    rng?: () => number,
    count?: number,
  ): void;
  rollDeathLootCount(npc: NpcShip): number;
}

/** The scene members `buildCombatExecutionDeps` reads (lazy closures, see
 *  `combatModuleDeps.ts` on why never `this` directly). */
export interface CombatExecutionDepsHost {
  getShipPhysics(): ShipPhysics | null;
  getGameLayer(): Container;
  getPlanetSprites(): PlanetSprite[];
  /** The player ship's world container (banking roll target; null headless). */
  getPlayerVisual(): { scale: { x: number; y: number } } | null;
  /** Narrow engine view: the live player + the bank bus (bribe tribute). */
  getEngine(): { player?: Player | null; bank?: BankAccess } | null;
  getCombatModule(): CombatModule;
  getNpcManager(): ExecutionNpcManager;
  isExecutingPlan(): boolean;
  showMessage(text: string, color?: number): void;
}

/** Build the live `CombatExecutionHost` from the scene's own state. */
export function buildCombatExecutionDeps(
  host: CombatExecutionDepsHost,
): CombatExecutionHost {
  return {
    getShipPhysics: () => host.getShipPhysics(),
    getGameLayer: () => host.getGameLayer(),
    // Live planet discs: position + rendered radius, the gravity mass-proxy
    // (Task 4 — reuses `displayRadius`, no new domain fields).
    getPlanets: () =>
      host.getPlanetSprites().map((p) => ({
        x: p.screenX,
        y: p.screenY,
        radius: p.displayRadius,
      })),
    getPlayerShip: () => host.getEngine()?.player?.ship ?? null,
    getPlayerVisual: () => host.getPlayerVisual(),
    getPlayerInventory: () => host.getEngine()?.player?.inventory ?? null,
    getPlayerCredits: () => host.getEngine()?.player?.credits ?? 0,
    // Bribe reuses the exact shakedown economy path (Task 10) — tribute moves
    // through the bank bus, never a direct credits mutation.
    payBribe: (amount, npc) => {
      const engine = host.getEngine();
      const player = engine?.player;
      if (!player) return;
      payTribute(
        engine?.bank ?? null,
        player,
        npc,
        amount,
        t("flight.tributeReason", { name: npc.name }),
      );
    },
    combatants: () => [...host.getCombatModule().combatants],
    selectedTarget: () => host.getCombatModule().selectedTarget,
    isCombatActive: () => host.getCombatModule().isActive,
    isExecuting: () => host.isExecutingPlan(),
    landShot: (target, rawDamage, from) =>
      host.getCombatModule().landExternalShot(target, rawDamage, from),
    disengage: (sprite) => host.getCombatModule().disengage(sprite),
    npcSprites: () => host.getNpcManager().getNpcSpritesView(),
    spawnLoot: (npc, x, y, count) =>
      host.getNpcManager().spawnLootForNpc(npc, x, y, undefined, count),
    rollLootCount: (npc) => host.getNpcManager().rollDeathLootCount(npc),
    // Every confirmed window re-arms the round latch (review 2026-07-15) —
    // without it `roundComplete` silences ALL fire for the rest of the fight.
    beginRound: () => host.getCombatModule().beginCombatRound(),
    showMessage: (text, color) => host.showMessage(text, color),
  };
}
