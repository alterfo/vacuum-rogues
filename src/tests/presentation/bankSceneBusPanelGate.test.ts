import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AccountType,
  journalEntry,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { showBankBusPanel } from "@/presentation/bankSceneView";

const BUS_HEADER = "ШИНА: команды → проводки";

describe("showBankBusPanel (pure gate)", () => {
  it("hides the demo bus panel outside __DEBUG__ (production)", () => {
    expect(showBankBusPanel(false)).toBe(false);
  });

  it("keeps the demo bus panel under __DEBUG__ (dev/e2e)", () => {
    expect(showBankBusPanel(true)).toBe(true);
  });
});

const gate = vi.hoisted(() => ({ override: null as boolean | null }));

vi.mock("@/presentation/bankSceneView", async (importActual) => {
  const actual =
    await importActual<typeof import("@/presentation/bankSceneView")>();
  return {
    ...actual,
    showBankBusPanel: (debug: boolean) =>
      gate.override ?? actual.showBankBusPanel(debug),
  };
});

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

import { BankScene } from "@/presentation/BankScene";

const renderer = {
  app: { screen: { width: 1400, height: 900 } },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
  stage: { addChild: vi.fn(), removeChild: vi.fn(), on: vi.fn(), off: vi.fn() },
} as unknown as import("@/presentation/Renderer").Renderer;

function makeHost() {
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
  ledger.post(
    journalEntry({
      id: "je0",
      date: 0,
      reason: "Операция",
      postings: [
        { accountId: currentAccountId, amount: 500 },
        { accountId: INTERNAL_ACCOUNTS.CASH, amount: -500 },
      ],
    }),
  );
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

describe("BankScene ШИНА panel render gating", () => {
  beforeEach(() => {
    created = [];
    gate.override = null;
  });

  it("does NOT render the ШИНА section header when the gate is off (production)", () => {
    gate.override = false;
    const scene = new BankScene(renderer);
    scene.initialize({ gameEngine: makeHost() });

    expect(created.some((n) => n.text === BUS_HEADER)).toBe(false);
    expect(created.some((n) => n.text === "ВЫПИСКА — текущий счёт")).toBe(true);

    scene.destroy();
  });

  it("renders the ШИНА section header when the gate is on (dev/e2e)", () => {
    gate.override = true;
    const scene = new BankScene(renderer);
    scene.initialize({ gameEngine: makeHost() });

    expect(created.some((n) => n.text === BUS_HEADER)).toBe(true);

    scene.destroy();
  });
});
