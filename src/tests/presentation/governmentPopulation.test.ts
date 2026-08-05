import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Text } from "pixi.js";
import { GovernmentScene } from "@/presentation/GovernmentScene";
import {
  resolvePopulation,
  deterministicPopulation,
} from "@/presentation/ui/planetProfile";
import type { Renderer } from "@/presentation/Renderer";
import type { Planet } from "@/domain/Planet";

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

function makePlanet(id: string, population: number): Planet {
  return {
    id,
    name: "Меридиан",
    type: "TERRESTRIAL",
    population,
    isHabitable: true,
    inhabitants: [],
    availableQuests: [],
    market: { availableResources: [] },
    drones: 0,
    orbitalRadius: 500,
  } as unknown as Planet;
}

function renderedTexts(): string[] {
  return (Text as unknown as Mock).mock.calls
    .map((call) => (call[0] as { text?: string } | undefined)?.text)
    .filter((t): t is string => typeof t === "string");
}

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    getChildByLabel: vi.fn().mockReturnValue(null),
    children: [],
    x: 0,
    y: 0,
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    children: [],
    x: 0,
    y: 0,
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    text: "",
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    label: "",
    destroyed: false,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
}));

describe("GovernmentScene population", () => {
  beforeEach(() => {
    (Text as unknown as Mock).mockClear();
  });

  it("displays resolvePopulation for a planet with a seeded population", () => {
    const planet = makePlanet("meridian-seeded", 5_000_000);
    const expected = resolvePopulation(planet.population, planet.id);
    expect(expected).toBe(5_000_000); // seeded value wins, not the id hash

    const scene = new GovernmentScene(makeRenderer());
    scene.initialize({ planet });

    expect(renderedTexts()).toContain(expected.toLocaleString("ru"));
  });

  it("falls back to the deterministic id-derived count when unseeded", () => {
    const planet = makePlanet("meridian-unseeded", 0);
    const expected = resolvePopulation(planet.population, planet.id);
    expect(expected).toBe(deterministicPopulation(planet.id));

    const scene = new GovernmentScene(makeRenderer());
    scene.initialize({ planet });

    expect(renderedTexts()).toContain(expected.toLocaleString("ru"));
  });
});
