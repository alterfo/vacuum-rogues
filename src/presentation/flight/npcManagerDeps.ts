/**
 * Build the {@link NpcShipManagerDeps} object `SpaceFlightScene` passes to
 * `NpcShipManager`. Extracted verbatim from the scene's `initialize()` (same
 * class of extraction as `combatModuleDeps.ts` / `routePlot.ts`) to keep the
 * scene under its line-count guard while the planning-phase UI wiring
 * (Task 14.5b) adds the weapon-assignment click route.
 *
 * `host` is an explicit object literal of arrow-closures built at the call site
 * (never `this` directly — see `combatModuleDeps.ts` on why TS rejects that),
 * so this stays unit-testable without a real scene.
 */

import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { FlightSessionState } from "@/systems/FlightSessionState";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { PlanetSprite } from "../PlanetSprite";
import type { NpcShipManagerDeps } from "./NpcShipManager";

/** The scene members `buildNpcManagerDeps` reads. */
export interface NpcManagerDepsHost {
  getShipPhysics(): ShipPhysics | null;
  getPlanetSprites(): PlanetSprite[];
  getStarCenter(): { x: number; y: number };
  getStarAvoidRadius(): number;
  isTurnRunning(): boolean;
  setTurnRunning(v: boolean): void;
  isCombatPauseActive(): boolean;
  /** PLANNING freeze (Task 1b): NPC movement must halt while the player plans. */
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
  /** Planning-phase weapon-assign click (14.5b): true = click consumed. */
  handlePlanningTargetClick(sprite: NpcShipSprite): boolean;
  /** Wreck-drift loot takeover for a combat kill (14.5c): true = defer. */
  deferDeathLoot(npc: NpcShip): boolean;
  getSelectedCombatTargetId(): string | null;
  isCombatant(sprite: NpcShipSprite): boolean;
  sessionState?: FlightSessionState;
}

/** Build the live `NpcShipManagerDeps` object from the scene's own state. */
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
      // Open planning only for a REAL engagement: addCombatant refuses a
      // downed (GOD-mode floor) or weaponless ship, and opening the planning
      // freeze over a refused fight would soft-lock the sim — no combat module
      // ever becomes active to end it (review 2026-07-15).
      if (host.isCombatActive()) host.beginCombatPlanning(); // no-op if already underway (14.5a)
    },
    deferDeathLoot: (npc) => host.deferDeathLoot(npc),
    onPlayerEngagesCombat: () => {
      // beginCombat() above already froze the sim — no deferred pause needed.
      if (!host.isTurnRunning()) {
        host.setTurnRunning(true);
        host.updateInteractiveCursors(true);
      }
    },
    isInCombat: () => host.isCombatActive(),
    // During PLANNING an enemy click is the weapon-assignment second click
    // (14.5b); when no gun is armed it falls through to the legacy re-target.
    selectCombatTarget: (sprite) => {
      if (host.handlePlanningTargetClick(sprite)) return;
      host.selectCombatTarget(sprite);
    },
    getCombatTargetId: () => host.getSelectedCombatTargetId(),
    isCombatant: (sprite) => host.isCombatant(sprite),
    // PLANNING freezes NPC movement too (Task 1b's whole-sim freeze) — the
    // legacy combatPause flag alone can never be true since 14.5a unwired it.
    isPaused: () => host.isCombatPauseActive() || host.isPlanning(),
    getStarAvoidRadius: () => host.getStarAvoidRadius(),
    sessionState: host.sessionState,
  };
}
