import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { GAME_BALANCE } from "@/config/balance";
import { FactionType, SceneType } from "@/types";
import { nextCycleGameMode } from "@/systems/overmind/newGamePlus";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

describe("Overmind endgame outcome routing + New Game+", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("routes the arc `won` status to the victory screen, once", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_WON",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const core = galaxy.overmindCoreSystemId;

    expect(core).not.toBe("");
    expect(galaxy.isOvermindSystem(core)).toBe(true);

    galaxy.gameDays = 6; // next advanceGalaxyDay → day 7 (7 % 5 !== 0)
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 6,
      status: "advancing",
      threat: 0.2,
      peakThreat: 0.2,
    };

    for (const id of [...galaxy.overmindSystems]) {
      galaxy.tryLiberate(id, "player");
    }
    expect(galaxy.overmindSystems).toHaveLength(0);
    const spy = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    harness.engine.advanceGalaxyDay();

    expect(galaxy.overmindArc.status).toBe("won");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true);

    galaxy.gameDays = 7; // next → 8 (8 % 5 !== 0)
    harness.engine.advanceGalaxyDay();
    expect(spy).toHaveBeenCalledTimes(1);

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("routes the arc `lost` status to the defeat screen", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_LOST",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;

    for (const sys of galaxy.systems) {
      galaxy.addOvermindSystem(sys.id);
    }
    const share = galaxy.overmindSystems.length / galaxy.systems.length;
    expect(share).toBeGreaterThanOrEqual(
      GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
    );

    galaxy.gameDays = 96;
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 96,
      status: "advancing",
      threat: share,
      peakThreat: share,
    };

    const spy = vi.spyOn(harness.engine, "showGameOutcomeScreen");
    harness.engine.advanceGalaxyDay();

    expect(galaxy.overmindArc.status).toBe("lost");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(false);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("startNewGamePlus seeds a fresh, tougher cycle from the won carry-over", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_NGPLUS",
      systemCount: 24,
    });
    await harness.newGame(FactionType.OUTLANDERS, "NORMAL");
    const won = harness.player()!;

    won.rank = 3;
    const wonCredits = won.credits;
    const wonFaction = won.faction;
    const wonGalaxyId = harness.galaxy()!.id;

    await harness.engine.startNewGamePlus();

    const fresh = harness.player()!;
    expect(fresh).not.toBe(won);

    const expectedCredits = Math.min(
      Math.floor(wonCredits * GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_FRACTION),
      GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_CAP,
    );
    expect(fresh.credits).toBe(expectedCredits);

    expect(fresh.rank).toBe(3);
    expect(fresh.faction).toBe(wonFaction);
    expect(fresh.gameMode).toBe(nextCycleGameMode("NORMAL")); // → HARD

    expect(harness.galaxy()!.id).not.toBe(wonGalaxyId);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("a plain new game does not inherit a staged-but-unconsumed NG+ carry", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_NGPLUS_LEAK",
      systemCount: 24,
    });
    await harness.newGame();

    const engineAny = harness.engine as unknown as {
      pendingNewGamePlus: unknown;
      generateDefaultGameState: () => Promise<void>;
    };
    engineAny.pendingNewGamePlus = {
      credits: 50000,
      rank: 5,
      factionType: FactionType.OUTLANDERS,
      gameMode: "HARD",
    };

    await engineAny.generateDefaultGameState();
    await harness.engine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: harness.engine,
      selectedFaction: FactionType.BASTIONS,
      selectedGameMode: "NORMAL",
    });

    const fresh = harness.player()!;
    expect(fresh.credits).toBe(1000);
    expect(fresh.rank ?? 0).toBe(0);
    expect(fresh.faction).toBe(FactionType.BASTIONS);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
