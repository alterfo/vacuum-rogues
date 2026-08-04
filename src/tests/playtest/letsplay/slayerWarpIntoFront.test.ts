import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy } from "./PlayerPolicy";
import { reachableNeighbors } from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("slayer warp executor — an explicit front-system target is honored, not vetoed", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("warping at an Overmind-held neighbor actually enters that system", async () => {
    harness = await RealEngineHarness.boot({ seed: "SLAYER-WARP" });
    await harness.newGame();
    const engine = harness.engine;
    const startId = engine.player!.currentSystemId;
    const neighbor = reachableNeighbors(engine.galaxy!.systems, startId)[0];
    expect(neighbor).toBeDefined();
    engine.galaxy!.addOvermindSystem(neighbor.toSystemId);

    const policy: PlayerPolicy = {
      name: "front-warper",
      decide(obs) {
        if (obs.player?.systemId === neighbor.toSystemId) {
          return { kind: "wait", reason: "mem:arrived" };
        }
        return {
          kind: "warp",
          targetId: neighbor.toSystemId,
          reason: "mem:slayer-advance",
        };
      },
    };
    const agent = new PlayerAgent(harness, policy);
    await agent.run(4);

    expect(engine.player!.currentSystemId).toBe(neighbor.toSystemId);
    expect(harness.errors()).toEqual([]);
  });
});
