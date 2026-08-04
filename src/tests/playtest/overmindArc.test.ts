import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { Faction } from "@/types/faction";
import { computeGalaxyThreat } from "@/systems/galaxy/GalaxyStatusIndicator";
import { advanceOvermind } from "@/systems/overmind/overmindSpread";
import { adaptiveSpreadIntervalDays } from "@/systems/campaign/adaptivePacing";
import {
  GAME_BALANCE,
  ADAPTIVE_GRACE_DAYS,
  ADAPTIVE_CREEP_START_DAY,
} from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const SPREAD = {
  graceDays: ADAPTIVE_GRACE_DAYS,
  capturesPerTick: GAME_BALANCE.OVERMIND_SPREAD_CAPTURES_PER_TICK,
  lossShare: GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
  containedShare: GAME_BALANCE.OVERMIND_SPREAD_CONTAINED_SHARE,
  minSystemsForLoss: GAME_BALANCE.OVERMIND_SPREAD_MIN_SYSTEMS,
};

describe("Overmind endgame-arc spread (EOD drive, adaptive clock)", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("stays dormant through the grace window, then engages and captures", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_ADVANCE",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;

    expect(galaxy.overmindSystems.length).toBeGreaterThan(0);
    expect(galaxy.overmindArc.status).toBe("dormant");
    const beforeOvermind = new Set(galaxy.overmindSystems);
    const initialCount = beforeOvermind.size;

    harness.engine.advanceGalaxyDay(); // day 1 — the arc clock starts
    expect(galaxy.overmindArc.dayZero).toBe(1);
    expect(galaxy.overmindArc.status).toBe("dormant");
    expect(galaxy.overmindArc.lastSpreadDay).toBeLessThan(0); // no spread in grace
    expect(galaxy.overmindSystems.length).toBe(initialCount);

    galaxy.gameDays = SPREAD.graceDays; // next EOD → dayZero + graceDays
    harness.engine.advanceGalaxyDay();

    const spreadDay = SPREAD.graceDays + 1;
    expect(galaxy.gameDays).toBe(spreadDay);
    expect(galaxy.overmindArc.lastSpreadDay).toBe(spreadDay);
    expect(galaxy.overmindArc.status).toBe("advancing");
    expect(galaxy.overmindArc.peakThreat).toBeGreaterThan(0);
    expect(galaxy.overmindSystems.length).toBe(
      initialCount + SPREAD.capturesPerTick,
    );

    const captured = galaxy.overmindSystems.filter(
      (id) => !beforeOvermind.has(id),
    );
    expect(captured).toHaveLength(SPREAD.capturesPerTick);
    for (const id of captured) {
      expect(galaxy.isOvermindSystem(id)).toBe(true);
      expect(galaxy.isHostileSystem(id)).toBe(true);
    }

    const threat = computeGalaxyThreat(
      galaxy.overmindSystems,
      galaxy.pirateSystems,
      galaxy.systems.length,
    );
    expect(threat.overmindCount).toBe(galaxy.overmindSystems.length);
    expect(threat.overmindShare).toBeGreaterThan(initialCount / 24);

    const garrisoned = galaxy.npcShips.some(
      (n) =>
        n.faction === Faction.OVERMIND &&
        galaxy.isOvermindSystem(n.currentSystemId),
    );
    expect(garrisoned).toBe(true);

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("is idempotent per business date — a same-day re-derive captures nothing", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_IDEMPOTENT",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;

    harness.engine.advanceGalaxyDay();
    galaxy.gameDays = SPREAD.graceDays;
    harness.engine.advanceGalaxyDay();
    expect(galaxy.overmindArc.lastSpreadDay).toBe(galaxy.gameDays);
    const stateAfterDrive = { ...galaxy.overmindArc };
    const setAfterDrive = [...galaxy.overmindSystems];

    const rerun = advanceOvermind(
      galaxy.overmindArc,
      {
        id: galaxy.id,
        systems: galaxy.systems,
        overmindSystems: galaxy.overmindSystems,
        overmindCoreSystemId: galaxy.overmindCoreSystemId,
      },
      galaxy.gameDays,
      {
        graceDays: SPREAD.graceDays,
        spreadIntervalDays: adaptiveSpreadIntervalDays(
          galaxy.gameDays,
          galaxy.overmindArc.dayZero,
          harness.engine.campaignPeakPower ?? 0,
        ),
        capturesPerTick: SPREAD.capturesPerTick,
        lossShare: SPREAD.lossShare,
        containedShare: SPREAD.containedShare,
        minSystemsForLoss: SPREAD.minSystemsForLoss,
      },
    );
    expect(rerun.captured).toEqual([]);
    expect(rerun.state.status).toBe(stateAfterDrive.status);
    expect(rerun.state.lastSpreadDay).toBe(stateAfterDrive.lastSpreadDay);
    expect(rerun.state.peakThreat).toBe(stateAfterDrive.peakThreat);
    expect(galaxy.overmindSystems).toEqual(setAfterDrive);

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("contains the arc when the player retakes the front below the contained share", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_CONTAIN",
      systemCount: 40,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const core = galaxy.overmindCoreSystemId;

    galaxy.gameDays = SPREAD.graceDays + 5; // next EOD → 96 (96 % 5 !== 0)
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: SPREAD.graceDays + 5,
      status: "advancing",
      threat: 0.4,
      peakThreat: 0.4,
    };

    for (const id of [...galaxy.overmindSystems]) {
      if (id !== core) galaxy.tryLiberate(id);
    }
    const share = galaxy.overmindSystems.length / galaxy.systems.length;
    expect(share).toBeLessThanOrEqual(SPREAD.containedShare);
    expect(galaxy.overmindArc.peakThreat).toBeGreaterThan(
      SPREAD.containedShare,
    );

    harness.engine.advanceGalaxyDay();

    expect(galaxy.gameDays).toBe(SPREAD.graceDays + 6);
    expect(galaxy.overmindArc.status).toBe("contained");
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("an ignored Overmind keeps pressing — grows, never wins spuriously, and its NPC-immune core outlives the tug-of-war", async () => {
    harness = await RealEngineHarness.boot({
      seed: "ARC_IGNORE_LOSES",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const playerSys = harness.player()!.currentSystemId;

    let preGrown = 0;
    for (const sys of galaxy.systems) {
      if (preGrown >= 8) break;
      if (sys.id === playerSys || galaxy.isOvermindSystem(sys.id)) continue;
      galaxy.addOvermindSystem(sys.id);
      preGrown++;
    }
    const startOvermind = galaxy.overmindSystems.length;
    const startShare = startOvermind / galaxy.systems.length;
    expect(startShare).toBeLessThan(SPREAD.lossShare); // not lost yet
    galaxy.gameDays = 1 + ADAPTIVE_CREEP_START_DAY; // creep floor active from here
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: galaxy.gameDays,
      status: "advancing",
      threat: startShare,
      peakThreat: startShare,
    };

    let reachedLost = false;
    let everWon = false;
    let prevCount = startOvermind;
    let sawGrowth = false;
    for (let d = 0; d < 480 && !reachedLost; d++) {
      harness.engine.advanceGalaxyDay();
      const status = galaxy.overmindArc.status;
      if (galaxy.overmindSystems.length > prevCount) sawGrowth = true;
      prevCount = galaxy.overmindSystems.length;
      if (status === "won") everWon = true;
      if (status === "lost") reachedLost = true;
    }

    expect(sawGrowth).toBe(true);
    expect(everWon).toBe(false);
    expect(galaxy.overmindArc.status).not.toBe("won");
    expect(galaxy.isOvermindSystem(galaxy.overmindCoreSystemId)).toBe(true);
    expect(galaxy.overmindSystems.length).toBeGreaterThan(0);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
