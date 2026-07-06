/**
 * Task 2 (three-year-campaign): `playerPowerIndex` — the adaptive-difficulty
 * input. A pure, deterministic function of (maxHull, weaponDamage, credits,
 * rank) normalized into [0,1] with all levers in `src/config/balance.ts`, plus
 * the peak-power ratchet (`campaignPeakPower`) persisted as an OPTIONAL
 * additive save field (no migration, no version bump).
 */
import { describe, it, expect } from "vitest";
import {
  playerPowerIndex,
  powerIndexFromLoadout,
  ratchetPeakPower,
  restoredPeakPower,
} from "@/systems/campaign/playerPower";
import {
  POWER_INDEX_BATTLE_READY_THRESHOLD,
  POWER_INDEX_RANK_MAX,
} from "@/config/balance";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { validateSaveState } from "@/validation/schemas";
import { MigrationPipeline } from "@/data/MigrationPipeline";

/** Starter ship per the campaign plan: hull 130 / weapon 14 / 1000 cr / rank 1. */
const STARTER = { maxHull: 130, weaponDamage: 14, credits: 1000, rank: 1 };

/** Battle-ready floor per the autopilot signal: hull ≥ 200, weapon ≥ 30. */
const BATTLE_READY = { maxHull: 200, weaponDamage: 30, credits: 1000, rank: 1 };

describe("playerPowerIndex — bounded, anchored, monotone, pure", () => {
  it("stays within [0,1] at the extremes", () => {
    expect(
      playerPowerIndex({ maxHull: 0, weaponDamage: 0, credits: 0, rank: 0 }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      playerPowerIndex({ maxHull: 0, weaponDamage: 0, credits: 0, rank: 0 }),
    ).toBeLessThanOrEqual(1);
    const apex = playerPowerIndex({
      maxHull: 1e9,
      weaponDamage: 1e9,
      credits: 1e12,
      rank: 99,
    });
    expect(apex).toBeGreaterThanOrEqual(0);
    expect(apex).toBeLessThanOrEqual(1);
    // Fully maxed components saturate to exactly 1 (weights sum to 1).
    expect(apex).toBe(1);
  });

  it("negative/garbage inputs clamp to the floor instead of leaking out of range", () => {
    const idx = playerPowerIndex({
      maxHull: -50,
      weaponDamage: -10,
      credits: -99999,
      rank: -3,
    });
    expect(idx).toBe(0);
  });

  it("starter ship (hull 130 / weapon 14 / 1000 cr / rank 1) ≈ 0", () => {
    const idx = playerPowerIndex(STARTER);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(0.05);
  });

  it("battle-ready (hull ≥ 200, weapon ≥ 30) crosses the defined threshold; starter does not", () => {
    expect(playerPowerIndex(BATTLE_READY)).toBeGreaterThanOrEqual(
      POWER_INDEX_BATTLE_READY_THRESHOLD,
    );
    expect(playerPowerIndex(STARTER)).toBeLessThan(
      POWER_INDEX_BATTLE_READY_THRESHOLD,
    );
  });

  it("is monotone non-decreasing in each component", () => {
    const base = { maxHull: 180, weaponDamage: 25, credits: 5000, rank: 2 };
    const sweeps: Array<keyof typeof base> = [
      "maxHull",
      "weaponDamage",
      "credits",
      "rank",
    ];
    for (const key of sweeps) {
      let prev = -Infinity;
      for (const v of [0, 50, 130, 200, 360, 1000, 100000]) {
        const idx = playerPowerIndex({ ...base, [key]: v });
        expect(idx).toBeGreaterThanOrEqual(prev);
        prev = idx;
      }
    }
  });

  it("rank saturates at POWER_INDEX_RANK_MAX (no bonus beyond the ladder)", () => {
    const base = { maxHull: 180, weaponDamage: 25, credits: 5000 };
    expect(playerPowerIndex({ ...base, rank: POWER_INDEX_RANK_MAX + 5 })).toBe(
      playerPowerIndex({ ...base, rank: POWER_INDEX_RANK_MAX }),
    );
  });

  it("is pure and deterministic (same inputs ⇒ same output, input not mutated)", () => {
    const input = { ...BATTLE_READY };
    const a = playerPowerIndex(input);
    const b = playerPowerIndex(input);
    expect(a).toBe(b);
    expect(input).toEqual(BATTLE_READY);
  });
});

describe("powerIndexFromLoadout — reads the canonical GearCatalog stats", () => {
  it("matches playerPowerIndex over the loadout's derivedStats (starter corvette)", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_engine_i");
    loadout.install("eq_tank");
    loadout.install("wpn_pulse");
    const ds = loadout.derivedStats();
    expect(powerIndexFromLoadout(loadout, 1000, 1)).toBe(
      playerPowerIndex({
        maxHull: ds.maxHull,
        weaponDamage: ds.weaponDamage,
        credits: 1000,
        rank: 1,
      }),
    );
  });

  it("a heavier hull + weapon strictly raises the index at equal credits/rank", () => {
    const starter = new ShipLoadout("hull_corvette");
    starter.install("wpn_pulse");
    const warship = new ShipLoadout("hull_bastion");
    warship.install("wpn_torpedo");
    expect(powerIndexFromLoadout(warship, 1000, 1)).toBeGreaterThan(
      powerIndexFromLoadout(starter, 1000, 1),
    );
  });
});

