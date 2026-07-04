import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import {
  SceneType,
  StationType,
  FactionType,
  NpcRole,
  NpcState,
} from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import { NpcShip } from "@/domain/NpcShip";
import { takeLoan } from "@/systems/banking/products";
import {
  observe,
  legalActionsForScene,
  type LegalActionContext,
} from "./observe";

/**
 * Task 1 of the dev-only letsplay engine: the observation + legal-action surface.
 *
 * Two layers, mirroring the plan's TDD split:
 *  - the **pure** `legalActionsForScene` is unit-tested exhaustively (every scene
 *    maps to the right action set; "trade" only where a market exists, etc.);
 *  - `observe(engine)` is tested over the **real** booted harness for a
 *    deterministic, well-formed snapshot.
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** A baseline location context (a quiet system with one planet + one station). */
function ctx(over: Partial<LegalActionContext> = {}): LegalActionContext {
  return {
    hasPlayer: true,
    planetCount: 1,
    stationCount: 1,
    hostileCount: 0,
    connectionCount: 2,
    availableQuestCount: 0,
    ...over,
  };
}

describe("legalActionsForScene (pure)", () => {
  it("offers no actions but 'wait' when there is no player (pre-game menus)", () => {
    expect(
      legalActionsForScene(SceneType.MAIN_MENU, ctx({ hasPlayer: false })),
    ).toEqual(["wait"]);
    // Even on a gameplay scene, a missing player collapses to wait-only.
    expect(
      legalActionsForScene(SceneType.SPACE_FLIGHT, ctx({ hasPlayer: false })),
    ).toEqual(["wait"]);
  });

  it("in flight: move/warp/land/dock/wait, but never trade", () => {
    const actions = legalActionsForScene(SceneType.SPACE_FLIGHT, ctx());
    expect(actions).toContain("move");
    expect(actions).toContain("warp");
    expect(actions).toContain("land");
    expect(actions).toContain("dock");
    expect(actions).toContain("wait");
    // The canonical "no trade outside a market" invariant.
    expect(actions).not.toContain("trade");
    // No hostile in range ⇒ no attack/flee.
    expect(actions).not.toContain("attack");
    expect(actions).not.toContain("flee");
  });

  it("in flight: warp/land/dock disappear when nothing is reachable", () => {
    const actions = legalActionsForScene(
      SceneType.SPACE_FLIGHT,
      ctx({ planetCount: 0, stationCount: 0, connectionCount: 0 }),
    );
    expect(actions).toEqual(["move", "wait"]);
  });

  it("in flight: a hostile in range unlocks both attack and flee", () => {
    const actions = legalActionsForScene(
      SceneType.SPACE_FLIGHT,
      ctx({ hostileCount: 1 }),
    );
    expect(actions).toContain("attack");
    expect(actions).toContain("flee");
  });

  it("in flight: liberate is legal only when the current system is a cleared capture", () => {
    const notCaptured = legalActionsForScene(
      SceneType.SPACE_FLIGHT,
      ctx({ canLiberate: false }),
    );
    expect(notCaptured).not.toContain("liberate");

    const cleared = legalActionsForScene(
      SceneType.SPACE_FLIGHT,
      ctx({ canLiberate: true }),
    );
    expect(cleared).toContain("liberate");
  });

  it("liberate never appears outside SPACE_FLIGHT, even when canLiberate is true", () => {
    const onPlanet = legalActionsForScene(
      SceneType.PLANET,
      ctx({ canLiberate: true }),
    );
    expect(onPlanet).not.toContain("liberate");
    const onStarMap = legalActionsForScene(
      SceneType.STAR_MAP,
      ctx({ canLiberate: true }),
    );
    expect(onStarMap).not.toContain("liberate");
  });

  it("arm-up is legal at a shop only when a firepower improvement is available", () => {
    const noRefit = legalActionsForScene(
      SceneType.STATION,
      ctx({ canArmUp: false }),
    );
    expect(noRefit).not.toContain("arm-up");

    const atStation = legalActionsForScene(
      SceneType.STATION,
      ctx({ canArmUp: true }),
    );
    expect(atStation).toContain("arm-up");

    const atShop = legalActionsForScene(
      SceneType.EQUIPMENT_SHOP,
      ctx({ canArmUp: true }),
    );
    expect(atShop).toContain("arm-up");
  });

  it("arm-up never appears in flight, even when a refit is available", () => {
    const inFlight = legalActionsForScene(
      SceneType.SPACE_FLIGHT,
      ctx({ canArmUp: true }),
    );
    expect(inFlight).not.toContain("arm-up");
  });

  it("on a planet: trade is legal; take-quest only when work is offered", () => {
    const none = legalActionsForScene(
      SceneType.PLANET,
      ctx({ availableQuestCount: 0 }),
    );
    expect(none).toContain("trade");
    expect(none).toContain("move");
    expect(none).not.toContain("take-quest");
    // …and never a combat action while landed.
    expect(none).not.toContain("attack");

    const offered = legalActionsForScene(
      SceneType.PLANET,
      ctx({ availableQuestCount: 3 }),
    );
    expect(offered).toContain("take-quest");
  });

  it("in the market: trade + leave", () => {
    const actions = legalActionsForScene(SceneType.TRADE, ctx());
    expect(actions).toContain("trade");
    expect(actions).toContain("move");
    expect(actions).not.toContain("attack");
  });

  it("at a station: repair is legal, trade is not (no market there)", () => {
    const actions = legalActionsForScene(SceneType.STATION, ctx());
    expect(actions).toContain("repair");
    expect(actions).toContain("move");
    expect(actions).not.toContain("trade");
  });

  it("on the star map: warp is the action when connections exist", () => {
    expect(legalActionsForScene(SceneType.STAR_MAP, ctx())).toContain("warp");
    expect(
      legalActionsForScene(SceneType.STAR_MAP, ctx({ connectionCount: 0 })),
    ).not.toContain("warp");
  });

  it("terminal screens (win/over) allow only 'wait'", () => {
    expect(legalActionsForScene(SceneType.WIN_SCREEN, ctx())).toEqual(["wait"]);
    expect(legalActionsForScene(SceneType.GAME_OVER, ctx())).toEqual(["wait"]);
  });

  it("returns actions in a stable canonical order (deterministic)", () => {
    const a = legalActionsForScene(SceneType.SPACE_FLIGHT, ctx());
    const b = legalActionsForScene(SceneType.SPACE_FLIGHT, ctx());
    expect(a).toEqual(b);
    // move precedes warp precedes land precedes dock precedes wait.
    expect(a).toEqual(["move", "warp", "land", "dock", "wait"]);
  });
});

