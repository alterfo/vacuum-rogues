import { describe, it, expect } from "vitest";
import { PlanetType, NpcRole, HullClass, FactionType } from "@/types";
import { textures, allTextures } from "@/assets/manifest";
import { STAR_MAP_PREFIX } from "@/systems/galaxy/starTypeDistribution";
import { STATION_TEXTURE_PREFIX } from "@/presentation/flight/stationArt";

const PLANET_PREFIX: Record<PlanetType, string> = {
  [PlanetType.TERRESTRIAL]: "terrestrial",
  [PlanetType.GAS_GIANT]: "gas",
  [PlanetType.ICE]: "ice",
  [PlanetType.VOLCANIC]: "volcanic",
  [PlanetType.INDUSTRIAL]: "industrial",
  [PlanetType.HABITAT]: "habitat",
};
const BIOME_PREFIX: Record<PlanetType, string> = {
  [PlanetType.ICE]: "ice",
  [PlanetType.VOLCANIC]: "volcanic",
  [PlanetType.GAS_GIANT]: "gas",
  [PlanetType.TERRESTRIAL]: "terran",
  [PlanetType.INDUSTRIAL]: "industrial",
  [PlanetType.HABITAT]: "city",
};
const ROLE_PREFIX: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "ranger",
  [NpcRole.TRADER]: "trader",
  [NpcRole.PIRATE]: "pirate",
  [NpcRole.PATROL]: "patrol",
  [NpcRole.OVERMIND]: "patrol",
};
const NEBULA_FAMILIES = ["red", "blue", "green", "teal"]; // SpaceBackgroundLayer
const NEBULA_DEPTHS = ["far", "mid", "near"];
const HULL_SHIP_PREFIX: Record<HullClass, string> = {
  [HullClass.LIGHT_FIGHTER]: "light_fighter",
  [HullClass.CORVETTE]: "corvette",
  [HullClass.FRIGATE]: "frigate",
  [HullClass.DESTROYER]: "destroyer",
  [HullClass.TRANSPORT]: "transport",
  [HullClass.HEAVY_FREIGHTER]: "heavy_freighter",
  [HullClass.CRUISER]: "destroyer",
};

interface ProdPrefix {
  category: string;
  prefix: string;
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
  {
    category: "ships",
    prefix: "ranger",
    source: "PlayerShipRenderer fallback",
  },
  ...Object.values(HullClass).map((hc) => ({
    category: "player_ships",
    prefix: HULL_SHIP_PREFIX[hc],
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
  const KEYED_CATEGORIES = new Set(["ui", "panoramas"]);
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
    for (const c of ORPHAN_ALLOWLIST) {
      expect(
        allTextures(c).length,
        `allowlisted '${c}' no longer has art`,
      ).toBeGreaterThan(0);
    }
  });
});
