import { describe, it, expect } from "vitest";
import { PlanetType, NpcRole, HullClass, FactionType } from "@/types";
import { textures, allTextures } from "@/assets/manifest";
import { STAR_MAP_PREFIX } from "@/systems/galaxy/starTypeDistribution";
import { STATION_TEXTURE_PREFIX } from "@/presentation/flight/stationArt";

/**
 * Task 4 — the letsplay oracle's **asset-coverage** sweep (memory
 * `feedback-letsplay-oddity-hunting`: catch *missing images*, not just crashes).
 *
 * Two guarantees:
 *  1. Every `pickVariant(category, prefix, …)` production resolves at runtime is
 *     backed by ≥1 manifest asset — so no entity (planet, star, ship, station,
 *     portrait, nebula backdrop) renders as a missing/placeholder image. A new
 *     type/role/faction with no art (or a typo'd prefix) reds the gate.
 *  2. No art category ships *unreferenced* — every category with assets is wired
 *     to a production read path, except a small, documented allowlist of known
 *     not-yet-wired art. New orphan art (someone drops a folder nobody renders)
 *     reds the gate.
 *
 * The non-exported production prefix maps (PlanetSprite's `PLANET_TEXTURE_PREFIX`,
 * PlanetScene's `PLANET_BIOME`, NpcShipSprite's `ROLE_SHIP_PREFIX`) are mirrored
 * here as `Record<Enum, string>` — typed against the live enum so TypeScript
 * *forces* this mirror to grow with the enum, and the resolve check then proves
 * the art exists. The exported maps (`STAR_MAP_PREFIX`, `STATION_TEXTURE_PREFIX`)
 * are imported directly. `nebula` / `player_ships` / `portraits` are derived the
 * exact way production derives them (family×depth · hull `.toLowerCase()` ·
 * faction `.toLowerCase()`).
 */

// --- production prefix mirrors (typed against the enum ⇒ compile-time complete) ---
const PLANET_PREFIX: Record<PlanetType, string> = {
  [PlanetType.TERRESTRIAL]: "terrestrial",
  [PlanetType.GAS_GIANT]: "gas",
  [PlanetType.ICE]: "ice",
  [PlanetType.VOLCANIC]: "volcanic",
  [PlanetType.INDUSTRIAL]: "industrial",
  [PlanetType.HABITAT]: "habitat",
};
// PlanetScene's `PLANET_BIOME` (surfaces/<biome>_NN landing backdrops).
const BIOME_PREFIX: Record<PlanetType, string> = {
  [PlanetType.ICE]: "ice",
  [PlanetType.VOLCANIC]: "volcanic",
  [PlanetType.GAS_GIANT]: "gas",
  [PlanetType.TERRESTRIAL]: "terran",
  [PlanetType.INDUSTRIAL]: "industrial",
  [PlanetType.HABITAT]: "city",
};
// NpcShipSprite's `ROLE_SHIP_PREFIX` (ships/<role>_NN).
const ROLE_PREFIX: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "ranger",
  [NpcRole.TRADER]: "trader",
  [NpcRole.PIRATE]: "pirate",
  [NpcRole.PATROL]: "patrol",
};
const NEBULA_FAMILIES = ["red", "blue", "green", "teal"]; // SpaceBackgroundLayer
const NEBULA_DEPTHS = ["far", "mid", "near"];

/** A (category, prefix) the engine derives a `pickVariant` on. */
interface ProdPrefix {
  category: string;
  prefix: string;
  /** Where production derives it (for a readable failure). */
  source: string;
}

