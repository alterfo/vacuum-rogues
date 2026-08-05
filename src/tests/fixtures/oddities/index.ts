import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneType } from "@/types";
import type {
  SessionSummary,
  SessionTranscript,
} from "../../playtest/letsplay/transcript";

export interface FixtureFrame {
  dataBase64: string;
  mediaType?: string;
  caption?: string;
  stepIndex?: number;
}

export interface FixtureExpectedBug {
  id: string;
  keywords: string[];
}

export interface VisualBugFixture {
  id: string;
  title: string;
  description: string;
  transcript: SessionTranscript;
  frames: FixtureFrame[];
  expected: FixtureExpectedBug;
  visualOnly: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));

function loadFrameBase64(name: string): string {
  const raw = readFileSync(join(HERE, "frames", `${name}.png.b64`), "utf8");
  return raw.replace(/\s+/g, "");
}

const ZERO_DELTA = {
  credits: 0,
  hull: 0,
  fuel: 0,
  cargo: 0,
  reputationMin: 0,
  killPoints: 0,
} as const;

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

export function loadVisualBugFixtures(): VisualBugFixture[] {
  return [QUEST_CARD_TEXT_OVERFLOW, SHIP_DEATH_NO_EXPLOSION];
}
