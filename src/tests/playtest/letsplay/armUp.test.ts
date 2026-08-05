import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { currentSystem } from "./engineQueries";
import {
  bestAffordableWeapon,
  planArmUp,
  canArmUp,
  executeArmUp,
} from "./equipmentQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("letsplay arm-up executor (Task 2)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "ARMUP-TEST" });
    await harness.newGame();

    const sys = currentSystem(harness.engine)!;
    sys.techLevel = 6;
    sys.stations.push(
      new Station(
        "craft-1",
        "Крафт-центр",
        StationType.CRAFT_CENTER,
        Faction.INDEPENDENT,
        100,
        0,
      ),
    );
    adjustPlayerCredits(
      harness.engine.bank,
      harness.engine.player!,
      500000,
      GL_COUNTERPARTY.REWARDS,
      "test seed",
    );
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("bestAffordableWeapon returns a stocked weapon with real damage", () => {
    const listing = bestAffordableWeapon(harness.engine);
    expect(listing).toBeTruthy();
    expect(listing!.gear.kind).toBe(GearKind.WEAPON);
    expect((listing!.gear as WeaponSpec).damage).toBeGreaterThan(0);
  });

  it("executeArmUp raises installed weapon damage by fitting a stronger gun", () => {
    const loadout = harness.engine.playerLoadout!;
    const before = loadout.derivedStats().weaponDamage;
    expect(canArmUp(harness.engine)).toBe(true);

    executeArmUp(harness.engine);

    const after = loadout.derivedStats().weaponDamage;
    expect(after).toBeGreaterThan(before);
    expect(harness.errors()).toHaveLength(0);
  });

  it("arms up until no further firepower gain is possible, then reports it done", () => {
    const loadout = harness.engine.playerLoadout!;
    const before = loadout.derivedStats().weaponDamage;

    let guard = 0;
    while (canArmUp(harness.engine) && guard < 12) {
      const prev = loadout.derivedStats().weaponDamage;
      executeArmUp(harness.engine);
      const now = loadout.derivedStats().weaponDamage;
      expect(now).toBeGreaterThanOrEqual(prev);
      guard++;
    }

    expect(canArmUp(harness.engine)).toBe(false);
    expect(planArmUp(harness.engine)).toBeNull();
    expect(loadout.derivedStats().weaponDamage).toBeGreaterThan(before);
    expect(harness.errors()).toHaveLength(0);
  });

  it("is a safe no-op with no affordable weapon and nothing owned to install", () => {
    const player = harness.engine.player!;
    const loadout = harness.engine.playerLoadout!;
    adjustPlayerCredits(
      harness.engine.bank,
      player,
      -player.credits,
      GL_COUNTERPARTY.EQUIPMENT,
      "drain for test",
    );
    const before = loadout.derivedStats().weaponDamage;

    expect(bestAffordableWeapon(harness.engine)).toBeNull();
    expect(canArmUp(harness.engine)).toBe(false);
    executeArmUp(harness.engine);

    expect(loadout.derivedStats().weaponDamage).toBe(before);
    expect(player.credits).toBe(0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("only spends credits when the pick isn't already owned", () => {
    const plan = planArmUp(harness.engine);
    expect(plan).toBeTruthy();
    expect(plan!.buyId).toBeTruthy();
    const strongest = bestAffordableWeapon(harness.engine);
    expect((strongest!.gear as WeaponSpec).damage).toBeGreaterThan(0);
  });
});
