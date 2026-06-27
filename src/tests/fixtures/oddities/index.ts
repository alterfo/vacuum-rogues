/**
 * Pre-fix oddity fixtures for the **vision** judge self-test (dev-only test data).
 *
 * Task 6 of `docs/plans/20260627-llm-oddity-judge-and-scenario-generator.md` asks
 * the vision judge to reproduce two *known shipped* VISUAL bugs:
 *
 *  1. {@link QUEST_CARD_TEXT_OVERFLOW} — a quest card whose description text spills
 *     past the card bounds.
 *  2. {@link SHIP_DEATH_NO_EXPLOSION} — an NPC ship is destroyed (the transcript /
 *     combat log says so) but the frame shows no explosion / death effect.
 *
 * Both are **purely visual**: the {@link SessionTranscript} alone (what the Task
 * 1–3 *text* judge sees) cannot reveal them — the overflow is a layout fact and
 * the missing explosion is the *absence* of a sprite. That asymmetry is exactly
 * what the vision path validates: the same transcript yields nothing from the text
 * judge, but the attached **frame** lets the vision judge flag the bug.
 *
 * Each fixture carries the textual context at capture time + the captured frame +
 * the {@link ExpectedVisualBug} oracle the judge must satisfy.
 *
 * **The committed frames are PLACEHOLDERS** (small solid-colour PNGs) so the test
 * is deterministic and self-contained without binary screenshots in the repo — the
 * deterministic test drives a fake LLM verdict, so frame *pixels* don't affect it.
 * To run the **live** vision call against the real bug, replace the matching
 * `frames/<id>.png.b64` with a base64 of a real pre-fix screenshot (see README.md).
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneType } from "@/types";
import type {
  SessionSummary,
  SessionTranscript,
} from "../../playtest/letsplay/transcript";

/**
 * A captured frame — structurally the vision judge's `OddityFrame`
 * (`tools/ai/visionJudge`). It is declared **locally** rather than imported
 * because `tools/` lives outside the `src` tsc `rootDir`, so a `src/` file may not
 * import it (it would break `tsc`/`npm run build`). The shapes are reconciled
 * where it matters: `visionJudge.test.ts` passes these fixtures straight into
 * `judgeFrames`/`detectKnownBugs`, so a structural divergence surfaces there.
 */
export interface FixtureFrame {
  /** Base64-encoded image bytes (no `data:` prefix, no newlines). */
  dataBase64: string;
  /** The image MIME type (defaults to `"image/png"` in the judge). */
  mediaType?: string;
  /** A human caption tying the frame to the run. */
  caption?: string;
  /** The transcript step index this frame was captured at, when known. */
  stepIndex?: number;
}

/** The vision judge's `ExpectedVisualBug` oracle, declared locally (see {@link FixtureFrame}). */
export interface FixtureExpectedBug {
  /** Stable id (matches the fixture id). */
  id: string;
  /** All keywords a flagging finding must mention (AND-matched, lowercased). */
  keywords: string[];
}

