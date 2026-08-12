import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HangarPanel,
  explainInstallBlock,
  gearIconKey,
} from "@/presentation/ui/HangarPanel";
import { gearById } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { LoadoutPreset } from "@/types";

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
    modules: [] as Array<{
      id: string;
      name: string;
      micromoduleId?: string;
      upgrades?: number;
    }>,
    addItem: vi.fn(function (
      this: { modules: Array<{ id: string; name: string }> },
      item: { id: string; name: string },
    ) {
      this.modules.push(item);
    }),
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
    removeResource(type: string, amount: number) {
      const stack = this.resources.find((r) => r.type === type);
      if (stack) stack.amount -= amount;
    },
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

function texts(): string[] {
  return created.map((n) => n.text);
}

function findButton(prefix: string): FakeNode | undefined {
  return created.find((n) => n.text.startsWith(prefix));
}

function findButtons(prefix: string): FakeNode[] {
  return created.filter((n) => n.text.startsWith(prefix));
}

const fakeEvent = { stopPropagation: () => {} };

describe("HangarPanel — shared slot-fitting component", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("renders the four categorized fitting banks with hull slot counts", () => {
    const loadout = new ShipLoadout("hull_scout"); // weapon 2, equip 2
    loadout.install("wpn_pulse"); // weapon → 1/2
    loadout.install("eq_engine_i"); // engine → 1/1
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

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
    expect(all.some((t) => t.includes("Корпус:"))).toBe(true);
  });

  it("installs warehouse gear through the canonical ShipLoadout", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]); // owned, uninstalled
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const installBtn = findButton("[Установить]");
    expect(installBtn).toBeDefined();
    installBtn!.handlers.pointerdown(fakeEvent);

    expect(loadout.installedGearIds()).toContain("eq_radar");
    expect(player.inventory.ownedGearIds).not.toContain("eq_radar");
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it("unfits a slot back off the loadout via [снять]", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const removeBtn = findButton("[снять]");
    expect(removeBtn).toBeDefined();
    removeBtn!.handlers.pointerdown(fakeEvent);

    expect(loadout.installedGearIds()).not.toContain("wpn_pulse");
    expect(player.inventory.addItem).toHaveBeenCalled(); // bagged, not destroyed
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it("a starter item unfitted via [снять] can then be sold from the bag (was permanently stuck)", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse"); // simulates a starter weapon installed with no ownedGearIds entry
    const player = makePlayer();
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);
    const creditsBefore = player.credits;

    panel.render(ctx);
    findButton("[снять]")!.handlers.pointerdown(fakeEvent);
    expect(player.inventory.modules.some((m) => m.id === "wpn_pulse")).toBe(
      true,
    );
    expect(player.inventory.ownedGearIds).not.toContain("wpn_pulse"); // never owned — starter gear

    created.length = 0;
    panel.render(ctx);

    const sellBtn = findButton("[Продать");
    expect(sellBtn).toBeDefined();
    sellBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.modules.some((m) => m.id === "wpn_pulse")).toBe(
      false,
    );
    expect(player.credits).toBeGreaterThan(creditsBefore);
  });

  it("sells owned warehouse gear through the shared sell seam", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const sellBtn = findButton("[Продать");
    expect(sellBtn).toBeDefined();
    sellBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.ownedGearIds).not.toContain("eq_radar");
    expect((player as unknown as { credits: number }).credits).toBeGreaterThan(
      1000,
    ); // refunded
    expect(ctx.showToast).toHaveBeenCalled();
  });

  it("sells a pre-existing legacy-bag item (a save's stuck starter gear can now be sold)", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    player.inventory.modules = [
      { id: "eq_radar", name: "Радар" },
    ] as unknown as Player["inventory"]["modules"];
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const sellBtn = findButton("[Продать");
    expect(sellBtn).toBeDefined();
    sellBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.modules).toHaveLength(0);
    expect((player as unknown as { credits: number }).credits).toBeGreaterThan(
      1000,
    ); // refunded
    expect(ctx.showToast).toHaveBeenCalled();
  });

  it("jettisons a pre-existing legacy-bag item via confirm/cancel", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    player.inventory.modules = [
      { id: "eq_radar", name: "Радар" },
    ] as unknown as Player["inventory"]["modules"];
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);

    panel.render(ctx);

    const jettisonBtn = findButton("[Выброс]");
    expect(jettisonBtn).toBeDefined();
    jettisonBtn!.handlers.pointerdown(fakeEvent);

    created.length = 0;
    panel.render(ctx);
    expect(player.inventory.modules).toHaveLength(1); // still there, pending confirm

    const confirmBtn = findButton("[Выбросить]");
    expect(confirmBtn).toBeDefined();
    confirmBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.modules).toHaveLength(0);
  });

  it("spaces «Установить» / «Продать» so the stacked actions never overlap", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]); // owned → both actions render
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const installBtn = findButton("[Установить]") as unknown as
      | { y: number; height: number }
      | undefined;
    const sellBtn = findButton("[Продать") as unknown as
      | { y: number; height: number }
      | undefined;
    expect(installBtn).toBeDefined();
    expect(sellBtn).toBeDefined();

    const gap = Math.abs(sellBtn!.y - installBtn!.y);
    expect(gap).toBeGreaterThan(installBtn!.height); // boxes don't overlap
    expect(gap).toBeGreaterThanOrEqual(16); // clear, un-mis-tappable spacing
  });

  it("blocks an over-mass warehouse install — toasts the reason, no mutation", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_torpedo"); // mass 12 → weapon 1/2
    loadout.install("wpn_torpedo"); // mass 12 → weapon 2/2, used 24
    loadout.install("eq_engine_i"); // mass 6 → used 30 (at capacity)
    const before = loadout.installedGearIds().slice();
    const player = makePlayer(["eq_shield"]); // free EQUIPMENT bank, mass 8 → over budget
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const installBtn = findButton("[Установить]");
    expect(installBtn).toBeDefined();
    installBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.ownedGearIds).toContain("eq_shield");
    expect(loadout.installedGearIds()).toEqual(before);
    expect(loadout.installedGearIds()).not.toContain("eq_shield");
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Перегруз"),
      expect.any(Number),
    );
  });

  it("renders nothing scene-coupled with a null loadout (banner falls back)", () => {
    const player = makePlayer();
    new HangarPanel(renderer).render(makeCtx(null, player));
    expect(texts().some((t) => t.includes("Корпус: —"))).toBe(true);
  });
});

