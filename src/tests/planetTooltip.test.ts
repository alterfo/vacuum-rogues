import { describe, it, expect } from "vitest";
import { Planet } from "@/domain/Planet";
import { PlanetType, FactionType } from "@/types";
import { Faction } from "@/types/faction";

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

/** Simulate the tooltip data logic extracted from showPlanetTooltip. */
function buildTooltipLines(
  planet: Planet,
  systemFaction: Faction,
  playerRep: number,
): Array<{ text: string; color: number }> {
  const FACTION_DISPLAY_NAME: Record<Faction, string> = {
    [Faction.OUTLANDERS]: "Аутсайдеры",
    [Faction.BASTIONS]: "Бастионы",
    [Faction.SYNDICATE]: "Синдикат",
    [Faction.PARADOXES]: "Парадоксы",
    [Faction.PROGRESSORS]: "Прогрессоры",
    [Faction.INDEPENDENT]: "Независимые",
    [Faction.OVERMIND]: "Овермайнд",
  };

  function repLabel(rep: number): string {
    if (rep >= 50) return "Союзник";
    if (rep >= 20) return "Дружественный";
    if (rep >= -20) return "Нейтральный";
    if (rep >= -50) return "Недовольный";
    return "Враждебный";
  }

  function repColor(rep: number): number {
    if (rep >= 50) return 0x44dd44;
    if (rep >= 20) return 0x88dd88;
    if (rep >= -20) return 0xcccccc;
    if (rep >= -50) return 0xddaa44;
    return 0xff4444;
  }

  const lines: Array<{ text: string; color: number }> = [];

  lines.push({ text: planet.name, color: 0xffffff });

  if (planet.isHabitable) {
    lines.push({ text: "Обитаема", color: 0x44dd44 });
  } else {
    lines.push({ text: "Необитаема", color: 0x888888 });
  }

  const factionLabel = FACTION_DISPLAY_NAME[systemFaction] ?? systemFaction;
  const repLbl = repLabel(playerRep);
  const repCol = repColor(playerRep);
  lines.push({ text: `${factionLabel} · ${repLbl}`, color: repCol });

  if (planet.capturedBy !== null && planet.capturedBy !== undefined) {
    const captorName =
      FACTION_DISPLAY_NAME[planet.capturedBy as unknown as Faction] ??
      planet.capturedBy;
    lines.push({ text: `⚠ Захвачена: ${captorName}`, color: 0xff4444 });
  }

  return lines;
}

describe("planet tooltip data", () => {
  it("includes planet name as first line", () => {
    const planet = makePlanet({ name: "Альфа" });
    const lines = buildTooltipLines(planet, Faction.OUTLANDERS, 0);
    expect(lines[0].text).toBe("Альфа");
    expect(lines[0].color).toBe(0xffffff);
  });

  it("shows habitable status for habitable planet (green)", () => {
    const planet = makePlanet({ isHabitable: true });
    const lines = buildTooltipLines(planet, Faction.BASTIONS, 0);
    expect(lines[1].text).toBe("Обитаема");
    expect(lines[1].color).toBe(0x44dd44);
  });

  it("shows uninhabitable status for uninhabitable planet (gray)", () => {
    const planet = makePlanet({ isHabitable: false });
    const lines = buildTooltipLines(planet, Faction.BASTIONS, 0);
    expect(lines[1].text).toBe("Необитаема");
    expect(lines[1].color).toBe(0x888888);
  });

  it("includes faction name and reputation label on third line", () => {
    const planet = makePlanet();
    const lines = buildTooltipLines(planet, Faction.SYNDICATE, 10);
    expect(lines[2].text).toContain("Синдикат");
    expect(lines[2].text).toContain("Нейтральный");
  });

  it("uses ally reputation label when rep >= 50", () => {
    const planet = makePlanet();
    const lines = buildTooltipLines(planet, Faction.PROGRESSORS, 75);
    expect(lines[2].text).toContain("Союзник");
    expect(lines[2].color).toBe(0x44dd44);
  });

  it("uses hostile reputation label when rep < -50", () => {
    const planet = makePlanet();
    const lines = buildTooltipLines(planet, Faction.PARADOXES, -80);
    expect(lines[2].text).toContain("Враждебный");
    expect(lines[2].color).toBe(0xff4444);
  });

  it("does not include capture warning for uncaptured planet", () => {
    const planet = makePlanet({ capturedBy: null });
    const lines = buildTooltipLines(planet, Faction.OUTLANDERS, 0);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.text.includes("Захвачена"))).toBe(false);
  });

  it("includes capture warning for a captured planet", () => {
    const planet = makePlanet({ capturedBy: FactionType.OUTLANDERS });
    const lines = buildTooltipLines(planet, Faction.BASTIONS, 0);
    expect(lines).toHaveLength(4);
    const captureLine = lines[3];
    expect(captureLine.text).toContain("⚠ Захвачена:");
    expect(captureLine.color).toBe(0xff4444);
  });

  it("capturedBy field defaults to null on Planet construction", () => {
    const planet = new Planet(
      "p2",
      "Бета",
      PlanetType.ICE,
      600,
      stubMarket,
      [],
      [],
    );
    expect(planet.capturedBy).toBeNull();
  });
});
