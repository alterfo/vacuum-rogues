import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HangarPanel,
  micromoduleSlotControl,
} from "@/presentation/ui/HangarPanel";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { ModuleCategory } from "@/types";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { LoadoutPreset } from "@/types";
import type { SfxKey } from "@/systems/AudioManager";

/**
 * Task 8: the shared hangar had ZERO sound effects on any of its actions
 * (repair / sell / install / jettison / loadout presets), and its fitted-slot
 * micromodule control showed the misleading "[нет микромодулей]" label even for
 * gear that structurally can never take a micromodule. These tests drive the
 * real panel (fake PixiJS) and assert the right `SfxKey` fires per action, plus
 * pin the corrected label logic on the pure resolver.
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
  const playSfx = vi.fn<[SfxKey], void>();
  const ctx = {
    container: new Container(),
    player,
    loadout,
    bank: null,
    equipment: { installGear: vi.fn() } as unknown as EquipmentSystem,
    presets,
    mutatePresets: vi.fn(),
    showToast: vi.fn(),
    playSfx,
    addToastSlot: vi.fn(),
    rerender: vi.fn(),
    back: vi.fn(),
    openMicromoduleApply: vi.fn(),
  };
  return ctx;
}

function findButton(prefix: string): FakeNode | undefined {
  return created.find((n) => n.text.startsWith(prefix));
}

function findButtons(prefix: string): FakeNode[] {
  return created.filter((n) => n.text.startsWith(prefix));
}

const fakeEvent = { stopPropagation: () => {} };

describe("micromoduleSlotControl — corrected fitted-slot label (Task 8)", () => {
  it("labels a compatible-module-on-hand slot as the actionable install", () => {
    expect(micromoduleSlotControl(ModuleCategory.WEAPON, true)).toEqual({
      label: "[установить микромодуль]",
      actionable: true,
    });
  });

  it("labels a fittable-but-none-owned slot as «нет микромодулей» (inert)", () => {
    expect(micromoduleSlotControl(ModuleCategory.WEAPON, false)).toEqual({
      label: "[нет микромодулей]",
      actionable: false,
    });
  });

  it("labels a structurally-non-fittable slot distinctly, NOT «нет микромодулей»", () => {
    const control = micromoduleSlotControl(null, false);
    expect(control.actionable).toBe(false);
    expect(control.label).not.toBe("[нет микромодулей]");
    expect(control.label).toBe("[микромодуль не ставится]");
  });
});

describe("HangarPanel — fitted-slot micromodule label rendering (Task 8)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("renders «нет микромодулей» for a fitted weapon with no compatible module owned", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    expect(findButton("[нет микромодулей]")).toBeDefined();
    expect(findButton("[микромодуль не ставится]")).toBeUndefined();
  });

  it("renders the actionable install label once a compatible weapon module is owned", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    player.inventory.micromodules = [
      {
        id: "mm_wpn",
        name: "Усилитель",
        targetCategory: ModuleCategory.WEAPON,
      },
    ] as unknown as Player["inventory"]["micromodules"];

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    expect(findButton("[установить микромодуль]")).toBeDefined();
  });
});

describe("HangarPanel — action SFX (Task 8: hangar had zero sound effects)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("plays «sell» when selling owned warehouse gear", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButton("[Продать")!.handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("sell");
  });

  it("plays «ui_click» when installing warehouse gear", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButton("[Установить]")!.handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("ui_click");
  });

  it("plays «buy» when repairing the hull at the СЕРВИСНЫЙ ЦЕНТР", () => {
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

    new HangarPanel(renderer).render(ctx);
    findButton("[Полный ремонт")!.handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("buy");
  });

  it("does NOT play the repair SFX when the player can't afford it", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    player.credits = 0;
    const maxHull = loadout.derivedStats().maxHull;
    (player as unknown as { ship: { hullHP: number; maxHull: number } }).ship =
      {
        hullHP: maxHull - 10,
        maxHull,
      };
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButton("[Полный ремонт")!.handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).not.toHaveBeenCalled();
  });

  it("plays «ui_click» when a jettison confirm lands", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]);
    const ctx = makeCtx(loadout, player);
    const panel = new HangarPanel(renderer);

    panel.render(ctx);
    findButton("[Выброс]")!.handlers.pointerdown(fakeEvent);

    created.length = 0;
    panel.render(ctx); // as the host's rerender() would
    ctx.playSfx.mockClear();
    findButton("[Выбросить]")!.handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("ui_click");
  });

  it("plays «ui_click» on saving a loadout preset", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);
    findButtons("[Сохр]")[0].handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("ui_click");
  });

  it("plays «ui_click» on applying a saved loadout preset", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    const preset = { name: "1" as const, slots: [{ gearId: "wpn_pulse" }] };
    const ctx = makeCtx(loadout, player, [preset]);

    new HangarPanel(renderer).render(ctx);
    findButtons("[Прим]")[0].handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("ui_click");
  });

  it("plays «ui_click» on clearing a saved loadout preset", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer();
    const presets = [{ name: "1" as const, slots: [] }];
    const ctx = makeCtx(loadout, player, presets);

    new HangarPanel(renderer).render(ctx);
    findButtons("[X]")[0].handlers.pointerdown(fakeEvent);

    expect(ctx.playSfx).toHaveBeenCalledWith("ui_click");
  });
});
