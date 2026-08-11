import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HangarPanel } from "@/presentation/ui/HangarPanel";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { LoadoutPreset } from "@/types";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { MONO_CHAR_WIDTH_RATIO } from "@/presentation/ui/questCardLayout";

afterEach(() => setFontScale("M"));

interface FakeNode {
  text: string;
  x: number;
  y: number;
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
  class Text extends FakeBase {
    text = "";
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
    Sprite: FakeBase,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

import { Container } from "pixi.js";

function makeRenderer(width: number, height: number): Renderer {
  return {
    app: {
      screen: { width, height },
      stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
    },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
  } as unknown as Renderer;
}

function makePlayer(): Player {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
    addOwnedGear: vi.fn(),
    removeOwnedGear: () => false,
    removeResource: vi.fn(),
  };
  const ship = {
    hullHP: 100,
    maxHull: 100,
    repair() {},
  };
  return { credits: 1000, inventory, ship } as unknown as Player;
}

function makeCtx(loadout: ShipLoadout | null, player: Player) {
  return {
    container: new Container(),
    player,
    loadout,
    bank: null,
    equipment: { installGear: vi.fn() } as unknown as EquipmentSystem,
    presets: [] as LoadoutPreset[],
    mutatePresets: vi.fn(),
    showToast: vi.fn(),
    addToastSlot: vi.fn(),
    rerender: vi.fn(),
    back: vi.fn(),
    openMicromoduleApply: vi.fn(),
  };
}

function findButton(prefix: string): FakeNode | undefined {
  return created.find((n) => n.text.startsWith(prefix));
}

describe("HangarPanel row name clamp (kill the label overlap)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("clamps a long fitted-slot gear name so it never crosses under [снять] on a narrow panel", () => {
    setFontScale("M");
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_torpedo"); // "Самонаводящаяся торпеда" — long name
    const player = makePlayer();

    new HangarPanel(makeRenderer(570, 700)).render(makeCtx(loadout, player));

    const fullLabel = `${gearById("wpn_torpedo")!.name} (T${gearById("wpn_torpedo")!.techLevel})`;
    const nameNode = created.find(
      (n) => n.text.includes("Самонав") && n.text !== fullLabel,
    );
    expect(
      nameNode,
      "expected the fitted-slot gear name to be truncated on a narrow panel",
    ).toBeTruthy();
    expect(nameNode!.text.length).toBeLessThan(fullLabel.length);

    const unBtn = findButton("[снять]") as unknown as { x: number } | undefined;
    expect(unBtn).toBeDefined();

    const charPx = scaledFont(11) * MONO_CHAR_WIDTH_RATIO;
    const nameRightEdge =
      (nameNode as unknown as { x: number }).x + nameNode!.text.length * charPx;
    expect(nameRightEdge).toBeLessThanOrEqual(unBtn!.x);
  });

  it("leaves a short fitted-slot gear name untouched", () => {
    setFontScale("M");
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();

    new HangarPanel(makeRenderer(1280, 800)).render(makeCtx(loadout, player));

    const gear = gearById("wpn_pulse")!;
    const expected = `${gear.name} (T${gear.techLevel})`;
    const nameNode = created.find((n) => n.text === expected);
    expect(nameNode, "short name should render in full").toBeTruthy();
  });
});
