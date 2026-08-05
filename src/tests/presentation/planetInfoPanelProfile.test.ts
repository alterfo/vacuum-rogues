import { describe, it, expect, vi } from "vitest";
import { EconomyType, PoliticalSystem } from "@/types";

let created: string[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    destroyed = false;
    parent: unknown = null;
    children: unknown[] = [];
    anchor = { set: () => {} };
    on() {
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    destroy() {
      this.destroyed = true;
    }
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
  }
  class Text extends FakeBase {
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
      created.push(this.text);
    }
  }
  return { Container, Graphics, Text };
});

import { PlanetInfoPanel } from "@/presentation/PlanetInfoPanel";

function habitablePlanet(
  overrides: Partial<{
    id: string;
    name: string;
    population: number;
    isHabitable: boolean;
    drones: number;
  }> = {},
) {
  return {
    id: "planet-1",
    name: "Терра",
    type: "TERRESTRIAL",
    isHabitable: true,
    drones: 0,
    population: 0,
    ...overrides,
  } as unknown as import("@/domain/Planet").Planet;
}

describe("PlanetInfoPanel social profile (Task 9)", () => {
  it("renders population, economy, political system and attitude for an inhabited planet", () => {
    created = [];
    const panel = new PlanetInfoPanel(
      habitablePlanet(),
      1000,
      800,
      3,
      undefined,
      "SYNDICATE",
      EconomyType.INDUSTRIAL,
      PoliticalSystem.REPUBLIC,
      55,
    );
    const texts = [...created];
    panel.destroy();

    expect(texts.some((t) => t.startsWith("Население: "))).toBe(true);
    expect(texts).toContain("Экономика: Промышленная");
    expect(texts).toContain("Строй: Республика");
    expect(texts).toContain("Отношение: Союзник");
  });

  it("uses the live population count when it has been seeded (> 0)", () => {
    created = [];
    const panel = new PlanetInfoPanel(
      habitablePlanet({ population: 2_400_000 }),
      1000,
      800,
      3,
      undefined,
      "SYNDICATE",
      EconomyType.MIXED,
      PoliticalSystem.DEMOCRACY,
      0,
    );
    const texts = [...created];
    panel.destroy();

    expect(texts).toContain("Население: 2.4 млн");
    expect(texts).toContain("Экономика: Смешанная");
    expect(texts).toContain("Строй: Демократия");
    expect(texts).toContain("Отношение: Нейтральный");
  });

  it("shows a dash for unknown economy/political data (graceful fallback)", () => {
    created = [];
    const panel = new PlanetInfoPanel(
      habitablePlanet(),
      1000,
      800,
      3,
      undefined,
      "SYNDICATE",
    );
    const texts = [...created];
    panel.destroy();

    expect(texts).toContain("Экономика: —");
    expect(texts).toContain("Строй: —");
    expect(texts.some((t) => t.startsWith("Население: "))).toBe(true);
  });

  it("omits the social lines for an uninhabited (drone) planet", () => {
    created = [];
    const panel = new PlanetInfoPanel(
      habitablePlanet({ isHabitable: false, drones: 7 }),
      1000,
      800,
      3,
    );
    const texts = [...created];
    panel.destroy();

    expect(texts).toContain("Дроны: 7");
    expect(texts.some((t) => t.startsWith("Население:"))).toBe(false);
    expect(texts.some((t) => t.startsWith("Экономика:"))).toBe(false);
  });
});
