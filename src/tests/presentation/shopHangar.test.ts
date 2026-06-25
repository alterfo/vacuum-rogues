import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";

/**
 * Task 4 (shared hangar in the equipment shop): the planet Верфь mounts the same
 * `HangarPanel` the station uses, on a new АНГАР tab — one fitting surface, no
 * duplicate controls. These tests drive the real `EquipmentShopScene` through the
 * scene→panel path (the way the station's `hangarLayout.test.ts` does), asserting
 * the shop renders the shared hangar, that fitting from the shop mutates the same
 * canonical `ShipLoadout`, and that the gear tab no longer carries its own
 * uninstall control (it moved into the hangar).
 */

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
    width = 50;
    height = 14;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "auto";
    cursor = "default";
    hitArea: unknown = null;
    mask: unknown = null;
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
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

// Imported AFTER the mock so the scene + scaledText + panel see the fake pixi.
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
  };
  return {
    credits: 5000,
    currentSystemId: "sys1",
    ship: { hullClass: "SCOUT", maxHull: 100, energy: 40, maxEnergy: 50 },
    inventory,
  };
}

function makeEngine(loadout: ShipLoadout, ownedGearIds: string[] = []) {
  return {
    player: makePlayer(ownedGearIds),
    playerLoadout: loadout,
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1" }] },
    audio: { playSfx: () => Promise.resolve() },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

const planet = {
  id: "p1",
  name: "Тест-мир",
  type: PlanetType.HABITAT,
} as unknown as import("@/domain/Planet").Planet;

function texts(): string[] {
  return created.map((n) => n.text);
}

function findButton(label: string): FakeNode | undefined {
  return created.find((n) => n.text === label);
}

/** Switch to the АНГАР tab and re-render (clears the recorded texts first). */
function openHangar(scene: EquipmentShopScene): void {
  created.length = 0;
  (scene as unknown as { activeTab: string }).activeTab = "hangar";
  (scene as unknown as { rebuild: () => void }).rebuild();
}

const fakeEvent = { stopPropagation: () => {} };

describe("EquipmentShopScene — shared hangar on the АНГАР tab", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("renders the four categorized fitting banks (the shared HangarPanel)", () => {
    const loadout = new ShipLoadout("hull_scout"); // weapon 2, equip 2
    loadout.install("wpn_pulse"); // weapon → 1/2
    loadout.install("eq_engine_i"); // engine → 1/1

    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout), planet });
    openHangar(scene);

    const all = texts();
    expect(all.some((t) => t.includes("ОРУЖИЕ") && t.includes("1/2"))).toBe(
      true,
    );
    expect(all.some((t) => t.includes("ДВИГАТЕЛЬ") && t.includes("1/1"))).toBe(
      true,
    );
    expect(all.some((t) => t.includes("РАДАР") && t.includes("0/1"))).toBe(
      true,
    );
    expect(
      all.some((t) => t.includes("ОБОРУДОВАНИЕ") && t.includes("0/2")),
    ).toBe(true);
    // The hangar's own hull banner — proof it is the shared panel, not the
    // shop's own loadout strip.
    expect(all.some((t) => t.includes("Корпус:"))).toBe(true);

    scene.destroy();
  });

  it("installs owned warehouse gear from the shop, mutating the same ShipLoadout", () => {
    const loadout = new ShipLoadout("hull_scout"); // radar slot free
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(loadout, ["eq_radar"]),
      planet,
    });
    openHangar(scene);

    expect(loadout.installedGearIds()).not.toContain("eq_radar");
    const installBtn = findButton("[Установить]");
    expect(installBtn).toBeDefined();
    installBtn!.handlers.pointerdown(fakeEvent);

    // The fit routed through the canonical loadout (same model the station uses).
    expect(loadout.installedGearIds()).toContain("eq_radar");

    scene.destroy();
  });

  it("exposes an АНГАР tab and drops the gear tab's own «Снять» uninstall control", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("eq_radar"); // something fitted to list in УСТАНОВЛЕНО

    const scene = new EquipmentShopScene(renderer);
    // Default gear tab on init: the УСТАНОВЛЕНО strip is now read-only — no
    // standalone «Снять» control (fitting lives only in the hangar tab).
    scene.initialize({ gameEngine: makeEngine(loadout), planet });
    const gearTabTexts = texts();
    expect(gearTabTexts).toContain("[ АНГАР ]"); // the new tab is offered
    expect(gearTabTexts.some((t) => t === "Снять")).toBe(false);
    // The installed item still shows for at-a-glance comparison.
    expect(gearTabTexts.some((t) => t.includes("УСТАНОВЛЕНО"))).toBe(true);

    scene.destroy();
  });
});
