import { describe, it, expect, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { SceneType } from "@/types";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function scripted(kind: Action["kind"]): PlayerPolicy {
  return {
    name: "scripted",
    decide(obs: Observation): Action {
      const k = obs.legalActions.includes(kind) ? kind : "wait";
      return { kind: k, reason: "scripted" };
    },
  };
}

describe("PlayerAgent — station dock refuels (Task 7)", () => {
  it("docking at a station with a depleted tank restores energy to max", async () => {
    const harness = await RealEngineHarness.boot();
    try {
      await harness.newGame();
      const ship = harness.engine.player!.ship;
      ship.energy = Math.max(1, Math.floor(ship.maxEnergy * 0.2));

      const agent = new PlayerAgent(harness, scripted("dock"));
      await agent.run(1);

      expect(harness.errors()).toEqual([]);
      expect(harness.currentSceneType()).toBe(SceneType.STATION);
      expect(ship.energy).toBe(ship.maxEnergy);
    } finally {
      harness.dispose();
    }
  });
});
