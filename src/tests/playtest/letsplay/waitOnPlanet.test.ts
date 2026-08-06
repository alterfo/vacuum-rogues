import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy } from "./PlayerPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const alwaysWait: PlayerPolicy = {
  name: "always-wait",
  decide: () => ({ kind: "wait", reason: "test:always-wait" }),
};

describe("waiting while landed advances the calendar (campaign wedge regression)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a deadlock-sheltering agent on a planet never freezes the clock", async () => {
    const engine = harness.engine;
    const sys = engine.galaxy!.systems.find(
      (s) => s.id === engine.player!.currentSystemId,
    )!;
    const planet = sys.planets.find((p) => p.isHabitable !== false)!;
    await harness.goTo(SceneType.PLANET, { planet });
    expect(engine.currentSceneType).toBe(SceneType.PLANET);

    const day0 = engine.galaxy!.gameDays;
    const agent = new PlayerAgent(harness, alwaysWait);
    await agent.run(3);

    expect(engine.galaxy!.gameDays).toBeGreaterThanOrEqual(day0 + 3);
    expect(harness.errors()).toHaveLength(0);
  });

  it("waiting docked at a station passes a day too", async () => {
    const engine = harness.engine;
    const sys = engine.galaxy!.systems.find(
      (s) => s.id === engine.player!.currentSystemId,
    )!;
    const station = sys.stations[0];
    if (!station) return;
    await harness.goTo(SceneType.STATION, { station });

    const day0 = engine.galaxy!.gameDays;
    const agent = new PlayerAgent(harness, alwaysWait);
    await agent.run(2);

    expect(engine.galaxy!.gameDays).toBeGreaterThanOrEqual(day0 + 2);
  });
});