describe("HangarPanel scrolling — overflowing content stays reachable (bug report: repair droid unreachable below the fold)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  const tinyRenderer = {
    app: {
      screen: { width: 1280, height: 260 },
      stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
    },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
  } as unknown as Renderer;

  it("still renders every fitted slot's [снять] button when the fitting-bank column overflows the visible height", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    loadout.install("eq_engine_i");
    const player = makePlayer();

    new HangarPanel(tinyRenderer).render(makeCtx(loadout, player));

    const unfitButtons = created.filter((n) => n.text === "[снять]");
    expect(unfitButtons.length).toBe(2);
  });

  it("still renders every warehouse row when the СКЛАД column overflows the visible height", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    player.inventory.modules = Array.from({ length: 6 }, (_, i) => ({
      id: `fake_item_${i}`,
      name: `Дроид-ремонтник ${i}`,
    })) as unknown as Player["inventory"]["modules"];
    const ctx = makeCtx(loadout, player);

    new HangarPanel(tinyRenderer).render(ctx);

    for (let i = 0; i < 6; i++) {
      expect(created.some((n) => n.text.includes(`Дроид-ремонтник ${i}`))).toBe(
        true,
      );
    }
  });

  it("reports a positive scroll range for both columns once content overflows the visible band", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    player.inventory.modules = [
      { id: "fake_1", name: "Item 1" },
    ] as unknown as Player["inventory"]["modules"];
    const panel = new HangarPanel(tinyRenderer);

    panel.render(makeCtx(loadout, player));

    const info = panel.getScrollInfo();
    expect(info.left.max).toBeGreaterThan(0);
    expect(info.right.max).toBeGreaterThan(0);
    expect(info.left.offset).toBe(0);
    expect(info.right.offset).toBe(0);
  });

  it("scrolls the overflowing column on a window wheel event, clamped to its max", () => {
    const wheelHandlers: Array<(e: WheelEvent) => void> = [];
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, handler) => {
        if (String(type) === "wheel") {
          wheelHandlers.push(handler as (e: WheelEvent) => void);
        }
      });
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const loadout = new ShipLoadout("hull_scout");
      loadout.install("wpn_pulse");
      loadout.install("eq_engine_i");
      const player = makePlayer();
      const panel = new HangarPanel(tinyRenderer);

      panel.render(makeCtx(loadout, player));

      expect(wheelHandlers.length).toBeGreaterThanOrEqual(1);
      const before = panel.getScrollInfo();
      expect(before.left.offset).toBe(0);

      for (const wheel of wheelHandlers) {
        wheel({
          deltaY: 100,
          preventDefault: vi.fn(),
        } as unknown as WheelEvent);
      }
      const scrolled = panel.getScrollInfo();
      expect(scrolled.left.offset).toBeGreaterThan(0);
      expect(scrolled.left.offset).toBeLessThanOrEqual(scrolled.left.max);

      for (const wheel of wheelHandlers) {
        for (let i = 0; i < 50; i++) {
          wheel({
            deltaY: 1000,
            preventDefault: vi.fn(),
          } as unknown as WheelEvent);
        }
      }
      const clamped = panel.getScrollInfo();
      expect(clamped.left.offset).toBe(clamped.left.max);

      const priorRemoveCalls = removeSpy.mock.calls.length;
      panel.render(makeCtx(loadout, player));
      expect(removeSpy.mock.calls.length).toBeGreaterThan(priorRemoveCalls);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

