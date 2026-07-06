import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { Faction } from "@/types/faction";
import { computeGalaxyThreat } from "@/systems/galaxy/GalaxyStatusIndicator";
import { advanceOvermind } from "@/systems/overmind/overmindSpread";
import { adaptiveSpreadIntervalDays } from "@/systems/campaign/adaptivePacing";
import { GAME_BALANCE, ADAPTIVE_GRACE_DAYS } from "@/config/balance";

/**
 * Real-engine playtest for the Overmind endgame-arc spread driven in the EOD
 * batch. Boots the genuine `GameEngine` + `GalaxyService` + `NpcSimulator` and
 * only stubs PixiJS, so it exercises the *wiring*: `advanceGalaxyDay` →
 * `advanceOvermindArc` → `galaxy.overmindSystems` growth → landing gating /
 * garrisons / threat indicator. Each scenario ends on the error-invariant
 * (`errors()` empty).
 *
 * REWRITTEN for the adaptive campaign clock (three-year-campaign Task 3, under
 * the plan's test-modification license). The meanings are unchanged — the arc
 * engages and captures on cadence, the drive is idempotent per business date,
 * containment is reachable, and ignoring the Overmind loses the galaxy — but
 * the schedule is now `ADAPTIVE_GRACE_DAYS` of dormancy followed by a
 * power-keyed interval (`adaptiveSpreadIntervalDays`) with a creep floor, so
 * the old fixed grace-6/interval-5 pins are gone. Long dormancy/creep windows
 * are fast-forwarded by pre-setting `gameDays`/`overmindArc` (the same manual
 * clock technique the old containment scenario used).
 *
 * Determinism note: the 5-day equilibrium churn (`stepOwnershipTick`) freezes
 * the Overmind front while the arc holds territory (`freezeOvermind`), so only
 * the deterministic arc spread mutates the Overmind set in these scenarios.
 */
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
    // Given a fresh game in a roomy galaxy (> MIN_SYSTEMS so the arc is live).
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

    // When the first EOD starts the arc clock and the dormancy window passes.
    // Fast-forward the idle year-1 growth room (the adaptive grace), then let
    // the first past-grace EOD fire the first spread tick.
    harness.engine.advanceGalaxyDay(); // day 1 — the arc clock starts
    expect(galaxy.overmindArc.dayZero).toBe(1);
    expect(galaxy.overmindArc.status).toBe("dormant");
    expect(galaxy.overmindArc.lastSpreadDay).toBeLessThan(0); // no spread in grace
    expect(galaxy.overmindSystems.length).toBe(initialCount);

    galaxy.gameDays = SPREAD.graceDays; // next EOD → dayZero + graceDays
    harness.engine.advanceGalaxyDay();

    // Then the arc has engaged and captured exactly one frontier system.
    const spreadDay = SPREAD.graceDays + 1;
    expect(galaxy.gameDays).toBe(spreadDay);
    expect(galaxy.overmindArc.lastSpreadDay).toBe(spreadDay);
    expect(galaxy.overmindArc.status).toBe("advancing");
    expect(galaxy.overmindArc.peakThreat).toBeGreaterThan(0);
    expect(galaxy.overmindSystems.length).toBe(
      initialCount + SPREAD.capturesPerTick,
    );

    // The newly captured system reads as Overmind/hostile — the landing gate and
    // garrison spawner both key off exactly this set.
    const captured = galaxy.overmindSystems.filter(
      (id) => !beforeOvermind.has(id),
    );
    expect(captured).toHaveLength(SPREAD.capturesPerTick);
    for (const id of captured) {
      expect(galaxy.isOvermindSystem(id)).toBe(true);
      expect(galaxy.isHostileSystem(id)).toBe(true);
    }

    // The star-map threat indicator (share-derived) reflects the larger front.
    const threat = computeGalaxyThreat(
      galaxy.overmindSystems,
      galaxy.pirateSystems,
      galaxy.systems.length,
    );
    expect(threat.overmindCount).toBe(galaxy.overmindSystems.length);
    expect(threat.overmindShare).toBeGreaterThan(initialCount / 24);

    // Garrisons: ensureGarrison (run each tick) has stood up Overmind defenders
    // in the captured front — the same wiring landing-gating depends on.
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

    // Advance to the first spread day so a capture has just fired (clock start
    // + fast-forwarded grace, as above).
    harness.engine.advanceGalaxyDay();
    galaxy.gameDays = SPREAD.graceDays;
    harness.engine.advanceGalaxyDay();
    expect(galaxy.overmindArc.lastSpreadDay).toBe(galaxy.gameDays);
    const stateAfterDrive = { ...galaxy.overmindArc };
    const setAfterDrive = [...galaxy.overmindSystems];

    // Re-deriving the SAME business date (the machine the EOD drive calls, with
    // the same adaptive schedule) must be a no-op: the lastSpreadDay cadence
    // blocks a second capture and the status/peak re-derivation is a pure read.
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
    // The live front is untouched by the re-derive.
    expect(galaxy.overmindSystems).toEqual(setAfterDrive);

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("contains the arc when the player retakes the front below the contained share", async () => {
    // Given a large galaxy whose Overmind front had peaked well into "advancing".
    harness = await RealEngineHarness.boot({
      seed: "ARC_CONTAIN",
      systemCount: 40,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const core = galaxy.overmindCoreSystemId;

    // Simulate a front that already advanced (a high peak) past the adaptive
    // grace. Put the clock on a day whose next tick skips the 5-day equilibrium
    // churn, with lastSpreadDay set so no fresh capture lands on the
    // verification tick (the weak-player interval is far longer than one day).
    galaxy.gameDays = SPREAD.graceDays + 5; // next EOD → 96 (96 % 5 !== 0)
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: SPREAD.graceDays + 5,
      status: "advancing",
      threat: 0.4,
      peakThreat: 0.4,
    };

    // When the player retakes the front — liberate every Overmind system except
    // the still-held core — so the live share drops far below CONTAINED_SHARE.
    for (const id of [...galaxy.overmindSystems]) {
      if (id !== core) galaxy.tryLiberate(id);
    }
    const share = galaxy.overmindSystems.length / galaxy.systems.length;
    expect(share).toBeLessThanOrEqual(SPREAD.containedShare);
    expect(galaxy.overmindArc.peakThreat).toBeGreaterThan(
      SPREAD.containedShare,
    );

    // One EOD tick re-derives the arc status from the pushed-back share.
    harness.engine.advanceGalaxyDay();

    // Then the arc reads as contained (peaked above, now at/below the line) and
    // nothing errored.
    expect(galaxy.gameDays).toBe(SPREAD.graceDays + 6);
    expect(galaxy.overmindArc.status).toBe("contained");
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("loses the galaxy when the Overmind is ignored — and never wins spuriously", async () => {
    // The campaign's resolution guarantee on the real engine: with NO player
    // intervention the creep-floor cadence still consumes the galaxy to the
    // 0.85 loss share (well before the 1080-day ceiling), the front genuinely
    // grows, and the background equilibrium never fires a spurious "won" by
    // freeing the core (`freezeOvermind` + the undirected frontier).
    harness = await RealEngineHarness.boot({
      seed: "ARC_IGNORE_LOSES",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const playerSys = harness.player()!.currentSystemId;

    // A neglected front deep in year 2: the arc engaged long ago and has
    // already swallowed a third of the galaxy while the player idled. The clock
    // sits past ADAPTIVE_CREEP_START_DAY, so the creep floor drives the cadence
    // from here (a weak idle player — peak power ≈ 0 — would otherwise stall).
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
    galaxy.gameDays = 400; // past dayZero + ADAPTIVE_CREEP_START_DAY
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 400,
      status: "advancing",
      threat: startShare,
      peakThreat: startShare,
    };

    // Advance EOD days with NO player intervention. On the creep floor the
    // remaining ~11 captures need ~11 × ADAPTIVE_CREEP_MIN_DAYS days; the
    // budget is sized generously past that — and far below the 1080-day
    // campaign ceiling, which is the resolution guarantee under test.
    let reachedLost = false;
    let everWon = false;
    let prevCount = startOvermind;
    let sawGrowth = false;
    for (let d = 0; d < 220 && !reachedLost; d++) {
      harness.engine.advanceGalaxyDay();
      const status = galaxy.overmindArc.status;
      if (galaxy.overmindSystems.length > prevCount) sawGrowth = true;
      prevCount = galaxy.overmindSystems.length;
      if (status === "won") everWon = true;
      if (status === "lost") reachedLost = true;
    }

    // The front genuinely advanced (no creep-window plateau), the Overmind never
    // spuriously "won" via the background equilibrium freeing the core, and the
    // galaxy was ultimately consumed — inside the campaign ceiling.
    expect(sawGrowth).toBe(true);
    expect(galaxy.overmindSystems.length).toBeGreaterThan(startOvermind);
    expect(everWon).toBe(false);
    expect(reachedLost).toBe(true);
    expect(galaxy.overmindArc.status).toBe("lost");
    expect(galaxy.gameDays).toBeLessThan(1080);
    // The core is still held by the Overmind on a loss (never auto-liberated).
    expect(galaxy.isOvermindSystem(galaxy.overmindCoreSystemId)).toBe(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
