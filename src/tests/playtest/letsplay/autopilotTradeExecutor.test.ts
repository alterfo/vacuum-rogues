/**
 * Task 4 regression (docs/plans/20260727-autopilot-ui-parity-fixes.md):
 * the live autopilot's TRADE step drives the REAL market UI.
 *
 * Before this task `openTrade` executed the buy/sell through a domain bypass
 * and the live `executeTrade()` seam was a stub no-op — so if the real TRADE
 * scene were opened, the policy would loop PLANET→TRADE→FLIGHT→PLANET without
 * ever acquiring cargo. This suite proves the closed loop: `openTrade` opens
 * the real {@link TradeScene}, and the next tick's `executeTrade()` realises
 * the buy/sell through the scene's `e2eBuyItem`/`e2eSellItem` seams — the same
 * decision + reserve-cap math as the old bypass, now visible in the real UI.
 *
 * Real-engine tier: boots the real GameEngine, navigates to the real TRADE
 * scene, and drives `createLiveSceneController(...).executeTrade()`, asserting
 * observable engine state (cargo/credits actually change through the seam).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType, ResourceType } from "@/types";
import { currentSystem } from "./engineQueries";
import { createLiveSceneController } from "./installAutopilotHook";
import { createMemory } from "./AgentMemory";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("letsplay live trade executor (Task 4)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "LIVE-TRADE-TEST" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  /** Total units of cargo the player currently holds. */
  function totalCargo(): number {
    return (
      harness.engine.player?.inventory.resources.reduce(
        (s, r) => s + r.amount,
        0,
      ) ?? 0
    );
  }

  it("the real TRADE scene exposes both e2e seams the live executor drives", async () => {
    const engine = harness.engine;
    const planet = currentSystem(engine)?.planets[0];
    if (!planet) return;
    await harness.goTo(SceneType.TRADE, { planet });
    const scene = engine.currentScene as {
      e2eBuyItem?: unknown;
      e2eSellItem?: unknown;
    };
    expect(typeof scene.e2eBuyItem).toBe("function");
    expect(typeof scene.e2eSellItem).toBe("function");
  });

  it("executeTrade() buys the preferred good through the real TradeScene seam (round trip changes cargo/credits)", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets.find(
      (p) => (p.market?.availableResources?.length ?? 0) >= 1,
    );
    if (!planet || !planet.market || !engine.player) return; // generated galaxy may lack a market

    await harness.goTo(SceneType.TRADE, { planet });

    const { TradeSystem } = await import("@/systems/TradeSystem");
    const ts = new TradeSystem();
    const affordable = planet.market.availableResources
      .map((r) => ({ r, p: ts.getBuyPrice(planet, r, engine.player!) }))
      .filter((x) => x.p > 0 && x.p <= engine.player!.credits)
      .sort((a, b) => a.p - b.p);
    if (affordable.length === 0) return; // nothing affordable to prove the buy path

    const good = affordable[0].r;

    // Seed a known cross-planet margin so THIS planet is the cheap BUY planet
    // for `good` — the exact belief state `executeTrade`'s margin branch reads
    // (`bestKnownMargin(getMemory()).buyPlanet === planet.id`).
    const memory = createMemory();
    memory.priceBook.set(
      planet.id,
      new Map([
        [good, { buy: affordable[0].p, sell: affordable[0].p, seenAt: 0 }],
      ]),
    );
    memory.priceBook.set(
      "elsewhere",
      new Map([
        [
          good,
          {
            buy: affordable[0].p + 1000,
            sell: affordable[0].p + 1000,
            seenAt: 0,
          },
        ],
      ]),
    );

    const creditsBefore = engine.player.credits;
    const cargoBefore = totalCargo();

    await createLiveSceneController(engine, () => memory).executeTrade();

    // A real buy happened through the seam: cargo up, credits down.
    expect(totalCargo()).toBeGreaterThan(cargoBefore);
    expect(engine.player.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("TradeScene.e2eSellItem sells qty units, mirroring e2eBuyItem", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets.find(
      (p) => (p.market?.availableResources?.length ?? 0) >= 1,
    );
    if (!planet || !planet.market || !engine.player) return;

    await harness.goTo(SceneType.TRADE, { planet });
    const { TradeSystem } = await import("@/systems/TradeSystem");
    const ts = new TradeSystem();
    const affordable = planet.market.availableResources
      .map((r) => ({ r, p: ts.getBuyPrice(planet, r, engine.player!) }))
      .filter((x) => x.p > 0 && x.p <= engine.player!.credits)
      .sort((a, b) => a.p - b.p);
    if (affordable.length === 0) return;
    const good = affordable[0].r;
    const scene = engine.currentScene as unknown as {
      e2eBuyItem: (r: ResourceType, qty: number) => boolean;
      e2eSellItem: (r: ResourceType, qty: number) => boolean;
    };

    scene.e2eBuyItem(good, 2);
    const heldAfterBuy =
      engine.player.inventory.resources.find((r) => r.type === good)?.amount ??
      0;
    if (heldAfterBuy === 0) return;

    const creditsAfterBuy = engine.player.credits;
    scene.e2eSellItem(good, heldAfterBuy);

    const heldAfterSell =
      engine.player.inventory.resources.find((r) => r.type === good)?.amount ??
      0;
    expect(heldAfterSell).toBeLessThan(heldAfterBuy);
    expect(engine.player.credits).toBeGreaterThan(creditsAfterBuy);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTrade() sells held cargo through the real TradeScene seam when no margin is known (sell-only)", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets.find(
      (p) => (p.market?.availableResources?.length ?? 0) >= 1,
    );
    if (!planet || !planet.market || !engine.player) return;

    await harness.goTo(SceneType.TRADE, { planet });

    // Stock some cargo directly through the real scene seam first.
    const { TradeSystem } = await import("@/systems/TradeSystem");
    const ts = new TradeSystem();
    const affordable = planet.market.availableResources
      .map((r) => ({ r, p: ts.getBuyPrice(planet, r, engine.player!) }))
      .filter((x) => x.p > 0 && x.p <= engine.player!.credits)
      .sort((a, b) => a.p - b.p);
    if (affordable.length === 0) return;
    const scene = engine.currentScene as unknown as {
      e2eBuyItem: (r: ResourceType, qty: number) => boolean;
    };
    scene.e2eBuyItem(affordable[0].r, 2);

    const cargoMid = totalCargo();
    if (cargoMid === 0) return; // buy didn't stock anything (price/hold guard)
    const creditsMid = engine.player.credits;

    // Default memory ⇒ no known margin ⇒ sell-only: every held lot is sold.
    await createLiveSceneController(engine).executeTrade();

    expect(totalCargo()).toBeLessThan(cargoMid);
    expect(engine.player.credits).toBeGreaterThan(creditsMid);
    expect(harness.errors()).toHaveLength(0);
  });
});
