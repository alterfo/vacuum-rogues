/**
 * Save-compat safety net (Task 2): load-time loadout revalidation.
 *
 * A catalog rebalance can shrink a hull's slot/mass capacity *after* a save was
 * written. Because `ShipLoadout.fromJSON` restores the persisted fitting
 * verbatim (no auto-eviction — canon: an existing loadout is read as-is), a
 * previously-valid loadout can come back over-capacity. The load path must
 * revalidate it against the **current** hull and drop the excess to the
 * inventory bag instead of loading an invalid over-fit state — so a catalog
 * shrink can never brick a progressed beta save.
 *
 * The pure `ShipLoadout.revalidateToCurrentHull()` is unit-tested here; the
 * GameEngine.loadGame wiring (excess → bag, normal save untouched) is exercised
 * with the real engine + mock services, mirroring loadout-persistence.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { FactionType, SceneType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { SaveState } from "@/domain/SaveState";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipLoadoutSnapshot } from "@/types";

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

describe("ShipLoadout.revalidateToCurrentHull (pure)", () => {
  it("drops weapons that overflow the current hull's weapon bank", () => {
    // Corvette: 2 weapon slots. A snapshot with 4 weapons restores verbatim
    // (fromJSON does not auto-evict), simulating a save written when the hull
    // had more slots than the current catalog gives it.
    const snapshot: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
      ],
    };
    const loadout = ShipLoadout.fromJSON(snapshot)!;
    expect(loadout.derivedStats().categories.weapon.used).toBe(4);

    const dropped = loadout.revalidateToCurrentHull();

    // 4 weapons − 2 slots = 2 dropped; the engine + tank are kept.
    expect(dropped.map((d) => d.gearId)).toEqual(["wpn_pulse", "wpn_pulse"]);
    expect(loadout.derivedStats().categories.weapon.used).toBe(2);
    expect(loadout.installedGearIds()).toEqual([
      "eq_engine_i",
      "eq_tank",
      "wpn_pulse",
      "wpn_pulse",
    ]);
  });

  it("drops gear that overflows the mass budget while keeping engine + fuel", () => {
    // Scout: massCapacity 30, weapon cap 2. engine_i(6) + tank(3) + two
    // torpedoes(12 each) = 33 mass: within every category cap but over МАССА.
    const snapshot: ShipLoadoutSnapshot = {
      hullId: "hull_scout",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_torpedo" },
        { gearId: "wpn_torpedo" },
      ],
    };
    const loadout = ShipLoadout.fromJSON(snapshot)!;
    expect(loadout.derivedStats().massUsed).toBe(33);

    const dropped = loadout.revalidateToCurrentHull();

    // One torpedo (the last non-essential part) is shed; engine + tank survive
    // so the ship can still take off. 6 + 3 + 12 = 21 ≤ 30.
    expect(dropped.map((d) => d.gearId)).toEqual(["wpn_torpedo"]);
    const stats = loadout.derivedStats();
    expect(stats.massUsed).toBe(21);
    expect(stats.massUsed).toBeLessThanOrEqual(stats.massCapacity);
    expect(stats.canTakeOff).toBe(true);
  });

  it("leaves a within-capacity loadout untouched (no drops)", () => {
    // The fully-fitted starter corvette: 16 mass, every bank within cap.
    const snapshot: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_pulse" },
        { gearId: "grav_tractor_1" },
      ],
    };
    const loadout = ShipLoadout.fromJSON(snapshot)!;
    const before = loadout.installedGearIds();

    const dropped = loadout.revalidateToCurrentHull();

    expect(dropped).toEqual([]);
    expect(loadout.installedGearIds()).toEqual(before);
  });

  it("preserves the micromodule + upgrades on a dropped slot record", () => {
    // The returned drop record carries the attached micromodule and upgrade
    // count so the load path can re-bag losslessly via slotToBagModule.
    const snapshot: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse", micromoduleId: "mm_amplifier_1", upgrades: 2 },
      ],
    };
    const loadout = ShipLoadout.fromJSON(snapshot)!;
    const dropped = loadout.revalidateToCurrentHull();

    // 3 weapons − 2 slots = 1 dropped: the last-installed weapon (the modded one).
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toEqual({
      gearId: "wpn_pulse",
      micromoduleId: "mm_amplifier_1",
      upgrades: 2,
    });
  });

  it("keeps fitted hull micromodules when trimming over-capacity slots", () => {
    // The one behavior that distinguishes revalidateToCurrentHull from swapHull
    // (which clears hull micromodules): the hull is unchanged on a load, so its
    // fitted micromodules must survive even while over-capacity gear is shed.
    // A regression that cleared hullMicromoduleIds in the shared eviction path
    // would silently strip a beta-tester's fitted hull micromodules on load.
    const snapshot: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
      ],
    };
    const loadout = ShipLoadout.fromJSON(snapshot)!;
    expect(loadout.applyMicromodule("hull_corvette", "mm_hull_armor_1")).toBe(
      true,
    );
    expect(loadout.hullMicromodules()).toEqual(["mm_hull_armor_1"]);

    const dropped = loadout.revalidateToCurrentHull();

    // The 2 over-cap weapons are shed, but the hull micromodule is untouched.
    expect(dropped).toHaveLength(2);
    expect(loadout.hullMicromodules()).toEqual(["mm_hull_armor_1"]);
  });

  it("sheds a duplicate single-slot part carried over from a legacy save", () => {
    // Engine/radar are dedicated cap-1 banks. A legacy/corrupt save with two
    // engines fitted must drop the duplicate on load (not keep an invalid 2nd
    // engine) while staying takeoff-capable on the surviving engine + fuel.
    const snapshot: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_pulse" },
      ],
    };
    const loadout = ShipLoadout.fromJSON(snapshot)!;
    expect(loadout.derivedStats().categories.engine.used).toBe(2);

    const dropped = loadout.revalidateToCurrentHull();

    expect(dropped.map((d) => d.gearId)).toEqual(["eq_engine_i"]);
    expect(loadout.derivedStats().categories.engine.used).toBe(1);
    expect(loadout.derivedStats().canTakeOff).toBe(true);
  });
});

describe("GameEngine.loadGame loadout revalidation", () => {
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

  async function makeLiveGame(): Promise<void> {
    engine.galaxy = await diDeps.galaxyService.generate("test", 5);
    engine.player = diDeps.playerService.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    engine.currentSceneType = SceneType.SPACE_FLIGHT;
  }

  it("an over-capacity save loads with the excess moved to the inventory bag", async () => {
    await makeLiveGame();
    // A save whose corvette carries 4 weapons (2 over the 2-slot bank) — exactly
    // the shape a catalog shrink would leave behind.
    const overfit: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
      ],
    };
    const bagBefore = engine.player!.inventory.modules.length;
    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      overfit,
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);

    // Loadout trimmed to the valid 2-weapon fitting…
    expect(engine.playerLoadout!.derivedStats().categories.weapon.used).toBe(2);
    // …and the 2 dropped weapons re-homed in the inventory bag, not destroyed.
    const added = engine.player!.inventory.modules.slice(bagBefore);
    expect(added).toHaveLength(2);
    expect(added.every((m) => m.id === "wpn_pulse")).toBe(true);
    // Still flyable.
    expect(engine.playerLoadout!.derivedStats().canTakeOff).toBe(true);
  });

  it("re-homes a dropped slot's micromodule + upgrades into the bag losslessly", async () => {
    await makeLiveGame();
    // The over-cap weapon that gets dropped carries a fitted micromodule and
    // artifact upgrades. The load path must re-bag it via slotToBagModule (not a
    // bare id), so the player doesn't lose the artifacts they spent. Per-category
    // eviction drops the LAST-installed weapons, so the modded copy is among them.
    const overfit: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse" },
        { gearId: "wpn_pulse", micromoduleId: "mm_amplifier_1", upgrades: 2 },
      ],
    };
    const bagBefore = engine.player!.inventory.modules.length;
    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      overfit,
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);

    const added = engine.player!.inventory.modules.slice(bagBefore);
    expect(added).toHaveLength(2);
    // The modded weapon kept its micromodule + upgrade count through the re-bag.
    const modded = added.find((m) => m.micromoduleId === "mm_amplifier_1");
    expect(modded).toBeDefined();
    expect(modded!.id).toBe("wpn_pulse");
    expect(modded!.upgrades).toBe(2);
  });

  it("a within-capacity save is loaded untouched (nothing added to the bag)", async () => {
    await makeLiveGame();
    const fitting: ShipLoadoutSnapshot = {
      hullId: "hull_corvette",
      slotted: [
        { gearId: "eq_engine_i" },
        { gearId: "eq_tank" },
        { gearId: "wpn_pulse" },
        { gearId: "grav_tractor_1" },
      ],
    };
    const bagBefore = engine.player!.inventory.modules.length;
    const save = new SaveState(
      1,
      engine.galaxy!,
      engine.player!,
      [],
      Date.now(),
      SceneType.SPACE_FLIGHT,
      fitting,
    );
    (diDeps.saveService as MockSaveService).setSave("auto", save);
    vi.spyOn(engine, "transitionTo").mockResolvedValue(undefined);

    expect(await engine.loadGame("auto")).toBe(true);

    expect(engine.playerLoadout!.installedGearIds()).toEqual([
      "eq_engine_i",
      "eq_tank",
      "wpn_pulse",
      "grav_tractor_1",
    ]);
    expect(engine.player!.inventory.modules.length).toBe(bagBefore);
  });
});