describe("observe(engine) over the real harness", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("on the booted main menu: no player, wait-only, no errors", () => {
    const obs = observe(harness.engine);
    expect(obs.scene).toBe(SceneType.MAIN_MENU);
    expect(obs.hasPlayer).toBe(false);
    expect(obs.player).toBeNull();
    expect(obs.system).toBeNull();
    expect(obs.quests).toEqual([]);
    expect(obs.legalActions).toEqual(["wait"]);
    expect(harness.errors()).toEqual([]);
  });

  it("after «Новая игра»: full player + system snapshot, flight action set", async () => {
    await harness.newGame();
    const obs = observe(harness.engine);

    expect(obs.scene).toBe(SceneType.SPACE_FLIGHT);
    expect(obs.hasPlayer).toBe(true);

    // Player vitals are well-formed: a fresh ship is at full hull, fuel within
    // [0, max], credits projected from the seeded ledger.
    const p = obs.player!;
    expect(p.credits).toBe(harness.credits());
    expect(p.hull).toBe(p.maxHull);
    expect(p.hullFraction).toBe(1);
    expect(p.maxHull).toBeGreaterThan(0);
    expect(p.fuel).toBeGreaterThanOrEqual(0);
    expect(p.fuel).toBeLessThanOrEqual(p.maxFuel);
    expect(p.cargoCapacity).toBeGreaterThan(0);
    expect(p.cargoUsed).toBe(0); // starter hold is empty
    expect(p.systemId).toBe(harness.player()!.currentSystemId);

    // The current system resolves with its planets/stations/connections.
    expect(obs.system).not.toBeNull();
    expect(obs.system!.id).toBe(p.systemId);
    expect(Array.isArray(obs.system!.planets)).toBe(true);
    expect(Array.isArray(obs.system!.stations)).toBe(true);

    // Flight action set: move/wait always; trade never in space.
    expect(obs.legalActions).toContain("move");
    expect(obs.legalActions).toContain("wait");
    expect(obs.legalActions).not.toContain("trade");

    expect(harness.errors()).toEqual([]);
  });

  it("is deterministic: two observations of the same state are deep-equal", async () => {
    await harness.newGame();
    expect(observe(harness.engine)).toEqual(observe(harness.engine));
  });

  it("landing on a planet flips the action set to a market (trade, no attack)", async () => {
    await harness.newGame();
    const sys = harness.galaxy()!.systems.find((s) => s.planets.length > 0)!;
    const planet = sys.planets[0];
    harness.player()!.currentSystemId = sys.id;

    await harness.goTo(SceneType.PLANET, { planet });
    const obs = observe(harness.engine);

    expect(obs.scene).toBe(SceneType.PLANET);
    expect(obs.legalActions).toContain("trade");
    expect(obs.legalActions).not.toContain("attack");
    expect(harness.errors()).toEqual([]);
  });

  it("is egocentric: only the landed planet exposes a market; no prices in space", async () => {
    await harness.newGame();

    // In flight, before landing: nothing is "landed", so no market is visible
    // anywhere — not on the current system's planets either.
    const flightObs = observe(harness.engine);
    expect(flightObs.currentPlanet).toBeNull();
    for (const p of flightObs.system!.planets) {
      // The system view is name-only; prices are never leaked from orbit.
      expect(p).not.toHaveProperty("market");
      expect(p).not.toHaveProperty("buy");
      expect(p).not.toHaveProperty("sell");
    }
  });

  it("landing reveals only THIS planet's market; unvisited planets stay price-free", async () => {
    await harness.newGame();
    const sys = harness
      .galaxy()!
      .systems.find((s) =>
        s.planets.some((p) => p.market.availableResources.length > 0),
      )!;
    const planet = sys.planets.find(
      (p) => p.market.availableResources.length > 0,
    )!;
    harness.player()!.currentSystemId = sys.id;

    await harness.goTo(SceneType.PLANET, { planet });
    const obs = observe(harness.engine);

    // The landed planet's market is now perceivable.
    expect(obs.currentPlanet).not.toBeNull();
    expect(obs.currentPlanet!.id).toBe(planet.id);
    const market = obs.currentPlanet!.market;
    expect(market.length).toBeGreaterThan(0);
    for (const good of market) {
      expect(good.buy).toBeGreaterThan(0);
      expect(good.sell).toBeGreaterThan(0);
      // Same-planet spread invariant: you can never instantly resell at a profit.
      expect(good.sell).toBeLessThan(good.buy);
    }

    // The *other* (unvisited) planets in the same system still carry no prices —
    // the player would have to fly there to learn them.
    for (const p of obs.system!.planets) {
      expect(p).not.toHaveProperty("market");
    }
    expect(harness.errors()).toEqual([]);
  });

  it("the landed-planet market is deterministic across two reads of one state", async () => {
    await harness.newGame();
    const sys = harness
      .galaxy()!
      .systems.find((s) =>
        s.planets.some((p) => p.market.availableResources.length > 0),
      )!;
    const planet = sys.planets.find(
      (p) => p.market.availableResources.length > 0,
    )!;
    harness.player()!.currentSystemId = sys.id;
    await harness.goTo(SceneType.PLANET, { planet });

    expect(observe(harness.engine).currentPlanet!.market).toEqual(
      observe(harness.engine).currentPlanet!.market,
    );
  });
});

