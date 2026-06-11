import { describe, it, expect } from "vitest";
import {
  stepOwnershipTick,
  type OwnershipBalanceConfig,
} from "@/systems/galaxy/OvermindBalance";

/** Deterministic mock RNG that returns values from a pre-defined list. */
function mockRng(values: number[]) {
  let idx = 0;
  return {
    next() {
      if (idx >= values.length)
        throw new Error(`mockRng exhausted after ${idx} calls`);
      return values[idx++];
    },
  };
}

/** Build a linear chain of N systems: 0–1–2–...–(N-1). */
function chain(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    connections: [
      ...(i > 0 ? [{ toSystemId: `s${i - 1}` }] : []),
      ...(i < n - 1 ? [{ toSystemId: `s${i + 1}` }] : []),
    ],
  }));
}

const BASE_CFG: OwnershipBalanceConfig = {
  pCapture: 0.5,
  pRecaptureBase: 0.5,
  feedbackStrength: 2.0,
};

describe("stepOwnershipTick", () => {
  // --- Forced-RNG capture / recapture ---

  it("captures a border faction system when RNG < effective pCapture", () => {
    // 4-system chain: s0(overmind) – s1(faction) – s2(faction) – s3(faction)
    // share = 1/4 = 0.25
    // effectivePCapture  = 0.5 * (1 - 0.25*2) = 0.25
    // effectivePRecapture = min(1, 0.5 * (1 + 0.25*2)) = 0.75
    // Roll order (iteration s0..s3):
    //   s0 (hostile, borders s1 faction) → recapture roll
    //   s1 (faction, borders s0 hostile) → capture roll
    //   s2, s3 have no hostile neighbor → no roll
    // Set rolls: s0 = 0.99 (≥ 0.75 → not liberated), s1 = 0.20 (< 0.25 → captured)
    const systems = chain(4);
    const result = stepOwnershipTick(
      systems,
      ["s0"],
      [],
      mockRng([0.99, 0.2]),
      BASE_CFG,
    );
    expect(result.overmindSystems).toContain("s0");
    expect(result.overmindSystems).toContain("s1");
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("does NOT capture when RNG >= effective pCapture", () => {
    // Same topology. Roll 0.99 for s1 → 0.99 ≥ 0.25 → no capture.
    const systems = chain(4);
    const result = stepOwnershipTick(
      systems,
      ["s0"],
      [],
      mockRng([0.99, 0.99]),
      BASE_CFG,
    );
    expect(result.overmindSystems).toEqual(["s0"]);
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("recaptures a border hostile system when RNG < effective pRecapture", () => {
    // 3-system chain: s0(faction) – s1(overmind) – s2(faction)
    // share = 1/3 ≈ 0.33
    // effectivePCapture  = 0.5 * (1 - 0.33*2) ≈ 0.167
    // effectivePRecapture = min(1, 0.5 * (1 + 0.33*2)) ≈ 0.833
    // Roll order: s0 (faction, borders s1) → capture; s1 (hostile, borders s0+s2) → recapture; s2 → capture
    // Rolls: s0 = 0.90 (no capture), s1 = 0.10 (< 0.833 → recaptured), s2 = 0.90 (no capture)
    const systems = chain(3);
    const result = stepOwnershipTick(
      systems,
      ["s1"],
      [],
      mockRng([0.9, 0.1, 0.9]),
      BASE_CFG,
    );
    expect(result.overmindSystems).toHaveLength(0);
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("captures as pirate when only pirate neighbors exist", () => {
    // 3-system chain: s0(pirate) – s1(faction) – s2(faction)
    // share = 1/3 ≈ 0.33; effectivePCapture ≈ 0.167; effectivePRecapture ≈ 0.833
    // s0 (pirate, borders s1 faction) → recapture roll: 0.99 ≥ 0.833 → not liberated
    // s1 (faction, only pirate neighbor s0) → capture roll: 0.10 < 0.167 → captured as pirate
    // s2: no hostile neighbor → no roll
    const systems = chain(3);
    const result = stepOwnershipTick(
      systems,
      [],
      ["s0"],
      mockRng([0.99, 0.1]),
      BASE_CFG,
    );
    expect(result.pirateSystems).toContain("s0");
    expect(result.pirateSystems).toContain("s1");
    expect(result.overmindSystems).toHaveLength(0);
  });

  it("captures as overmind when both overmind and pirate neighbors exist (overmind priority)", () => {
    // 5 systems: s0(overmind) – s1(faction) – s2(faction); s1 also connects to s4(pirate); s3(faction)
    // s0(overmind): [s1]
    // s1(faction):  [s0, s4]   ← both hostile neighbors
    // s2(faction):  [s1]
    // s3(faction):  [s1]
    // s4(pirate):   [s1]
    // hostile = {s0, s4} = 2/5 = 40% share
    // effectivePCapture  = 0.5 * (1 - 0.4*2) = 0.10
    // effectivePRecapture = min(1, 0.5 * (1 + 0.4*2)) = 0.90
    // Roll order (s0..s4):
    //   s0 (hostile, borders s1 faction) → recapture: 0.95 ≥ 0.90 → not liberated
    //   s1 (faction, borders s0 overmind + s4 pirate) → capture: 0.05 < 0.10 → captured AS OVERMIND
    //   s2, s3 have no hostile neighbor → no roll
    //   s4 (hostile, borders s1 faction) → recapture: 0.95 ≥ 0.90 → not liberated
    const systems = [
      { id: "s0", connections: [{ toSystemId: "s1" }] },
      { id: "s1", connections: [{ toSystemId: "s0" }, { toSystemId: "s4" }] },
      { id: "s2", connections: [{ toSystemId: "s1" }] },
      { id: "s3", connections: [{ toSystemId: "s1" }] },
      { id: "s4", connections: [{ toSystemId: "s1" }] },
    ];
    const result = stepOwnershipTick(
      systems,
      ["s0"],
      ["s4"],
      mockRng([0.95, 0.05, 0.95]),
      BASE_CFG,
    );
    expect(result.overmindSystems).toContain("s1");
    expect(result.pirateSystems).not.toContain("s1");
  });

  // --- Negative feedback ---

  it("negative feedback: effectivePCapture = 0 when hostile share ≥ 1/feedbackStrength", () => {
    // At 50% hostile share with feedbackStrength=2:
    // effectivePCapture = 0.5 * max(0, 1 - 0.5*2) = 0
    // No faction system should be captured regardless of roll value.
    // Chain: s0(overmind), s1(overmind), s2(faction), s3(faction)  share=0.5
    const systems = chain(4);
    // Roll 0.0 for all (lowest possible — still won't beat effectivePCapture of 0)
    const result = stepOwnershipTick(
      systems,
      ["s0", "s1"],
      [],
      mockRng([0.0, 0.0, 0.0, 0.0]),
      BASE_CFG,
    );
    expect(result.overmindSystems).not.toContain("s2");
    expect(result.overmindSystems).not.toContain("s3");
  });

  it("negative feedback: effectivePRecapture = 1 at high hostile share (always recaptures)", () => {
    // At 75% hostile share with feedbackStrength=2:
    // effectivePRecapture = min(1, 0.5 * (1 + 0.75*2)) = min(1, 1.25) = 1.0
    // A border hostile system is recaptured regardless of roll value.
    // Chain: s0(overmind), s1(overmind), s2(overmind), s3(faction)  share=0.75
    // s2 borders s3 (faction) → always recaptured (roll 0.99 < 1.0)
    const systems = chain(4);
    const result = stepOwnershipTick(
      systems,
      ["s0", "s1", "s2"],
      [],
      mockRng([0.99, 0.99, 0.99, 0.99]),
      BASE_CFG,
    );
    expect(result.overmindSystems).not.toContain("s2");
  });

  it("hostile systems with no faction neighbors are never recaptured", () => {
    // Fully hostile galaxy: no recapture possible (no faction border).
    const systems = [
      { id: "s0", connections: [{ toSystemId: "s1" }] },
      { id: "s1", connections: [{ toSystemId: "s0" }] },
    ];
    const result = stepOwnershipTick(
      systems,
      ["s0", "s1"],
      [],
      mockRng([]),
      BASE_CFG,
    );
    expect(result.overmindSystems).toContain("s0");
    expect(result.overmindSystems).toContain("s1");
  });

  it("faction systems with no hostile neighbors are never captured", () => {
    // Isolated faction system: no connections → never a border system.
    const systems = [
      { id: "s0", connections: [] },
      { id: "s1", connections: [] },
    ];
    const result = stepOwnershipTick(
      systems,
      ["s1"],
      [],
      mockRng([]),
      BASE_CFG,
    );
    expect(result.overmindSystems).not.toContain("s0");
  });

  // --- Equilibrium direction tests ---

  it("can expand from a low hostile start given favorable rolls (captures occur)", () => {
    // 10-system ring with 1 overmind (10% share).
    // effectivePCapture  = 0.5 * (1 - 0.1*2) = 0.40
    // effectivePRecapture = min(1, 0.5 * (1 + 0.1*2)) = 0.60
    // Roll order: s0 (hostile, recapture), s1 (faction, capture), then s2..s8 have no hostile,
    //             s9 (faction, borders s0 in ring → capture).
    // Rolls: s0=0.99 (not liberated), s1=0.20 (captured), s9=0.20 (captured)
    const n = 10;
    const ring = Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      connections: [
        { toSystemId: `s${(i - 1 + n) % n}` },
        { toSystemId: `s${(i + 1) % n}` },
      ],
    }));
    // s0 (hostile): recapture 0.99; s1 (faction, borders s0): capture 0.20;
    // s2..s8 no hostile border; s9 (faction, borders s0 in ring): capture 0.20
    const result = stepOwnershipTick(
      ring,
      ["s0"],
      [],
      mockRng([0.99, 0.2, 0.2]),
      BASE_CFG,
    );
    expect(result.overmindSystems.length).toBeGreaterThan(1);
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("shrinks from a high hostile start: negative feedback drives recaptures", () => {
    // 10-system ring: 9 hostile, 1 faction (s9). share=0.9
    // effectivePCapture  = 0.5 * max(0, 1 - 0.9*2) = 0  → no captures possible
    // effectivePRecapture = min(1, 0.5 * (1 + 0.9*2)) = min(1, 1.40) = 1.0 → always recaptures
    const n = 10;
    const ring = Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      connections: [
        { toSystemId: `s${(i - 1 + n) % n}` },
        { toSystemId: `s${(i + 1) % n}` },
      ],
    }));
    let overmind = Array.from({ length: 9 }, (_, i) => `s${i}`);
    let pirate: string[] = [];
    // Any roll works since pCapture=0 and pRecapture=1 at this share.
    const deterministicRng = {
      _v: 0.5,
      next() {
        return (this._v = (this._v * 1.3 + 0.07) % 1);
      },
    };

    for (let t = 0; t < 20; t++) {
      const res = stepOwnershipTick(
        ring,
        overmind,
        pirate,
        deterministicRng,
        BASE_CFG,
      );
      overmind = res.overmindSystems;
      pirate = res.pirateSystems;
    }

    const share = (overmind.length + pirate.length) / n;
    // After 20 ticks from 90% hostile with pCapture=0 and pRecapture=1, share must drop.
    expect(share).toBeLessThan(0.9);
  });

  it("returns empty arrays for an empty system list", () => {
    const result = stepOwnershipTick([], [], [], mockRng([]), BASE_CFG);
    expect(result.overmindSystems).toHaveLength(0);
    expect(result.pirateSystems).toHaveLength(0);
  });
});
