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
import { FactionType, SceneType } from "@/types";
import type { Renderer } from "@/presentation/Renderer";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
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
  opts: { hullHP?: number; damage?: number } = {},
): NpcShipSprite {
  return {
    x,
    y,
    npc: {
      id,
      name: id,
      hullHP: opts.hullHP ?? 1000, // tanky by default so the fight persists
      damage: opts.damage ?? 20,
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

describe("GameEngine.triggerPlayerDeath (Task 2)", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;

  beforeEach(() => {
    localStorage.clear();
    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      onnxService: new MockOnnxService(),
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
      onnxService: new MockOnnxService(),
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
});