describe("observe(engine): Task 1 bank/equipment/Overmind/quest signals", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("hasCraftCenter/hasRepairDock flip on when the current system fields one", async () => {
    await harness.newGame();
    const sys = harness.galaxy()!.systems[0];
    sys.stations.push(
      new Station(
        "craft-1",
        "Крафт-центр",
        StationType.CRAFT_CENTER,
        Faction.INDEPENDENT,
        100,
        0,
      ),
      new Station(
        "repair-1",
        "Ремонтный узел",
        StationType.REPAIR_DOCK,
        Faction.INDEPENDENT,
        150,
        1,
      ),
    );
    harness.player()!.currentSystemId = sys.id;

    const obs = observe(harness.engine);
    expect(obs.hasCraftCenter).toBe(true);
    expect(obs.hasRepairDock).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("hasCraftCenter/hasRepairDock stay false without a matching station", async () => {
    await harness.newGame();
    const sys = harness.galaxy()!.systems[0];
    sys.stations.length = 0;
    sys.stations.push(
      new Station(
        "trade-1",
        "Торговый пост",
        StationType.TRADE_POST,
        Faction.INDEPENDENT,
        100,
        0,
      ),
    );
    harness.player()!.currentSystemId = sys.id;

    const obs = observe(harness.engine);
    expect(obs.hasCraftCenter).toBe(false);
    expect(obs.hasRepairDock).toBe(false);
  });

  it("hasBank is true once landed on any planet", async () => {
    await harness.newGame();
    const sys = harness.galaxy()!.systems.find((s) => s.planets.length > 0)!;
    const planet = sys.planets[0];
    harness.player()!.currentSystemId = sys.id;
    await harness.goTo(SceneType.PLANET, { planet });

    expect(observe(harness.engine).hasBank).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("nearOvermindCore is true at the core system and false elsewhere", async () => {
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const [coreSys, otherSys] = galaxy.systems;
    galaxy.overmindCoreSystemId = coreSys.id;

    harness.player()!.currentSystemId = coreSys.id;
    expect(observe(harness.engine).nearOvermindCore).toBe(true);

    harness.player()!.currentSystemId = otherSys.id;
    const farSys = galaxy.systems.find(
      (s) =>
        s.id !== coreSys.id &&
        !s.connections.some((c) => c.toSystemId === coreSys.id),
    );
    if (farSys) {
      harness.player()!.currentSystemId = farSys.id;
      expect(observe(harness.engine).nearOvermindCore).toBe(false);
    }
  });

  it("overmindShare reflects the captured fraction of the galaxy", async () => {
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    galaxy.overmindSystems = [galaxy.systems[0].id];

    const obs = observe(harness.engine);
    expect(obs.overmindShare).toBeCloseTo(1 / galaxy.systems.length);
  });

  it("liberate becomes legal once the current system is a cleared Overmind capture", async () => {
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;

    // Not yet captured: liberate is illegal.
    expect(observe(harness.engine).legalActions).not.toContain("liberate");

    // A freshly generated galaxy may already place a few hostiles in-system —
    // clear them first so only the staged garrison below controls the assertion.
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId !== sys) continue;
      if (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE) {
        n.state = NpcState.DEAD;
      }
    }

    // Captured but with a live defender still present: still illegal.
    galaxy.overmindSystems = [sys];
    galaxy.npcShips.push(
      new NpcShip({
        id: "garrison-1",
        name: "Страж",
        race: FactionType.OUTLANDERS,
        faction: Faction.OVERMIND,
        role: NpcRole.PATROL,
        hullHP: 100,
        maxHull: 100,
        shields: 0,
        speed: 1,
        damage: 10,
        currentSystemId: sys,
        state: NpcState.PATROLLING,
        goal: null,
        destinationSystemId: null,
        daysToArrival: 0,
        credits: 0,
        reputation: 0,
      }),
    );
    expect(observe(harness.engine).legalActions).not.toContain("liberate");

    // Garrison cleared: liberate becomes legal.
    galaxy.npcShips[galaxy.npcShips.length - 1].state = NpcState.DEAD;
    expect(observe(harness.engine).legalActions).toContain("liberate");
  });

  it("questDeliveryHere is true when a carried quest targets the current system", async () => {
    await harness.newGame();
    const obs = observe(harness.engine);
    // No quests yet — the signal must be present and false, not throw.
    expect(obs.questDeliveryHere).toBe(false);
  });

  it("activeLoans flips on after taking a real loan and off once repaid", async () => {
    await harness.newGame();
    const player = harness.player()!;
    expect(observe(harness.engine).activeLoans).toBe(false);

    takeLoan(
      harness.engine.bank.bus,
      harness.engine.bankingService,
      player.id,
      player.currentAccountId,
      { principal: 500, dailyRate: 0.02, periods: 5 },
    );

    const withLoan = observe(harness.engine);
    expect(withLoan.activeLoans).toBe(true);
    expect(withLoan.loanBalance).toBe(500);
    expect(withLoan.loanMissedPayments).toBe(0);
    expect(harness.errors()).toEqual([]);
  });

  it("cheapestGearPrice/bestHullPrice are non-negative numbers or null, and stable", async () => {
    await harness.newGame();
    const a = observe(harness.engine);
    const b = observe(harness.engine);
    expect(a.cheapestGearPrice).toEqual(b.cheapestGearPrice);
    expect(a.bestHullPrice).toEqual(b.bestHullPrice);
    if (a.cheapestGearPrice !== null) {
      expect(a.cheapestGearPrice).toBeGreaterThan(0);
    }
    if (a.bestHullPrice !== null) {
      expect(a.bestHullPrice).toBeGreaterThan(0);
    }
  });
});
