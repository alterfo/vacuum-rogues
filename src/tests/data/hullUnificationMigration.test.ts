import { describe, it, expect } from "vitest";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { ShipLoadoutSnapshotSchema } from "@/validation/schemas";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { SaveState } from "@/domain/SaveState";
import type { ShipLoadoutSnapshot } from "@/types";

function makeLegacyFittedSave(
  overrides: {
    hullClass?: string;
    shipModules?: Array<Record<string, unknown> | null>;
    inventoryModules?: Array<Record<string, unknown>>;
    loadout?: ShipLoadoutSnapshot;
  } = {},
): Record<string, unknown> {
  return {
    version: 22,
    timestamp: 1_000_000,
    persistentDialogs: [],
    galaxy: {
      id: "galaxy-test",
      systems: [],
      npcShips: [],
    },
    player: {
      id: "player-1",
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
        hullClass: overrides.hullClass ?? "CORVETTE",
        modules: overrides.shipModules ?? [null, null, null],
      },
      inventory: {
        modules: overrides.inventoryModules ?? [],
        micromodules: [],
        resources: [],
        cosmetics: [],
      },
    },
    ...(overrides.loadout ? { loadout: overrides.loadout } : {}),
  };
}

function legacyModule(
  gearId: string,
  micromoduleId?: string,
): Record<string, unknown> {
  return {
    id: gearId,
    category: "WEAPON",
    name: gearId,
    effect: { type: "weapon", value: 10 },
    level: 2,
    ...(micromoduleId ? { micromoduleId } : {}),
  };
}

function getLoadout(migrated: SaveState): ShipLoadoutSnapshot {
  return (migrated as unknown as { loadout?: ShipLoadoutSnapshot }).loadout!;
}

