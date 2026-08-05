import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import { RealEngineHarness } from "./realEngineHarness";
import { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { NpcShipManagerDeps } from "@/presentation/flight/NpcShipManager";
import { CombatModule } from "@/presentation/flight/CombatModule";
import { ShipPhysics } from "@/systems/ShipPhysics";
import type { Encounter, EncounterType } from "@/systems/encounters/encounterGenerator"; // prettier-ignore
import { rollEncounter } from "@/systems/encounters/encounterGenerator";
import {
  encounterSystemView,
  encounterPlayerStateFor,
} from "@/systems/encounters/encounterFlight";
import { ENCOUNTER_CONFIG } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

function makeEncounter(
  type: EncounterType,
  systemId: string,
  danger: number,
): Encounter {
  return {
    id: `enc:${systemId}:${type}`,
    type,
    systemId,
    danger,
    rewardScale: 1,
  };
}

describe("Exploration encounters over the real engine (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  function buildManager(): { mgr: NpcShipManager; combat: CombatModule } {
    const engine = harness.engine;
    const physics = new ShipPhysics(0, 0, 0.1);
    const combat = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => engine.playerLoadout,
      getPlayerShip: () => harness.player()!.ship,
      getGameMode: () => harness.player()!.gameMode,
      isPaused: () => false,
      onPlayerUnderAttack: () => {},
      onNpcDestroyed: () => {},
      showMessage: () => {},
    });
    const gameLayer = new Container();
    const uiLayer = new Container();
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 0, y: 0 }),
      isTurnRunning: () => false,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      startInFlightCombat: (s) => combat.addCombatant(s),
      isInCombat: () => combat.isActive,
      selectCombatTarget: (s) => combat.selectTarget(s),
      isCombatant: (s) => combat.combatants.has(s),
      isPaused: () => false,
    };
    const mgr = new NpcShipManager(
      engine.renderer!,
      engine,
      gameLayer,
      uiLayer,
      deps,
    );
    return { mgr, combat };
  }

  it("a salvage choice pays out through the real banking + cargo seams", () => {
    const { mgr } = buildManager();
    const player = harness.player()!;
    const before = player.credits;
    const enc = makeEncounter("derelict", player.currentSystemId, 0);

    const outcome = mgr.applyEncounterChoice(enc, "engage", () => 0.99);

    expect(outcome.kind).toBe("salvage");
    expect(player.credits).toBe(before + (outcome.credits ?? 0));
    expect(outcome.credits).toBeGreaterThan(0);
    const looted = outcome.cargo![0];
    const stack = player.inventory.resources.find(
      (r) => r.type === looted.type,
    );
    expect(stack?.amount).toBeGreaterThanOrEqual(looted.amount);
    expect(harness.errors()).toEqual([]);
  });

  it("a rescue choice grants reputation through the real seam", () => {
    const { mgr } = buildManager();
    const player = harness.player()!;
    const enc = makeEncounter("distress", player.currentSystemId, 0);

    const outcome = mgr.applyEncounterChoice(enc, "engage", () => 0.99);

    expect(outcome.kind).toBe("rescue");
    expect(outcome.reputationDelta).toBeGreaterThan(0);
    const repMoved = Object.values(player.reputation).some((v) => v > 0);
    expect(repMoved).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("an ambush choice spills into a real in-flight fight", () => {
    const { mgr, combat } = buildManager();
    const player = harness.player()!;
    const before = player.credits;
    const enc = makeEncounter("distress", player.currentSystemId, 1);

    expect(combat.isActive).toBe(false);
    const outcome = mgr.applyEncounterChoice(enc, "engage", () => 0);

    expect(outcome.kind).toBe("ambush");
    expect(outcome.startCombat).toBe(true);
    expect(mgr.inCombat).toBe(true); // routed through the real CombatModule
    expect(combat.isActive).toBe(true);
    expect(mgr.npcCount).toBeGreaterThan(0); // a hostile was spawned
    expect(player.credits).toBe(before); // an ambush has no payout
    combat.destroy();
    expect(harness.errors()).toEqual([]);
  });

  it("ignoring an encounter applies no payoff and starts no fight", () => {
    const { mgr, combat } = buildManager();
    const player = harness.player()!;
    const before = player.credits;
    const enc = makeEncounter("derelict", player.currentSystemId, 1);

    const outcome = mgr.applyEncounterChoice(enc, "ignore");

    expect(outcome.kind).toBe("ignored");
    expect(player.credits).toBe(before);
    expect(combat.isActive).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("does not re-offer the same entry encounter on a same-day re-entry", () => {
    const engine = harness.engine;
    const player = harness.player()!;
    const galaxy = engine.galaxy!;
    const systemId = player.currentSystemId;

    let firingDay = -1;
    for (let day = 0; day < 500; day++) {
      const enc = rollEncounter(
        encounterSystemView(galaxy, systemId),
        `${systemId}:${day}`,
        encounterPlayerStateFor(player),
        ENCOUNTER_CONFIG,
      );
      if (enc) {
        firingDay = day;
        break;
      }
    }
    expect(firingDay).toBeGreaterThanOrEqual(0);
    galaxy.gameDays = firingDay;

    const { mgr } = buildManager();
    mgr.initialize();
    expect(mgr.isEncounterPromptOpen).toBe(true); // fires on first entry

    mgr.closeEncounterPrompt();
    expect(mgr.isEncounterPromptOpen).toBe(false);

    mgr.initialize();
    expect(mgr.isEncounterPromptOpen).toBe(false); // deduped this session

    expect(harness.errors()).toEqual([]);
  });

  it("presents a dismissible choice prompt", () => {
    const { mgr } = buildManager();
    const enc = makeEncounter("anomaly", harness.player()!.currentSystemId, 0);

    mgr.showEncounterPrompt(enc);
    expect(mgr.isEncounterPromptOpen).toBe(true);
    expect(mgr.hasOpenModal()).toBe(true);

    mgr.closeEncounterPrompt();
    expect(mgr.isEncounterPromptOpen).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
