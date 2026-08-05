import { describe, it, expect, vi } from "vitest";
import {
  getRepTier,
  getDialogueLines,
  GovernmentScene,
} from "@/presentation/GovernmentScene";
import type { Renderer } from "@/presentation/Renderer";

function makeRenderer(): Renderer {
  return {
    app: {
      screen: { width: 800, height: 600 },
    },
    gameLayer: {
      addChild: vi.fn(),
      removeChild: vi.fn(),
      children: [],
    },
    uiLayer: {
      addChild: vi.fn(),
      removeChild: vi.fn(),
      children: [],
    },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

describe("getRepTier", () => {
  it("returns 'hostile' below -30", () => {
    expect(getRepTier(-31)).toBe("hostile");
    expect(getRepTier(-100)).toBe("hostile");
  });

  it("returns 'neutral' at exactly -30", () => {
    expect(getRepTier(-30)).toBe("neutral");
  });

  it("returns 'neutral' at 0", () => {
    expect(getRepTier(0)).toBe("neutral");
  });

  it("returns 'ally' above 0", () => {
    expect(getRepTier(1)).toBe("ally");
    expect(getRepTier(100)).toBe("ally");
  });
});

describe("getDialogueLines", () => {
  it("returns 3+ lines for each tier", () => {
    expect(getDialogueLines("hostile").length).toBeGreaterThanOrEqual(3);
    expect(getDialogueLines("neutral").length).toBeGreaterThanOrEqual(3);
    expect(getDialogueLines("ally").length).toBeGreaterThanOrEqual(3);
  });

  it("hostile lines differ from ally lines", () => {
    const hostile = getDialogueLines("hostile");
    const ally = getDialogueLines("ally");
    expect(hostile[0]).not.toBe(ally[0]);
  });
});

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

describe("GovernmentScene", () => {
  it("initializes without throwing given minimal context", () => {
    const renderer = makeRenderer();
    const scene = new GovernmentScene(renderer);
    expect(() => scene.initialize({})).not.toThrow();
  });

  it("initializes with planet context", () => {
    const renderer = makeRenderer();
    const scene = new GovernmentScene(renderer);
    const fakePlanet = {
      id: "planet-1",
      name: "Арктур",
      type: "TERRESTRIAL",
      isHabitable: true,
      inhabitants: [],
      availableQuests: [],
      market: { availableResources: [] },
      drones: 0,
      orbitalRadius: 500,
    };
    expect(() =>
      scene.initialize({
        planet: fakePlanet as unknown as import("@/domain/Planet").Planet,
      }),
    ).not.toThrow();
  });

  it("destroy cleans up without errors", () => {
    const renderer = makeRenderer();
    const scene = new GovernmentScene(renderer);
    scene.initialize({});
    expect(() => scene.destroy()).not.toThrow();
  });

  it("dialogue lines for hostile tier match hostile tier content", () => {
    const lines = getDialogueLines("hostile");
    expect(
      lines.some((l) => l.includes("нежелательно") || l.includes("планеты")),
    ).toBe(true);
  });

  it("dialogue lines for ally tier mention positive sentiment", () => {
    const lines = getDialogueLines("ally");
    expect(
      lines.some(
        (l) =>
          l.includes("Рады") ||
          l.includes("друг") ||
          l.includes("распоряжении"),
      ),
    ).toBe(true);
  });
});
