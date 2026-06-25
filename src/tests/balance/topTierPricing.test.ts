import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  EquipmentClass,
  isRareGear,
  gearById,
  type HullSpec,
  type EquipmentSpec,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { RARE_TECH_THRESHOLD } from "@/config/balance";

// ---------------------------------------------------------------------------
// Task 2: the top tier must be a steep, rare, very-expensive climb — most of
// the galaxy runs similar mid-tech, and the apex hull/engine is a long-term
// goal only the richest field. Assert the *relationships* (steep top step, a
// ≥4× gap to the mid tier, rare flagging, scarce high-end stock), not exact
// magnitudes, so later tuning doesn't churn these tests.
// ---------------------------------------------------------------------------

const HULLS = GEAR_CATALOG.filter(
  (g): g is HullSpec => g.kind === GearKind.HULL,
);
const ENGINES = GEAR_CATALOG.filter(
  (g): g is EquipmentSpec =>
    g.kind === GearKind.EQUIPMENT && g.equipmentClass === EquipmentClass.ENGINE,
);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function maxBy(items: Gear[]): Gear {
  return items.reduce((best, g) => (g.basePrice > best.basePrice ? g : best));
}

describe("top-tier pricing & rarity (Task 2)", () => {
  describe("steep top step", () => {
    it("the hull curve has its single steepest step at the very top", () => {
      const prices = HULLS.map((h) => h.basePrice).sort((a, b) => a - b);
      const steps = prices.slice(1).map((p, i) => p - prices[i]);
      const topStep = steps[steps.length - 1];
      const earlierMax = Math.max(...steps.slice(0, -1));
      expect(topStep).toBeGreaterThan(earlierMax);
    });

    it("the apex hull costs at least 4× the median (mid-tier) hull", () => {
      const apex = maxBy(HULLS);
      const midHulls = HULLS.filter((h) => !isRareGear(h));
      expect(midHulls.length).toBeGreaterThan(0);
      const mid = median(midHulls.map((h) => h.basePrice));
      expect(apex.basePrice).toBeGreaterThanOrEqual(4 * mid);
    });

    it("the apex engine costs at least 4× the entry engine", () => {
      const apex = maxBy(ENGINES);
      const entry = ENGINES.reduce((min, e) =>
        e.basePrice < min.basePrice ? e : min,
      );
      expect(ENGINES.length).toBeGreaterThanOrEqual(2);
      expect(apex.basePrice).toBeGreaterThanOrEqual(4 * entry.basePrice);
    });
  });

  describe("rarity flagging", () => {
    it("the apex hull and apex engine are flagged rare", () => {
      expect(isRareGear(maxBy(HULLS))).toBe(true);
      expect(isRareGear(maxBy(ENGINES))).toBe(true);
      // The two named apex pieces carry the explicit flag.
      expect(gearById("hull_bastion")?.rare).toBe(true);
      expect(gearById("eq_engine_v")?.rare).toBe(true);
    });

    it("there is a new rare, very-expensive top-tier engine", () => {
      const engineV = gearById("eq_engine_v") as EquipmentSpec | undefined;
      expect(engineV).toBeDefined();
      expect(engineV!.equipmentClass).toBe(EquipmentClass.ENGINE);
      expect(isRareGear(engineV!)).toBe(true);
      // Pricier than the previous top engine (eq_engine_iii) — a genuine apex.
      const mid = gearById("eq_engine_iii") as EquipmentSpec;
      expect(engineV!.basePrice).toBeGreaterThan(mid.basePrice);
    });

    it("rare gear is high-tech and common gear is not", () => {
      const rare = GEAR_CATALOG.filter(isRareGear);
      expect(rare.length).toBeGreaterThanOrEqual(3);
      for (const g of rare) {
        expect(
          g.techLevel,
          `${g.id} flagged rare but low-tech`,
        ).toBeGreaterThanOrEqual(RARE_TECH_THRESHOLD);
      }
      // Mid/low-tech staples are never rare.
      expect(isRareGear(gearById("hull_corvette")!)).toBe(false);
      expect(isRareGear(gearById("eq_engine_i")!)).toBe(false);
    });

    it("rare gear stays within the documented endgame price ceiling (≤ 14000)", () => {
      for (const g of GEAR_CATALOG.filter(isRareGear)) {
        expect(
          g.basePrice,
          `${g.id} above endgame ceiling`,
        ).toBeLessThanOrEqual(14000);
      }
    });
  });

  describe("gated availability (only the richest markets field it)", () => {
    it("a rare apex item is stocked in far fewer shops than a common one", () => {
      const planets = 200;
      let apexEngineSeen = 0;
      let commonSeen = 0;
      for (let i = 0; i < planets; i++) {
        const ids = new Set(
          generateShop({
            systemId: "S",
            planetId: `P${i}`,
            seed: "rare-stock",
            day: 0,
          }).map((l) => l.gear.id),
        );
        if (ids.has("eq_engine_v")) apexEngineSeen++; // rare T7
        if (ids.has("eq_tank")) commonSeen++; // common T1
      }
      // Common gear is nearly ubiquitous; the rare apex is a scarce minority.
      expect(commonSeen).toBeGreaterThan(planets * 0.6);
      expect(apexEngineSeen).toBeLessThan(planets * 0.3);
      expect(apexEngineSeen).toBeLessThan(commonSeen);
    });
  });
});
