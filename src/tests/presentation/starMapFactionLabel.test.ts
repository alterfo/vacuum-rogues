/**
 * Task 6 (docs/plans/20260708-font-scale-and-faction-bugs.md): the star-map
 * system info-panel used to render `` `Владелец: ${system.ownerFaction}` `` —
 * the raw `Faction` enum string (e.g. "INDEPENDENT") — instead of a
 * localized label. This asserts `showSystemInfo` now renders the localized
 * `FACTION_LABEL` text for an `INDEPENDENT`-owned system.
 *
 * PixiJS `Text` needs real canvas metrics unavailable in jsdom, so this
 * mirrors the existing scene-level test convention (`equipmentShopFontScaleLayout.test.ts`):
 * a lightweight `pixi.js` mock whose `Graphics`/`Text`/`Container` are plain
 * mutable objects, so the source's real child/text assignments are directly
 * inspectable after render.
 */
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

// Imported AFTER the mock so the scene sees the fake pixi.
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
