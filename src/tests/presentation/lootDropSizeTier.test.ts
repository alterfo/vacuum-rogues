import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { LootDropHandler } from "@/presentation/flight/LootDropHandler";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType, type NpcSizeTier } from "@/types";
import { Faction } from "@/types/faction";
import { ARTIFACT_DROP_CHANCE, OVERMIND_ARTIFACT_DROP } from "@/config/balance";

function makeNpc(
  id: string,
  opts: {
    faction?: Faction;
    loadout?: string[];
    sizeTier?: NpcSizeTier;
  } = {},
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.faction === Faction.OVERMIND ? NpcRole.OVERMIND : NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
    loadoutSummary: opts.loadout ?? [],
    sizeTier: opts.sizeTier,
  });
}

/** Deterministic RNG cycling through a fixed sequence of [0,1) values. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeHandler(): LootDropHandler {
  return new LootDropHandler(new Container());
}

function artifactCount(handler: LootDropHandler): number {
  return handler.spaceLoot.filter((l) => l.artifactId).length;
}

describe("LootDropHandler — size-tier-scaled artifact drops", () => {
  describe("balance table shape", () => {
    it("covers every size tier and scales monotonically small → boss", () => {
      const tiers: NpcSizeTier[] = ["small", "medium", "large", "boss"];
      for (const tier of tiers) {
        expect(OVERMIND_ARTIFACT_DROP[tier]).toBeDefined();
      }
      const chance = (t: NpcSizeTier) =>
        OVERMIND_ARTIFACT_DROP[t].artifactChanceMult;
      expect(chance("small")).toBe(1); // small = today's flat baseline, unchanged
      expect(chance("medium")).toBeGreaterThanOrEqual(chance("small"));
      expect(chance("large")).toBeGreaterThan(chance("medium"));
      expect(chance("boss")).toBeGreaterThan(chance("large"));
      const rolls = (t: NpcSizeTier) =>
        OVERMIND_ARTIFACT_DROP[t].bonusLootRolls;
      expect(rolls("small")).toBe(0);
      expect(rolls("boss")).toBeGreaterThan(rolls("small"));
      // Boss must GUARANTEE an artifact: capped chance 1.0 + at least one
      // guaranteed loot roll even when the count roll comes up 0.
      expect(
        Math.min(1, ARTIFACT_DROP_CHANCE * chance("boss")),
      ).toBeGreaterThanOrEqual(1);
      expect(rolls("boss")).toBeGreaterThanOrEqual(1);
    });
  });

  describe("boss tier", () => {
    it("guarantees at least one artifact even on the worst count roll", () => {
      const handler = makeHandler();
      // count roll 0.1 → base count 0; boss bonus rolls still produce items,
      // and the capped 1.0 artifact chance makes every one an artifact.
      handler.spawn(
        makeNpc("boss", { faction: Faction.OVERMIND, sizeTier: "boss" }),
        0,
        0,
        seqRng([0.1, 0.999]),
      );
      expect(artifactCount(handler)).toBeGreaterThanOrEqual(1);
      handler.destroy();
    });
  });

  describe("large vs small", () => {
    it("large tier converts a roll that small would miss into an artifact", () => {
      // Artifact roll 0.4: small misses (0.4 >= 0.25 flat), large hits
      // (0.4 < 0.25 × its >1 multiplier).
      const largeChance = Math.min(
        1,
        ARTIFACT_DROP_CHANCE * OVERMIND_ARTIFACT_DROP.large.artifactChanceMult,
      );
      expect(0.4).toBeGreaterThanOrEqual(ARTIFACT_DROP_CHANCE);
      expect(0.4).toBeLessThan(largeChance);

      const small = makeHandler();
      small.spawn(
        makeNpc("s", { faction: Faction.OVERMIND, sizeTier: "small" }),
        0,
        0,
        seqRng([0.5, 0.4]),
      );
      expect(small.spaceLoot.length).toBe(1);
      expect(artifactCount(small)).toBe(0);
      small.destroy();

      const large = makeHandler();
      large.spawn(
        makeNpc("l", { faction: Faction.OVERMIND, sizeTier: "large" }),
        0,
        0,
        seqRng([0.5, 0.4]),
      );
      expect(artifactCount(large)).toBeGreaterThanOrEqual(1);
      large.destroy();
    });

    it("large tier rolls more loot items than small on the same count roll", () => {
      const small = makeHandler();
      small.spawn(
        makeNpc("s", { faction: Faction.OVERMIND, sizeTier: "small" }),
        0,
        0,
        seqRng([0.5, 0.9]),
      );
      const large = makeHandler();
      large.spawn(
        makeNpc("l", { faction: Faction.OVERMIND, sizeTier: "large" }),
        0,
        0,
        seqRng([0.5, 0.9]),
      );
      expect(large.spaceLoot.length).toBeGreaterThan(small.spaceLoot.length);
      small.destroy();
      large.destroy();
    });
  });

  describe("small tier — unchanged flat odds", () => {
    it("hits exactly at the flat ARTIFACT_DROP_CHANCE boundary", () => {
      // Just below the flat chance → artifact.
      const hit = makeHandler();
      hit.spawn(
        makeNpc("s1", { faction: Faction.OVERMIND, sizeTier: "small" }),
        0,
        0,
        seqRng([0.5, ARTIFACT_DROP_CHANCE - 0.001]),
      );
      expect(hit.spaceLoot.length).toBe(1);
      expect(artifactCount(hit)).toBe(1);
      hit.destroy();

      // Exactly at the flat chance → miss (module instead), same as today.
      const miss = makeHandler();
      miss.spawn(
        makeNpc("s2", { faction: Faction.OVERMIND, sizeTier: "small" }),
        0,
        0,
        seqRng([0.5, ARTIFACT_DROP_CHANCE]),
      );
      expect(miss.spaceLoot.length).toBe(1);
      expect(artifactCount(miss)).toBe(0);
      expect(miss.spaceLoot[0].moduleId).toBeDefined();
      miss.destroy();
    });

    it("gets no bonus loot rolls (count 0 on a low roll)", () => {
      const handler = makeHandler();
      handler.spawn(
        makeNpc("s", { faction: Faction.OVERMIND, sizeTier: "small" }),
        0,
        0,
        seqRng([0.1]),
      );
      expect(handler.spaceLoot.length).toBe(0);
      handler.destroy();
    });
  });

  describe("tier-less Overmind ship (old save) — exact current behavior", () => {
    it("uses the flat chance and no bonus rolls when sizeTier is absent", () => {
      const handler = makeHandler();
      handler.spawn(
        makeNpc("ov", { faction: Faction.OVERMIND }),
        0,
        0,
        seqRng([0.5, ARTIFACT_DROP_CHANCE]),
      );
      expect(handler.spaceLoot.length).toBe(1);
      expect(artifactCount(handler)).toBe(0);
      handler.destroy();

      const none = makeHandler();
      none.spawn(
        makeNpc("ov2", { faction: Faction.OVERMIND }),
        0,
        0,
        seqRng([0.1]),
      );
      expect(none.spaceLoot.length).toBe(0);
      none.destroy();
    });
  });

  describe("non-Overmind ships — completely unaffected", () => {
    it("ignores sizeTier: no artifacts, no bonus rolls even at boss tier", () => {
      const handler = makeHandler();
      handler.spawn(
        makeNpc("t", { sizeTier: "boss", loadout: ["shield_mk2"] }),
        0,
        0,
        seqRng([0.5, 0.001]),
      );
      expect(handler.spaceLoot.length).toBe(1);
      expect(artifactCount(handler)).toBe(0);
      expect(handler.spaceLoot[0].moduleId).toBeDefined();
      handler.destroy();

      const none = makeHandler();
      none.spawn(makeNpc("t2", { sizeTier: "boss" }), 0, 0, seqRng([0.1]));
      expect(none.spaceLoot.length).toBe(0);
      none.destroy();
    });
  });
});
