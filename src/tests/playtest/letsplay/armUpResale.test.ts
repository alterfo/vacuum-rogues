import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { currentSystem } from "./engineQueries";
import { planArmUp, executeArmUp } from "./equipmentQueries";
import { ownedUninstalledGear } from "@/systems/equipment/GearBridge";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("arm-up resale — a displaced weapon converts to credits, not dead capital", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "ARMUP-RESALE" });
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

  it("a swap-plan arm-up sells the displaced weapon instead of hoarding it", () => {
    const engine = harness.engine;
    const player = engine.player!;
    const loadout = engine.playerLoadout!;

    let guard = 0;
    let sawSwap = false;
    while (guard < 12) {
      const plan = planArmUp(engine);
      if (!plan) break;
      const isSwap = plan.uninstallIndex != null;
      const displacedId = isSwap
        ? loadout.installedSlots()[plan.uninstallIndex!]?.gearId
        : undefined;
      executeArmUp(engine);
      if (isSwap && displacedId) {
        sawSwap = true;
        expect([...ownedUninstalledGear(player, loadout)]).not.toContain(
          displacedId,
        );
      }
      guard++;
    }

    expect(sawSwap).toBe(true);
    expect(harness.errors()).toEqual([]);
  });
});