/** A captured pre-fix bug: its textual context, the frame, and the judge oracle. */
export interface VisualBugFixture {
  /** Stable id (also the frame filename stem + the {@link FixtureExpectedBug} id). */
  id: string;
  /** Short human title for the bug. */
  title: string;
  /** What the bug is and why the text judge cannot see it. */
  description: string;
  /** The textual context at capture time (what the *text* judge would read). */
  transcript: SessionTranscript;
  /** The captured frame(s), pre-fix, showing the bug. */
  frames: FixtureFrame[];
  /** The oracle the vision judge must satisfy to count as having caught the bug. */
  expected: FixtureExpectedBug;
  /** `true` ⇔ a purely VISUAL bug the text judge provably cannot catch. */
  visualOnly: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Read a committed `frames/<name>.png.b64` fixture frame (base64, whitespace-stripped). */
function loadFrameBase64(name: string): string {
  const raw = readFileSync(join(HERE, "frames", `${name}.png.b64`), "utf8");
  return raw.replace(/\s+/g, "");
}

/** A zero vitals-delta — the fixtures only need the few fields the bug touches. */
const ZERO_DELTA = {
  credits: 0,
  hull: 0,
  fuel: 0,
  cargo: 0,
  reputationMin: 0,
  killPoints: 0,
} as const;

/** Build a {@link SessionSummary} from a few overrides, defaulting the rest. */
function summary(over: Partial<SessionSummary>): SessionSummary {
  return {
    steps: 1,
    daysElapsed: 0,
    endScene: SceneType.SPACE_FLIGHT,
    survived: true,
    deaths: 0,
    creditsCurve: [1000],
    reputationCurve: [0],
    netCredits: 0,
    killPointsGained: 0,
    questsTaken: 0,
    questsCompleted: 0,
    totalErrors: 0,
    ...over,
  };
}

/**
 * Quest card text overflow — the quest board renders a long contract description
 * that runs past the card's bounds. The transcript shows the agent accepting the
 * quest at a station; nothing in the text says the card overflowed.
 */
export const QUEST_CARD_TEXT_OVERFLOW: VisualBugFixture = {
  id: "questCardTextOverflow",
  title: "Quest card text overflow",
  description:
    "A quest card's description text overflows its container on the station " +
    "quest board. Purely a layout fact — the transcript records the quest was " +
    "taken, but text overflow is invisible to a text-only judge.",
  transcript: {
    seed: "FIXTURE-QUEST-OVERFLOW",
    policy: "fixture",
    summary: summary({
      steps: 2,
      endScene: SceneType.STATION,
      questsTaken: 1,
    }),
    steps: [
      {
        index: 0,
        day: 1,
        scene: SceneType.SPACE_FLIGHT,
        action: { kind: "dock", targetId: "station-1" },
        vitalsDelta: { ...ZERO_DELTA },
        notableLogs: [],
      },
      {
        index: 1,
        day: 1,
        scene: SceneType.STATION,
        action: { kind: "take-quest", targetId: "quest-deliver-meds" },
        vitalsDelta: { ...ZERO_DELTA },
        notableLogs: ["[quest] accepted: Deliver medical supplies"],
      },
    ],
  },
  frames: [
    {
      dataBase64: loadFrameBase64("questCardTextOverflow"),
      mediaType: "image/png",
      caption: "step 1 — station quest board, a quest card selected",
      stepIndex: 1,
    },
  ],
  expected: { id: "questCardTextOverflow", keywords: ["quest", "overflow"] },
  visualOnly: true,
};

/**
 * Missing ship-death explosion — an NPC ship is destroyed (killPoints rose, the
 * combat log says "destroyed") but the frame shows the ship gone with no
 * explosion / death VFX. The *absence* of a sprite cannot appear in a transcript.
 */
export const SHIP_DEATH_NO_EXPLOSION: VisualBugFixture = {
  id: "shipDeathNoExplosion",
  title: "Missing ship-death explosion",
  description:
    "An NPC ship is destroyed in combat (the log + killPoints confirm it) but " +
    "no explosion / death effect is drawn. The missing VFX is the absence of a " +
    "sprite — invisible to a text-only judge that only sees the kill log.",
  transcript: {
    seed: "FIXTURE-NO-EXPLOSION",
    policy: "fixture",
    summary: summary({
      steps: 1,
      killPointsGained: 1,
    }),
    steps: [
      {
        index: 0,
        day: 2,
        scene: SceneType.SPACE_FLIGHT,
        action: { kind: "attack", targetId: "pirate-3" },
        vitalsDelta: { ...ZERO_DELTA, hull: -8, killPoints: 1 },
        notableLogs: ["[combat] pirate-3 destroyed"],
      },
    ],
  },
  frames: [
    {
      dataBase64: loadFrameBase64("shipDeathNoExplosion"),
      mediaType: "image/png",
      caption: "the frame at the moment pirate-3 was destroyed",
      stepIndex: 0,
    },
  ],
  expected: { id: "shipDeathNoExplosion", keywords: ["explosion"] },
  visualOnly: true,
};

/** Every known visual-bug fixture, in a stable order. */
export function loadVisualBugFixtures(): VisualBugFixture[] {
  return [QUEST_CARD_TEXT_OVERFLOW, SHIP_DEATH_NO_EXPLOSION];
}
