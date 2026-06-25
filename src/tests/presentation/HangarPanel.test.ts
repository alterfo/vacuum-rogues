import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HangarPanel,
  explainInstallBlock,
} from "@/presentation/ui/HangarPanel";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";

/**
 * Task 3 (shared hangar): the slot-fitting hangar extracted out of StationScene
 * into a reusable component. These tests drive the panel directly (no scene),
 * asserting it renders the four categorized banks and that fit / unfit / sell
 * route through the canonical ShipLoadout + the shared gear helpers — so the
 * station and the equipment shop get identical behaviour from one source.
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

// Imported AFTER the mock so the panel + scaledText see the fake pixi.
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
  };
  return { credits: 1000, inventory } as unknown as Player;
}

function makeCtx(loadout: ShipLoadout | null, player: Player) {
  return {
    container: new Container(),
    player,
    loadout,
    bank: null,
    equipment: { installGear: vi.fn() } as unknown as EquipmentSystem,
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
    // Hull is a banner, not a slot.
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

  it("spaces «Установить» / «Продать» so the stacked actions never overlap", () => {
    // Regression (Task 3): the two warehouse actions sat 13 px apart in the same
    // right-hand column — inside the text height — so their hit boxes overlapped
    // and got mis-tapped. They must keep a clear vertical gap exceeding the
    // button height.
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

    // Same column (anchor 1,0.5), so non-overlap is purely a vertical-gap test:
    // centres must be at least one button height apart (the old 13 px gap < 14 px
    // height overlapped). Require a comfortable minimum beyond that.
    const gap = Math.abs(sellBtn!.y - installBtn!.y);
    expect(gap).toBeGreaterThan(installBtn!.height); // boxes don't overlap
    expect(gap).toBeGreaterThanOrEqual(16); // clear, un-mis-tappable spacing
  });

  it("blocks an over-mass warehouse install — toasts the reason, no mutation", () => {
    // hull_scout: massCapacity 30. Fill it to capacity, then try to install a
    // gear that fits a free bank but blows the mass budget.
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

    // No-op: gear stays in the warehouse, loadout unchanged, reason toasted red.
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
