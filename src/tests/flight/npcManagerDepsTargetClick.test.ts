import { describe, it, expect, vi } from "vitest";
import {
  buildNpcManagerDeps,
  type NpcManagerDepsHost,
} from "@/presentation/flight/npcManagerDeps";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

function makeHost(over: Partial<NpcManagerDepsHost> = {}) {
  const calls = {
    addCombatant: vi.fn(),
    selectCombatTarget: vi.fn(),
    handlePlanningTargetClick: vi.fn(() => false),
  };
  const host: NpcManagerDepsHost = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 0, y: 0 }),
    getStarAvoidRadius: () => 0,
    isTurnRunning: () => true,
    setTurnRunning: () => {},
    isCombatPauseActive: () => false,
    isPlanning: () => false,
    updateInteractiveCursors: () => {},
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    setPursuitReplot: () => {},
    clearRouteTargetPlanet: () => {},
    endTurn: () => {},
    addCombatant: calls.addCombatant,
    beginCombatPlanning: () => {},
    isCombatActive: () => true,
    selectCombatTarget: calls.selectCombatTarget,
    handlePlanningTargetClick: calls.handlePlanningTargetClick,
    deferDeathLoot: () => false,
    getSelectedCombatTargetId: () => null,
    isCombatant: () => false,
    ...over,
  };
  return { deps: buildNpcManagerDeps(host), calls };
}

function sprite(hostile: boolean, aggressive = false): NpcShipSprite {
  return { npc: { hostile }, aggressive } as unknown as NpcShipSprite;
}

describe("clicking a hostile non-combatant during an active fight pulls it into the fight", () => {
  it("hostile non-combatant → addCombatant, then normal target selection", () => {
    const { deps, calls } = makeHost();
    deps.selectCombatTarget?.(sprite(true));
    expect(calls.addCombatant).toHaveBeenCalledTimes(1);
    expect(calls.selectCombatTarget).toHaveBeenCalledTimes(1);
  });

  it("aggressive-but-not-yet-flagged non-combatant is pulled in too", () => {
    const { deps, calls } = makeHost();
    deps.selectCombatTarget?.(sprite(false, true));
    expect(calls.addCombatant).toHaveBeenCalledTimes(1);
  });

  it("a peaceful ship is never dragged into the fight by a click", () => {
    const { deps, calls } = makeHost();
    deps.selectCombatTarget?.(sprite(false));
    expect(calls.addCombatant).not.toHaveBeenCalled();
    expect(calls.selectCombatTarget).toHaveBeenCalledTimes(1);
  });

  it("outside an active fight the click never adds combatants", () => {
    const { deps, calls } = makeHost({ isCombatActive: () => false });
    deps.selectCombatTarget?.(sprite(true));
    expect(calls.addCombatant).not.toHaveBeenCalled();
  });

  it("an already-registered combatant is not re-added", () => {
    const { deps, calls } = makeHost({ isCombatant: () => true });
    deps.selectCombatTarget?.(sprite(true));
    expect(calls.addCombatant).not.toHaveBeenCalled();
    expect(calls.selectCombatTarget).toHaveBeenCalledTimes(1);
  });

  it("a planning-phase click still routes through the weapon-assignment path first", () => {
    const { deps, calls } = makeHost({
      isPlanning: () => true,
      handlePlanningTargetClick: vi.fn(() => true),
    });
    deps.selectCombatTarget?.(sprite(true));
    expect(calls.addCombatant).toHaveBeenCalledTimes(1);
    expect(calls.selectCombatTarget).not.toHaveBeenCalled();
  });
});
