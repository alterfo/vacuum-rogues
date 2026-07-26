/**
 * Task 10 (quest-and-hub polish pass,
 * `docs/plans/20260726-quest-and-hub-polish-pass.md`): robot-assistant voice at
 * repair / refuel / hull-diagnostic.
 *
 * Canon §11.4 asks hangar/station service interactions to speak with a short
 * robot-assistant voice («System check: … Ship ready for launch») rather than a
 * bare mechanical toast. This suite pins the pure voice-line builders and asserts
 * the line actually reaches the toast on each of the three actions — station
 * repair (`StationScene.doRepair`), station refuel (`StationScene.doRefuel`), and
 * the hangar СЕРВИСНЫЙ ЦЕНТР diagnostic (`HangarPanel` repair button).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  repairVoiceLine,
  refuelVoiceLine,
  diagnosticVoiceLine,
} from "@/systems/equipment/serviceVoice";

// ── pure voice-line builders ────────────────────────────────────────────────
describe("service voice lines (Task 10) — pure builders", () => {
  it("repair line names the cost and the ship-ready framing in robot voice", () => {
    const line = repairVoiceLine(200);
    expect(line).toContain("Сервис-бот");
    expect(line).toContain("200 ₡");
    expect(line).toContain("восстановлен");
    expect(line).toContain("к вылету готовы");
  });

  it("refuel line names the cost and a fuel-system status in robot voice", () => {
    const line = refuelVoiceLine(40);
    expect(line).toContain("Сервис-бот");
    expect(line).toContain("40 ₡");
    expect(line).toContain("заправлены");
    expect(line).toContain("Топливная система");
  });

  it("diagnostic line frames the repair as a completed systems check", () => {
    const line = diagnosticVoiceLine(120);
    expect(line).toContain("Сервис-бот");
    expect(line).toContain("120 ₡");
    expect(line).toContain("диагностика");
    expect(line).toContain("Проверка пройдена");
  });

  it("all three lines are distinct (each action reads differently)", () => {
    const lines = new Set([
      repairVoiceLine(10),
      refuelVoiceLine(10),
      diagnosticVoiceLine(10),
    ]);
    expect(lines.size).toBe(3);
  });
});

// ── scene wiring ────────────────────────────────────────────────────────────
interface FakeNode {
  text: string;
  alpha: number;
  handlers: Record<string, (e: unknown) => void>;
  children: FakeNode[];
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
    roundRect() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
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

// Imported AFTER the mock so the scenes + helpers see the fake pixi.
import { Container } from "pixi.js";
import { StationScene } from "@/presentation/StationScene";
import { HangarPanel } from "@/presentation/ui/HangarPanel";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import { StationType } from "@/types";

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

function makeEngine() {
  const inventory = {
    ownedGearIds: [] as string[],
    modules: [] as Array<{ id: string; name: string }>,
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    addOwnedGear: vi.fn(),
    removeOwnedGear: vi.fn(() => true),
  };
  return {
    player: {
      credits: 1_000_000,
      currentSystemId: "sys1",
      currentAccountId: "acc1",
      rank: 0,
      // 20 HP missing, 10 energy missing — both service paths take the success
      // branch.
      ship: { hullHP: 80, maxHull: 100, energy: 40, maxEnergy: 50 },
      isHostileTo: () => false,
      inventory,
    },
    playerLoadout: null,
    playerLoadoutPresets: [],
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1", stations: [] }] },
    audio: { playSfx: vi.fn(() => Promise.resolve()) },
    questManager: {
      getActiveQuests: () => [],
      getCompletedQuestIds: () => [],
      getPendingReturnQuests: () => [],
      claimReturnReward: vi.fn(() => true),
    },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as GameEngine;
}

function station(type: StationType): Station {
  return { id: "base-1", name: "Тест-база", type } as unknown as Station;
}

function toast(scene: object): FakeNode | null {
  return (scene as { toast: FakeNode | null }).toast;
}

beforeEach(() => {
  created.length = 0;
  vi.clearAllMocks();
});

describe("StationScene — robot-assistant voice on repair/refuel (Task 10)", () => {
  it("speaks the repair voice line and it survives the re-render", () => {
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(),
      station: station(StationType.REPAIR_DOCK),
    });
    (scene as unknown as { view: string }).view = "main";
    (scene as unknown as { render: () => void }).render();

    (scene as unknown as { doRepair: () => void }).doRepair();

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("Сервис-бот");
    expect(t!.text).toContain("восстановлен");
    expect(t!.text).toContain("к вылету готовы");
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });

  it("speaks the refuel voice line and it survives the re-render", () => {
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(),
      station: station(StationType.REPAIR_DOCK),
    });
    (scene as unknown as { view: string }).view = "main";
    (scene as unknown as { render: () => void }).render();

    (scene as unknown as { doRefuel: () => void }).doRefuel();

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("Сервис-бот");
    expect(t!.text).toContain("заправлены");
    expect(t!.text).toContain("Топливная система");
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });
});

// HangarPanel ctx harness (spy-based, mirrors hangarPanelSfxAndLabel.test.ts).
function makePanelPlayer(): Player {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
    addOwnedGear: vi.fn(),
    removeOwnedGear: vi.fn(() => true),
  };
  return { credits: 1_000_000, inventory } as unknown as Player;
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
    playSfx: vi.fn(),
    addToastSlot: vi.fn(),
    rerender: vi.fn(),
    back: vi.fn(),
    openMicromoduleApply: vi.fn(),
  };
}

describe("HangarPanel — robot-assistant diagnostic voice (Task 10)", () => {
  it("speaks the diagnostic voice line when repairing at the СЕРВИСНЫЙ ЦЕНТР", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePanelPlayer();
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

    new HangarPanel(renderer).render(ctx as never);
    const repairBtn = created.find((n) => n.text.startsWith("[Полный ремонт"));
    expect(repairBtn).toBeDefined();
    repairBtn!.handlers.pointerdown({ stopPropagation: () => {} });

    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("диагностика"),
      expect.any(Number),
    );
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Сервис-бот"),
      expect.any(Number),
    );
  });
});
