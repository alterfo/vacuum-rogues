import { describe, it, expect, vi } from "vitest";
import { FactionType, type GameMode, SceneType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("quest probe (temp)", () => {
  it.runIf(!!process.env.QUEST_PROBE)(
    "tallies quest take/complete/expire events across a seeded session",
    async () => {
      const steps = Number(process.env.QUEST_STEPS ?? 300);
      const seed = process.env.QUEST_SEED ?? "QUEST-PROBE-0";
      const mode = (process.env.QUEST_MODE ?? "GOD") as GameMode;
      const harness = await RealEngineHarness.boot({ seed });
      const traceId = process.env.QUEST_TRACE_ID;
      const events: string[] = [];
      const trace: string[] = [];
      let takenCount = 0;
      const seenActiveIds = new Set<string>();
      let lastCompletedIds = new Set<string>();
      let lastFailedIds = new Set<string>();
      try {
        await harness.newGame(FactionType.OUTLANDERS, mode);
        if (process.env.QUEST_DUMP_TOPOLOGY) {
          const g = harness.engine.galaxy;
          for (const s of g?.systems ?? []) {
             
            console.log(
              `${s.id} (${s.name}) -> [${s.connections.map((c) => c.toSystemId).join(", ")}]`,
            );
          }
        }
        const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
        for (let i = 0; i < steps; i++) {
          const res = await agent.run(1);
          const qm = harness.engine.questManager;
          const day = harness.engine.galaxy?.gameDays ?? 0;
          const sid = harness.engine.player?.currentSystemId ?? "?";

          if (traceId) {
            const tq = qm.getActiveQuests().find((q) => q.id === traceId);
            const scene = harness.currentScene() as unknown as {
              planet?: { id: string };
            } | null;
            const planetId = scene?.planet?.id ?? "";
            const collect = tq?.objectives.find(
              (o) => o.type === "COLLECT_ITEM" && !o.completed,
            );
            const carried = collect?.itemType
              ? (harness.engine.player?.inventory.resources.find(
                  (r) => r.type === collect.itemType,
                )?.amount ?? 0)
              : "-";
            for (const s of res.steps) {
              trace.push(
                `@${i} d${day.toFixed(1)} sid=${sid} pid=${planetId} scene=${String(s.scene)} act=${s.action.kind}(${s.action.reason ?? ""}) tq=${tq ? `active target=${tq.targetSystemId} good=${collect?.itemType ?? "-"} need=${collect?.targetAmount ?? "-"} carried=${carried} reward=${tq.reward?.credits ?? "?"}` : "gone"}`,
              );
            }
          }

          const active = qm.getActiveQuests();
          for (const q of active) {
            if (!seenActiveIds.has(q.id)) {
              seenActiveIds.add(q.id);
              takenCount++;
              events.push(
                `@${i} d${day} TAKE ${q.id} type=${q.type} target=${q.targetSystemId ?? "?"} deadline=${q.deadline ?? "?"} (in ${sid})`,
              );
            }
          }

          const completedIds = new Set(qm.getCompletedQuestIds());
          for (const id of completedIds) {
            if (!lastCompletedIds.has(id)) {
              events.push(`@${i} d${day} COMPLETE ${id} (in ${sid})`);
            }
          }
          lastCompletedIds = completedIds;

          const expired = qm.getExpiredQuests?.() ?? [];
          const failedIds = new Set(expired.map((q) => q.id));
          for (const id of failedIds) {
            if (!lastFailedIds.has(id)) {
              const q = expired.find((fq) => fq.id === id);
              events.push(
                `@${i} d${day} EXPIRE ${id} type=${q?.type} target=${q?.targetSystemId ?? "?"} (in ${sid})`,
              );
            }
          }
          lastFailedIds = failedIds;

          if (harness.currentSceneType() === SceneType.GAME_OVER) break;
        }
      } finally {
        harness.dispose();
      }
       
      console.log(events.join("\n"));
       
      console.log(
        `\nTALLY: taken=${takenCount} completed=${lastCompletedIds.size} expired=${lastFailedIds.size}`,
      );
      if (traceId) {
         
        console.log(`\nTRACE ${traceId}:\n${trace.join("\n")}`);
      }
      expect(events.length).toBeGreaterThanOrEqual(0);
    },
    600_000,
  );
});
