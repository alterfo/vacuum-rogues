import { describe, it, expect } from "vitest";
import {
  stepOwnershipTick,
  type BalanceSystemNode,
  type OwnershipBalanceConfig,
} from "@/systems/galaxy/OvermindBalance";
import { SeededRNG } from "@/utils/seededRNG";
import { GAME_BALANCE } from "@/config/balance";

function buildGalaxyTopology(
  seed: string,
  n: number,
): { systems: BalanceSystemNode[]; overmindStart: string[] } {
  const rng = new SeededRNG(seed);
  const coords = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    q: rng.nextInt(-50, 50),
    r: rng.nextInt(-50, 50),
  }));

  const systems: BalanceSystemNode[] = coords.map((c) => {
    const sorted = coords
      .filter((o) => o.id !== c.id)
      .map((o) => ({
        id: o.id,
        dist: Math.sqrt((o.q - c.q) ** 2 + (o.r - c.r) ** 2),
      }))
      .sort((a, b) => a.dist - b.dist);
    return {
      id: c.id,
      connections: sorted.slice(0, 3).map((d) => ({ toSystemId: d.id })),
    };
  });

  const sorted = [...coords].sort(
    (a, b) => b.q ** 2 + b.r ** 2 - (a.q ** 2 + a.r ** 2),
  );
  const overmindStart = [sorted[0].id, sorted[1].id];

  return { systems, overmindStart };
}

const CFG: OwnershipBalanceConfig = {
  pCapture: GAME_BALANCE.OVERMIND_CAPTURE_PROB,
  pRecaptureBase: GAME_BALANCE.OVERMIND_RECAPTURE_BASE_PROB,
  feedbackStrength: GAME_BALANCE.OVERMIND_FEEDBACK_STRENGTH,
};

interface SimResult {
  dailyShares: number[];
  majorityReached: boolean;
}

function runEquilibriumSim(
  seed: string,
  n = 30,
  days = 2000,
  interval = GAME_BALANCE.OVERMIND_BALANCE_INTERVAL,
): SimResult {
  const { systems, overmindStart } = buildGalaxyTopology(seed, n);
  const rng = new SeededRNG(`eq_${seed}`);
  let overmind = [...overmindStart];
  let pirate: string[] = [];
  const dailyShares: number[] = [];
  let majorityReached = false;

  for (let day = 1; day <= days; day++) {
    if (day % interval === 0) {
      const r = stepOwnershipTick(systems, overmind, pirate, rng, CFG);
      overmind = r.overmindSystems;
      pirate = r.pirateSystems;

      const totalHostile = overmind.length + pirate.length;
      if (totalHostile < GAME_BALANCE.OVERMIND_FLOOR_MIN) {
        const needed = GAME_BALANCE.OVERMIND_FLOOR_MIN - totalHostile;
        const hostile = new Set([...overmind, ...pirate]);
        const available = systems.filter((s) => !hostile.has(s.id));
        for (let i = 0; i < needed; i++) {
          if (available.length === 0) break;
          const idx = Math.floor(rng.next() * available.length);
          const chosen = available.splice(idx, 1)[0];
          overmind.push(chosen.id);
        }
      }
    }
    const share = (overmind.length + pirate.length) / n;
    dailyShares.push(share);
    if (overmind.length > n / 2) majorityReached = true;
  }

  return { dailyShares, majorityReached };
}

function windowAvg(arr: number[], start: number, end: number): number {
  const slice = arr.slice(start, end);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

describe("overmindEquilibrium: 2000-day self-balance simulation", () => {
  const SEEDS = ["alpha", "beta", "gamma"];
  const WARMUP = 300;
  const BAND_LOW = 0.08;
  const BAND_HIGH = 0.25;

  for (const seed of SEEDS) {
    it(`[${seed}] majority is never reached`, () => {
      const { majorityReached } = runEquilibriumSim(seed);
      expect(majorityReached).toBe(false);
    });

    it(`[${seed}] rolling 200-day average stays in [${BAND_LOW * 100}%,${BAND_HIGH * 100}%] after warmup`, () => {
      const { dailyShares } = runEquilibriumSim(seed);
      for (
        let start = WARMUP;
        start + 200 <= dailyShares.length;
        start += 100
      ) {
        const avg = windowAvg(dailyShares, start, start + 200);
        expect(avg).toBeGreaterThanOrEqual(BAND_LOW);
        expect(avg).toBeLessThanOrEqual(BAND_HIGH);
      }
    });

    it(`[${seed}] no upward trend: avg share in days 1200-2000 ≤ avg share in days 700-1200 + 3%`, () => {
      const { dailyShares } = runEquilibriumSim(seed);
      const avgA = windowAvg(dailyShares, 700, 1200);
      const avgB = windowAvg(dailyShares, 1200, 2000);
      expect(avgB).toBeLessThanOrEqual(avgA + 0.03);
    });
  }
});
