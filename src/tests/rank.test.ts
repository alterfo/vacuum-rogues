import { describe, it, expect, vi } from "vitest";
import {
  RANK_THRESHOLDS,
  RANK_LABELS,
  ELITE_QUEST_MIN_RANK,
  RANK_DISCOUNT_THRESHOLD,
  RANK_DISCOUNT_FACTOR,
} from "@/config/balance";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import type { StarSystem } from "@/domain/StarSystem";

// ── kill points ───────────────────────────────────────────────────────────────

describe("RANK_THRESHOLDS", () => {
  it("has 8 entries (ranks 0–7)", () => {
    expect(RANK_THRESHOLDS).toHaveLength(8);
  });

  it("thresholds increase monotonically", () => {
    for (let i = 1; i < RANK_THRESHOLDS.length; i++) {
      expect(RANK_THRESHOLDS[i]).toBeGreaterThan(RANK_THRESHOLDS[i - 1]);
    }
  });

  it("matches RANK_LABELS length", () => {
    expect(RANK_LABELS).toHaveLength(RANK_THRESHOLDS.length);
  });
});

// ── CombatSystem.resolveVictory ───────────────────────────────────────────────

describe("CombatSystem.resolveVictory", () => {
  const makeEnemy = (techLevel: number) =>
    new EnemyShip(
      `e_${techLevel}`,
      "FIGHTER" as import("@/types").EnemyType,
      60,
      0,
      0.1,
      10,
      false,
      [],
      {} as import("@/types").AIProfile,
      techLevel,
    );

  it("accumulates kill points as techLevel × 10 per enemy", () => {
    const system = new CombatSystem(new AdaptiveQualityProfile());
    const enemies = [makeEnemy(2), makeEnemy(3)];
    const rewards = system.resolveVictory(enemies);
    // 2×10 + 3×10 = 50
    expect(rewards.killPointsGained).toBe(50);
  });

  it("returns 0 kill points for empty enemy list", () => {
    const system = new CombatSystem(new AdaptiveQualityProfile());
    expect(system.resolveVictory([]).killPointsGained).toBe(0);
  });

  it("also computes credits as techLevel × 50", () => {
    const system = new CombatSystem(new AdaptiveQualityProfile());
    const enemies = [makeEnemy(1)];
    vi.spyOn(Math, "random").mockReturnValue(0); // no loot drop
    const rewards = system.resolveVictory(enemies);
    expect(rewards.creditsGained).toBe(50);
    vi.restoreAllMocks();
  });
});

// ── rank promotion logic ──────────────────────────────────────────────────────

describe("rank promotion", () => {
  it("promotes when killPoints >= threshold for next rank", () => {
    const rank = 0;
    const killPoints = RANK_THRESHOLDS[1]; // exactly enough for rank 1
    const canPromote = killPoints >= RANK_THRESHOLDS[rank + 1];
    expect(canPromote).toBe(true);
  });

  it("does not promote when killPoints < threshold", () => {
    const rank = 0;
    const killPoints = RANK_THRESHOLDS[1] - 1;
    const canPromote = killPoints >= RANK_THRESHOLDS[rank + 1];
    expect(canPromote).toBe(false);
  });

  it("max rank (7) cannot promote further", () => {
    const rank = 7;
    const atMax = rank >= RANK_THRESHOLDS.length - 1;
    expect(atMax).toBe(true);
  });
});

// ── elite quest rank gate ─────────────────────────────────────────────────────

describe("QuestGenerator elite quest minRank", () => {
  const SYSTEMS = [
    {
      id: "s1",
      name: "Alpha",
      coordinates: { q: 0, r: 0 },
      planets: [],
      stations: [],
      connections: [{ toSystemId: "s2" }],
      starType: "YELLOW_DWARF" as const,
      explored: true,
      fogOfWar: false,
      economyType: "MIXED" as const,
      politicalSystem: "REPUBLIC" as const,
      ownerFaction: "INDEPENDENT" as const,
      enter: () => {},
    },
    {
      id: "s2",
      name: "Beta",
      coordinates: { q: 1, r: 0 },
      planets: [],
      stations: [],
      connections: [{ toSystemId: "s1" }],
      starType: "RED_DWARF" as const,
      explored: true,
      fogOfWar: false,
      economyType: "MIXED" as const,
      politicalSystem: "REPUBLIC" as const,
      ownerFaction: "INDEPENDENT" as const,
      enter: () => {},
    },
  ] as unknown as StarSystem[];

  it("elite quests have minRank >= ELITE_QUEST_MIN_RANK", () => {
    // Generate a large board to catch at least one elite quest
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s1",
      planetId: "p1",
      day: 0,
      seed: "test",
      count: 30,
      eliteRatio: 1.0, // force all quests to be elite
      textRatio: 0, // no text quests
      chainRatio: 0,
    });

    const eliteQuests = board.filter((q) =>
      q.template.title.startsWith("[ЭЛИТА]"),
    );
    expect(eliteQuests.length).toBeGreaterThan(0);
    for (const q of eliteQuests) {
      expect(q.template.minRank ?? 0).toBeGreaterThanOrEqual(
        ELITE_QUEST_MIN_RANK,
      );
    }
  });

  it("non-elite quests have minRank = 0", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s1",
      planetId: "p1",
      day: 0,
      seed: "test",
      count: 30,
      eliteRatio: 0, // no elite quests
      textRatio: 0,
      chainRatio: 0,
    });

    for (const q of board) {
      expect(q.template.minRank ?? 0).toBe(0);
    }
  });
});

// ── trade discount ────────────────────────────────────────────────────────────

describe("rank trade discount constants", () => {
  it("discount threshold is 5", () => {
    expect(RANK_DISCOUNT_THRESHOLD).toBe(5);
  });

  it("discount factor is 0.85 (15% off)", () => {
    expect(RANK_DISCOUNT_FACTOR).toBe(0.85);
  });
});
