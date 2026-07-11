/**
 * Task 3 (font-scale layout bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): GREEN regression
 * test for the `HangarPanel.ts` fix already landed in this pack (fitted-slot
 * box height + unfit-button/micromodule-row offsets via `fittedSlotHeight()`,
 * and the warehouse-row `btnGap`/`warehouseRowH`) — there was no dedicated
 * test pinning that fix yet.
 *
 * At the real "L" scale (1.25×) the historical hardcoded gaps (20 px for the
 * warehouse row, 11/20/26 px offsets for the fitted slot) happen to coincide
 * almost exactly with `lineStepFor`'s output for this panel's font sizes —
 * so a plain "does it still look right at L" assertion can't tell the fixed
 * code apart from the original hardcoded one. Instead this test partially
 * mocks `lineStepFor` (from `ui/questCardLayout`) to a distinctive, easily
 * recognisable value and asserts the panel's rendered offsets actually
 * derive from it — proving the geometry is WIRED to the font-scale helper
 * rather than a hardcoded literal (the class of bug this whole pack fixes).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Player } from "@/domain/Player";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { Renderer } from "@/presentation/Renderer";
import { setFontScale } from "@/utils/fontScale";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

// Deliberately far from any historical literal (20/26/34 px), but small
// enough that the panel's overflow-clip guards don't hide the row entirely.
const MOCK_LINE_STEP = 60;

vi.mock("@/presentation/ui/questCardLayout", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/presentation/ui/questCardLayout")>();
  return { ...actual, lineStepFor: () => MOCK_LINE_STEP };
});

interface FakeNode {
  text: string;
  x: number;
  y: number;
  handlers: Record<string, (e: unknown) => void>;
}

interface FakeGraphics {
  rectCalls: number[][];
}

let created: FakeNode[] = [];
let createdGraphics: FakeGraphics[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    children: FakeNode[] = [];
    handlers: Record<string, (e: unknown) => void> = {};
    on(ev: string, cb: (e: unknown) => void) {
      this.handlers[ev] = cb;
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
    rectCalls: number[][] = [];
    constructor() {
      super();
      createdGraphics.push(this as unknown as FakeGraphics);
    }
    rect(x: number, y: number, w: number, h: number) {
      this.rectCalls.push([x, y, w, h]);
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
    width = 50;
    height = 14;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
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

// Imported AFTER the mocks so the panel + scaledText see the fakes.
import { Container } from "pixi.js";
import { HangarPanel } from "@/presentation/ui/HangarPanel";

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
  // Effectively-infinite hull pool so the СЕРВИСНЫЙ ЦЕНТР block always syncs
  // to a healthy/perfect status regardless of which hull is under test.
  const ship = { hullHP: 1_000_000_000, maxHull: 1_000_000_000 };
  return { credits: 1000, inventory, ship } as unknown as Player;
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

describe("HangarPanel fitted-slot box wired to the font-scale line step", () => {
  beforeEach(() => {
    created = [];
    createdGraphics = [];
  });

  /**
   * The fitted-slot box's own drawn height (`fittedSlotHeight()`) is
   * `4 + nameStep + mmStep + 4` — with both steps mocked to
   * {@link MOCK_LINE_STEP} that is a distinctive, easily-identified height
   * (128) among the panel's Graphics rects (empty slots stay a hardcoded 24).
   * Its `rect(x, y, w, h)` call's `y` is the row's absolute top, letting every
   * offset below be checked RELATIVE to the row (not the panel's absolute
   * layout, which the mock doesn't otherwise affect).
   */
  function findSlotRowTop(): number {
    const expectedH = 4 + MOCK_LINE_STEP + MOCK_LINE_STEP + 4;
    const slotRect = createdGraphics
      .flatMap((g) => g.rectCalls)
      .find(([, , , h]) => h === expectedH);
    expect(slotRect, "expected the fitted-slot box rect").toBeTruthy();
    return slotRect![1];
  }

  it("derives the [снять] button's row offset from lineStepFor, not a hardcoded literal", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const rowTop = findSlotRowTop();
    const unfitBtn = created.find((n) => n.text === "[снять]");
    expect(unfitBtn, "expected the [снять] button").toBeTruthy();
    // Pre-fix this was a hardcoded `y + 11` regardless of scale — with
    // `lineStepFor` mocked to a distinctive 60, the fixed formula
    // (`4 + nameStep / 2`) puts the button far past that, proving it is
    // actually wired to the helper.
    expect(unfitBtn!.y - rowTop).toBeCloseTo(4 + MOCK_LINE_STEP / 2, 0);
  });

  it("derives the micromodule row's offset from lineStepFor, not a hardcoded literal", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");
    const player = makePlayer();
    const ctx = makeCtx(loadout, player);

    new HangarPanel(renderer).render(ctx);

    const rowTop = findSlotRowTop();
    // The micromodule "apply" button (no micromodule fitted, none owned)
    // renders at `mmRowY + mmStep / 2`, where `mmRowY = rowTop + 4 +
    // nameStep` — with `lineStepFor` mocked to 60 this is far past the
    // historical hardcoded `y + 26`.
    const mmBtn = created.find((n) => n.text === "[нет микромодулей]");
    expect(mmBtn, "expected the micromodule apply button").toBeTruthy();
    const expectedMmY = rowTop + 4 + MOCK_LINE_STEP + MOCK_LINE_STEP / 2;
    expect(mmBtn!.y).toBeCloseTo(expectedMmY, 0);
  });
});

describe("HangarPanel warehouse-row buttons wired to the font-scale line step", () => {
  beforeEach(() => {
    created = [];
  });

  it("derives the «Продать»/«Установить» gap from lineStepFor, not the hardcoded 20 px", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(["eq_radar"]); // owned, uninstalled → warehouse row

    new HangarPanel(renderer).render(makeCtx(loadout, player));

    const install = created.find((n) => n.text === "[Установить]");
    const sell = created.find((n) => n.text.startsWith("[Продать"));
    expect(install, "expected the [Установить] button").toBeTruthy();
    expect(sell, "expected the [Продать] button").toBeTruthy();

    // Pre-fix this gap was a hardcoded 20 px regardless of scale — with
    // `lineStepFor` mocked to 500, the fixed formula
    // (`Math.max(20, lineStepFor(...) + 4)`) pushes the gap far past 20,
    // proving it is actually wired to the helper.
    expect(sell!.y - install!.y).toBeGreaterThanOrEqual(MOCK_LINE_STEP);
  });
});
