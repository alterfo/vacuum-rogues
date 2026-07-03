/**
 * TEMP diagnostic — NOT a committed test. Runs the live-autopilot policy
 * (MemoryHeuristicPolicy, the dev autopilot default) across many fresh games
 * headlessly and categorizes the *behavioral* problems the user reported:
 * dying, getting stranded, stalling at low hull, warp ping-pong, no economic
 * progress. Writes a human-readable problem list to scratchpad + console.
 *
 * Run: npx vitest --run src/tests/playtest/letsplay/_autopilotDiag.run.test.ts
 * Delete after use.
 */
import { writeFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import { runLetsplay, type SessionReport } from "./letsplay.run";

// Real-engine harness needs PixiJS stubbed (same as letsplaySession.test.ts).
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const SESSIONS = Number(process.env.DIAG_SESSIONS ?? 100);
const STEPS = Number(process.env.DIAG_STEPS ?? 60);
const LOW_HULL = 0.3; // "hull <30%" the user called out

interface SessionDiag {
  index: number;
  seed: string;
  endScene: SceneType;
  died: boolean;
  stranded: boolean; // always-actionable invariant breached
  errorCount: number;
  longestWaitRun: number; // longest consecutive run of no-progress actions
  waitFraction: number;
  lowHullStall: boolean; // hit <30% hull then never changed system again
  tookHeavyDamage: boolean; // hull dropped >50% between two steps (combat proxy)
  warps: number;
  distinctScenes: number;
  creditsDelta: number;
  questsCompleted: number;
  finalHullPct: number;
  maxOvermindShare: number;
  finalOvermindShare: number;
  galaxyFell: boolean; // Overmind share reached the loss threshold at any point
  daysElapsed: number;
}

const OVERMIND_LOSS_SHARE = 0.5; // GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE

const NO_PROGRESS = new Set(["wait", "attack"]);

function diagnose(s: SessionReport): SessionDiag {
  const t = s.transcript;
  const first = t[0]?.vitals;
  const finalV = t[t.length - 1]?.vitals;

  // longest consecutive no-progress run + wait fraction
  let longest = 0;
  let cur = 0;
  let waits = 0;
  for (const step of t) {
    if (NO_PROGRESS.has(step.action.kind)) {
      cur++;
      longest = Math.max(longest, cur);
      if (step.action.kind === "wait") waits++;
    } else cur = 0;
  }

  // heavy-damage proxy: any step-to-step hull drop > 50% of maxHull
  let heavy = false;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1].vitals;
    const b = t[i].vitals;
    if (a && b && a.maxHull > 0) {
      if ((a.hull - b.hull) / a.maxHull > 0.5) heavy = true;
    }
  }

  // low-hull stall: first step where hull<30%, then no scene TRANSITION that
  // escapes (scene stays the same / only flight+wait) through the rest.
  let lowHullStall = false;
  const lowIdx = t.findIndex(
    (st) =>
      st.vitals &&
      st.vitals.maxHull > 0 &&
      st.vitals.hull / st.vitals.maxHull < LOW_HULL,
  );
  if (lowIdx >= 0) {
    const after = t.slice(lowIdx);
    const scenesAfter = new Set(after.map((st) => st.scene));
    const anyWarp = after.some(
      (st) => st.action.kind === "warp" || st.action.kind === "flee",
    );
    // stalled if it never warped/fled AND stayed within a single flight-ish scene
    if (!anyWarp && scenesAfter.size <= 1) lowHullStall = true;
  }

  const warps = t.filter((st) => st.action.kind === "warp").length;
  const distinctScenes = new Set(t.map((st) => st.scene)).size;
  const finalHullPct =
    finalV && finalV.maxHull > 0 ? finalV.hull / finalV.maxHull : 1;

  const shares = s.samples.map((sm) => sm.overmindShare ?? 0);
  const maxOvermindShare = shares.length ? Math.max(...shares) : 0;
  const finalOvermindShare = shares.length ? shares[shares.length - 1] : 0;
  const daysElapsed = s.samples.length
    ? (s.samples[s.samples.length - 1].day ?? 0) - (s.samples[0].day ?? 0)
    : 0;

  return {
    index: s.index,
    seed: s.seed,
    endScene: s.endScene,
    died: s.endScene === SceneType.GAME_OVER || (finalV?.hull ?? 1) <= 0,
    stranded: s.violations.some((v) => v.invariant === "always-actionable"),
    errorCount: s.errors.length,
    longestWaitRun: longest,
    waitFraction: t.length ? waits / t.length : 0,
    lowHullStall,
    tookHeavyDamage: heavy,
    warps,
    distinctScenes,
    creditsDelta: (finalV?.credits ?? 0) - (first?.credits ?? 0),
    questsCompleted: finalV?.questsCompleted ?? 0,
    finalHullPct,
    maxOvermindShare,
    finalOvermindShare,
    galaxyFell: maxOvermindShare >= OVERMIND_LOSS_SHARE,
    daysElapsed,
  };
}

