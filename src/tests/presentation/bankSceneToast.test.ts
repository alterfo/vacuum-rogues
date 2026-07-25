/**
 * Task 5 (quest-and-hub polish pass): pins the corrected `BankScene` toast
 * colours at their **call sites** — a contradictory outcome must never reuse a
 * sibling action's hue. The two fixed contradictions:
 *   1. "Кредит зачислен" (granted) must not share the "credit denied" colour.
 *   2. "Нет действующего кредита" (nothing to repay) must not share the
 *      "Снято со вклада" (withdrawal succeeded) colour.
 *
 * Drives the REAL `BankScene` action methods over a REAL `BankingService` +
 * `BankBus` (pure domain/systems, no PixiJS) with a lightweight `pixi.js` mock
 * so `render()` doesn't need a canvas, and spies `showToast` to capture the
 * exact colour each action passes.
 */
import { describe, it, expect, vi } from "vitest";
import {
  AccountType,
  journalEntry,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { deposit, openSavings } from "@/systems/banking/products";
import { BANK_TOAST } from "@/presentation/bankSceneView";

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    alpha = 1;
    label = "";
    eventMode = "auto";
    cursor = "default";
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    children: unknown[] = [];
    on() {
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    getChildByLabel() {
      return null;
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
    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      if (opts?.style) this.style = opts.style;
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

function makeHost(opts: { savings?: number } = {}) {
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
  // Fund the current account so deposits/withdrawals have something to move.
  ledger.post(
    journalEntry({
      id: "seed",
      date: 0,
      reason: "seed",
      postings: [
        { accountId: currentAccountId, amount: 6000 },
        { accountId: INTERNAL_ACCOUNTS.CASH, amount: -6000 },
      ],
    }),
  );
  if (opts.savings) {
    const sav = openSavings(bus, bankingService, playerId);
    deposit(bus, currentAccountId, sav, opts.savings);
  }

  const player = {
    id: playerId,
    currentAccountId,
    credits: 6000,
  } as unknown as import("@/domain/Player").Player;

  return {
    bankBus: bus,
    bankingService,
    bank: null,
    player,
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/presentation/BankSceneHost").BankSceneHost;
}

interface ScenePrivate {
  showToast: (text: string, color: number) => void;
  doTakeLoan: () => void;
  doRepay: () => void;
  doWithdraw: () => void;
}

/** Spy on `showToast` and return the captured (text, colour) call log. */
function spyToasts(scene: BankScene): Array<{ text: string; color: number }> {
  const calls: Array<{ text: string; color: number }> = [];
  (scene as unknown as ScenePrivate).showToast = (text, color) =>
    calls.push({ text, color });
  return calls;
}

describe("BankScene toast colours (call sites)", () => {
  it("uses a distinct colour for a granted loan vs a denied one", () => {
    const scene = new BankScene(renderer);
    scene.initialize({ gameEngine: makeHost() });
    const calls = spyToasts(scene);
    const s = scene as unknown as ScenePrivate;

    s.doTakeLoan(); // no debt yet → granted
    s.doTakeLoan(); // now in debt → borrow blocked (denied)

    expect(calls).toHaveLength(2);
    const [granted, denied] = calls;
    expect(granted.color).toBe(BANK_TOAST.success);
    expect(denied.color).toBe(BANK_TOAST.warn);
    expect(granted.color).not.toBe(denied.color);

    scene.destroy();
  });

  it("uses a distinct colour for 'nothing to repay' vs a successful withdrawal", () => {
    const scene = new BankScene(renderer);
    scene.initialize({ gameEngine: makeHost({ savings: 1000 }) });
    const calls = spyToasts(scene);
    const s = scene as unknown as ScenePrivate;

    s.doRepay(); // no active loan → neutral info
    s.doWithdraw(); // savings funded → success

    expect(calls).toHaveLength(2);
    const [noDebt, withdrew] = calls;
    expect(noDebt.text).toBe("Нет действующего кредита");
    expect(noDebt.color).toBe(BANK_TOAST.info);
    expect(withdrew.color).toBe(BANK_TOAST.success);
    expect(noDebt.color).not.toBe(withdrew.color);

    scene.destroy();
  });
});
