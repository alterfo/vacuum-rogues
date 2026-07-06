import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { GAME_BALANCE } from "@/config/balance";
import { FactionType, SceneType } from "@/types";
import { nextCycleGameMode } from "@/systems/overmind/newGamePlus";

/**
 * Real-engine playtest for the Overmind endgame outcome routing + New Game+
 * (Task 4 of `20260625-overmind-endgame-living-galaxy`). Boots the genuine
 * `GameEngine` and only stubs PixiJS, so it exercises the *wiring*: the EOD
 * batch reading `galaxy.overmindArc.status` and routing `won` →
 * `showGameOutcomeScreen(true)` / `lost` → `showGameOutcomeScreen(false)`, the
 * overlay's idempotency, and `startNewGamePlus` seeding a fresh, tougher cycle
 * from the won captain's carry-over.
 *
 * Determinism note: like `overmindArc.test.ts`, scenarios sit on a day whose
 * next EOD skips the 5-day equilibrium churn (`gameDays % 5 !== 0`), so only the
 * deterministic arc drives the front — no flaky reliance on the random tick.
 */
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

    // Sanity: the core is an Overmind-held system to begin with.
    expect(core).not.toBe("");
    expect(galaxy.isOvermindSystem(core)).toBe(true);

    // A started arc (real peak) sitting on a day whose next EOD skips the churn.
    galaxy.gameDays = 6; // next advanceGalaxyDay → day 7 (7 % 5 !== 0)
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 6,
      status: "advancing",
      threat: 0.2,
      peakThreat: 0.2,
    };

    // When the player breaks the core (removes it from Overmind control).
    galaxy.tryLiberate(core);
    const spy = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    harness.engine.advanceGalaxyDay();

    // Then the arc reads `won` and the victory screen was shown exactly once.
    expect(galaxy.overmindArc.status).toBe("won");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true);

    // And a second EOD (the sticky `won` status re-runs) does NOT re-show it —
    // the overlay is idempotent.
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
    const playerSys = harness.player()!.currentSystemId;

    // Drive the Overmind to a clear majority (≥ loss share), avoiding the
    // player's own system so nothing odd happens at their location.
    const target =
      Math.ceil(
        galaxy.systems.length * GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
      ) + 2;
    for (const sys of galaxy.systems) {
      if (galaxy.overmindSystems.length >= target) break;
      if (sys.id === playerSys) continue;
      galaxy.addOvermindSystem(sys.id);
    }
    const share = galaxy.overmindSystems.length / galaxy.systems.length;
    expect(share).toBeGreaterThanOrEqual(
      GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
    );

    // A started arc past the ADAPTIVE grace (dayZero 1 + 90 ≤ 97), sitting on
    // a day whose next EOD skips the churn (97 % 5 !== 0) and whose spread
    // cadence blocks a same-window capture (lastSpreadDay = 96).
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

    // Give the won captain some standing to carry forward.
    won.rank = 3;
    const wonCredits = won.credits;
    const wonFaction = won.faction;
    const wonGalaxyId = harness.galaxy()!.id;

    await harness.engine.startNewGamePlus();

    const fresh = harness.player()!;
    // A genuinely new captain (the prior won instance was reset).
    expect(fresh).not.toBe(won);

    // Credits: a capped half-slice of the won pile.
    const expectedCredits = Math.min(
      Math.floor(wonCredits * GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_FRACTION),
      GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_CAP,
    );
    expect(fresh.credits).toBe(expectedCredits);

    // Rank + faction carry verbatim; difficulty escalates a notch.
    expect(fresh.rank).toBe(3);
    expect(fresh.faction).toBe(wonFaction);
    expect(fresh.gameMode).toBe(nextCycleGameMode("NORMAL")); // → HARD

    // A fresh galaxy was generated and we landed in flight.
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

    // Simulate a New Game+ carry that startNewGamePlus staged but the
    // SPACE_FLIGHT transition never consumed (e.g. it threw before the
    // new-game branch nulled `pendingNewGamePlus`). The carry has enriched
    // credits + a veteran rank that must NOT leak into a subsequent plain game.
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

    // A plain «Новая игра»: reset game state, then build a fresh player.
    await engineAny.generateDefaultGameState();
    await harness.engine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: harness.engine,
      selectedFaction: FactionType.BASTIONS,
      selectedGameMode: "NORMAL",
    });

    const fresh = harness.player()!;
    // Defaults, not the leaked carry (credits 1000 / rank 0); the chosen
    // faction wins over the stale carry's OUTLANDERS.
    expect(fresh.credits).toBe(1000);
    expect(fresh.rank ?? 0).toBe(0);
    expect(fresh.faction).toBe(FactionType.BASTIONS);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
