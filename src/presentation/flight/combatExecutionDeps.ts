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
  isPursuitSuspended(): boolean;
}

export interface CombatExecutionDepsHost {
  getShipPhysics(): ShipPhysics | null;
  getGameLayer(): Container;
  getPlanetSprites(): PlanetSprite[];
  getPlayerVisual(): { scale: { x: number; y: number } } | null;
  getEngine(): { player?: Player | null; bank?: BankAccess } | null;
  getCombatModule(): CombatModule;
  getNpcManager(): ExecutionNpcManager;
  isExecutingPlan(): boolean;
  showMessage(text: string, color?: number): void;
}

export function buildCombatExecutionDeps(
  host: CombatExecutionDepsHost,
): CombatExecutionHost {
  return {
    getShipPhysics: () => host.getShipPhysics(),
    getGameLayer: () => host.getGameLayer(),
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
    beginRound: () => host.getCombatModule().beginCombatRound(),
    isPursuitSuspended: () => host.getNpcManager().isPursuitSuspended(),
    showMessage: (text, color) => host.showMessage(text, color),
  };
}