describe("ratchetPeakPower — effective difficulty never decreases", () => {
  it("seeds from the current index when no peak exists yet", () => {
    expect(ratchetPeakPower(undefined, 0.3)).toBe(0.3);
    expect(ratchetPeakPower(null, 0.3)).toBe(0.3);
  });

  it("holds the peak when current power drops (no rubber-band exploit)", () => {
    expect(ratchetPeakPower(0.6, 0.2)).toBe(0.6);
  });

  it("rises when current power exceeds the stored peak", () => {
    expect(ratchetPeakPower(0.4, 0.55)).toBe(0.55);
  });

  it("clamps out-of-range values into [0,1]", () => {
    expect(ratchetPeakPower(1.7, 0.5)).toBe(1);
    expect(ratchetPeakPower(-0.2, -0.4)).toBe(0);
    expect(ratchetPeakPower(undefined, 2)).toBe(1);
  });
});

describe("restoredPeakPower — load semantics (absent ⇒ derive from loadout)", () => {
  it("prefers the persisted value when present", () => {
    const loadout = new ShipLoadout("hull_corvette");
    expect(restoredPeakPower(0.42, loadout, 1000, 1)).toBe(0.42);
  });

  it("derives from the current loadout when the save predates the field", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("wpn_pulse");
    expect(restoredPeakPower(undefined, loadout, 1000, 1)).toBe(
      powerIndexFromLoadout(loadout, 1000, 1),
    );
  });

  it("clamps a corrupted persisted value into [0,1]", () => {
    const loadout = new ShipLoadout("hull_corvette");
    expect(restoredPeakPower(3.5, loadout, 1000, 1)).toBe(1);
  });
});

/** Minimal schema-valid pre-campaign save (mirrors banking/persistence.test.ts). */
function makePreCampaignSave(): Record<string, unknown> {
  return {
    version: 1,
    timestamp: 1_000_000,
    persistentDialogs: [],
    galaxy: {
      id: "galaxy-test",
      gameDays: 3,
      systems: [
        {
          id: "sys-1",
          name: "Alpha",
          coordinates: { q: 0, r: 0 },
          starType: "YELLOW_DWARF",
          explored: true,
          fogOfWar: false,
          planets: [],
          connections: [],
        },
      ],
      npcShips: [],
    },
    player: {
      id: "player-1",
      name: "Tester",
      experience: 0,
      level: 1,
      credits: 1000,
      reputation: {},
      questLog: { activeQuests: [], completedQuests: [] },
      journal: { entries: [] },
      currentSystemId: "sys-1",
      ship: {
        id: "Ranger-1",
        name: "Ranger-1",
        hullHP: 100,
        maxHull: 100,
        shields: 50,
        maxShields: 50,
        energy: 100,
        maxEnergy: 100,
        speed: 1.0,
        evasion: 0.8,
        modules: [null, null, null],
      },
      inventory: { modules: [], resources: [], cosmetics: [] },
    },
  };
}

describe("SaveStateSchema — campaignPeakPower is optional additive", () => {
  it("a save without the field validates (old saves untouched, no migration)", () => {
    const migrated = MigrationPipeline.migrate(
      makePreCampaignSave() as never,
    ) as unknown as Record<string, unknown>;
    expect(migrated.campaignPeakPower).toBeUndefined();
    expect(() => validateSaveState(migrated)).not.toThrow();
  });

  it("a save carrying the field validates and preserves its value (round-trip)", () => {
    const migrated = MigrationPipeline.migrate(
      makePreCampaignSave() as never,
    ) as unknown as Record<string, unknown>;
    const parsed = validateSaveState({ ...migrated, campaignPeakPower: 0.42 });
    expect(parsed.campaignPeakPower).toBe(0.42);
  });

  it("rejects out-of-range values (index is defined on [0,1])", () => {
    const migrated = MigrationPipeline.migrate(
      makePreCampaignSave() as never,
    ) as unknown as Record<string, unknown>;
    expect(() =>
      validateSaveState({ ...migrated, campaignPeakPower: 1.5 }),
    ).toThrow();
    expect(() =>
      validateSaveState({ ...migrated, campaignPeakPower: -0.1 }),
    ).toThrow();
  });
});
