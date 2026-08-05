import { describe, it, expect } from "vitest";
import {
  stepOwnershipTick,
  type OwnershipBalanceConfig,
} from "@/systems/galaxy/OvermindBalance";

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
  it("captures a border faction system when RNG < effective pCapture", () => {
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

  it("negative feedback: effectivePCapture = 0 when hostile share ≥ 1/feedbackStrength", () => {
    const systems = chain(4);
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

  it("can expand from a low hostile start given favorable rolls (captures occur)", () => {
    const n = 10;
    const ring = Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      connections: [
        { toSystemId: `s${(i - 1 + n) % n}` },
        { toSystemId: `s${(i + 1) % n}` },
      ],
    }));
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
    expect(share).toBeLessThan(0.9);
  });

  it("returns empty arrays for an empty system list", () => {
    const result = stepOwnershipTick([], [], [], mockRng([]), BASE_CFG);
    expect(result.overmindSystems).toHaveLength(0);
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("freezeOvermind never liberates an Overmind system (protects the core)", () => {
    const systems = chain(3);
    const result = stepOwnershipTick(
      systems,
      ["s1"],
      [],
      mockRng([0.99, 0.99]),
      { ...BASE_CFG, freezeOvermind: true },
    );
    expect(result.overmindSystems).toEqual(["s1"]);
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("freezeOvermind does not grow the Overmind front (an Overmind-only border is left for the arc)", () => {
    const systems = chain(3);
    const result = stepOwnershipTick(systems, ["s0"], [], mockRng([]), {
      ...BASE_CFG,
      freezeOvermind: true,
    });
    expect(result.overmindSystems).toEqual(["s0"]);
    expect(result.pirateSystems).toHaveLength(0);
  });

  it("freezeOvermind still churns pirates (capture + recapture) and can capture as pirate at a mixed border", () => {
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
      mockRng([0.05, 0.1]),
      { ...BASE_CFG, freezeOvermind: true },
    );
    expect(result.pirateSystems).toContain("s1");
    expect(result.overmindSystems).toEqual(["s0"]); // never grew or shrank
    expect(result.pirateSystems).not.toContain("s4"); // pirate liberated
  });
});
