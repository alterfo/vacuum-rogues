import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { FlightSessionState } from "@/systems/FlightSessionState";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { PlanetSprite } from "../PlanetSprite";
import type { NpcShipManagerDeps } from "./NpcShipManager";

export interface NpcManagerDepsHost {
  getShipPhysics(): ShipPhysics | null;
  getPlanetSprites(): PlanetSprite[];
  getStarCenter(): { x: number; y: number };
  getStarAvoidRadius(): number;
  isTurnRunning(): boolean;
  setTurnRunning(v: boolean): void;
  isCombatPauseActive(): boolean;
  isPlanning(): boolean;
  updateInteractiveCursors(turnRunning: boolean): void;
  showMessage(text: string, color?: number): void;
  showTooltip(text: string, screenX: number, screenY: number): void;
  hideTooltip(): void;
  executeRouteTo(x: number, y: number): void;
  setPursuitReplot(v: boolean): void;
  clearRouteTargetPlanet(): void;
  endTurn(): void;
  addCombatant(sprite: NpcShipSprite): void;
  beginCombatPlanning(): void;
  isCombatActive(): boolean;
  selectCombatTarget(sprite: NpcShipSprite): void;
  handlePlanningTargetClick(sprite: NpcShipSprite): boolean;
  deferDeathLoot(npc: NpcShip): boolean;
  getSelectedCombatTargetId(): string | null;
  isCombatant(sprite: NpcShipSprite): boolean;
  sessionState?: FlightSessionState;
}

export function buildNpcManagerDeps(
  host: NpcManagerDepsHost,
): NpcShipManagerDeps {
  return {
    getShipPhysics: () => host.getShipPhysics(),
    getPlanetSprites: () => host.getPlanetSprites(),
    getStarCenter: () => host.getStarCenter(),
    isTurnRunning: () => host.isTurnRunning() && !host.isCombatPauseActive(),
    showMessage: (text, color) => host.showMessage(text, color),
    showTooltip: (text, sx, sy) => host.showTooltip(text, sx, sy),
    hideTooltip: () => host.hideTooltip(),
    executeRouteTo: (x, y) => {
      host.setPursuitReplot(true);
      host.executeRouteTo(x, y);
      host.setPursuitReplot(false);
    },
    clearRouteTarget: () => host.clearRouteTargetPlanet(),
    endTurn: () => host.endTurn(),
    startInFlightCombat: (sprite) => {
      host.addCombatant(sprite);
      if (host.isCombatActive()) host.beginCombatPlanning(); // no-op if already underway (14.5a)
    },
    deferDeathLoot: (npc) => host.deferDeathLoot(npc),
    onPlayerEngagesCombat: () => {
      if (!host.isTurnRunning()) {
        host.setTurnRunning(true);
        host.updateInteractiveCursors(true);
      }
    },
    isInCombat: () => host.isCombatActive(),
    selectCombatTarget: (sprite) => {
      if (
        host.isCombatActive() &&
        !host.isCombatant(sprite) &&
        (sprite.npc.hostile || sprite.aggressive)
      ) {
        host.addCombatant(sprite);
      }
      if (host.handlePlanningTargetClick(sprite)) return;
      host.selectCombatTarget(sprite);
    },
    getCombatTargetId: () => host.getSelectedCombatTargetId(),
    isCombatant: (sprite) => host.isCombatant(sprite),
    isPaused: () => host.isCombatPauseActive() || host.isPlanning(),
    getStarAvoidRadius: () => host.getStarAvoidRadius(),
    sessionState: host.sessionState,
  };
}
