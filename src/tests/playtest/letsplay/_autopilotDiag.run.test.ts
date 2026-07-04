/**
 * TEMP diagnostic — NOT a committed test. Runs the autopilot brain
 * (MemoryHeuristicPolicy) across many fresh games headlessly and categorizes
 * behavioral problems, with a focus on the land↔take-off oscillation the user
 * reported live. Inert unless DIAG_SESSIONS is set. Delete after use.
 *
 * Run: DIAG_SESSIONS=100 DIAG_STEPS=60 npx vitest --run \
 *   src/tests/playtest/letsplay/_autopilotDiag.run.test.ts
 */
import { writeFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import { runLetsplay, type SessionReport } from "./letsplay.run";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const SESSIONS = Number(process.env.DIAG_SESSIONS ?? 100);
const STEPS = Number(process.env.DIAG_STEPS ?? 60);
const OVERMIND_LOSS_SHARE = 0.85;

interface Diag {
  seed: string;
  endScene: SceneType;
  died: boolean;
  creditsDelta: number;
  questsCompleted: number;
  galaxyFell: boolean;
  overmindWon: boolean;
  finalShare: number;
  hadPresence: boolean;
  // land↔take-off oscillation: PLANET→(SPACE_FLIGHT)→PLANET transitions
  landTakeoffCycles: number;
  pureMoveReland: number;
  earnLandActions: number;
  landActions: number;
  moveActions: number;
  tradeActions: number;
  distinctScenes: number;
  longestSceneRepeat: number; // longest run alternating within {PLANET,SPACE_FLIGHT}
}

function diagnose(s: SessionReport): Diag {
  const t = s.transcript;
  const first = t[0]?.vitals;
  const finalV = t[t.length - 1]?.vitals;

  // Count PLANET→...→PLANET returns (land, leave, land again = a cycle).
  let landTakeoffCycles = 0;
  let lastPlanetIdx = -Infinity;
  const sceneSeq = t.map((st) => st.scene);
  for (let i = 0; i < sceneSeq.length; i++) {
    if (sceneSeq[i] === SceneType.PLANET) {
      if (i - lastPlanetIdx <= 4) landTakeoffCycles++;
      lastPlanetIdx = i;
    }
  }

  // DEBUG-ONLY (not part of the committed gate): the literal "сел-взлетел"
  // symptom — a PLANET re-entry whose ENTIRE gap since the last PLANET
  // occurrence was pure `move` (no `trade`/`take-quest` in between), i.e. a
  // genuine no-op land→take-off→land loop rather than an active multi-trade
  // stay. Kept separate from `landTakeoffCycles` (which also counts a busy
  // trading stay bouncing PLANET↔TRADE) to isolate whether the warp-reject
  // counter actually kills the reported bug.
  let pureMoveReland = 0;
  let lastPlanetIdx2 = -Infinity;
  for (let i = 0; i < sceneSeq.length; i++) {
    if (sceneSeq[i] === SceneType.PLANET) {
      if (i - lastPlanetIdx2 <= 4 && i - lastPlanetIdx2 > 1) {
        const between = t.slice(lastPlanetIdx2 + 1, i);
        if (between.every((st) => st.action.kind === "move")) pureMoveReland++;
      }
      lastPlanetIdx2 = i;
    }
  }

  // Longest consecutive run where every scene is PLANET or SPACE_FLIGHT (the
  // oscillation window) — a big number means "stuck bouncing planet↔flight".
  let longest = 0;
  let cur = 0;
  for (const sc of sceneSeq) {
    if (sc === SceneType.PLANET || sc === SceneType.SPACE_FLIGHT) {
      cur++;
      longest = Math.max(longest, cur);
    } else cur = 0;
  }

  const shares = s.samples.map((sm) => sm.overmindShare ?? 0);
  const maxShare = shares.length ? Math.max(...shares) : 0;
  const finalShare = shares.length ? shares[shares.length - 1] : 0;
  const hadPresence = shares.some((v) => v > 0);
  // Win proxy: the Overmind had a presence and it was driven to zero share.
  const overmindWon = hadPresence && (shares[shares.length - 1] ?? 1) === 0;

  return {
    seed: s.seed,
    endScene: s.endScene,
    died: s.endScene === SceneType.GAME_OVER || (finalV?.hull ?? 1) <= 0,
    creditsDelta: (finalV?.credits ?? 0) - (first?.credits ?? 0),
    questsCompleted: finalV?.questsCompleted ?? 0,
    galaxyFell: maxShare >= OVERMIND_LOSS_SHARE,
    overmindWon,
    finalShare,
    hadPresence,
    landTakeoffCycles,
    pureMoveReland,
    earnLandActions: t.filter((st) => st.action.reason === "mem:earn").length,
    landActions: t.filter((st) => st.action.kind === "land").length,
    moveActions: t.filter((st) => st.action.kind === "move").length,
    tradeActions: t.filter((st) => st.action.kind === "trade").length,
    distinctScenes: new Set(sceneSeq).size,
    longestSceneRepeat: longest,
  };
}

describe("autopilot diagnostic (temp)", () => {
  const RUN = !!process.env.DIAG_SESSIONS;
  it.runIf(RUN)(
    `plays ${SESSIONS} autopilot sessions and reports problems`,
    async () => {
      const report = await runLetsplay({
        sessions: SESSIONS,
        steps: STEPS,
        seedPrefix: "DIAG",
      });
      const d = report.sessions.map(diagnose);
      const n = d.length;
      const pct = (k: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;
      const cnt = (f: (x: Diag) => boolean) => d.filter(f).length;
      const avg = (f: (x: Diag) => number) =>
        n ? (d.reduce((a, x) => a + f(x), 0) / n).toFixed(2) : "0";

      const hist: Record<string, number> = {};
      for (const x of d) hist[x.endScene] = (hist[x.endScene] ?? 0) + 1;

      const L: string[] = [];
      L.push(`# Autopilot diagnostic — ${n} sessions × ${STEPS} steps`);
      L.push(`## Overmind outcome`);
      L.push(`- WON (share driven to 0):  ${pct(cnt((x) => x.overmindWon))}`);
      L.push(`- galaxy fell (>=85%):      ${pct(cnt((x) => x.galaxyFell))}`);
      L.push(`- had Overmind presence:    ${pct(cnt((x) => x.hadPresence))}`);
      L.push(`- avg final Overmind share: ${avg((x) => x.finalShare)}`);
      L.push(`## Health`);
      L.push(`- died:                     ${pct(cnt((x) => x.died))}`);
      L.push(
        `- no credit gain:           ${pct(cnt((x) => x.creditsDelta <= 0))}`,
      );
      L.push(
        `- 0 quests:                 ${pct(cnt((x) => x.questsCompleted === 0))}`,
      );
      L.push(
        `- harness errors:           ${pct(cnt((x) => report.sessions.find((s) => s.seed === x.seed)!.errors.length > 0))}`,
      );
      L.push(`## Land↔take-off oscillation`);
      L.push(
        `- >=3 land/take-off cycles: ${pct(cnt((x) => x.landTakeoffCycles >= 3))}`,
      );
      L.push(
        `- >=6 land/take-off cycles: ${pct(cnt((x) => x.landTakeoffCycles >= 6))}`,
      );
      L.push(
        `- stuck in PLANET/FLIGHT run >=20: ${pct(cnt((x) => x.longestSceneRepeat >= 20))}`,
      );
      L.push(
        `- only 1-2 distinct scenes: ${pct(cnt((x) => x.distinctScenes <= 2))}`,
      );
      L.push(`## Averages`);
      L.push(`- avg credits delta:  ${avg((x) => x.creditsDelta)}`);
      L.push(`- avg quests:         ${avg((x) => x.questsCompleted)}`);
      L.push(`- avg land actions:   ${avg((x) => x.landActions)}`);
      L.push(`- avg move actions:   ${avg((x) => x.moveActions)}`);
      L.push(`- avg trade actions:  ${avg((x) => x.tradeActions)}`);
      L.push(`- avg land/take-off cycles: ${avg((x) => x.landTakeoffCycles)}`);
      L.push(`- avg pure-move re-lands:   ${avg((x) => x.pureMoveReland)}`);
      L.push(`- avg earn-land actions:    ${avg((x) => x.earnLandActions)}`);
      L.push(`## End-scene distribution`);
      for (const [sc, c] of Object.entries(hist).sort((a, b) => b[1] - a[1]))
        L.push(`- ${sc}: ${pct(c)}`);
      L.push(`## Worst 12 by oscillation`);
      for (const x of [...d]
        .sort((a, b) => b.landTakeoffCycles - a.landTakeoffCycles)
        .slice(0, 12))
        L.push(
          `- [${x.seed}] cycles=${x.landTakeoffCycles} land=${x.landActions} move=${x.moveActions} trade=${x.tradeActions} scenes=${x.distinctScenes} end=${x.endScene} Δcr=${x.creditsDelta} q=${x.questsCompleted}`,
        );

      // Decision trace of the worst oscillator — see WHY it re-lands.
      const worst = [...d].sort(
        (a, b) => b.landTakeoffCycles - a.landTakeoffCycles,
      )[0];
      const worstSession = report.sessions.find((s) => s.seed === worst.seed)!;
      L.push(`## Worst oscillator trace [${worst.seed}] (scene:action:reason)`);
      for (const st of worstSession.transcript.slice(0, 30)) {
        const sc = String(st.scene).replace("Scene", "").slice(0, 6);
        L.push(`  ${sc}:${st.action.kind}:${st.action.reason ?? ""}`);
      }

      const text = L.join("\n");
      const out =
        "/Users/olegsidorkin/.claude/jobs/d14e4528/tmp/autopilot-diag.txt";
      try {
        writeFileSync(out, text, "utf8");
      } catch {
        /* scratch dir may not exist in all envs */
      }
      // eslint-disable-next-line no-console
      console.log("\n" + text + "\n");
      expect(n).toBe(SESSIONS);
    },
    600_000,
  );
});
