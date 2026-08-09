import { describe, it, expect, vi } from "vitest";

const pickVariantKeyMock = vi.fn(
  (_category: string, _prefix: string, _seed: string): string | undefined =>
    undefined,
);
const texMock = vi.fn((_key: string): unknown => undefined);

vi.mock("@/presentation/textures", () => ({
  pickVariantKey: (category: string, prefix: string, seed: string) =>
    pickVariantKeyMock(category, prefix, seed),
  tex: (key: string) => texMock(key),
}));

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: unknown[] = [];
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
  }
  class FakeSprite {
    anchor = { set: vi.fn() };
    width = 0;
    height = 0;
    x = 0;
    y = 0;
    eventMode = "auto";
    constructor(public texture: unknown) {}
  }
  class FakeGraphics {
    x = 0;
    y = 0;
    eventMode = "auto";
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
  }
  class FakeText {
    anchor = { set: vi.fn() };
    x = 0;
    y = 0;
    eventMode = "auto";
    text: string;
    constructor(opts: { text: string }) {
      this.text = opts.text;
    }
  }
  return {
    Container: FakeContainer,
    Sprite: FakeSprite,
    Graphics: FakeGraphics,
    Text: FakeText,
  };
});

import { gearIconKey, mountGearIcon } from "@/presentation/ui/gearIcon";
import { gearById } from "@/systems/equipment/GearCatalog";
import { Container } from "pixi.js";

describe("gearIconKey — per-item family/tier prefix (Task 7)", () => {
  it("computes the exact wpn_<class>_<tier> prefix for every weapon tier bucket", () => {
    const cases: Array<[string, string]> = [
      ["wpn_mining_laser", "wpn_energy_low"], // T1
      ["wpn_pulse", "wpn_energy_low"], // T2
      ["wpn_beam", "wpn_energy_mid"], // T5
      ["wpn_disruptor", "wpn_energy_high"], // T7
      ["wpn_scatter", "wpn_fragment_mid"], // T3
      ["wpn_long_lance", "wpn_fragment_mid"], // T5
      ["wpn_swarm_racks", "wpn_missile_low"], // T2
      ["wpn_rocket", "wpn_missile_mid"], // T3
      ["wpn_torpedo", "wpn_missile_high"], // T6
      ["wpn_singularity_lance", "wpn_missile_high"], // T8
    ];
    for (const [id, prefix] of cases) {
      pickVariantKeyMock.mockClear();
      gearIconKey(gearById(id)!);
      expect(pickVariantKeyMock).toHaveBeenCalledWith("icons", prefix, id);
    }
  });

  it("computes the exact eq_<family>_<tier> prefix for every equipment tier bucket", () => {
    const cases: Array<[string, string]> = [
      ["eq_tank", "eq_fuel_tank_low"], // T1
      ["eq_tank_ii", "eq_fuel_tank_mid"], // T3
      ["eq_tank_iii", "eq_fuel_tank_high"], // T6
      ["eq_engine_i", "eq_engine_low"], // T2
      ["eq_engine_iii", "eq_engine_mid"], // T5
      ["eq_engine_v", "eq_engine_high"], // T7
      ["eq_radar_near", "eq_radar_low"], // T2
      ["eq_radar", "eq_radar_mid"], // T4
      ["eq_radar_far", "eq_radar_high"], // T6
      ["eq_scanner_near", "eq_scanner_low"], // T2
      ["eq_scanner", "eq_scanner_mid"], // T4
      ["eq_scanner_deep", "eq_scanner_high"], // T6
      ["eq_droid_basic", "eq_repair_droid_low"], // T2
      ["eq_droid", "eq_repair_droid_mid"], // T5
      ["eq_droid_nano", "eq_repair_droid_high"], // T7
      ["eq_shield_light", "eq_shield_mid"], // T3
      ["eq_shield", "eq_shield_high"], // T6
      ["eq_grapple_i", "eq_grapple_low"], // T1
      ["eq_grapple_ii", "eq_grapple_mid"], // T3
      ["grav_tractor_1", "eq_grav_tractor_mid"], // T3
      ["grav_tractor_3", "eq_grav_tractor_high"], // T7
    ];
    for (const [id, prefix] of cases) {
      pickVariantKeyMock.mockClear();
      gearIconKey(gearById(id)!);
      expect(pickVariantKeyMock).toHaveBeenCalledWith("icons", prefix, id);
    }
  });

  it("falls back to the flat family icon when no tiered art is loaded (today's real state)", () => {
    pickVariantKeyMock.mockReturnValue(undefined);
    expect(gearIconKey(gearById("wpn_disruptor")!)).toBe("icons/laser");
    expect(gearIconKey(gearById("eq_engine_v")!)).toBe("icons/engine");
    expect(gearIconKey(gearById("eq_tank_iii")!)).toBe("icons/fuel_tank");
    expect(gearIconKey(gearById("eq_radar_far")!)).toBe("icons/radar");
    expect(gearIconKey(gearById("eq_shield")!)).toBe("icons/shield");
    expect(gearIconKey(gearById("eq_droid_nano")!)).toBe("icons/repair_droid");
  });

  it("stays undefined (text-only) for families with no flat fallback art either", () => {
    pickVariantKeyMock.mockReturnValue(undefined);
    expect(gearIconKey(gearById("eq_scanner")!)).toBeUndefined();
    expect(gearIconKey(gearById("eq_grapple_i")!)).toBeUndefined();
    expect(gearIconKey(gearById("grav_tractor_1")!)).toBeUndefined();
  });

  it("prefers the tiered key over the flat fallback once matching art lands", () => {
    pickVariantKeyMock.mockReturnValue("icons/wpn_energy_high_01");
    expect(gearIconKey(gearById("wpn_disruptor")!)).toBe(
      "icons/wpn_energy_high_01",
    );
  });
});

