/**
 * Task 5 (UX-review fixes, `docs/plans/20260729-ux-review-fixes.md`): the
 * Station main view used to render as a bare panel on a flat black void (finding
 * #3). `StationScene.renderMain` now mounts a full-bleed, station-type-tinted
 * procedural backdrop (`flight/stationBackdrop.ts`) as the first child of the
 * main container — below the panel box and every service row.
 *
 * This test drives the real `StationScene.render()` in the "main" view (mirrors
 * the lightweight pixi.js mock convention from `stationScopeFontScaleLayout.test.ts`,
 * extended so each Graphics records its fill colours) and asserts:
 *  - the backdrop node is the first child mounted (before the panel box), and
 *  - its gradient colours vary by StationType.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import { StationType } from "@/types";
import { setFontScale } from "@/utils/fontScale";
import {
  stationBackdropAccent,
  stationBackdropBands,
} from "@/presentation/flight/stationBackdrop";

afterEach(() => setFontScale("M"));

interface FillCall {
  color: number;
  alpha?: number;
}

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
    children: FakeBase[] = [];
    on() {
      return this;
    }
    addChild(c: FakeBase) {
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
    fills: FillCall[] = [];
    rect() {
      return this;
    }
    roundRect() {
      return this;
    }
    circle() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    poly() {
      return this;
    }
    fill(opts?: FillCall) {
      if (opts) this.fills.push(opts);
      return this;
    }
    stroke() {
      return this;
    }
    clear() {
      this.fills = [];
      return this;
    }
  }
  class Text extends FakeBase {
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
    }
  }
  return {
    Container,
    Graphics,
    Text,
    Rectangle: class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
    },
    FederatedPointerEvent: class {},
  };
});

// Imported AFTER the mock so the scene sees the fake pixi.
import {
  StationScene,
  buildStationBackdrop,
} from "@/presentation/StationScene";

const renderer = {
  app: {
    screen: { width: 1280, height: 800 },
    stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
  },
  stage: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
} as unknown as Renderer;

interface ShipStats {
  hullHP: number;
  maxHull: number;
  energy: number;
  maxEnergy: number;
}

const DEFAULT_SHIP: ShipStats = {
  hullHP: 80,
  maxHull: 100,
  energy: 40,
  maxEnergy: 100,
};

function makeEngine(loadout: ShipLoadout, ship: ShipStats = DEFAULT_SHIP) {
  return {
    player: {
      credits: 5000,
      currentSystemId: "sys1",
      ship: { hullClass: "SCOUT", ...ship },
      isHostileTo: () => false,
      inventory: {
        ownedGearIds: [],
        micromodules: [],
        resources: [],
        modules: [],
      },
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

function station(type: StationType) {
  return {
    id: `st_${type}`,
    name: "Станция",
    type,
    faction: "INDEPENDENT",
  } as unknown as import("@/domain/Station").Station;
}

interface FakeGraphics {
  fills: FillCall[];
  eventMode: string;
}

function renderMainChildren(
  type: StationType,
  ship?: ShipStats,
): FakeGraphics[] {
  const scene = new StationScene(renderer);
  scene.initialize({
    gameEngine: makeEngine(new ShipLoadout("hull_scout"), ship),
    station: station(type),
  });
  const main = (
    scene as unknown as { mainContainer: { children: FakeGraphics[] } }
  ).mainContainer;
  const children = main.children.slice();
  scene.destroy();
  return children;
}

describe("StationScene interior backdrop (Task 5, finding #3)", () => {
  it("mounts a full-bleed gradient backdrop as the first child, before the panel box", () => {
    const children = renderMainChildren(StationType.TRADE_POST);
    const backdrop = children[0];
    // The backdrop is a multi-band gradient: many fills, all opaque.
    expect(backdrop.fills.length).toBeGreaterThan(1);
    expect(backdrop.eventMode).toBe("static");

    // The panel box is the very next Graphics: a single opaque 0x080818 fill.
    const panel = children[1];
    expect(panel.fills.some((f) => f.color === 0x080818)).toBe(true);
    // Panel comes strictly after the backdrop.
    expect(children.indexOf(backdrop)).toBeLessThan(children.indexOf(panel));
  });

  it("tints the backdrop differently per station type", () => {
    const trade = renderMainChildren(StationType.TRADE_POST)[0].fills.map(
      (f) => f.color,
    );
    const military = renderMainChildren(StationType.MILITARY_BASE)[0].fills.map(
      (f) => f.color,
    );
    expect(trade).not.toEqual(military);
  });
});

interface FakeNode {
  cursor: string;
  eventMode: string;
  children: FakeNode[];
  text?: string;
  fills?: FillCall[];
}

describe("StationScene action buttons (Task 7, finding #6 — unified chrome)", () => {
  it("renders each service row through the shared UiButton chrome, not a bare Text", () => {
    const children = renderMainChildren(
      StationType.TRADE_POST,
    ) as unknown as FakeNode[];
    // A UiButton mounts its composite (bg + accent strip + icon + label) as an
    // interactive Container (cursor 'pointer'); the old bare `scaledText` row was
    // a childless Text. Every actionable service row must now be a composite.
    const interactive = children.filter((c) => c.cursor === "pointer");
    // TRADE_POST exposes 7 services, all actionable for a non-hostile visit.
    expect(interactive.length).toBe(7);
    for (const row of interactive) {
      expect(row.eventMode).toBe("static");
      expect(row.children.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("nests the service label inside the UiButton container, dropping the bare-bracket row", () => {
    const children = renderMainChildren(
      StationType.TRADE_POST,
    ) as unknown as FakeNode[];
    const nestedLabels = children
      .filter((c) => c.cursor === "pointer")
      .flatMap((c) => c.children)
      .map((c) => c.text ?? "")
      .filter(Boolean);
    expect(nestedLabels.some((t) => t.includes("Магазин снаряжения"))).toBe(
      true,
    );
    // The old bracketed style is gone: no top-level Text row wraps a service
    // label directly on the main container.
    const topLevelTexts = children.map((c) => c.text ?? "").filter(Boolean);
    expect(
      topLevelTexts.some((t) => t.startsWith("[ ") && t.includes("Магазин")),
    ).toBe(false);
  });
});

describe("StationScene satisfied status rows (Task 8, finding #7)", () => {
  // Find the main-container row whose own or nested label text includes `substr`.
  function findRow(children: FakeNode[], substr: string): FakeNode | undefined {
    return children.find((c) =>
      [c.text ?? "", ...c.children.map((ch) => ch.text ?? "")].some((t) =>
        t.includes(substr),
      ),
    );
  }

  const FULL: ShipStats = {
    hullHP: 100,
    maxHull: 100,
    energy: 100,
    maxEnergy: 100,
  };
  const DAMAGED: ShipStats = {
    hullHP: 50,
    maxHull: 100,
    energy: 100,
    maxEnergy: 100,
  };

  it("renders 'Корпус в норме' / 'Баки полны' as non-interactive when nothing is missing", () => {
    const children = renderMainChildren(
      StationType.REPAIR_DOCK,
      FULL,
    ) as unknown as FakeNode[];

    const repairRow = findRow(children, "Корпус в норме");
    const refuelRow = findRow(children, "Баки полны");
    expect(repairRow).toBeTruthy();
    expect(refuelRow).toBeTruthy();
    // Satisfied rows go through the non-interactive branch: no pointer cursor,
    // not an event target.
    for (const row of [repairRow!, refuelRow!]) {
      expect(row.eventMode).not.toBe("static");
      expect(row.cursor).not.toBe("pointer");
    }
  });

  it("keeps a genuinely actionable row (damaged hull → Ремонт) interactive", () => {
    const children = renderMainChildren(
      StationType.REPAIR_DOCK,
      DAMAGED,
    ) as unknown as FakeNode[];

    // Damaged hull → the repair row shows a cost and stays a clickable UiButton;
    // full tanks → the refuel row is inert. Match on the cost-bearing label
    // ("Ремонт  (…₡)") so we don't collide with the "Ремонтный узел" header.
    const repairRow = findRow(children, "Ремонт  (");
    expect(repairRow).toBeTruthy();
    expect(repairRow!.cursor).toBe("pointer");
    expect(repairRow!.eventMode).toBe("static");

    const refuelRow = findRow(children, "Баки полны");
    expect(refuelRow).toBeTruthy();
    expect(refuelRow!.eventMode).not.toBe("static");
    expect(refuelRow!.cursor).not.toBe("pointer");
  });
});

describe("stationBackdrop helpers (pure)", () => {
  it("gives each station type a distinct accent colour", () => {
    const accents = [
      StationType.TRADE_POST,
      StationType.REPAIR_DOCK,
      StationType.MILITARY_BASE,
      StationType.RESEARCH_LAB,
      StationType.CRAFT_CENTER,
    ].map(stationBackdropAccent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("fades from near-black at the top toward the accent tint at the bottom", () => {
    const accent = 0xff5544;
    const bands = stationBackdropBands(accent, 12);
    expect(bands).toHaveLength(12);
    // Top band is near-black; bottom band is brighter (accent-tinted).
    expect(bands[0]).toBeLessThan(0x0a0a20);
    expect(bands[bands.length - 1]).toBeGreaterThan(bands[0]);
  });

  it("builds a backdrop Graphics whose fills vary with the station type", () => {
    const trade = buildStationBackdrop(
      1280,
      800,
      StationType.TRADE_POST,
    ) as unknown as {
      fills: FillCall[];
    };
    const science = buildStationBackdrop(
      1280,
      800,
      StationType.RESEARCH_LAB,
    ) as unknown as { fills: FillCall[] };
    expect(trade.fills.map((f) => f.color)).not.toEqual(
      science.fills.map((f) => f.color),
    );
  });
});
