import { describe, it, expect } from "vitest";
import { Planet } from "@/domain/Planet";
import { PlanetType, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import {
  buildPlanetTooltipLines,
  FACTION_COLOR,
  FACTION_DISPLAY_NAME,
} from "@/utils/planetTooltip";

// Minimal Market stub so Planet can be constructed without real infrastructure.
const stubMarket = {
  goods: [],
  getPrice: () => 0,
  updatePrices: () => {},
} as unknown as import("@/domain/Market").Market;

function makePlanet(
  overrides: Partial<{
    name: string;
    isHabitable: boolean;
    capturedBy: FactionType | null;
  }> = {},
): Planet {
  return new Planet(
    "p1",
    overrides.name ?? "Тестовая",
    PlanetType.TERRESTRIAL,
    800,
    stubMarket,
    [],
    [],
    overrides.isHabitable ?? true,
    0,
    0,
    overrides.capturedBy ?? null,
  );
}

/** Constant-reputation lookup helper for tests. */
const repAlways = (rep: number) => () => rep;

describe("buildPlanetTooltipLines", () => {
  it("includes planet name as first line (white)", () => {
    const planet = makePlanet({ name: "Альфа" });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
    );
    expect(lines[0].text).toBe("Альфа");
    expect(lines[0].color).toBe(0xffffff);
  });

  it("shows habitable status for habitable planet (green)", () => {
    const planet = makePlanet({ isHabitable: true });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.BASTIONS,
      repAlways(0),
    );
    expect(lines[1].text).toBe("Обитаема");
    expect(lines[1].color).toBe(0x44dd44);
  });

  it("shows uninhabitable status for uninhabitable planet (grey)", () => {
    const planet = makePlanet({ isHabitable: false });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.BASTIONS,
      repAlways(0),
    );
    expect(lines[1].text).toBe("Необитаема");
    expect(lines[1].color).toBe(0xaaaaaa);
  });

  it("renders the controlling faction name in its faction colour", () => {
    const planet = makePlanet();
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.SYNDICATE,
      repAlways(10),
    );
    expect(lines[2].text).toBe(FACTION_DISPLAY_NAME[Faction.SYNDICATE]);
    expect(lines[2].color).toBe(FACTION_COLOR[Faction.SYNDICATE]);
  });

  it("renders the player relation on its own line (neutral)", () => {
    const planet = makePlanet();
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.SYNDICATE,
      repAlways(10),
    );
    expect(lines[3].text).toBe("Нейтральный");
    expect(lines[3].color).toBe(0xcccccc);
  });

  it("uses ally relation when rep >= 50 (green)", () => {
    const planet = makePlanet();
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.PROGRESSORS,
      repAlways(75),
    );
    expect(lines[3].text).toBe("Союзник");
    expect(lines[3].color).toBe(0x44dd44);
  });

  it("uses hostile relation when rep < -50 (red)", () => {
    const planet = makePlanet();
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.PARADOXES,
      repAlways(-80),
    );
    expect(lines[3].text).toBe("Враждебный");
    expect(lines[3].color).toBe(0xff4444);
  });

  it("has no capture warning for an uncaptured planet (4 lines)", () => {
    const planet = makePlanet({ capturedBy: null });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
    );
    expect(lines).toHaveLength(4);
    expect(lines.some((l) => l.text.includes("Захвачена"))).toBe(false);
  });

  it("flags an OVERMIND-captured planet in red with a warning (5 lines)", () => {
    const planet = makePlanet({
      capturedBy: Faction.OVERMIND as unknown as FactionType,
    });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.BASTIONS,
      repAlways(-40),
    );
    expect(lines).toHaveLength(5);
    const captureLine = lines[4];
    expect(captureLine.text).toContain("⚠ Захвачена");
    expect(captureLine.text).toContain(FACTION_DISPLAY_NAME[Faction.OVERMIND]);
    expect(captureLine.color).toBe(0xff4444);
  });

  it("uses the captor (not the system) for the faction name when captured", () => {
    const planet = makePlanet({
      capturedBy: Faction.OVERMIND as unknown as FactionType,
    });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.BASTIONS,
      repAlways(0),
    );
    expect(lines[2].text).toBe(FACTION_DISPLAY_NAME[Faction.OVERMIND]);
    expect(lines[2].color).toBe(FACTION_COLOR[Faction.OVERMIND]);
  });

  it("reputation is looked up against the controlling faction", () => {
    const planet = makePlanet({
      capturedBy: Faction.OVERMIND as unknown as FactionType,
    });
    const seen: Faction[] = [];
    buildPlanetTooltipLines(planet, Faction.BASTIONS, (f) => {
      seen.push(f);
      return 0;
    });
    expect(seen).toContain(Faction.OVERMIND);
    expect(seen).not.toContain(Faction.BASTIONS);
  });
});