describe("mountGearIcon — shared mount helper", () => {
  it("no-ops (returns 0, mounts nothing) when the icon key has no loaded texture", () => {
    pickVariantKeyMock.mockReturnValue(undefined);
    texMock.mockReturnValue(undefined);
    const container = new Container();
    const consumed = mountGearIcon(container, gearById("wpn_pulse")!, 0, 0, 18);
    expect(consumed).toBe(0);
    expect(
      (container as unknown as { children: unknown[] }).children,
    ).toHaveLength(0);
  });

  it("mounts a sprite and returns size+4 when a texture is loaded", () => {
    pickVariantKeyMock.mockReturnValue(undefined);
    texMock.mockReturnValue({ fakeTexture: true });
    const container = new Container();
    const consumed = mountGearIcon(
      container,
      gearById("wpn_pulse")!,
      5,
      10,
      18,
    );
    expect(consumed).toBe(22);
    expect(
      (container as unknown as { children: unknown[] }).children,
    ).toHaveLength(1);
  });
});

describe("gearIconKey — FRAGMENT/MISSILE weapons have no flat fallback (Task 7)", () => {
  it("stays undefined instead of reusing the ENERGY laser icon", () => {
    pickVariantKeyMock.mockReturnValue(undefined);
    expect(gearIconKey(gearById("wpn_scatter")!)).toBeUndefined();
    expect(gearIconKey(gearById("wpn_rocket")!)).toBeUndefined();
  });
});

describe("mountGearIcon — category glyph fallback for art-less families (Task 7)", () => {
  it("mounts a visible glyph + positive offset for every gap family, never 0", () => {
    pickVariantKeyMock.mockReturnValue(undefined);
    texMock.mockReturnValue(undefined);
    const gapFamilyIds = [
      "hull_scout", // HULL
      "eq_scanner", // EquipmentClass.SCANNER
      "eq_grapple_i", // EquipmentClass.GRAPPLE
      "grav_tractor_1", // EquipmentClass.GRAV_TRACTOR
      "wpn_scatter", // WeaponClass.FRAGMENT
      "wpn_rocket", // WeaponClass.MISSILE
    ];
    for (const id of gapFamilyIds) {
      const container = new Container();
      const consumed = mountGearIcon(container, gearById(id)!, 0, 0, 18);
      expect(consumed).toBeGreaterThan(0);
      expect(
        (container as unknown as { children: unknown[] }).children.length,
      ).toBeGreaterThan(0);
    }
  });
});
