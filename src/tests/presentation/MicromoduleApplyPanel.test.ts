import { describe, it, expect, vi, beforeEach } from "vitest";
import { MicromoduleApplyPanel } from "@/presentation/ui/MicromoduleApplyPanel";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { ModuleCategory } from "@/types";
import type { Renderer } from "@/presentation/Renderer";
import type { Player } from "@/domain/Player";
import type { MicroModule } from "@/types";

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
    eventMode = "auto";
    cursor = "default";
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
      this.children = [];
      return [];
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
  }
  class Text extends FakeBase {
    text = "";
    width = 50;
    height = 14;
    style: Record<string, unknown> = {};
    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      created.push(this as unknown as FakeNode);
    }
  }
  return { Container, Graphics, Text, Rectangle: class {} };
});

import { Container } from "pixi.js";

const renderer = {
  app: { screen: { width: 1280, height: 800 } },
} as unknown as Renderer;

const mmWeapon: MicroModule = {
  id: "mm_wpn_1",
  name: "Усилитель урона ур.1",
  targetCategory: ModuleCategory.WEAPON,
  bonusType: "damage",
  bonusTier: 1,
};
const mmEngine: MicroModule = {
  id: "mm_eng_1",
  name: "Форсаж ур.1",
  targetCategory: ModuleCategory.ENGINE,
  bonusType: "speed",
  bonusTier: 1,
};

function makePlayer(micromodules: MicroModule[]): Player {
  return {
    inventory: { micromodules: [...micromodules] },
  } as unknown as Player;
}

function makeCtx(
  loadout: ShipLoadout,
  player: Player,
  target: { slotIndex: number; gearId: string },
) {
  return {
    container: new Container(),
    player,
    loadout,
    target,
    showToast: vi.fn(),
    onClose: vi.fn(),
  };
}

function findButton(prefix: string): FakeNode | undefined {
  return created.find((n) => n.text.startsWith(prefix));
}

const fakeEvent = { stopPropagation: () => {} };

describe("MicromoduleApplyPanel — shared apply modal", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("lists only micromodules whose category matches the fitted slot", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse"); // slot 0 → WEAPON
    const player = makePlayer([mmWeapon, mmEngine]);

    new MicromoduleApplyPanel(renderer).render(
      makeCtx(loadout, player, { slotIndex: 0, gearId: "wpn_pulse" }),
    );

    const labels = created.map((n) => n.text);
    expect(labels.some((t) => t.includes("Усилитель урона ур.1"))).toBe(true);
    expect(labels.some((t) => t.includes("Форсаж"))).toBe(false);
  });

  it("shows the empty state when no owned micromodule matches the slot", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer([mmEngine]); // wrong category only

    new MicromoduleApplyPanel(renderer).render(
      makeCtx(loadout, player, { slotIndex: 0, gearId: "wpn_pulse" }),
    );

    expect(
      created.some((n) => n.text.includes("Нет подходящих микромодулей")),
    ).toBe(true);
    expect(findButton("[Применить]")).toBeUndefined();
  });

  it("applies the chosen micromodule onto the exact slot and consumes it", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer([mmWeapon]);
    const ctx = makeCtx(loadout, player, { slotIndex: 0, gearId: "wpn_pulse" });

    new MicromoduleApplyPanel(renderer).render(ctx);

    findButton("[Применить]")!.handlers.pointerdown(fakeEvent);

    expect(loadout.micromoduleAt(0)).toBe("mm_wpn_1");
    expect(player.inventory.micromodules).toHaveLength(0); // consumed
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Применён"),
      expect.any(Number),
    );
    expect(ctx.onClose).toHaveBeenCalled();
  });

  it("reports failure and keeps the micromodule when the slot is already fitted", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    loadout.applyMicromoduleAt(0, "mm_wpn_2"); // slot already has one
    const player = makePlayer([mmWeapon]);
    const ctx = makeCtx(loadout, player, { slotIndex: 0, gearId: "wpn_pulse" });

    new MicromoduleApplyPanel(renderer).render(ctx);

    findButton("[Применить]")!.handlers.pointerdown(fakeEvent);

    expect(loadout.micromoduleAt(0)).toBe("mm_wpn_2"); // unchanged
    expect(player.inventory.micromodules).toHaveLength(1); // not consumed
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Не удалось"),
      expect.any(Number),
    );
    expect(ctx.onClose).toHaveBeenCalled();
  });

  it("bails to onClose without drawing when the fitted item has vanished", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer([mmWeapon]);
    const ctx = makeCtx(loadout, player, {
      slotIndex: 0,
      gearId: "no_such_gear",
    });

    new MicromoduleApplyPanel(renderer).render(ctx);

    expect(ctx.onClose).toHaveBeenCalled();
    expect(findButton("[Применить]")).toBeUndefined();
  });
});
