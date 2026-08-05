import { describe, it, expect, vi } from "vitest";
import { Faction } from "@/types/faction";

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

function habitablePlanet() {
  return {
    name: "Терра",
    type: "TERRESTRIAL",
    isHabitable: true,
    drones: 0,
  } as unknown as import("@/domain/Planet").Planet;
}

function buildPanel(ownerFaction?: string): string[] {
  created = [];
  const panel = new PlanetInfoPanel(
    habitablePlanet(),
    1000,
    800,
    3,
    undefined,
    ownerFaction,
  );
  const texts = [...created];
  panel.destroy();
  return texts;
}

describe("PlanetInfoPanel faction fallback", () => {
  it("labels an unowned system 'Независимая', not 'Окраинники'", () => {
    const texts = buildPanel(undefined);
    expect(texts).toContain("Фракция: Независимая");
    expect(texts).not.toContain("Фракция: Окраинники");
  });

  it("resolves an explicit INDEPENDENT owner to 'Независимая'", () => {
    const texts = buildPanel(Faction.INDEPENDENT);
    expect(texts).toContain("Фракция: Независимая");
  });

  it("still resolves a known owner faction through factionDisplayLabel", () => {
    const texts = buildPanel(Faction.SYNDICATE);
    expect(texts).toContain("Фракция: Синдикат");
  });
});
