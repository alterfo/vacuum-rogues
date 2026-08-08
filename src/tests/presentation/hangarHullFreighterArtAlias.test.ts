import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeNode {
  text: string;
  handlers: Record<string, (e: unknown) => void>;
}

const created: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    handlers: Record<string, (e: unknown) => void> = {};
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
    on(ev: string, cb: (e: unknown) => void) {
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
  class Sprite extends FakeBase {
    width = 0;
    height = 0;
    constructor(public texture?: unknown) {
      super();
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
      created.push(this as unknown as FakeNode);
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
    Sprite,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

const pickVariant = vi.fn().mockReturnValue(null);
vi.mock("@/presentation/textures", () => ({
  pickVariant: (...args: unknown[]) => pickVariant(...args),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));

import { Container } from "pixi.js";
import { HangarPanel } from "@/presentation/ui/HangarPanel";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";

const renderer = {
  app: {
    screen: { width: 1280, height: 800 },
    stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
  },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
} as unknown as Renderer;

function makePlayer(): Player {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
    addOwnedGear: vi.fn(),
    removeOwnedGear: vi.fn().mockReturnValue(false),
    removeResource: vi.fn(),
  };
  const ship = {
    hullHP: 1_000_000_000,
    maxHull: 1_000_000_000,
    repair: vi.fn(),
  };
  return { credits: 1000, inventory, ship } as unknown as Player;
}

function makeCtx(loadout: ShipLoadout, player: Player) {
  return {
    container: new Container(),
    player,
    loadout,
    bank: null,
    equipment: { installGear: vi.fn() } as unknown as EquipmentSystem,
    presets: [],
    mutatePresets: vi.fn(),
    showToast: vi.fn(),
    addToastSlot: vi.fn(),
    rerender: vi.fn(),
    back: vi.fn(),
    openMicromoduleApply: vi.fn(),
  };
}

describe("HangarPanel hull_freighter art alias (interim, pending art regeneration)", () => {
  beforeEach(() => {
    created.length = 0;
    pickVariant.mockClear();
  });

  it("resolves the hangar preview art through the alias, not heavy_freighter/ranger", () => {
    const loadout = new ShipLoadout("hull_freighter");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const shipArtCall = pickVariant.mock.calls.find(
      (call) => call[0] === "player_ships",
    );
    expect(shipArtCall).toBeDefined();
    expect(shipArtCall![1]).toBe("transport");
    expect(shipArtCall![1]).not.toBe("heavy_freighter");
  });
});
