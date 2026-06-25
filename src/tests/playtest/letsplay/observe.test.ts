import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
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
});
