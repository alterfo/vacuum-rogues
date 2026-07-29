import { describe, it, expect, vi } from "vitest";

// PlanetScene imports pixi.js at module load; mock it so the pure helpers can be
// imported without a real renderer.
vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  Sprite: vi.fn(),
}));

import {
  clampPanoramaX,
  computePlanetMenuLayout,
  planetInfoPanelLines,
  planetTypeLabel,
  skyGradientColors,
  visiblePlanetServices,
} from "@/presentation/PlanetScene";

describe("clampPanoramaX (Task 6 panorama pan)", () => {
  it("centres a panorama narrower than the screen and ignores drag", () => {
    expect(clampPanoramaX(0, 800, 1000)).toBe(100);
    expect(clampPanoramaX(-500, 800, 1000)).toBe(100);
    expect(clampPanoramaX(999, 800, 1000)).toBe(100);
  });

  it("clamps a wide panorama to [screenWidth - panoramaWidth, 0]", () => {
    // 4096px panorama on a 1280px screen → 2816px of pan range.
    expect(clampPanoramaX(0, 4096, 1280)).toBe(0); // left edge
    expect(clampPanoramaX(100, 4096, 1280)).toBe(0); // cannot pan past 0
    expect(clampPanoramaX(-5000, 4096, 1280)).toBe(1280 - 4096); // right edge
    expect(clampPanoramaX(-1000, 4096, 1280)).toBe(-1000); // mid-range passes
  });

  it("treats an exactly screen-wide panorama as non-pannable", () => {
    expect(clampPanoramaX(-50, 1280, 1280)).toBe(0);
  });
});

describe("skyGradientColors (Task 6 fallback sky)", () => {
  it("returns exactly the requested number of bands", () => {
    expect(skyGradientColors(0x2266ff, 8)).toHaveLength(8);
    expect(skyGradientColors(0xff6600, 10)).toHaveLength(10);
  });

  it("starts near space-black and tints toward the faction colour at the bottom", () => {
    const bands = skyGradientColors(0x2266ff, 10);
    expect(bands[0]).toBeLessThan(0x0a0a20); // top band ≈ dark space
    expect(bands[bands.length - 1]).toBeGreaterThan(bands[0]); // bottom brighter
  });

  it("handles a single-step request without dividing by zero", () => {
    expect(skyGradientColors(0xff0000, 1)).toHaveLength(1);
  });
});

describe("computePlanetMenuLayout (playtest2 ⑥ — menu must fit on-screen)", () => {
  // statY at 1280×720 with the default planet/info/stat block ≈ 466 (see
  // createUI). The eighth button «Взлёт» used to overflow below y=720.
  const CONTENT_BOTTOM = 466;

  const cases: Array<{ h: number; count: number }> = [
    { h: 720, count: 8 }, // inhabited world, full service menu (the ⑥ case)
    { h: 720, count: 9 }, // + bribe button when hostile
    { h: 768, count: 8 },
    { h: 1080, count: 8 },
    { h: 1080, count: 9 },
    { h: 900, count: 1 }, // uninhabited world: only «Взлёт»
  ];

  for (const { h, count } of cases) {
    it(`fits ${count} buttons at ${h}px without overflow or overlap`, () => {
      const { btnStartY, btnStep, btnH } = computePlanetMenuLayout(
        h,
        CONTENT_BOTTOM,
        count,
      );
      // The last button's bottom edge must stay on-screen.
      const lastBottom = btnStartY + (count - 1) * btnStep + btnH;
      expect(lastBottom).toBeLessThanOrEqual(h);
      // Consecutive buttons must not overlap (overlap steals clicks).
      expect(btnH).toBeLessThanOrEqual(btnStep);
      // Buttons stay legible.
      expect(btnH).toBeGreaterThanOrEqual(20);
    });
  }

  it("does not balloon buttons on very tall screens", () => {
    const { btnStep, btnH } = computePlanetMenuLayout(2000, CONTENT_BOTTOM, 8);
    expect(btnStep).toBeLessThanOrEqual(38);
    expect(btnH).toBeLessThanOrEqual(32);
  });

  // Below ~700px the per-button step drops under the 20px legibility floor; the
  // height must still never exceed the step or buttons overlap and steal clicks.
  const shortCases: Array<{ h: number; count: number }> = [
    { h: 690, count: 9 },
    { h: 660, count: 8 },
    { h: 640, count: 9 },
  ];
  for (const { h, count } of shortCases) {
    it(`keeps ${count} buttons non-overlapping on a short ${h}px screen`, () => {
      const { btnStartY, btnStep, btnH } = computePlanetMenuLayout(
        h,
        CONTENT_BOTTOM,
        count,
      );
      // Hard invariant: the button height never exceeds its step (no overlap).
      expect(btnH).toBeLessThanOrEqual(btnStep);
      // The last button's bottom edge still stays on-screen.
      const lastBottom = btnStartY + (count - 1) * btnStep + btnH;
      expect(lastBottom).toBeLessThanOrEqual(h);
    });
  }
});

describe("visiblePlanetServices (regression — must still pass)", () => {
  const ALL = [
    { label: "Губернатор" },
    { label: "Верфь" },
    { label: "Маркет" },
    { label: "Взлёт" },
  ];

  it("shows the full set on inhabited worlds", () => {
    expect(visiblePlanetServices(true, ALL)).toEqual(ALL);
  });

  it("shows only take-off on uninhabited worlds", () => {
    expect(visiblePlanetServices(false, ALL).map((b) => b.label)).toEqual([
      "Взлёт",
    ]);
  });
});

describe("planetInfoPanelLines (UX finding #4 — economy/type shown once)", () => {
  it("shows the planet-type word only in the subtitle, never on the faction row", () => {
    const lines = planetInfoPanelLines({
      planetType: "INDUSTRIAL",
      isHabitable: true,
      factionName: "Синдикат",
      economyType: "INDUSTRIAL",
      politicalSystem: "REPUBLIC",
      population: 2_400_000,
      populationSeed: "planet-1",
    });

    const typeWord = planetTypeLabel("INDUSTRIAL"); // "Промышленный"
    const occurrences = [lines.subtitle, lines.faction, lines.profile]
      .filter((l): l is string => l != null)
      .filter((l) => l.includes(typeWord)).length;

    // The planet-type word appears exactly once across the whole card.
    expect(occurrences).toBe(1);
    expect(lines.subtitle).toContain(typeWord);
    // Line 1 is the controlling faction alone — the old "type • faction" is gone.
    expect(lines.faction).toBe("Синдикат");
    expect(lines.faction).not.toContain(typeWord);
    expect(lines.faction).not.toContain("•");
  });

  it("keeps population + economy + political as the distinct profile fact line", () => {
    const lines = planetInfoPanelLines({
      planetType: "TERRESTRIAL",
      isHabitable: true,
      factionName: "Синдикат",
      economyType: "AGRICULTURAL",
      politicalSystem: "DEMOCRACY",
      population: 2_400_000,
      populationSeed: "planet-1",
    });
    expect(lines.profile).toContain("Население: 2.4 млн");
    expect(lines.profile).toContain("Аграрная");
    expect(lines.profile).toContain("Демократия");
  });

  it("omits the profile line for an uninhabited (drone) world", () => {
    const lines = planetInfoPanelLines({
      planetType: "ICE",
      isHabitable: false,
      factionName: "Независимые",
      populationSeed: "planet-2",
    });
    expect(lines.profile).toBeNull();
    expect(lines.subtitle).toContain(planetTypeLabel("ICE"));
    expect(lines.subtitle).toContain("Необитаемая");
  });
});