const PRODUCTION_PREFIXES: ProdPrefix[] = [
  ...Object.values(PLANET_PREFIX).flatMap((prefix) => [
    { category: "planets", prefix, source: "PlanetSprite disc" },
    { category: "planet_maps", prefix, source: "PlanetSprite equirect" },
  ]),
  ...Object.values(BIOME_PREFIX).map((prefix) => ({
    category: "surfaces",
    prefix,
    source: "PlanetScene backdrop",
  })),
  ...Object.values(STAR_MAP_PREFIX)
    .filter((p): p is string => !!p)
    .map((prefix) => ({
      category: "star_maps",
      prefix,
      source: "StarRenderer",
    })),
  ...Object.values(ROLE_PREFIX).map((prefix) => ({
    category: "ships",
    prefix,
    source: "NpcShipSprite",
  })),
  // PlayerShipRenderer falls back to ships/ranger for the player hull.
  {
    category: "ships",
    prefix: "ranger",
    source: "PlayerShipRenderer fallback",
  },
  ...Object.values(HullClass).map((hc) => ({
    category: "player_ships",
    prefix: hc.toLowerCase(),
    source: "PlayerShipRenderer hull",
  })),
  ...Object.values(FactionType).map((f) => ({
    category: "portraits",
    prefix: f.toLowerCase(),
    source: "RaceSelectionScene",
  })),
  ...NEBULA_FAMILIES.flatMap((fam) =>
    NEBULA_DEPTHS.map((depth) => ({
      category: "nebula",
      prefix: `${fam}_${depth}`,
      source: "SpaceBackgroundLayer",
    })),
  ),
  ...Object.values(STATION_TEXTURE_PREFIX).map((prefix) => ({
    category: "station",
    prefix,
    source: "stationArt",
  })),
];

/** Mirror of `pickVariant`'s key-matching: exact OR `<wanted>_NN`. */
function variantCount(category: string, prefix: string): number {
  const wanted = `${category}/${prefix}`;
  return allTextures(category).filter(
    (k) => k === wanted || k.startsWith(`${wanted}_`),
  ).length;
}

describe("asset coverage — every production pickVariant prefix resolves", () => {
  it("the production prefix list is non-trivial (the mirror didn't silently empty)", () => {
    expect(PRODUCTION_PREFIXES.length).toBeGreaterThan(20);
  });

  it.each(PRODUCTION_PREFIXES)(
    "$category/$prefix ($source) resolves to ≥1 asset",
    ({ category, prefix }) => {
      expect(variantCount(category, prefix)).toBeGreaterThan(0);
    },
  );
});

describe("asset coverage — no unreferenced ('orphan') art category", () => {
  // Categories production reads via pickVariant (the resolve check above covers them).
  const PICKVARIANT_CATEGORIES = new Set([
    "nebula",
    "portraits",
    "planet_maps",
    "planets",
    "ships",
    "player_ships",
    "surfaces",
    "star_maps",
    "station",
  ]);
  // Categories read by explicit manifest key (not pickVariant): cursors, backdrops.
  const KEYED_CATEGORIES = new Set(["ui", "panoramas"]);
  // Shipped art not yet wired to any render path — documented, so a NEW orphan
  // (art nobody renders) still reds the gate. Remove an entry once its art is
  // wired or deleted. `stars` is superseded by the equirect `star_maps`;
  // `icons/<module>` has no consumer yet.
  const ORPHAN_ALLOWLIST = new Set(["icons", "stars"]);

  const categoriesWithArt = new Set(
    Object.keys(textures).map((k) => k.split("/")[0]),
  );

  it("every category that has art is referenced, allowlisted, or keyed", () => {
    const orphans = [...categoriesWithArt].filter(
      (c) =>
        !PICKVARIANT_CATEGORIES.has(c) &&
        !KEYED_CATEGORIES.has(c) &&
        !ORPHAN_ALLOWLIST.has(c),
    );
    expect(
      orphans,
      orphans.length
        ? `unreferenced art categories (wire them or allowlist with a reason): ${orphans.join(", ")}`
        : "",
    ).toEqual([]);
  });

  it("every referenced pickVariant category actually has art on disk", () => {
    for (const c of PICKVARIANT_CATEGORIES) {
      expect(allTextures(c).length, `no art in category ${c}`).toBeGreaterThan(
        0,
      );
    }
  });

  it("the orphan allowlist stays honest — each entry still ships art", () => {
    // If `stars`/`icons` art is deleted, drop it from the allowlist too.
    for (const c of ORPHAN_ALLOWLIST) {
      expect(
        allTextures(c).length,
        `allowlisted '${c}' no longer has art`,
      ).toBeGreaterThan(0);
    }
  });
});