describe("explainInstallBlock — shared fit-block reason (one source of truth)", () => {
  it("returns null when the gear fits", () => {
    const loadout = new ShipLoadout("hull_scout");
    expect(explainInstallBlock(loadout, "eq_tank")).toBeNull();
  });

  it("reports a full category bank by name", () => {
    const loadout = new ShipLoadout("hull_scout"); // weapon 2
    loadout.install("wpn_pulse");
    loadout.install("wpn_pulse"); // weapon 2/2 full
    const reason = explainInstallBlock(loadout, "wpn_beam");
    expect(reason).toContain("Нет слота");
    expect(reason).toContain("ОРУЖИЕ");
  });

  it("reports an over-mass install even with a free slot", () => {
    const loadout = new ShipLoadout("hull_scout"); // massCapacity 30
    loadout.install("wpn_torpedo"); // mass 12
    loadout.install("wpn_torpedo"); // mass 12 → weapon 2/2, used 24
    loadout.install("eq_engine_i"); // mass 6 → used 30 (at capacity)
    const reason = explainInstallBlock(loadout, "eq_shield"); // free bank, mass 8
    expect(reason).toContain("Перегруз");
  });
});

describe("HangarPanel ring (Task 4) — SR2-style zone grouping over the unchanged 4-bank model", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("renders the four SR2 ring group titles alongside the unchanged bank headers", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const all = texts();
    expect(all).toContain("ВООРУЖЕНИЕ");
    expect(all).toContain("СИСТЕМА ДВИЖЕНИЯ");
    expect(all).toContain("СИСТЕМА ОТСЛЕЖИВАНИЯ");
    expect(all).toContain("ДОПОЛНИТЕЛЬНОЕ ОБОРУДОВАНИЕ");
    expect(all.some((t) => t.includes("ОРУЖИЕ") && t.includes("0/2"))).toBe(
      true,
    );
  });

  it("shows a fitted fuel tank in the movement zone (above the bottom equipment zone), not the misc equipment row", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("eq_tank");
    loadout.install("eq_shield");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const tankName = gearById("eq_tank")!.name;
    const shieldName = gearById("eq_shield")!.name;
    const tankNode = created.find((n) => n.text.startsWith(tankName)) as
      | { y: number }
      | undefined;
    const shieldNode = created.find((n) => n.text.startsWith(shieldName)) as
      | { y: number }
      | undefined;
    expect(tankNode).toBeDefined();
    expect(shieldNode).toBeDefined();
    expect(tankNode!.y).toBeLessThan(shieldNode!.y);
  });

  it("draws the central hull-view box with the hull's plain name, distinct from the top banner", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const all = texts();
    expect(all.some((t) => t === `Корпус: ${loadout.hull.name}`)).toBe(true);
    expect(all.some((t) => t === loadout.hull.name)).toBe(true);
  });
});

