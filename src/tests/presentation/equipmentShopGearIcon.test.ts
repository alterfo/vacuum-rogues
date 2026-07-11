/**
 * Task 7 (gear icon art category): the ГАЛАКТИЧЕСКАЯ shop's ТОВАРЫ gear
 * listing (`EquipmentShopScene.renderRows`) mounts each row's icon through
 * the SAME shared `gearIcon.ts` helper `HangarPanel` uses — never a forked
 * copy (root CLAUDE.md "one shared component" rule). This pins the wiring:
 * one `mountGearIcon` call per listed gear row, with that row's own `gear`
 * and its name-line position, and that the name text is offset by whatever
 * width the icon reports consuming (0 in every unit-test environment, since
 * no art is preloaded — mirrors `HangarPanel`'s existing icon-offset tests).
 */
import { describe, it, expect, vi } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";

const mountGearIconMock = vi.fn(
  (
    _container: unknown,
    _gear: unknown,
    _x: number,
    _y: number,
    _size: number,
  ) => 0,
);
vi.mock("@/presentation/ui/gearIcon", () => ({
  mountGearIcon: (
    container: unknown,
    gear: unknown,
    x: number,
    y: number,
    size: number,
  ) => mountGearIconMock(container, gear, x, y, size),
  gearIconKey: () => undefined,
}));

interface FakeNode {
  text: string;
  x: number;
  y: number;
  children: FakeNode[];
}

let created: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    width = 50;
    height = 14;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    hitArea: unknown = null;
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
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
      created.push(this as unknown as FakeNode);
    }
  }
  return {
    Container,
    Graphics,
    Text,
    FederatedPointerEvent: class {},
  };
});

// Imported AFTER the mocks so the scene sees the fakes.
import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";

const renderer = {
  app: {
    screen: { width: 1280, height: 800 },
    stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
  },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
} as unknown as Renderer;

function makeEngine(loadout: ShipLoadout) {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
  };
  return {
    player: {
      credits: 5000,
      currentSystemId: "sys1",
      ship: { hullClass: "SCOUT", hullHP: 80, maxHull: 100 },
      isHostileTo: () => false,
      inventory,
    },
    playerLoadout: loadout,
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1", stations: [] }] },
    audio: { playSfx: () => Promise.resolve() },
    questManager: {
      getActiveQuests: () => [],
      getCompletedQuestIds: () => [],
      getPendingReturnQuests: () => [],
    },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

const planet = {
  id: "p1",
  name: "Тест-мир",
  type: PlanetType.HABITAT,
} as unknown as import("@/domain/Planet").Planet;

function weaponListing(): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById("wpn_pulse")!,
    price: 200,
  };
}

describe("EquipmentShopScene gear listing — shared icon wiring (Task 7)", () => {
  it("mounts each row's icon through the shared gearIcon helper, offsetting the name by its consumed width", () => {
    mountGearIconMock.mockReset();
    mountGearIconMock.mockReturnValue(0);
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      weaponListing(),
    ];
    created = [];
    mountGearIconMock.mockClear();
    (scene as unknown as { render: () => void }).render();

    expect(mountGearIconMock).toHaveBeenCalledTimes(1);
    const [, gearArg] = mountGearIconMock.mock.calls[0];
    expect((gearArg as { id: string }).id).toBe("wpn_pulse");

    const gearName = gearById("wpn_pulse")!.name;
    const nameText = created.find((n) => n.text.includes(gearName));
    expect(nameText).toBeTruthy();
    // No icon width consumed (mock returns 0) -> name sits at the un-offset column.
    const [, , iconX] = mountGearIconMock.mock.calls[0];
    expect(nameText!.x).toBe(iconX);
  });

  it("offsets the name line by a non-zero icon width once art is loaded", () => {
    mountGearIconMock.mockReset();
    mountGearIconMock.mockReturnValue(20);
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      weaponListing(),
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    const gearName = gearById("wpn_pulse")!.name;
    const nameText = created.find((n) => n.text.includes(gearName));
    const [, , iconX] = mountGearIconMock.mock.calls[0];
    expect(nameText!.x).toBe(iconX + 20);
  });
});
