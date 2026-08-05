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

  function totalCargo(): number {
    return (
      harness.engine.player?.inventory.resources.reduce(
        (s, r) => s + r.amount,
        0,
      ) ?? 0
    );
  }

  it("the real TRADE scene exposes both e2e seams the live executor drives", async () => {
    expect.hasAssertions();
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
    expect.hasAssertions();
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

    expect(totalCargo()).toBeGreaterThan(cargoBefore);
    expect(engine.player.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeTrade() lands back on the PLANET hub so the next tick can take quests (live/headless parity)", async () => {
    expect.hasAssertions();
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const planet = sys?.planets.find(
      (p) => (p.market?.availableResources?.length ?? 0) >= 1,
    );
    if (!planet || !planet.market || !engine.player) return;

    await harness.goTo(SceneType.TRADE, { planet });
    await createLiveSceneController(engine).executeTrade();

    expect(engine.currentSceneType).toBe(SceneType.PLANET);
    expect(harness.errors()).toHaveLength(0);
  });

  it("TradeScene.e2eSellItem sells qty units, mirroring e2eBuyItem", async () => {
    expect.hasAssertions();
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
    expect.hasAssertions();
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
    const scene = engine.currentScene as unknown as {
      e2eBuyItem: (r: ResourceType, qty: number) => boolean;
    };
    scene.e2eBuyItem(affordable[0].r, 2);

    const cargoMid = totalCargo();
    if (cargoMid === 0) return; // buy didn't stock anything (price/hold guard)
    const creditsMid = engine.player.credits;

    await createLiveSceneController(engine).executeTrade();

    expect(totalCargo()).toBeLessThan(cargoMid);
    expect(engine.player.credits).toBeGreaterThan(creditsMid);
    expect(harness.errors()).toHaveLength(0);
  });
});