describe("MigrationPipeline v22→v23 — dual-hull loadout synthesis", () => {
  it("converts a legacy installed weapon into a slotted gear entry", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("wpn_pulse"), null, null],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const loadout = getLoadout(migrated);
    expect(loadout).toBeDefined();
    expect(loadout.slotted.map((s) => s.gearId)).toContain("wpn_pulse");
  });

  it("maps hullClass to the matching catalog hull id", () => {
    const corvette = MigrationPipeline.migrate(
      makeLegacyFittedSave({ hullClass: "CORVETTE" }) as unknown as SaveState,
    );
    const destroyer = MigrationPipeline.migrate(
      makeLegacyFittedSave({ hullClass: "DESTROYER" }) as unknown as SaveState,
    );

    expect(getLoadout(corvette).hullId).toBe("hull_corvette");
    expect(getLoadout(destroyer).hullId).toBe("hull_bastion");
  });

  it("guarantees an engine + fuel tank so the migrated ship can take off", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("wpn_pulse"), null, null],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const stats = ShipLoadout.fromJSON(getLoadout(migrated))!.derivedStats();
    expect(stats.canTakeOff).toBe(true);
    expect(stats.speed).toBeGreaterThan(0);
  });

  it("carries a legacy micromodule onto the slotted gear", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("wpn_pulse", "mm_wpn_1"), null, null],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const slot = getLoadout(migrated).slotted.find(
      (s) => s.gearId === "wpn_pulse",
    );
    expect(slot?.micromoduleId).toBe("mm_wpn_1");
  });

  it("includes spare modules from the inventory bag", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [null, null, null],
      inventoryModules: [legacyModule("wpn_railgun")],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(getLoadout(migrated).slotted.map((s) => s.gearId)).toContain(
      "wpn_railgun",
    );
  });

  it("skips unknown gear ids item-by-item without voiding the loadout", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [
        legacyModule("weapon_laser_1_ANCIENT"),
        legacyModule("wpn_pulse"),
        null,
      ],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const ids = getLoadout(migrated).slotted.map((s) => s.gearId);
    expect(ids).not.toContain("weapon_laser_1_ANCIENT");
    expect(ids).toContain("wpn_pulse");
  });

  it("never installs a hull module into a slot", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("hull_warden"), null, null],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(getLoadout(migrated).slotted.map((s) => s.gearId)).not.toContain(
      "hull_warden",
    );
  });

  it("preserves an existing loadout's hull and gear, folding in legacy fitting (no data loss, no overwrite)", () => {
    const canonical: ShipLoadoutSnapshot = {
      hullId: "hull_warden",
      slotted: [{ gearId: "wpn_beam" }],
    };
    const raw = makeLegacyFittedSave({
      hullClass: "CORVETTE",
      shipModules: [legacyModule("wpn_pulse"), null, null],
      loadout: canonical,
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const loadout = getLoadout(migrated);
    expect(loadout.hullId).toBe("hull_warden");
    const ids = loadout.slotted.map((s) => s.gearId);
    expect(ids).toContain("wpn_beam");
    expect(ids).toContain("wpn_pulse");
  });

  it("recovers legacy ship.modules gear when the loadout holds only the starter fitting", () => {
    const starter: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [{ gearId: "eq_engine_i" }, { gearId: "eq_tank" }],
    };
    const raw = makeLegacyFittedSave({
      hullClass: "CORVETTE",
      shipModules: [legacyModule("wpn_pulse"), null, null],
      inventoryModules: [legacyModule("wpn_beam")],
      loadout: starter,
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const ids = getLoadout(migrated).slotted.map((s) => s.gearId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "eq_engine_i",
        "eq_tank",
        "wpn_pulse",
        "wpn_beam",
      ]),
    );
  });

  it("is idempotent — re-migrating yields the same loadout", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("wpn_pulse"), null, null],
    });
    const once = MigrationPipeline.migrate(raw as unknown as SaveState);
    const onceLoadout = JSON.stringify(getLoadout(once));
    const twice = MigrationPipeline.migrate(once);
    expect(JSON.stringify(getLoadout(twice))).toEqual(onceLoadout);
  });

  it("produces a snapshot that round-trips through ShipLoadout.fromJSON", () => {
    const raw = makeLegacyFittedSave({
      hullClass: "TRANSPORT",
      shipModules: [legacyModule("wpn_pulse"), null, null],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const loadout = ShipLoadout.fromJSON(getLoadout(migrated));
    expect(loadout).not.toBeNull();
    expect(loadout!.derivedStats().cargo).toBe(45);
  });

  it("the synthesized loadout snapshot passes Zod schema validation", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("wpn_pulse", "mm_wpn_1"), null, null],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);
    expect(() =>
      ShipLoadoutSnapshotSchema.parse(getLoadout(migrated)),
    ).not.toThrow();
  });

  it("reserves a bagged engine + tank even when installed weapons fill the hull", () => {
    const raw = makeLegacyFittedSave({
      hullClass: "LIGHT_FIGHTER", // hull_scout, 4 slots
      shipModules: [
        legacyModule("wpn_pulse"),
        legacyModule("wpn_beam"),
        legacyModule("wpn_railgun"),
      ],
      inventoryModules: [legacyModule("eq_engine_i"), legacyModule("eq_tank")],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const snapshot = getLoadout(migrated);
    const ids = snapshot.slotted.map((s) => s.gearId);
    expect(ids).toContain("eq_engine_i");
    expect(ids).toContain("eq_tank");
    expect(snapshot.slotted.length).toBeLessThanOrEqual(4);
    expect(ShipLoadout.fromJSON(snapshot)!.derivedStats().canTakeOff).toBe(
      true,
    );
  });

  it("keeps installed fitting over bag spares when candidates exceed slots", () => {
    const raw = makeLegacyFittedSave({
      hullClass: "CORVETTE", // hull_corvette, 5 slots
      shipModules: [
        legacyModule("wpn_pulse"),
        legacyModule("wpn_beam"),
        legacyModule("wpn_railgun"),
      ],
      inventoryModules: [
        legacyModule("wpn_scatter"),
        legacyModule("wpn_rocket"),
      ],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    const snapshot = getLoadout(migrated);
    const ids = snapshot.slotted.map((s) => s.gearId);
    expect(snapshot.slotted.length).toBe(5);
    expect(ids).toEqual(
      expect.arrayContaining([
        "eq_engine_i",
        "eq_tank",
        "wpn_pulse",
        "wpn_beam",
        "wpn_railgun",
      ]),
    );
    expect(ids).not.toContain("wpn_scatter");
    expect(ids).not.toContain("wpn_rocket");
  });

  it("re-running the v22 synthesis on its own output leaves the loadout unchanged", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [legacyModule("wpn_pulse"), null, null],
    });
    const once = MigrationPipeline.migrate(raw as unknown as SaveState);
    const first = JSON.stringify(getLoadout(once));

    (once as unknown as { version: number }).version = 22;
    const twice = MigrationPipeline.migrate(once);
    expect(JSON.stringify(getLoadout(twice))).toEqual(first);
  });

  function getBagIds(migrated: SaveState): string[] {
    return (
      migrated as unknown as {
        player?: { inventory?: { modules?: Array<{ id: string } | null> } };
      }
    )
      .player!.inventory!.modules!.filter((m): m is { id: string } => !!m)
      .map((m) => m.id);
  }

  it("removes folded bag gear from inventory.modules so the hangar cannot dupe it", () => {
    const raw = makeLegacyFittedSave({
      shipModules: [null, null, null],
      inventoryModules: [legacyModule("wpn_railgun")],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(getLoadout(migrated).slotted.map((s) => s.gearId)).toContain(
      "wpn_railgun",
    );
    expect(getBagIds(migrated)).not.toContain("wpn_railgun");
  });

  it("keeps overflow bag spares in inventory.modules (no data loss)", () => {
    const raw = makeLegacyFittedSave({
      hullClass: "CORVETTE",
      shipModules: [
        legacyModule("wpn_pulse"),
        legacyModule("wpn_beam"),
        legacyModule("wpn_railgun"),
      ],
      inventoryModules: [
        legacyModule("wpn_scatter"),
        legacyModule("wpn_rocket"),
      ],
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(getLoadout(migrated).slotted.length).toBe(5);
    expect(getBagIds(migrated)).toEqual(
      expect.arrayContaining(["wpn_scatter", "wpn_rocket"]),
    );
  });

  it("keeps a genuine bag spare matching existing loadout gear, only dropping what it folds", () => {
    const starter: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [{ gearId: "eq_engine_i" }, { gearId: "eq_tank" }],
    };
    const raw = makeLegacyFittedSave({
      hullClass: "CORVETTE",
      inventoryModules: [
        legacyModule("eq_engine_i"),
        legacyModule("wpn_pulse"),
      ],
      loadout: starter,
    });
    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(getLoadout(migrated).slotted.map((s) => s.gearId)).toContain(
      "wpn_pulse",
    );
    const bag = getBagIds(migrated);
    expect(bag).not.toContain("wpn_pulse"); // folded → out of the bag
    expect(bag).toContain("eq_engine_i"); // genuine spare → stays
  });
});
