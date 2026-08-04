import { describe, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SceneType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { observe } from "./observe";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

interface PerStep {
  index: number;
  day: number;
  scene: SceneType;
  systemId: string | null;
  credits: number;
  hull: number;
  fuel: number;
  cargoUsed: number;
  questsActive: number;
  questsCompleted: number;
  legalCount: number;
  legalActions: string[];
  actionKind: string;
  actionTarget?: string;
  actionReason?: string;
  logs: string[];
}

interface Finding {
  category: "stall" | "loop" | "unopenable" | "stranded" | "error";
  step: number;
  scene: SceneType;
  detail: string;
}

const STALL_MIN = 4;
const WAIT_MIN = 5;
const CYCLE_MIN_REPEATS = 3;

function unchanged(a: PerStep, b: PerStep): boolean {
  return (
    a.day === b.day &&
    a.scene === b.scene &&
    a.systemId === b.systemId &&
    a.credits === b.credits &&
    a.hull === b.hull &&
    a.fuel === b.fuel &&
    a.cargoUsed === b.cargoUsed &&
    a.questsActive === b.questsActive &&
    a.questsCompleted === b.questsCompleted
  );
}

function analyze(steps: PerStep[]): Finding[] {
  const out: Finding[] = [];

  for (let i = 0; i < steps.length; i++) {
    let run = 1;
    while (i + run < steps.length && unchanged(steps[i], steps[i + run])) run++;
    if (run >= STALL_MIN) {
      out.push({
        category: "stall",
        step: steps[i].index,
        scene: steps[i].scene,
        detail: `frozen ${run} steps: no day/scene/system/vitals change (day ${steps[i].day}, scene ${steps[i].scene}, action ${steps[i].actionKind}/${steps[i].actionReason ?? "-"})`,
      });
      i += run - 1;
    }
  }

  for (let i = 0; i < steps.length; i++) {
    if (steps[i].actionKind !== "wait") continue;
    let run = 1;
    while (i + run < steps.length && steps[i + run].actionKind === "wait")
      run++;
    if (run >= WAIT_MIN) {
      out.push({
        category: "stall",
        step: steps[i].index,
        scene: steps[i].scene,
        detail: `${run}× consecutive 'wait' (nothing to do; reason ${steps[i].actionReason ?? "-"})`,
      });
      i += run - 1;
    }
  }

  const sig = (s: PerStep) => `${s.actionKind}:${s.actionTarget ?? ""}`;
  for (let p = 1; p <= 4; p++) {
    for (let i = 0; i + p < steps.length; i++) {
      let reps = 0;
      while (
        i + (reps + 1) * p + (p - 1) < steps.length &&
        (() => {
          for (let k = 0; k < p; k++) {
            if (sig(steps[i + k]) !== sig(steps[i + (reps + 1) * p + k]))
              return false;
          }
          return true;
        })()
      )
        reps++;
      if (reps >= CYCLE_MIN_REPEATS) {
        const window = steps.slice(i, i + p);
        const netCredits =
          steps[i + (reps + 1) * p - 1].credits - steps[i].credits;
        const netQuests =
          steps[i + (reps + 1) * p - 1].questsCompleted -
          steps[i].questsCompleted;
        const pat = window.map(sig).join(" -> ");
        out.push({
          category: "loop",
          step: steps[i].index,
          scene: steps[i].scene,
          detail: `period-${p} cycle ×${reps + 1}: [${pat}]  netCredits=${netCredits} netQuestsDone=${netQuests}`,
        });
        i += (reps + 1) * p - 1;
      }
    }
  }

  for (let i = 0; i < steps.length - 1; i++) {
    const s = steps[i];
    const n = steps[i + 1];
    if (
      (s.actionKind === "land" || s.actionKind === "dock") &&
      s.scene === SceneType.SPACE_FLIGHT &&
      n.scene === SceneType.SPACE_FLIGHT &&
      s.day === n.day
    ) {
      out.push({
        category: "unopenable",
        step: s.index,
        scene: s.scene,
        detail: `'${s.actionKind}' (target ${s.actionTarget ?? "-"}) did not enter PLANET/STATION — still SPACE_FLIGHT`,
      });
    }
    if (
      s.actionKind === "take-quest" &&
      n.questsActive === s.questsActive &&
      n.questsCompleted === s.questsCompleted
    ) {
      out.push({
        category: "unopenable",
        step: s.index,
        scene: s.scene,
        detail: `'take-quest' produced no active/completed quest change`,
      });
    }
    if (
      s.actionKind === "warp" &&
      s.systemId != null &&
      n.systemId === s.systemId &&
      s.day === n.day
    ) {
      out.push({
        category: "unopenable",
        step: s.index,
        scene: s.scene,
        detail: `'warp' (target ${s.actionTarget ?? "-"}) did not change system`,
      });
    }
  }

  const terminal = (sc: SceneType) =>
    sc === SceneType.GAME_OVER || sc === SceneType.WIN_SCREEN;
  for (const s of steps) {
    if (
      !terminal(s.scene) &&
      s.legalActions.filter((a) => a !== "wait").length === 0
    ) {
      out.push({
        category: "stranded",
        step: s.index,
        scene: s.scene,
        detail: `only 'wait' legal — stranded/dead-end UI`,
      });
    }
    for (const log of s.logs) {
      out.push({
        category: "error",
        step: s.index,
        scene: s.scene,
        detail: log,
      });
    }
  }

  return out;
}

describe.runIf(!!process.env.ODDITY_HUNT)("autopilot oddity hunt", () => {
  it("plays 10 sessions and collects stalls, loops, unopenable UI, stranded states", async () => {
    const SESSIONS = Number(process.env.ODDITY_SESSIONS ?? 10);
    const STEPS = Number(process.env.ODDITY_STEPS ?? 150);
    const sessionReports: {
      seed: string;
      steps: number;
      endScene: SceneType;
      daysElapsed: number;
      survived: boolean;
      findings: Finding[];
      raw: PerStep[];
    }[] = [];

    for (let s = 0; s < SESSIONS; s++) {
      const seed = `ODDITY-${s}`;
      const harness = await RealEngineHarness.boot({ seed });
      try {
        await harness.newGame();
        const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
        const steps: PerStep[] = [];
        for (let i = 0; i < STEPS; i++) {
          const engine = harness.engine;
          const obs = observe(engine);
          const before = harness.errors().length;
          const res = await agent.run(1);
          const logs = harness
            .errors()
            .slice(before)
            .map((e) => `[${e.source}] ${e.message}`);
          const act = res.steps[0]?.action;
          steps.push({
            index: i,
            day: engine.galaxy?.gameDays ?? 0,
            scene: obs.scene,
            systemId: obs.player?.systemId ?? null,
            credits: obs.player?.credits ?? 0,
            hull: obs.player?.hull ?? 0,
            fuel: obs.player?.fuel ?? 0,
            cargoUsed: obs.player?.cargoUsed ?? 0,
            questsActive: obs.quests?.length ?? 0,
            questsCompleted:
              engine.questManager?.getCompletedQuestIds?.().length ?? 0,
            legalCount: obs.legalActions.length,
            legalActions: obs.legalActions,
            actionKind: act?.kind ?? "wait",
            actionTarget: act?.targetId,
            actionReason: act?.reason,
            logs,
          });
          if (
            obs.scene === SceneType.GAME_OVER ||
            obs.scene === SceneType.WIN_SCREEN
          )
            break;
        }
        const firstDay = steps[0]?.day ?? 0;
        const lastDay = steps[steps.length - 1]?.day ?? firstDay;
        sessionReports.push({
          seed,
          steps: steps.length,
          endScene: harness.currentSceneType(),
          daysElapsed: Math.max(0, lastDay - firstDay),
          survived: harness.currentSceneType() !== SceneType.GAME_OVER,
          findings: analyze(steps),
          raw: steps,
        });
      } finally {
        harness.dispose();
      }
    }

    mkdirSync(".letsplay", { recursive: true });
    writeFileSync(
      join(".letsplay", "oddity-hunt.json"),
      JSON.stringify(sessionReports, null, 2),
      "utf8",
    );

    const lines: string[] = [];
    const totals: Record<string, number> = {};
    for (const r of sessionReports) {
      for (const f of r.findings)
        totals[f.category] = (totals[f.category] ?? 0) + 1;
      lines.push(
        `\n=== ${r.seed} — ${r.steps} steps, +${r.daysElapsed}d, end=${r.endScene}, ${r.survived ? "survived" : "DIED"}, ${r.findings.length} findings ===`,
      );
      const byCat: Record<string, Finding[]> = {};
      for (const f of r.findings) (byCat[f.category] ??= []).push(f);
      for (const [cat, fs] of Object.entries(byCat)) {
        lines.push(`  ${cat} (${fs.length}):`);
        for (const f of fs.slice(0, 12))
          lines.push(`    @${f.step} [${f.scene}] ${f.detail}`);
        if (fs.length > 12) lines.push(`    … +${fs.length - 12} more`);
      }
    }
    lines.push(`\n### TOTALS: ${JSON.stringify(totals)}`);
    console.log(lines.join("\n"));
  }, 600_000);
});