// Inert in the normal suite — only runs when DIAG_SESSIONS is set explicitly.
const RUN_DIAG = !!process.env.DIAG_SESSIONS;

describe("autopilot diagnostic (temp)", () => {
  it.runIf(RUN_DIAG)(
    `plays ${SESSIONS} autopilot sessions and reports problems`,
    async () => {
      const report = await runLetsplay({
        sessions: SESSIONS,
        steps: STEPS,
        seedPrefix: "DIAG",
      });
      const diags = report.sessions.map(diagnose);

      const n = diags.length;
      const pct = (k: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;
      const count = (f: (d: SessionDiag) => boolean) => diags.filter(f).length;

      const died = count((d) => d.died);
      const stranded = count((d) => d.stranded);
      const errored = count((d) => d.errorCount > 0);
      const lowHullStall = count((d) => d.lowHullStall);
      const bigWait = count((d) => d.longestWaitRun >= 10);
      const noProgress = count((d) => d.creditsDelta <= 0);
      const noQuests = count((d) => d.questsCompleted === 0);
      const heavyDmg = count((d) => d.tookHeavyDamage);
      const noWarp = count((d) => d.warps === 0);
      const galaxyFell = count((d) => d.galaxyFell);
      const avg = (f: (d: SessionDiag) => number) =>
        n ? diags.reduce((a, d) => a + f(d), 0) / n : 0;
      const avgMaxShare = avg((d) => d.maxOvermindShare);
      const avgFinalShare = avg((d) => d.finalOvermindShare);
      const avgDays = avg((d) => d.daysElapsed);

      const endSceneHist: Record<string, number> = {};
      for (const d of diags)
        endSceneHist[d.endScene] = (endSceneHist[d.endScene] ?? 0) + 1;

      const lines: string[] = [];
      lines.push(`# Autopilot diagnostic — ${n} sessions × ${STEPS} steps`);
      lines.push(`  policy: MemoryHeuristicPolicy (dev autopilot default)`);
      lines.push("");
      lines.push(`## Aggregate problems`);
      lines.push(`- died (GAME_OVER or hull 0):     ${pct(died)}`);
      lines.push(`- GALAXY FELL (Overmind >=50%):    ${pct(galaxyFell)}`);
      lines.push(`- STALLED at <30% hull (stuck):   ${pct(lowHullStall)}`);
      lines.push(`- stranded (only "wait" offered):  ${pct(stranded)}`);
      lines.push(`- long no-progress run (>=10):     ${pct(bigWait)}`);
      lines.push(`- took heavy combat damage (>50%): ${pct(heavyDmg)}`);
      lines.push(`- no credit gain over session:     ${pct(noProgress)}`);
      lines.push(`- 0 quests completed:              ${pct(noQuests)}`);
      lines.push(
        `- WANDERING (>=3 warps, 0 quests, Δcr<=0): ${pct(count((d) => d.warps >= 3 && d.questsCompleted === 0 && d.creditsDelta <= 0))}`,
      );
      lines.push(`- never warped:                    ${pct(noWarp)}`);
      lines.push(`- harness errors logged:           ${pct(errored)}`);
      lines.push("");
      lines.push(`## Averages`);
      lines.push(
        `- avg max Overmind share:   ${(100 * avgMaxShare).toFixed(1)}%`,
      );
      lines.push(
        `- avg final Overmind share: ${(100 * avgFinalShare).toFixed(1)}%`,
      );
      lines.push(`- avg game-days elapsed:    ${avgDays.toFixed(1)}`);
      lines.push(
        `- avg credits delta:        ${avg((d) => d.creditsDelta).toFixed(0)}`,
      );
      lines.push(
        `- avg quests completed:     ${avg((d) => d.questsCompleted).toFixed(2)}`,
      );
      lines.push(
        `- avg warps/session:        ${avg((d) => d.warps).toFixed(1)}`,
      );
      lines.push("");
      lines.push(`## End-scene distribution`);
      for (const [scene, c] of Object.entries(endSceneHist).sort(
        (a, b) => b[1] - a[1],
      ))
        lines.push(`- ${scene}: ${pct(c)}`);
      lines.push("");
      lines.push(`## Worst 15 sessions (died / stalled / stranded first)`);
      const rank = (d: SessionDiag) =>
        (d.died ? 8 : 0) +
        (d.lowHullStall ? 4 : 0) +
        (d.stranded ? 2 : 0) +
        (d.errorCount ? 1 : 0);
      const worst = [...diags].sort((a, b) => rank(b) - rank(a)).slice(0, 15);
      for (const d of worst) {
        const tags = [
          d.died && "DIED",
          d.lowHullStall && "LOW-HULL-STALL",
          d.stranded && "STRANDED",
          d.errorCount > 0 && `${d.errorCount}err`,
          d.tookHeavyDamage && "heavyDmg",
          `wait×${d.longestWaitRun}`,
          `hull=${Math.round(d.finalHullPct * 100)}%`,
          `Δcr=${d.creditsDelta}`,
          `warps=${d.warps}`,
          `end=${d.endScene}`,
        ]
          .filter(Boolean)
          .join(" ");
        lines.push(`- [${d.seed}] ${tags}`);
      }
      lines.push("");
      lines.push(
        `## Death tails (last 8 steps of died sessions) — action@hull%/fuel%`,
      );
      const deadReports = report.sessions.filter((s) => {
        const fv = s.transcript[s.transcript.length - 1]?.vitals;
        return s.endScene === SceneType.GAME_OVER || (fv?.hull ?? 1) <= 0;
      });
      for (const s of deadReports.slice(0, 12)) {
        const t = s.transcript;
        // Find the step with the biggest hull drop (the killing sequence start).
        let dropIdx = 0;
        let dropMax = 0;
        for (let i = 1; i < t.length; i++) {
          const a = t[i - 1].vitals;
          const b = t[i].vitals;
          if (a && b && a.maxHull > 0) {
            const d = (a.hull - b.hull) / a.maxHull;
            if (d > dropMax) {
              dropMax = d;
              dropIdx = i;
            }
          }
        }
        const win = t.slice(Math.max(0, dropIdx - 4), dropIdx + 3).map((st) => {
          const v = st.vitals;
          const h =
            v && v.maxHull > 0 ? Math.round((100 * v.hull) / v.maxHull) : "?";
          const f = v ? Math.round(v.fuel) : "?";
          const sc = String(st.scene).replace("Scene", "").slice(0, 5);
          return `${sc}:${st.action.kind}@${h}%f${f}`;
        });
        lines.push(
          `- [${s.seed}] drop@step${dropIdx} (-${Math.round(100 * dropMax)}%): ${win.join(" ")}`,
        );
      }
      lines.push("");
      lines.push(`## Sample harness errors`);
      const errs = report.failures
        .filter((f) => f.kind === "error")
        .slice(0, 20);
      if (errs.length === 0) lines.push(`  (none)`);
      for (const e of errs) lines.push(`- [s${e.session}] ${e.message}`);

      const text = lines.join("\n");
      const out =
        "/private/tmp/claude-501/-Users-olegsidorkin-SpaceRangers/5f51c285-7072-4b27-b80e-00c490793d84/scratchpad/autopilot-diag.txt";
      writeFileSync(out, text, "utf8");
      // eslint-disable-next-line no-console
      console.log("\n" + text + "\n\nWROTE: " + out);

      expect(n).toBe(SESSIONS);
    },
    600_000,
  );
});
