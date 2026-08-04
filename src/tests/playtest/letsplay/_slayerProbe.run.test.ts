import { describe, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { SceneType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { observe } from "./observe";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe.runIf(!!process.env.SLAYER_PROBE)("slayer conversion probe", () => {
  it("replays a battle-ready campaign seed with a step transcript", async () => {
    const seed = process.env.SLAYER_SEED ?? "CAMPAIGN-7";
    const STEPS = Number(process.env.SLAYER_STEPS ?? 420);
    const harness = await RealEngineHarness.boot({ seed });
    const rows: unknown[] = [];
    try {
      await harness.newGame();
      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      for (let i = 0; i < STEPS; i++) {
        const engine = harness.engine;
        const obs = observe(engine);
        const res = await agent.run(1);
        const act = res.steps[0]?.action;
        rows.push({
          i,
          day: engine.galaxy?.gameDays ?? 0,
          scene: obs.scene,
          sys: obs.player?.systemId,
          cr: obs.player?.credits ?? 0,
          hull: obs.player?.hull ?? 0,
          maxHull: obs.player?.maxHull ?? 0,
          wpn: obs.player?.weaponDamage ?? 0,
          host: obs.hostiles.length,
          omHere: obs.overmindHeldHere ?? false,
          canLib: engine.canLiberateCurrentSystem(),
          om: engine.galaxy?.overmindSystems.length ?? 0,
          act: act?.kind,
          tgt: act?.targetId ?? null,
          why: act?.reason ?? null,
        });
        if (
          obs.scene === SceneType.GAME_OVER ||
          obs.scene === SceneType.WIN_SCREEN
        )
          break;
      }
    } finally {
      harness.dispose();
    }
    mkdirSync(".letsplay", { recursive: true });
    writeFileSync(
      `.letsplay/slayer-probe-${seed}.json`,
      JSON.stringify(rows, null, 1),
      "utf8",
    );
    console.log(
      `probe: ${rows.length} steps → .letsplay/slayer-probe-${seed}.json`,
    );
  }, 600_000);
});
