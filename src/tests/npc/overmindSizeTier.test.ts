import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import {
  NpcSimulator,
  ROLE_STATS,
  overmindSizeTierForId,
  npcsPresentInSystem,
} from "@/systems/npc/NpcSimulator";
import { OVERMIND_SIZE_TIERS, OVERMIND_BOSS_TIER } from "@/config/balance";
import { NpcShipSchema } from "@/validation/schemas";
import { SeededRNG } from "@/utils/seededRNG";
import { NpcRole, StarType, type NpcSizeTier } from "@/types";
import { Faction } from "@/types/faction";

function makeGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  return new Galaxy("galaxy_size_tier", [sysA], new Overmind(), [], []);
}

describe("Overmind sizeTier — stat scaling", () => {
  const base = ROLE_STATS[NpcRole.OVERMIND];

  function spawn(tier?: NpcSizeTier) {
    const sim = new NpcSimulator();
    return sim.spawnOvermindInSystem(
      new SeededRNG(`ov_tier_${tier ?? "none"}`),
      `ov_${tier ?? "none"}`,
      "sys_a",
      tier,
    );
  }

  it("a bigger tier spawns proportionally higher hull than the base", () => {
    const small = spawn("small");
    const medium = spawn("medium");
    const large = spawn("large");
    expect(small.maxHull).toBeLessThan(medium.maxHull);
    expect(large.maxHull).toBeGreaterThan(medium.maxHull);
    expect(small.maxHull).toBe(
      Math.round(base.hull * OVERMIND_SIZE_TIERS.small.statMult),
    );
    expect(large.maxHull).toBe(
      Math.round(base.hull * OVERMIND_SIZE_TIERS.large.statMult),
    );
  });

  it("damage is tier-flat below boss (the seeded campaign/siege gates red on garrison damage change)", () => {
    expect(spawn("small").damage).toBe(base.damage);
    expect(spawn("medium").damage).toBe(base.damage);
    expect(spawn("large").damage).toBe(base.damage);
  });

  it("medium tier and the tier-less default keep the exact Task 1 base stats", () => {
    for (const ship of [spawn("medium"), spawn(undefined)]) {
      expect(ship.maxHull).toBe(base.hull);
      expect(ship.hullHP).toBe(base.hull);
      expect(ship.damage).toBe(base.damage);
      expect(ship.sizeTier).toBe("medium");
    }
  });

  it("boss tier applies the fixed boss stats (the old ad-hoc 450/45 override)", () => {
    const boss = spawn("boss");
    expect(boss.sizeTier).toBe("boss");
    expect(boss.maxHull).toBe(OVERMIND_BOSS_TIER.hull);
    expect(boss.hullHP).toBe(OVERMIND_BOSS_TIER.hull);
    expect(boss.damage).toBe(OVERMIND_BOSS_TIER.damage);
    expect(OVERMIND_BOSS_TIER.hull).toBe(450);
    expect(OVERMIND_BOSS_TIER.damage).toBe(45);
  });

  it("the spawned tier is recorded on the ship (drives per-tier art)", () => {
    expect(spawn("small").sizeTier).toBe("small");
    expect(spawn("large").sizeTier).toBe("large");
  });
});

describe("overmindSizeTierForId — weighted garrison/capture-fleet tier", () => {
  it("yields only small/medium/large (never boss), small most common", () => {
    const counts: Record<string, number> = { small: 0, medium: 0, large: 0 };
    for (let i = 0; i < 2000; i++) {
      const tier = overmindSizeTierForId(`garrison_ov_sys_${i}_0_${i % 7}`);
      expect(["small", "medium", "large"]).toContain(tier);
      counts[tier]++;
    }
    expect(counts.small).toBeGreaterThan(counts.medium);
    expect(counts.medium).toBeGreaterThan(counts.large);
    expect(counts.large).toBeGreaterThan(0);
  });

  it("is deterministic per ship id (stable across ticks and reloads)", () => {
    expect(overmindSizeTierForId("garrison_ov_sys_a_1_0")).toBe(
      overmindSizeTierForId("garrison_ov_sys_a_1_0"),
    );
  });
});

describe("Overmind sizeTier — garrison spawns carry a rolled tier", () => {
  it("every garrison ship gets a small/medium/large tier with matching stats", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("garrison_tier_seed"));

    const present = npcsPresentInSystem(galaxy, "sys_a").filter(
      (n) => n.faction === Faction.OVERMIND,
    );
    expect(present.length).toBeGreaterThan(0);
    const base = ROLE_STATS[NpcRole.OVERMIND];
    for (const ship of present) {
      expect(["small", "medium", "large"]).toContain(ship.sizeTier);
      const mult =
        OVERMIND_SIZE_TIERS[ship.sizeTier as "small" | "medium" | "large"]
          .statMult;
      expect(ship.maxHull).toBe(Math.round(base.hull * mult));
      expect(ship.damage).toBe(base.damage);
    }
  });
});

describe("Overmind sizeTier — persistence", () => {
  it("round-trips through NpcShipSchema", () => {
    const sim = new NpcSimulator();
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG("ov_tier_persist"),
      "ov_persist",
      "sys_a",
      "large",
    );
    const raw = JSON.parse(JSON.stringify(ship)) as unknown;
    const parsed = NpcShipSchema.parse(raw);
    expect(parsed.sizeTier).toBe("large");
  });

  it("tolerates an old save with no sizeTier (additive/optional field)", () => {
    const sim = new NpcSimulator();
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG("ov_tier_legacy"),
      "ov_legacy",
      "sys_a",
    );
    const raw = JSON.parse(JSON.stringify(ship)) as Record<string, unknown>;
    delete raw.sizeTier;
    const parsed = NpcShipSchema.parse(raw);
    expect(parsed.sizeTier).toBeUndefined();
  });
});
