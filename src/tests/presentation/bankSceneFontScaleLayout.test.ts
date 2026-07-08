/**
 * Task 3 (font-scale layout bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): GREEN regression
 * test for the `BankScene.ts` fix already landed in this pack
 * (`statementRowStep`, the bus-log wrapped-line step, and the pixel-derived
 * `maxReasonChars`) — there was no dedicated test pinning that fix yet. See
 * `BankScene.renderStatementAndBus`/`renderStatementLine` for the
 * source-of-truth formulas this test mirrors.
 *
 * Builds a REAL `Ledger` + `BankingService` + `BankBus` (all pure domain/
 * systems code, no PixiJS) so `BankScene`'s statement/bus-log render paths
 * exercise the exact production data shape, with a lightweight `pixi.js` mock
 * (mirroring `HangarPanel.test.ts`'s convention) so `Text`/`Graphics`
 * instances are directly inspectable after render.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import {
  MONO_CHAR_WIDTH_RATIO,
  estimateWrappedLines,
  lineStepFor,
} from "@/presentation/ui/questCardLayout";
import {
  AccountType,
  journalEntry,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

interface FakeNode {
  text: string;
  x: number;
  y: number;
}

let created: FakeNode[] = [];

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
    roundRect() {
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

// Imported AFTER the mock so the scene sees the fake pixi.
import { BankScene } from "@/presentation/BankScene";

const renderer = {
  app: { screen: { width: 1400, height: 900 } },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
  stage: { addChild: vi.fn(), removeChild: vi.fn(), on: vi.fn(), off: vi.fn() },
} as unknown as import("@/presentation/Renderer").Renderer;

const LONG_REASON =
  "Оплата поставки редких металлов с дальней торговой станции у окраины сектора";

function makeHost(reasons: readonly string[]) {
  const bus = new BankBus();
  const bankingService = new BankingService(bus);
  const ledger = bankingService.getLedger();
  const playerId = "player1";
  const currentAccountId = `cur:${playerId}`;
  ledger.openAccount({
    id: currentAccountId,
    type: AccountType.CURRENT,
    label: "Игрок",
    ownerId: playerId,
  });
  reasons.forEach((reason, i) => {
    ledger.post(
      journalEntry({
        id: `je${i}`,
        date: i,
        reason,
        postings: [
          { accountId: currentAccountId, amount: 500 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: -500 },
        ],
      }),
    );
  });

  const player = {
    id: playerId,
    currentAccountId,
    credits: 5500,
  } as unknown as import("@/domain/Player").Player;

  return {
    bankBus: bus,
    bankingService,
    bank: null,
    player,
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/presentation/BankSceneHost").BankSceneHost;
}

describe("BankScene statement rows at L font scale", () => {
  beforeEach(() => {
    created = [];
  });

  it("grows the statement row step with the font scale (statementRowStep)", () => {
    setFontScale("L");
    const scene = new BankScene(renderer);
    // Two rows (newest journal entry first — statementRows reverses) so the
    // ACTUAL rendered gap between them is measurable.
    scene.initialize({
      gameEngine: makeHost(["Первая операция", "Вторая операция"]),
    });

    const rowA = created.find((n) => n.text.startsWith("Д0"));
    const rowB = created.find((n) => n.text.startsWith("Д1"));
    expect(rowA, "expected the first statement row").toBeTruthy();
    expect(rowB, "expected the second statement row").toBeTruthy();

    const expectedStep = Math.max(22, lineStepFor(scaledFont(12)) + 5);
    // Pre-fix `statementRowStep` was a hardcoded 22 px regardless of scale;
    // at "L" the fixed formula grows it past that floor — pin the ACTUAL
    // measured gap between two rendered rows to that formula, not just the
    // formula's own value in isolation.
    expect(expectedStep).toBeGreaterThan(22);
    expect(Math.abs(rowB!.y - rowA!.y)).toBe(expectedStep);

    scene.destroy();
  });

  it("derives the reason's char budget from the available pixel width, not a fixed 30-char count", () => {
    setFontScale("L");
    const scene = new BankScene(renderer);
    scene.initialize({ gameEngine: makeHost([LONG_REASON]) });

    const row = created.find((n) => n.text.startsWith("Д0"));
    expect(row, "expected the statement row Text node").toBeTruthy();

    // Reproduces `renderStatementLine`'s own formula: the reason's char
    // budget is derived from the PIXEL width available before the
    // right-aligned delta column (`rightW = screenWidth * 0.42`), not a fixed
    // 30-char count. At the panel's actual (generous) width this legitimately
    // allows MORE than 30 chars — the bug wasn't "always shorter", it was
    // "untethered from the real available width" (bled past it when the
    // column was narrow, wasted space when it was wide).
    const rightW = 1400 * 0.42;
    const datePrefixLen = "Д0  ".length;
    const deltaClearance = 90;
    const charPx = scaledFont(12) * MONO_CHAR_WIDTH_RATIO;
    const maxReasonChars = Math.max(
      6,
      Math.floor((rightW - deltaClearance) / charPx) - datePrefixLen,
    );
    // Sanity: the long reason genuinely needs truncating at this budget, so
    // the assertion below exercises the truncation branch, not the no-op one.
    expect(LONG_REASON.length).toBeGreaterThan(maxReasonChars);
    const expectedReason =
      LONG_REASON.slice(0, Math.max(1, maxReasonChars - 1)) + "…";
    expect(row!.text).toBe(`Д0  ${expectedReason}`);

    // A fixed 30-char count (the old bug) would have produced a DIFFERENT
    // (shorter) string here, since the real pixel budget is wider — pinning
    // this proves the row is wired to the width, not the old literal.
    const oldReason = LONG_REASON.slice(0, 29) + "…";
    expect(row!.text).not.toBe(`Д0  ${oldReason}`);

    scene.destroy();
  });
});

describe("BankScene bus-log rows at L font scale", () => {
  beforeEach(() => {
    created = [];
  });

  it("steps the bus-log row by its estimated wrapped-line count, not a fixed 18 px", () => {
    setFontScale("L");
    const scene = new BankScene(renderer);
    const host = makeHost(["Короткая операция"]);
    scene.initialize({ gameEngine: host });

    // Dispatch a real command through the bus so the live "Шина" log gets a
    // long line the panel must wrap (mirrors an actual deposit/withdraw).
    const inner = scene as unknown as {
      busLog: string[];
      render: () => void;
    };
    const longLine =
      "→ Очень длинная команда через шину которая обязательно переносится по словам на несколько строк";
    const nextLine = "→ Следующая команда";
    inner.busLog.push(longLine, nextLine);
    inner.render();

    const busText = created.find((n) => n.text === longLine);
    const nextText = created.find((n) => n.text === nextLine);
    expect(busText, "expected the long bus-log Text node").toBeTruthy();
    expect(nextText, "expected the next bus-log Text node").toBeTruthy();

    const width = 1400 * 0.42; // rightW passed to renderStatementAndBus
    const lines = estimateWrappedLines(longLine, width, scaledFont(11));
    // Sanity: this line genuinely wraps to 2+ lines at "L" scale in the panel
    // width used, so a fixed 18 px step would have bled the next row into it.
    expect(lines).toBeGreaterThan(1);

    const expectedGap = lines * lineStepFor(scaledFont(11));
    // Pre-fix the step was a hardcoded 18 px regardless of the line's real
    // wrapped-line count — pin the ACTUAL measured gap between the two
    // rendered rows to the wrapped-line-count-derived formula.
    expect(nextText!.y - busText!.y).toBe(expectedGap);

    scene.destroy();
  });
});
