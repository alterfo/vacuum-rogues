import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { FactionType, HullClass, SceneType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { SaveState } from "@/domain/SaveState";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

vi.mock("pixi.js", () => ({
  Filter: class {},
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    stage: { addChild: vi.fn(), eventMode: "auto", off: vi.fn(), on: vi.fn() },
    ticker: { start: vi.fn(), stop: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
    pivot: { set: vi.fn() },
    on: vi.fn(),
    destroy: vi.fn(),
    eventMode: "static",
    cursor: "pointer",
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    ellipse: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
    clear: vi.fn(),
    addChild: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    text: "",
    style: {},
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

describe("GameEngine loadout persistence", () => {
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

  async function makeLiveGame(): Promise<void> {
    engine.galaxy = await diDeps.galaxyService.generate("test", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    engine.currentSceneType = SceneType.SPACE_FLIGHT;
  }

  it("saveGame writes the loadout snapshot into the save", async () => {
    await makeLiveGame();
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("eq_engine_iii");
    loadout.install("eq_tank");
    loadout.install("wpn_beam");
    engine.playerLoadout = loadout;

    await engine.saveGame("auto");

    const saved = await diDeps.saveService.read("auto");
    expect(saved!.loadout).toEqual(loadout.toJSON());
  });

  it("loadGame restores the purchased loadout from the save", async () => {
    await makeLiveGame();
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("eq_engine_iii");
    loadout.install("eq_tank");
    loadout.applyMicromodule("hull_warden", "mm_amplifier_1");

    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      loadout.toJSON(),
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    engine.playerLoadout = new ShipLoadout("hull_scout");

    expect(await engine.loadGame("auto")).toBe(true);
    expect(engine.playerLoadout!.hull.id).toBe("hull_warden");
    expect(engine.playerLoadout!.derivedStats()).toEqual(
      loadout.derivedStats(),
    );
  });

  it("loadGame falls back to the starter loadout for pre-persistence saves", async () => {
    await makeLiveGame();
    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      undefined, // old save: no loadout snapshot
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);
    expect(engine.playerLoadout!.hull.id).toBe("hull_corvette");
    expect(engine.playerLoadout!.installedGearIds()).toEqual([
      "eq_engine_i",
      "eq_tank",
      "wpn_pulse",
      "grav_tractor_1",
    ]);
  });

  it("the starter loadout includes a weapon and exposes weapon damage (a fresh game can fight)", async () => {
    await makeLiveGame();
    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      undefined, // pre-persistence save ⇒ falls back to the starter loadout
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);
    expect(engine.playerLoadout!.installedGearIds()).toContain("wpn_pulse");
    expect(engine.playerLoadout!.derivedStats().weaponDamage).toBeGreaterThan(
      0,
    );
  });

  it("loadGame falls back to the starter loadout when the saved hull id is unknown", async () => {
    await makeLiveGame();
    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      { hullId: "hull_gone", slotted: [{ gearId: "eq_engine_i" }] },
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);
    expect(engine.playerLoadout!.hull.id).toBe("hull_corvette");
  });

  it("loadGame projects the loadout hull onto the live ship so maxHull cannot drift", async () => {
    await makeLiveGame();
    engine.player!.ship.maxHull = 50;
    engine.player!.ship.hullHP = 50;

    const loadout = new ShipLoadout("hull_warden"); // FRIGATE, hp 220
    loadout.install("eq_engine_iii");
    loadout.install("eq_tank");

    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      loadout.toJSON(),
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);
    expect(engine.player!.ship.maxHull).toBe(
      engine.playerLoadout!.derivedStats().maxHull,
    );
    expect(engine.player!.ship.maxHull).toBe(220);
    expect(engine.player!.ship.hullClass).toBe(HullClass.FRIGATE);
    expect(engine.player!.ship.hullHP).toBeLessThanOrEqual(220);
  });
});
