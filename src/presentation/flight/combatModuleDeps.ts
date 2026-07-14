/**
 * Build the {@link CombatModuleDeps} object `SpaceFlightScene` passes to `CombatModule`.
 * Extracted verbatim from the scene's `initialize()` (same class of extraction as
 * `routePlot.ts`/`plotPlannedRoute` — Task 3) to keep the scene under its line-count
 * guard while the pause-and-plan wiring (Task 14.5a) adds a few more lines.
 *
 * `host` is a narrow structural view of the scene's own members (passed as `this`
 * from `SpaceFlightScene.initialize()`) so this stays unit-testable without a real
 * scene, mirroring every other `flight/*Deps` extraction in this codebase.
 */

import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { GameMode } from "@/types";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { CombatModuleDeps } from "./CombatModule";

/**
 * The scene members `buildCombatModuleDeps` reads. Built as an explicit object
 * literal of arrow-closures at the call site (`initialize()`), NOT by passing
 * `this` directly — `shipPhysics`/`isTurnRunning`/`destroyed` are private fields
 * on `SpaceFlightScene` that TypeScript's structural check rejects when a class
 * instance is assigned to an interface exposing same-named public members, so
 * every changing field is read through a method here instead of a property.
 */
export interface CombatModuleDepsHost {
  getShipPhysics(): ShipPhysics | null;
  isPlanning(): boolean;
  endCombatPlanning(): boolean;
  isCombatPauseActive(): boolean;
  isTurnRunning(): boolean;
  isDestroyed(): boolean;
  renderer: {
    uiLayer: Container;
    gameLayer: Container;
    app: { screen: { width: number; height: number } };
  };
  gameEngine: {
    playerLoadout?: ShipLoadout | null;
    player?: {
      ship?: { hullHP: number; maxHull: number } | null;
      gameMode?: GameMode;
      currentSystemId?: string;
    } | null;
    galaxy?: { isHostileSystem(id: string): boolean } | null;
    campaignPeakPower?: number | null;
  } | null;
  npcManager: {
    handleInFlightDeath(sprite: NpcShipSprite): void;
    handlePlayerDeath(): void;
  };
  questCompletion: { bountyByNpcKill(npcId: string): void };
  hud: { showMessage(text: string, color?: number): void };
  endTurn(): void;
}

/** Build the live `CombatModuleDeps` object from the scene's own state. */
export function buildCombatModuleDeps(
  host: CombatModuleDepsHost,
): CombatModuleDeps {
  return {
    getShipPhysics: () => host.getShipPhysics(),
    isPaused: () =>
      host.isPlanning() || host.isCombatPauseActive() || !host.isTurnRunning(),
    getPlayerLoadout: () => host.gameEngine?.playerLoadout ?? null,
    getUiLayer: () => host.renderer.uiLayer,
    getGameLayer: () => host.renderer.gameLayer,
    getScreenSize: () => host.renderer.app.screen,
    getPlayerShip: () => host.gameEngine?.player?.ship ?? null,
    getGameMode: () => host.gameEngine?.player?.gameMode ?? "NORMAL",
    // Adaptive garrison scaling (Task 4): fights in a hostile-held system
    // scale with the run's ratcheted peak power.
    isHostileSystem: () => {
      const sysId = host.gameEngine?.player?.currentSystemId;
      return !!(sysId && host.gameEngine?.galaxy?.isHostileSystem(sysId));
    },
    getCampaignPeakPower: () => host.gameEngine?.campaignPeakPower ?? 0,
    onNpcDestroyed: (s) => {
      const npcId = s.npc.id; // capture before the death path deletes the NPC, then complete its BOUNTY
      host.npcManager.handleInFlightDeath(s);
      host.questCompletion.bountyByNpcKill(npcId);
    },
    onPlayerDestroyed: () => host.npcManager.handlePlayerDeath(),
    // The reactive single-shot active-pause (onPlayerUnderAttack/onTargetLost/
    // onRoundComplete → combatPause) is SUPERSEDED by the pause-and-plan loop
    // (Task 14.5a) — combatPlanning.beginCombat() already freezes the fight the
    // instant it opens, so a mid-window hit no longer needs its own reactive
    // freeze-and-reopen. Not deleted from combatPause.ts itself yet (Task 15
    // owns removing the now-dead module once nothing else references it).
    onCombatEnded: () => {
      host.endCombatPlanning();
      if (!host.isDestroyed()) host.endTurn(); // combat over → end the turn (skip teardown)
    },
    showMessage: (t, c) => host.hud.showMessage(t, c),
  };
}
