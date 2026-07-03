import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { Faction } from "@/types/faction";
import { computeGalaxyThreat } from "@/systems/galaxy/GalaxyStatusIndicator";
import { advanceOvermind } from "@/systems/overmind/overmindSpread";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Real-engine playtest for the Overmind endgame-arc spread driven in the EOD
 * batch (Task 3 of `20260625-overmind-endgame-living-galaxy`). Boots the genuine
 * `GameEngine` + `GalaxyService` + `NpcSimulator` and only stubs PixiJS, so it
 * exercises the *wiring*: `advanceGalaxyDay` → `advanceOvermindArc` →
 * `galaxy.overmindSystems` growth → landing gating / garrisons / threat
 * indicator. Each scenario ends on the error-invariant (`errors()` empty).
 *
 * Determinism note: the 5-day equilibrium churn (`stepOwnershipTick`) only fires
 * on `gameDays % OVERMIND_BALANCE_INTERVAL === 0`. The scenarios advance to days
 * that skip it, so only the deterministic arc spread mutates the front — no
 * flaky reliance on the probabilistic equilibrium.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const SPREAD = {
  graceDays: GAME_BALANCE.OVERMIND_SPREAD_GRACE_DAYS,
  spreadIntervalDays: GAME_BALANCE.OVERMIND_SPREAD_INTERVAL_DAYS,
  capturesPerTick: GAME_BALANCE.OVERMIND_SPREAD_CAPTURES_PER_TICK,
  lossShare: GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
  containedShare: GAME_BALANCE.OVERMIND_SPREAD_CONTAINED_SHARE,
  minSystemsForLoss: GAME_BALANCE.OVERMIND_SPREAD_MIN_SYSTEMS,
};

describe("Overmind endgame-arc spread (EOD drive)", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("advances the Overmind front over EOD days and reflects captures", async () => {
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

    // When four end-of-day turns pass. The arc clock starts on day 1, grace is
    // GRACE_DAYS, so the first spread tick fires deterministically on day 4 — and
    // days 1..4 never hit the 5-day equilibrium tick, so the front grows by the
    // arc alone.
    for (let i = 0; i < SPREAD.graceDays + 1; i++) {
      harness.engine.advanceGalaxyDay();
    }

    // Then the arc has engaged and captured exactly one frontier system.
    expect(galaxy.gameDays).toBe(SPREAD.graceDays + 1);
    expect(galaxy.overmindArc.dayZero).toBe(1);
    expect(galaxy.overmindArc.lastSpreadDay).toBe(SPREAD.graceDays + 1);
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

    // Advance to the first spread day so a capture has just fired.
    for (let i = 0; i < SPREAD.graceDays + 1; i++) {
      harness.engine.advanceGalaxyDay();
    }
    const stateAfterDrive = { ...galaxy.overmindArc };
    const setAfterDrive = [...galaxy.overmindSystems];

    // Re-deriving the SAME business date (the machine the EOD drive calls) must
    // be a no-op: the lastSpreadDay cadence blocks a second capture and the
    // status/peak re-derivation is a pure read.
    const rerun = advanceOvermind(
      galaxy.overmindArc,
      {
        id: galaxy.id,
        systems: galaxy.systems,
        overmindSystems: galaxy.overmindSystems,
        overmindCoreSystemId: galaxy.overmindCoreSystemId,
      },
      galaxy.gameDays,
      SPREAD,
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

    // Simulate a front that already advanced (a high peak). Put the clock on a
    // day whose next tick skips the 5-day equilibrium churn, and set the spread
    // cadence so no fresh capture lands on the verification tick.
    galaxy.gameDays = 6; // next advanceGalaxyDay → day 7 (7 % 5 !== 0)
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 6,
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
    expect(galaxy.gameDays).toBe(7);
    expect(galaxy.overmindArc.status).toBe("contained");
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("loses the galaxy when the Overmind is ignored — and never wins spuriously", async () => {
    // Regression for two pacing bugs the equilibrium tick caused on its 5-day
    // cadence: (1) it liberated the Overmind core, firing a spurious "won", and
    // (2) its ~25% feedback ceiling capped the arc below the loss line, so an
    // ignored Overmind oscillated forever and "lost" was unreachable. With the
    // arc owning the front (freezeOvermind) and the undirected frontier, doing
    // nothing must monotonically advance to a real defeat.
    harness = await RealEngineHarness.boot({
      seed: "ARC_IGNORE_LOSES",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const startOvermind = galaxy.overmindSystems.length;

    // Advance EOD days with NO player intervention. The arc should reach "lost"
    // within this budget. The loss line is now `OVERMIND_SPREAD_LOSS_SHARE`
    // = 0.85 (a near-total galaxy, not a mere half), so at 1 capture / 5-day
    // tick a 24-system galaxy needs ~20 captures ≈ day 100 to cross it — the
    // window is sized generously past that so the invariant (ignoring the
    // Overmind eventually loses the whole galaxy) still holds under the raised
    // threshold.
    let reachedLost = false;
    let everWon = false;
    let prevCount = startOvermind;
    let sawGrowth = false;
    for (let d = 0; d < 160 && !reachedLost; d++) {
      harness.engine.advanceGalaxyDay();
      const status = galaxy.overmindArc.status;
      if (galaxy.overmindSystems.length > prevCount) sawGrowth = true;
      prevCount = galaxy.overmindSystems.length;
      if (status === "won") everWon = true;
      if (status === "lost") reachedLost = true;
    }

    // The front genuinely advanced (no 40-day plateau), the Overmind never
    // spuriously "won" via the background equilibrium freeing the core, and the
    // galaxy was ultimately consumed.
    expect(sawGrowth).toBe(true);
    expect(galaxy.overmindSystems.length).toBeGreaterThan(startOvermind);
    expect(everWon).toBe(false);
    expect(reachedLost).toBe(true);
    expect(galaxy.overmindArc.status).toBe("lost");
    // The core is still held by the Overmind on a loss (never auto-liberated).
    expect(galaxy.isOvermindSystem(galaxy.overmindCoreSystemId)).toBe(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
