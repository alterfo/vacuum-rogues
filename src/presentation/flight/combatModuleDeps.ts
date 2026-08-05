import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { GameMode } from "@/types";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { CombatModuleDeps } from "./CombatModule";
import type { CombatExecutionController } from "./combatExecution";

export interface CombatModuleDepsHost {
  getShipPhysics(): ShipPhysics | null;
  isPlanning(): boolean;
  isExecutingPlan(): boolean;
  getPlannedTarget(weapon: WeaponSpec): NpcShipSprite | null;
  getExecution(): CombatExecutionController | null;
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
  getNpcManager(): {
    handleInFlightDeath(sprite: NpcShipSprite): void;
    handlePlayerDeath(): void;
  };
  questCompletion: { bountyByNpcKill(npcId: string): void };
  hud: { showMessage(text: string, color?: number): void };
  endTurn(): void;
}

export function buildCombatModuleDeps(
  host: CombatModuleDepsHost,
): CombatModuleDeps {
  return {
    getShipPhysics: () => host.getShipPhysics(),
    isPaused: () =>
      host.isPlanning() ||
      host.isCombatPauseActive() ||
      (!host.isTurnRunning() && !host.isExecutingPlan()),
    isPlannedTargetingActive: () => host.isExecutingPlan(),
    getPlannedWeaponTarget: (w) => host.getPlannedTarget(w),
    interceptPlannedShot: (t, w) =>
      host.getExecution()?.interceptPlannedShot(t, w) ?? false,
    onPlayerShotVfx: (fx, fy, t, w) =>
      host.getExecution()?.onPlayerShotVfx(fx, fy, t, w) ?? false,
    isNpcFireSuppressed: (npc) =>
      host.getExecution()?.isNpcJammed(npc) ?? false,
    onNpcShieldHit: (t) => host.getExecution()?.spawnNpcShieldFlash(t),
    getPlayerLoadout: () => host.gameEngine?.playerLoadout ?? null,
    getUiLayer: () => host.renderer.uiLayer,
    getGameLayer: () => host.renderer.gameLayer,
    getScreenSize: () => host.renderer.app.screen,
    getPlayerShip: () => host.gameEngine?.player?.ship ?? null,
    getGameMode: () => host.gameEngine?.player?.gameMode ?? "NORMAL",
    isHostileSystem: () => {
      const sysId = host.gameEngine?.player?.currentSystemId;
      return !!(sysId && host.gameEngine?.galaxy?.isHostileSystem(sysId));
    },
    getCampaignPeakPower: () => host.gameEngine?.campaignPeakPower ?? 0,
    onNpcDestroyed: (s) => {
      const npcId = s.npc.id; // capture before the death path deletes the NPC, then complete its BOUNTY
      host.getExecution()?.onNpcKilled(s);
      host.getNpcManager().handleInFlightDeath(s);
      host.questCompletion.bountyByNpcKill(npcId);
    },
    onPlayerDestroyed: () => host.getNpcManager().handlePlayerDeath(),
    onCombatEnded: () => {
      host.endCombatPlanning();
      if (!host.isDestroyed()) host.endTurn(); // combat over → end the turn (skip teardown)
    },
    showMessage: (t, c) => host.hud.showMessage(t, c),
  };
}