describe("gearIconKey — module-class icon resolution (Task 4)", () => {
  it("resolves the 6 module classes with existing art to their icon key", () => {
    expect(gearIconKey(gearById("wpn_pulse")!)).toBe("icons/laser");
    expect(gearIconKey(gearById("eq_engine_i")!)).toBe("icons/engine");
    expect(gearIconKey(gearById("eq_tank")!)).toBe("icons/fuel_tank");
    expect(gearIconKey(gearById("eq_radar")!)).toBe("icons/radar");
    expect(gearIconKey(gearById("eq_shield")!)).toBe("icons/shield");
    expect(gearIconKey(gearById("eq_droid")!)).toBe("icons/repair_droid");
  });

  it("falls back to undefined for module classes with no art yet", () => {
    expect(gearIconKey(gearById("eq_scanner")!)).toBeUndefined();
    expect(gearIconKey(gearById("eq_grapple_i")!)).toBeUndefined();
  });
});

describe("HangarPanel — ВЫБРОСИТЬ/ШЛЮЗ jettison (Task 5)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("arms a two-step confirm before jettisoning owned gear — no mutation until confirmed", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);

    panel.render(ctx);
    const jettisonBtn = findButton("[Выброс]");
    expect(jettisonBtn).toBeDefined();
    jettisonBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.ownedGearIds).toContain("eq_radar");
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it("discards owned gear with no credit refund once the confirm click lands", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);
    const creditsBefore = player.credits;

    panel.render(ctx);
    findButton("[Выброс]")!.handlers.pointerdown(fakeEvent);

    created.length = 0;
    panel.render(ctx); // re-render as the host scene's ctx.rerender() would

    const confirmBtn = findButton("[Выбросить]");
    expect(confirmBtn).toBeDefined();
    confirmBtn!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.ownedGearIds).not.toContain("eq_radar");
    expect(player.credits).toBe(creditsBefore); // no refund — selling is the paid path
  });

  it("cancelling the confirm leaves the gear in the warehouse untouched", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);

    panel.render(ctx);
    findButton("[Выброс]")!.handlers.pointerdown(fakeEvent);

    created.length = 0;
    panel.render(ctx);
    findButton("[Отмена]")!.handlers.pointerdown(fakeEvent);

    created.length = 0;
    panel.render(ctx);

    expect(player.inventory.ownedGearIds).toContain("eq_radar");
    expect(findButton("[Выброс]")).toBeDefined(); // back to the normal row state
  });

  it("jettisons a cargo resource stack through the ТРЮМ [Выброс] action", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(); // no owned gear — only the ТРЮМ row offers [Выброс]
    player.inventory.resources = [
      { type: "METALS", amount: 5 },
    ] as unknown as Player["inventory"]["resources"];
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);

    panel.render(ctx);
    findButton("[Выброс]")!.handlers.pointerdown(fakeEvent);

    created.length = 0;
    panel.render(ctx);
    findButton("[Выбросить]")!.handlers.pointerdown(fakeEvent);

    expect(player.inventory.resources).toEqual([{ type: "METALS", amount: 0 }]);
  });
});

