import { describe, it, expect, vi } from "vitest";
import { HangarPanel } from "@/presentation/ui/HangarPanel";
import { gearById } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { LoadoutPreset } from "@/types";

interface FakeNode {
  text: string;
  eventMode: string;
  handlers: Record<string, () => void>;
}

let texts: FakeNode[] = [];
let graphicsNodes: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    handlers: Record<string, () => void> = {};
    children: unknown[] = [];
    x = 0;
    y = 0;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "auto";
    cursor = "default";
    hitArea: unknown = null;
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    destroyed = false;
    on(ev: string, cb: () => void) {
      this.handlers[ev] = cb;
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    removeChildren() {
      const c = this.children;
      this.children = [];
      return c;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    constructor() {
      super();
      graphicsNodes.push(this as unknown as FakeNode);
    }
    rect() {
      return this;
    }
    roundRect() {
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
    text = "";
    width = 50;
    height = 14;
    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      texts.push(this as unknown as FakeNode);
    }
  }
  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public w = 0,
      public h = 0,
    ) {}
  }
  return {
    Container,
    Graphics,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

import { Container } from "pixi.js";

const renderer = {
  app: {
    screen: { width: 1280, height: 800 },
    stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
  },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
} as unknown as Renderer;

function makePlayer(ownedGearIds: string[] = []) {
  const inventory = {
    ownedGearIds: [...ownedGearIds],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
    addOwnedGear(id: string) {
      this.ownedGearIds.push(id);
    },
    removeOwnedGear(id: string) {
      const i = this.ownedGearIds.indexOf(id);
      if (i >= 0) {
        this.ownedGearIds.splice(i, 1);
        return true;
      }
      return false;
    },
    removeResource() {},
  };
  const ship = {
    hullHP: 1_000_000_000,
    maxHull: 1_000_000_000,
    repair(this: { hullHP: number; maxHull: number }) {
      this.hullHP = this.maxHull;
    },
  };
  return { credits: 1000, inventory, ship } as unknown as Player;
}

function makeCtx(
  loadout: ShipLoadout | null,
  player: Player,
  presets: LoadoutPreset[] = [],
) {
  return {
    container: new Container(),
    player,
    loadout,
    bank: null,
    equipment: { installGear: vi.fn() } as unknown as EquipmentSystem,
    presets,
    mutatePresets: vi.fn(),
    showToast: vi.fn(),
    addToastSlot: vi.fn(),
    rerender: vi.fn(),
    back: vi.fn(),
    openMicromoduleApply: vi.fn(),
  };
}

describe("HangarPanel fitted-slot hover tooltip (Task 10)", () => {
  it("shows a stat tooltip for the fitted weapon on pointerover and hides it on pointerout", () => {
    texts = [];
    graphicsNodes = [];
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const slotBg = graphicsNodes.find(
      (g) => g.eventMode === "static" && !!g.handlers.pointerover,
    );
    expect(slotBg, "fitted-slot background must be hoverable").toBeTruthy();

    const beforeCount = texts.length;
    slotBg!.handlers.pointerover();

    const gear = gearById("wpn_pulse")!;
    const tooltipTexts = texts.slice(beforeCount);
    expect(tooltipTexts.some((t) => t.text === gear.name)).toBe(true);
    expect(tooltipTexts.some((t) => t.text.includes("Урон:"))).toBe(true);

    slotBg!.handlers.pointerout();
    const beforeCount2 = texts.length;
    slotBg!.handlers.pointerover();
    expect(texts.length).toBeGreaterThan(beforeCount2);
  });
});
