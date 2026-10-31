import { describe, expect, it } from "vitest";
import { Faction } from "@/types/faction";
import { StarType } from "@/types";
import {
  nebulaPaletteForStarType,
  resolveNebulaPalette,
} from "@/presentation/nebulaPalette";

describe("nebula palette state mapping", () => {
  it("maps each star type to a five-colour procedural palette", () => {
    const types = [
      StarType.RED_DWARF,
      StarType.YELLOW_DWARF,
      StarType.BLUE_GIANT,
      StarType.WHITE_DWARF,
      StarType.NEUTRON,
      StarType.BLACK_HOLE,
    ];
    for (const starType of types) {
      expect(nebulaPaletteForStarType(starType)).toHaveLength(5);
    }
  });

  it("uses a faction accent at idle and red overlays for combat/low hull", () => {
    const idle = resolveNebulaPalette({
      starType: StarType.BLUE_GIANT,
      ownerFaction: Faction.BASTIONS,
    });
    expect(idle.overlayColor).toBe(0x88aaff);
    expect(idle.overlayAlpha).toBeCloseTo(0.05, 5);

    const combat = resolveNebulaPalette({
      starType: StarType.RED_DWARF,
      ownerFaction: Faction.SYNDICATE,
      inCombat: true,
    });
    expect(combat.overlayColor).toBe(0xff5040);
    expect(combat.overlayAlpha).toBeCloseTo(0.1, 5);

    const lowHull = resolveNebulaPalette({
      starType: StarType.YELLOW_DWARF,
      ownerFaction: Faction.OUTLANDERS,
      inCombat: true,
      lowHull: true,
    });
    expect(lowHull.overlayColor).toBe(0xff4033);
    expect(lowHull.overlayAlpha).toBeCloseTo(0.16, 5);
  });

  it("keeps the boss overlay distinct from normal combat", () => {
    const boss = resolveNebulaPalette({
      starType: StarType.NEUTRON,
      ownerFaction: Faction.OVERMIND,
      inCombat: true,
      boss: true,
    });
    expect(boss.overlayColor).toBe(0xff5c4d);
    expect(boss.overlayAlpha).toBeCloseTo(0.14, 5);
  });
});
