import { describe, it, expect, vi } from "vitest";
import { FactionType, SceneType, type GameMode } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent, type AgentStep } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("wedge probe (temp)", () => {
  it.runIf(!!process.env.WEDGE_PROBE)(
    "prints the transcript tail at the wedge",
    async () => {
      const steps = Number(process.env.WEDGE_STEPS ?? 500);
      const seed = process.env.WEDGE_SEED ?? "CAMPAIGN-CAPACITY-0";
      const mode = (process.env.WEDGE_MODE ?? "GOD") as GameMode;
      const harness = await RealEngineHarness.boot({ seed });
      const t: AgentStep[] = [];
      try {
        await harness.newGame(FactionType.OUTLANDERS, mode);
        const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
        const sys: string[] = [];
        for (let i = 0; i < steps; i++) {
          const res = await agent.run(1);
          const g = harness.engine.galaxy;
          const sid = harness.engine.player?.currentSystemId ?? "?";
          const held = g?.isOvermindSystem(sid) ? " HELD" : "";
          const { npcsPresentInSystem } =
            await import("@/systems/npc/NpcSimulator");
          const hs = g
            ? npcsPresentInSystem(g, sid)
                .filter((n) => n.hostile)
                .map((n) => `${n.name}:${n.hullHP}hp/${n.damage}dmg`)
                .join(" ")
            : "";
          const { observe } = await import("./observe");
          const o = observe(harness.engine);
          const q = o.quests
            .map((x) => `${x.type}->${x.targetSystemId}`)
            .join(" ");
          const nb = (o.system?.neighbors ?? [])
            .map(
              (n) =>
                `${n.systemId}${n.overmindHeld ? "!" : ""}v${n.visited ? 1 : 0}`,
            )
            .join(" ");
          sys.push(
            `${sid}${held} held=[${(g?.overmindSystems ?? []).join(",")}] q=[${q}] nb=[${nb}] ${hs}`,
          );
          t.push(...res.steps.map((s) => ({ ...s, index: i })));
          if (harness.currentSceneType() === SceneType.GAME_OVER) break;
        }
         
        console.log(sys.map((s, i) => `@${i} ${s}`).join("\n"));
      } finally {
        harness.dispose();
      }
      const lines = t.slice(-60).map((s) => {
        const v = s.vitals;
        return (
          `#${s.index} d${s.day} ${String(s.scene)} ${s.action.kind}` +
          `(${s.action.reason ?? ""}) cr=${v?.credits} hull=${v?.hull}/${v?.maxHull} ` +
          `fuel=${v?.fuel} cargo=${v?.cargoUsed}`
        );
      });
       
      console.log(lines.join("\n"));
      const hist: Record<string, number> = {};
      for (const s of t.slice(-300)) {
        const k = `${String(s.scene)}:${s.action.kind}:${s.action.reason ?? ""}`;
        hist[k] = (hist[k] ?? 0) + 1;
      }
       
      console.log(
        Object.entries(hist)
          .sort((a, b) => b[1] - a[1])
          .map(([k, c]) => `${c}× ${k}`)
          .join("\n"),
      );
      expect(t.length).toBeGreaterThan(0);
    },
    600_000,
  );
});
