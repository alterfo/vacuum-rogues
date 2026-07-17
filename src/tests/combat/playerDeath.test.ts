/**
 * Player-death detection → game-over trigger (plan 20260619, Task 2).
 *
 * Two layers are locked here:
 *   1. CombatModule — when incoming NPC fire drops the player hull to 0 it
 *      surfaces `onPlayerDestroyed` exactly once per fight (a stray later shot,
 *      or a second NPC firing the same frame, must NOT re-fire it).
 *   2. GameEngine.triggerPlayerDeath — idempotent guard (mirrors `_gameOverShown`)
 *      that fires the death flow once, and crucially does NOT overwrite the
 *      `"auto"` takeoff autosave (death must be non-destructive to the checkpoint).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { FactionType, NpcRole, SceneType } from "@/types";
import type { Renderer } from "@/presentation/Renderer";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

const FIRE = GAME_BALANCE.combatFireIntervalMs;

function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: true,
    currentSpeed: 1,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics;
}

function makeSprite(
  id: string,
  x: number,
  y: number,
  opts: { hullHP?: number; damage?: number; role?: NpcRole } = {},
): NpcShipSprite {
  return {
    x,
    y,
    npc: {
      id,
      name: id,
      hullHP: opts.hullHP ?? 1000, // tanky by default so the fight persists
      damage: opts.damage ?? 20,
      role: opts.role ?? NpcRole.PIRATE,
    },
  } as unknown as NpcShipSprite;
}

/** Build a CombatModule wired to count player-death notifications. */
function setup(ship: { hullHP: number; maxHull: number }): {
  module: CombatModule;
  ship: { hullHP: number; maxHull: number };
  deathCount: () => number;
} {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  let deaths = 0;
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    onPlayerDestroyed: () => {
      deaths++;
    },
  };
  return { module: new CombatModule(deps), ship, deathCount: () => deaths };
}

