import { describe, it, expect, vi } from "vitest";
import type { Renderer } from "@/presentation/Renderer";
import { Faction } from "@/types/faction";
import type { StarSystem } from "@/domain/StarSystem";

interface FakeNode {
  text: string;
  x: number;
  y: number;
  children: FakeNode[];
}

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    children: FakeNode[] = [];
    on() {
      return this;
    }
    addChild(c: FakeNode) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    removeChildren() {
      const c = this.children;
      this.children = [];
      return c;
    }
    destroy() {}
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
    clear() {
      return this;
    }
  }
  class Text extends FakeBase {
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
    }
  }
  class Sprite extends FakeBase {}
  class BlurFilter {}
  return {
    Container,
    Graphics,
    Text,
    Sprite,
    BlurFilter,
    FederatedPointerEvent: class {},
  };
});

const { StarMapScene } = await import("@/presentation/StarMapScene");

function makeSystem(ownerFaction: Faction): StarSystem {
  return {
    id: "sys-1",
    name: "Альфа",
    ownerFaction,
    planets: [],
    connections: [],
  } as unknown as StarSystem;
}

describe("star-map info panel renders a localized faction label", () => {
  it("shows the localized 'Независимая' label, not the raw INDEPENDENT string", () => {
    const uiLayer = { addChild: vi.fn(), removeChild: vi.fn(), children: [] };
    const renderer = {
      app: { screen: { width: 800 } },
      uiLayer,
    } as unknown as Renderer;

    const scene = new StarMapScene(renderer);
    const fields = scene as unknown as Record<string, unknown>;
    fields.playerSystemId = null; // skip the interactive fuel/warp branches

    (
      scene as unknown as { showSystemInfo(system: StarSystem): void }
    ).showSystemInfo(makeSystem(Faction.INDEPENDENT));

    const infoPanel = fields.infoPanel as FakeNode;
    const factionText = infoPanel.children.find((c) =>
      c.text?.startsWith("Владелец:"),
    );
    expect(factionText?.text).toBe("Владелец: Независимая");
    expect(factionText?.text).not.toContain("INDEPENDENT");
  });
});
