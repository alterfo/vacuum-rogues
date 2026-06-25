import { describe, it, expect } from "vitest";
import { Planet } from "@/domain/Planet";
import { PlanetType, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import {
  buildPlanetTooltipLines,
  FACTION_COLOR,
  FACTION_DISPLAY_NAME,
} from "@/utils/planetTooltip";
import { landingDenialMessage } from "@/systems/galaxy/landingAccess";

/** True when no tooltip line carries either landing-denial message. */
const hasNoDenialLine = (lines: { text: string }[]): boolean =>
  !lines.some(
    (l) =>
      l.text === landingDenialMessage("overmind") ||
      l.text === landingDenialMessage("pirate-rep"),
  );

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

  it("appends no landing-denial line when landing is allowed (omitted/null)", () => {
    const planet = makePlanet({ capturedBy: null });
    const omitted = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
    );
    const explicitNull = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
      null,
    );
    // Same shape with the arg omitted vs. an explicit null, and neither carries
    // a denial line (content check — not just a length proxy).
    const baseline = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
    ).length;
    expect(omitted).toHaveLength(baseline);
    expect(explicitNull).toHaveLength(baseline);
    expect(hasNoDenialLine(omitted)).toBe(true);
    expect(hasNoDenialLine(explicitNull)).toBe(true);
    // Controller line still the system owner when landing is allowed.
    expect(omitted[2].text).toBe(FACTION_DISPLAY_NAME[Faction.OUTLANDERS]);
  });

  it("appends the overmind denial line (red) using the shared wording", () => {
    const planet = makePlanet({ capturedBy: null });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
      "overmind",
    );
    const denial = lines[lines.length - 1];
    expect(denial.text).toBe(landingDenialMessage("overmind"));
    expect(denial.color).toBe(0xff4444);
  });

  it("appends the pirate-rep denial line using the shared wording", () => {
    const planet = makePlanet({ capturedBy: null });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
      "pirate-rep",
    );
    const denial = lines[lines.length - 1];
    expect(denial.text).toBe(landingDenialMessage("pirate-rep"));
    expect(denial.color).toBe(0xff4444);
  });

  // Production scenario: capture is tracked per-system on the galaxy, so the
  // planet's own `capturedBy` stays null while `landingDenial` says "overmind".
  // The controller/relation lines must name the Overmind, not the benign system
  // owner — otherwise the tooltip contradicts its own denial line.
  it("names the Overmind as controller (not the system owner) when overmind-denied", () => {
    const planet = makePlanet({ capturedBy: null });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
      "overmind",
    );
    expect(lines[2].text).toBe(FACTION_DISPLAY_NAME[Faction.OVERMIND]);
    expect(lines[2].color).toBe(FACTION_COLOR[Faction.OVERMIND]);
    expect(lines[2].text).not.toBe(FACTION_DISPLAY_NAME[Faction.OUTLANDERS]);
  });

  it("looks reputation up against the Overmind (not the system owner) when overmind-denied", () => {
    const planet = makePlanet({ capturedBy: null });
    const seen: Faction[] = [];
    buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      (f) => {
        seen.push(f);
        return 0;
      },
      "overmind",
    );
    expect(seen).toContain(Faction.OVERMIND);
    expect(seen).not.toContain(Faction.OUTLANDERS);
  });

  it("names the pirates as controller (red) when pirate-rep-denied", () => {
    const planet = makePlanet({ capturedBy: null });
    const lines = buildPlanetTooltipLines(
      planet,
      Faction.OUTLANDERS,
      repAlways(0),
      "pirate-rep",
    );
    expect(lines[2].text).toBe("Пираты");
    expect(lines[2].text).not.toBe(FACTION_DISPLAY_NAME[Faction.OUTLANDERS]);
    // Denial line is still appended last.
    expect(lines[lines.length - 1].text).toBe(
      landingDenialMessage("pirate-rep"),
    );
  });
});