describe("HangarPanel — СЕРВИСНЫЙ ЦЕНТР repair block (Task 5)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("shows «не требуется» and no repair button when the hull is already at max", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    expect(texts().some((t) => t.includes("СЕРВИСНЫЙ ЦЕНТР"))).toBe(true);
    expect(texts().some((t) => t.includes("не требуется"))).toBe(true);
    expect(findButton("[Полный ремонт")).toBeUndefined();
  });

  it("prices a damaged hull off the shared repairCost seam and repairs it on click", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    const maxHull = loadout.derivedStats().maxHull;
    (
      player as unknown as {
        ship: { hullHP: number; maxHull: number; repair: () => void };
      }
    ).ship = {
      hullHP: maxHull - 10,
      maxHull,
      repair(this: { hullHP: number; maxHull: number }) {
        this.hullHP = this.maxHull;
      },
    };
    const ctx = makeCtx(loadout, player);
    const creditsBefore = player.credits;

    new HangarPanel(renderer).render(ctx);

    const repairBtn = findButton("[Полный ремонт");
    expect(repairBtn).toBeDefined();
    expect(repairBtn!.text).toBe("[Полный ремонт 20₡]"); // 10 missing HP × 2 cr/HP

    repairBtn!.handlers.pointerdown(fakeEvent);

    expect(
      (player as unknown as { ship: { hullHP: number } }).ship.hullHP,
    ).toBe(maxHull);
    expect(player.credits).toBe(creditsBefore - 20);
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it("full repair also restores shields and energy, not just hull (matches the planet Верфь)", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    const maxHull = loadout.derivedStats().maxHull;
    const repairSpy = vi.fn(function (this: {
      hullHP: number;
      maxHull: number;
      shields: number;
      maxShields: number;
    }) {
      this.hullHP = this.maxHull;
      this.shields = this.maxShields;
    });
    (
      player as unknown as {
        ship: {
          hullHP: number;
          maxHull: number;
          shields: number;
          maxShields: number;
          repair: () => void;
        };
      }
    ).ship = {
      hullHP: maxHull - 10,
      maxHull,
      shields: 0,
      maxShields: 50,
      repair: repairSpy,
    };
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButton("[Полный ремонт")!.handlers.pointerdown(fakeEvent);

    expect(repairSpy).toHaveBeenCalledTimes(1);
    expect(
      (player as unknown as { ship: { shields: number } }).ship.shields,
    ).toBe(50);
  });

  it("blocks the repair with a toast, no mutation, when the player can't afford it", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    player.credits = 0;
    const maxHull = loadout.derivedStats().maxHull;
    (player as unknown as { ship: { hullHP: number; maxHull: number } }).ship =
      { hullHP: maxHull - 10, maxHull };
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButton("[Полный ремонт")!.handlers.pointerdown(fakeEvent);

    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("недостаточно"),
      expect.any(Number),
    );
    expect(
      (player as unknown as { ship: { hullHP: number } }).ship.hullHP,
    ).toBe(maxHull - 10);
  });
});

describe("HangarPanel — КОМПЛЕКТАЦИЯ 1/2/3 preset tabs (Task 6)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("renders three К1/К2/К3 tab labels with a [Сохр] action each", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    expect(texts().some((t) => t.includes("К1:"))).toBe(true);
    expect(texts().some((t) => t.includes("К2:"))).toBe(true);
    expect(texts().some((t) => t.includes("К3:"))).toBe(true);
    expect(findButtons("[Сохр]")).toHaveLength(3);
  });

  it("[Сохр] captures the live fitting and persists it via ctx.mutatePresets", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButtons("[Сохр]")[0].handlers.pointerdown(fakeEvent);

    expect(ctx.mutatePresets).toHaveBeenCalledTimes(1);
    const saved = ctx.mutatePresets.mock.calls[0][0] as Array<{
      name: string;
      slots: Array<{ gearId: string }>;
    }>;
    expect(saved).toEqual([
      {
        name: "1",
        slots: [{ gearId: "wpn_pulse", micromoduleId: undefined }],
        hullMicromoduleIds: [],
      },
    ]);
    expect(ctx.showToast).toHaveBeenCalled();
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it("[Прим] is inert (no eventMode) for an empty preset slot", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const applyBtns = findButtons("[Прим]");
    expect(applyBtns).toHaveLength(3);
    expect(applyBtns[0].handlers.pointerdown).toBeUndefined();
  });

  it("[Прим] re-fits a saved preset through the canonical loadout", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    const preset = {
      name: "1" as const,
      slots: [{ gearId: "wpn_pulse" }],
    };
    const ctx = makeCtx(loadout, player, [preset]);

    new HangarPanel(renderer).render(ctx);
    findButton("[снять]")!.handlers.pointerdown(fakeEvent);
    expect(loadout.installedGearIds()).not.toContain("wpn_pulse");

    findButtons("[Прим]")[0].handlers.pointerdown(fakeEvent);

    expect(loadout.installedGearIds()).toContain("wpn_pulse");
    expect(ctx.showToast).toHaveBeenCalled();
  });

  it("[X] clears a saved preset via ctx.mutatePresets", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    const presets = [
      { name: "1" as const, slots: [] },
      { name: "2" as const, slots: [] },
    ];
    const ctx = makeCtx(loadout, player, presets);

    new HangarPanel(renderer).render(ctx);
    findButtons("[X]")[0].handlers.pointerdown(fakeEvent);

    expect(ctx.mutatePresets).toHaveBeenCalledWith([presets[1]]);
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it("[X] is inert for an already-empty preset slot", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const clearBtns = findButtons("[X]");
    expect(clearBtns).toHaveLength(3);
    expect(clearBtns[0].handlers.pointerdown).toBeUndefined();
  });
});