describe("CombatModule player-death detection (Task 2)", () => {
  it("fires onPlayerDestroyed once when the hull reaches 0", () => {
    const { module, ship, deathCount } = setup({ hullHP: 15, maxHull: 100 });
    module.addCombatant(makeSprite("a", 50, 0, { damage: 20 }));
    module.update(FIRE); // 15 - 20 → clamped to 0
    expect(ship.hullHP).toBe(0);
    expect(deathCount()).toBe(1);
  });

  it("does not fire while the hull is still above 0", () => {
    const { module, deathCount } = setup({ hullHP: 100, maxHull: 100 });
    module.addCombatant(makeSprite("a", 50, 0, { damage: 20 }));
    module.update(FIRE); // 100 - 20 = 80, alive
    expect(deathCount()).toBe(0);
  });

  it("a stray later shot does not re-fire the death (idempotent per fight)", () => {
    const { module, deathCount } = setup({ hullHP: 15, maxHull: 100 });
    // Tanky NPC survives the player's return fire, so it keeps shooting after the kill.
    module.addCombatant(makeSprite("a", 50, 0, { hullHP: 100000, damage: 20 }));
    module.update(FIRE); // player dies here
    module.update(FIRE); // further fire lands on a 0-hull ship
    module.update(FIRE);
    expect(deathCount()).toBe(1);
  });

  it("two NPCs firing the same frame surface the death only once", () => {
    const { module, deathCount } = setup({ hullHP: 15, maxHull: 100 });
    module.addCombatant(makeSprite("a", 40, 0, { hullHP: 100000, damage: 20 }));
    module.addCombatant(makeSprite("b", 60, 0, { hullHP: 100000, damage: 20 }));
    module.update(FIRE); // both fire in the same advanceNpcTimers loop
    expect(deathCount()).toBe(1);
  });

  it("a fresh fight after endCombat can report death again", () => {
    const ship = { hullHP: 15, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    let deaths = 0;
    const module = new CombatModule({
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
      onPlayerDestroyed: () => {
        deaths++;
      },
    });

    module.addCombatant(makeSprite("a", 50, 0, { hullHP: 100000, damage: 20 }));
    module.update(FIRE);
    expect(deaths).toBe(1);

    module.endCombat(); // resets the per-fight death guard
    ship.hullHP = 15; // player repaired and takes off again
    module.addCombatant(makeSprite("b", 50, 0, { hullHP: 100000, damage: 20 }));
    module.update(FIRE);
    expect(deaths).toBe(2);
  });
});

describe("CombatModule.lastDeathCause (win-rate-100pct plan, Task 6 escalation telemetry)", () => {
  it("is null before any death", () => {
    const { module } = setup({ hullHP: 100, maxHull: 100 });
    expect(module.lastDeathCause).toBeNull();
  });

  it("records the killer's id/role, engagement-start hull fraction, and combatant count", () => {
    const { module, ship } = setup({ hullHP: 20, maxHull: 100 }); // 0.2 fraction at engage
    module.addCombatant(
      makeSprite("a", 50, 0, { damage: 20, role: NpcRole.RANGER }),
    );
    module.update(FIRE); // 20 - 20 → clamped to 0
    expect(ship.hullHP).toBe(0);
    expect(module.lastDeathCause).toEqual({
      killerNpcId: "a",
      killerRole: NpcRole.RANGER,
      engagementStartHullFraction: 0.2,
      simultaneousCombatants: 1,
      roundsSurvived: 1,
    });
  });

  it("counts every simultaneously-engaged combatant, not just the killer", () => {
    const { module } = setup({ hullHP: 15, maxHull: 100 });
    module.addCombatant(makeSprite("a", 40, 0, { hullHP: 100000, damage: 20 }));
    module.addCombatant(makeSprite("b", 60, 0, { hullHP: 100000, damage: 20 }));
    module.update(FIRE); // both fire in the same advanceNpcTimers loop
    expect(module.lastDeathCause?.simultaneousCombatants).toBe(2);
  });

  it("engagementStartHullFraction is captured at the fight's OPENING hit, not the fatal one", () => {
    const { module, ship } = setup({ hullHP: 100, maxHull: 100 }); // fraction 1.0 at engage
    const hostile = makeSprite("a", 50, 0, { damage: 10 });
    module.addCombatant(hostile); // fresh engagement: isActive false → true
    module.update(FIRE); // 100 - 10 = 90, non-lethal
    expect(ship.hullHP).toBe(90);
    // The SAME ongoing fight escalates (isActive stays true — engagementStartHullFraction
    // must NOT re-capture here, only at the original open above).
    (hostile.npc as { damage: number }).damage = 200;
    module.update(FIRE); // now lethal
    expect(ship.hullHP).toBe(0);
    expect(module.lastDeathCause?.engagementStartHullFraction).toBe(1);
  });

  it("a fresh fight after endCombat re-captures engagement-start hull for its own death", () => {
    const ship = { hullHP: 50, maxHull: 100 };
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const module = new CombatModule({
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getPlayerShip: () => ship,
    });

    module.addCombatant(
      makeSprite("a", 50, 0, { hullHP: 100000, damage: 200 }),
    );
    module.update(FIRE);
    expect(module.lastDeathCause?.engagementStartHullFraction).toBe(0.5);

    module.endCombat();
    ship.hullHP = 30; // repaired to a different hull level, takes off again
    module.addCombatant(
      makeSprite("b", 50, 0, { hullHP: 100000, damage: 200 }),
    );
    module.update(FIRE);
    expect(module.lastDeathCause?.engagementStartHullFraction).toBe(0.3);
    expect(module.lastDeathCause?.killerNpcId).toBe("b");
  });

  it("roundsSurvived counts every beginCombatRound call in the fight, not just the opening one", () => {
    const { module, ship } = setup({ hullHP: 100, maxHull: 100 });
    const hostile = makeSprite("a", 50, 0, { hullHP: 100000, damage: 1 });
    module.addCombatant(hostile);
    expect(module.lastDeathCause).toBeNull(); // not dead yet
    // Mirrors PlayerAgent.waitOneDay's own per-step call — a real fight
    // survives several of these before the fatal one.
    module.beginCombatRound();
    module.beginCombatRound();
    expect(ship.hullHP).toBe(100); // sanity: still alive, no update() ticked yet
    (hostile.npc as { damage: number }).damage = 200;
    module.update(FIRE); // now lethal
    expect(ship.hullHP).toBe(0);
    // 1 (fresh-engagement open) + 2 explicit calls above = 3.
    expect(module.lastDeathCause?.roundsSurvived).toBe(3);
  });

  it("a beginCombatRound call outside any fight does not inflate the NEXT fight's round count", () => {
    const { module, ship } = setup({ hullHP: 100, maxHull: 100 });
    // Peaceful steps before any engagement (e.g. PlayerAgent.waitOneDay's
    // unconditional per-step call while just flying around).
    module.beginCombatRound();
    module.beginCombatRound();
    module.beginCombatRound();
    module.addCombatant(makeSprite("a", 50, 0, { damage: 200 }));
    module.update(FIRE);
    expect(ship.hullHP).toBe(0);
    expect(module.lastDeathCause?.roundsSurvived).toBe(1); // only the fresh-engagement round counts
  });
});

describe("GameEngine.triggerPlayerDeath (Task 2)", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;

  beforeEach(() => {
    localStorage.clear();
    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
    };
    engine = new GameEngine(diDeps);
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("fires the death callback exactly once", () => {
    const cb = vi.fn();
    engine.playerDeathCallback = cb;
    engine.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("repeated calls are a no-op (idempotent guard)", () => {
    const cb = vi.fn();
    engine.playerDeathCallback = cb;
    engine.triggerPlayerDeath();
    engine.triggerPlayerDeath();
    engine.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does NOT overwrite the takeoff autosave on death", () => {
    const saveSpy = vi.spyOn(engine, "saveGame");
    const writeSpy = vi.spyOn(diDeps.saveService, "write");
    engine.triggerPlayerDeath();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("loading a save re-arms the death guard so the player can die again", async () => {
    engine.galaxy = await diDeps.galaxyService.generate("test", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    await engine.saveGame("auto");

    const cb = vi.fn();
    engine.playerDeathCallback = cb;
    engine.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(1);

    // Loading the checkpoint resets the guard; a subsequent death fires anew.
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);
    await engine.loadGame("auto");
    engine.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("GameEngine.triggerPlayerDeath → GAME_OVER transition (Task 4)", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;

  beforeEach(() => {
    localStorage.clear();
    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
    };
    engine = new GameEngine(diDeps);
    // A truthy renderer lets the production death path drive the GAME_OVER
    // transition (transitionTo is stubbed so no real scene graph is needed).
    engine.renderer = {} as Renderer;
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("transitions to GAME_OVER exactly once when a renderer is present", () => {
    const transitionTo = vi
      .spyOn(engine, "transitionTo")
      .mockResolvedValue(undefined);
    engine.triggerPlayerDeath();
    engine.triggerPlayerDeath(); // guarded — must not re-transition
    expect(transitionTo).toHaveBeenCalledTimes(1);
    expect(transitionTo).toHaveBeenCalledWith(
      SceneType.GAME_OVER,
      expect.objectContaining({ gameEngine: engine }),
    );
  });

  it("does NOT overwrite the takeoff autosave when transitioning to GAME_OVER", () => {
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);
    const saveSpy = vi.spyOn(engine, "saveGame");
    const writeSpy = vi.spyOn(diDeps.saveService, "write");
    engine.triggerPlayerDeath();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("«Начать заново» (restartNewGame) clears the dead player + regenerates the galaxy", async () => {
    engine.galaxy = await diDeps.galaxyService.generate("old", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    const deadGalaxy = engine.galaxy;
    // Player died → death guard latched.
    const transitionTo = vi
      .spyOn(engine, "transitionTo")
      .mockResolvedValue(undefined);
    engine.triggerPlayerDeath();

    await engine.restartNewGame();

    // A bare transitionTo(RACE_SELECTION) would leave the dead player in place;
    // restartNewGame must reset state so the SPACE_FLIGHT new-game guard fires.
    expect(engine.player).toBeNull();
    expect(engine.galaxy).not.toBe(deadGalaxy);
    expect(transitionTo).toHaveBeenCalledWith(
      SceneType.RACE_SELECTION,
      expect.objectContaining({ gameEngine: engine }),
    );

    // Death guard re-armed: a fresh game can die again.
    const cb = vi.fn();
    engine.playerDeathCallback = cb;
    engine.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
