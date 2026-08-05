import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import {
  applyLiveAction,
  type ApplyCall,
  type LiveSceneController,
} from "./LiveApplier";
import { legalActionsForScene, type Observation } from "./observe";
import type { Action } from "./PlayerPolicy";

function makeController(): {
  controller: LiveSceneController;
  calls: ApplyCall[];
} {
  const calls: ApplyCall[] = [];
  const rec =
    (call: ApplyCall) =>
    (..._args: unknown[]): void => {
      calls.push(call);
    };
  const controller: LiveSceneController = {
    tick: rec("tick"),
    leaveToFlight: rec("leaveToFlight"),
    land: rec("land"),
    dock: rec("dock"),
    openStarMap: rec("openStarMap"),
    warp: rec("warp"),
    openTrade: rec("openTrade"),
    executeTrade: rec("executeTrade"),
    takeQuest: rec("takeQuest"),
    attack: rec("attack"),
    flee: rec("flee"),
    repair: rec("repair"),
    buyGear: rec("buyGear"),
    upgradeHull: rec("upgradeHull"),
    buyModule: rec("buyModule"),
    takeLoan: rec("takeLoan"),
    repayLoan: rec("repayLoan"),
    sellCargo: rec("sellCargo"),
    armUp: rec("armUp"),
    liberate: rec("liberate"),
  };
  return { controller, calls };
}

function makeObs(
  scene: SceneType,
  ctx: Partial<Parameters<typeof legalActionsForScene>[1]> = {},
): Observation {
  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: 1,
    stationCount: 1,
    hostileCount: 1,
    connectionCount: 1,
    availableQuestCount: 1,
    credits: 1_000_000,
    cheapestGearPrice: 100,
    bestHullPrice: 100,
    ...ctx,
  });
  return {
    scene,
    hasPlayer: true,
    player: null,
    system: null,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
  };
}

const act = (kind: Action["kind"], targetId?: string): Action => ({
  kind,
  targetId,
});

describe("applyLiveAction — legal actions drive the expected controller verb", () => {
  it.each<[SceneType, Action["kind"], ApplyCall]>([
    [SceneType.SPACE_FLIGHT, "wait", "tick"],
    [SceneType.SPACE_FLIGHT, "move", "tick"], // in flight, move = fly a frame
    [SceneType.SPACE_FLIGHT, "land", "land"],
    [SceneType.SPACE_FLIGHT, "dock", "dock"],
    [SceneType.SPACE_FLIGHT, "warp", "openStarMap"], // from flight, warp opens the map
    [SceneType.SPACE_FLIGHT, "attack", "attack"],
    [SceneType.SPACE_FLIGHT, "flee", "flee"],
    [SceneType.STAR_MAP, "warp", "warp"], // on the map, warp jumps
    [SceneType.PLANET, "trade", "openTrade"], // on a planet, trade opens the market
    [SceneType.PLANET, "take-quest", "takeQuest"],
    [SceneType.PLANET, "move", "leaveToFlight"], // sub-screen move backs out
    [SceneType.TRADE, "trade", "executeTrade"], // in the market, trade buys/sells
    [SceneType.STATION, "repair", "repair"],
    [SceneType.STATION, "move", "leaveToFlight"],
    [SceneType.STATION, "buy-gear", "buyGear"], // station is a shortcut to the shop
    [SceneType.STATION, "upgrade-hull", "upgradeHull"],
    [SceneType.STATION, "take-loan", "takeLoan"], // no active loan by default
    [SceneType.BANK, "take-loan", "takeLoan"],
  ])("scene %s + %s → %s", async (scene, kind, expectedCall) => {
    const { controller, calls } = makeController();
    const result = await applyLiveAction(act(kind), makeObs(scene), controller);

    expect(result.applied).toBe(true);
    expect(result.call).toBe(expectedCall);
    expect(calls).toEqual([expectedCall]);
  });

  it("buy-module at STATION is legal with a CRAFT_CENTER and enough credits", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.STATION, {
      hasCraftCenter: true,
      credits: 1000,
    });
    expect(obs.legalActions).toContain("buy-module");

    const result = await applyLiveAction(act("buy-module"), obs, controller);
    expect(result.call).toBe("buyModule");
    expect(calls).toEqual(["buyModule"]);
  });

  it("liberate at SPACE_FLIGHT is legal only when the system is a cleared capture", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.SPACE_FLIGHT, { canLiberate: true });
    expect(obs.legalActions).toContain("liberate");

    const result = await applyLiveAction(act("liberate"), obs, controller);
    expect(result.call).toBe("liberate");
    expect(calls).toEqual(["liberate"]);

    const notCleared = makeObs(SceneType.SPACE_FLIGHT, { canLiberate: false });
    expect(notCleared.legalActions).not.toContain("liberate");
    const skipped = await applyLiveAction(
      act("liberate"),
      notCleared,
      controller,
    );
    expect(skipped.applied).toBe(false);
  });

  it("arm-up at a shop is legal only when a refit is available, and drives armUp", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.STATION, { canArmUp: true });
    expect(obs.legalActions).toContain("arm-up");

    const result = await applyLiveAction(act("arm-up"), obs, controller);
    expect(result.call).toBe("armUp");
    expect(calls).toEqual(["armUp"]);

    const noRefit = makeObs(SceneType.STATION, { canArmUp: false });
    expect(noRefit.legalActions).not.toContain("arm-up");
    const skipped = await applyLiveAction(act("arm-up"), noRefit, controller);
    expect(skipped.applied).toBe(false);
  });

  it("repay-loan replaces take-loan at STATION/BANK once a loan is active", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.BANK, { activeLoans: true });
    expect(obs.legalActions).not.toContain("take-loan");
    expect(obs.legalActions).toContain("repay-loan");

    const result = await applyLiveAction(act("repay-loan"), obs, controller);
    expect(result.call).toBe("repayLoan");
    expect(calls).toEqual(["repayLoan"]);
  });

  it("buy-gear/upgrade-hull at EQUIPMENT_SHOP are legal only when affordable", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.EQUIPMENT_SHOP, {
      credits: 5000,
      cheapestGearPrice: 2000,
      bestHullPrice: 4000,
    });
    expect(obs.legalActions).toContain("buy-gear");
    expect(obs.legalActions).toContain("upgrade-hull");

    const gearResult = await applyLiveAction(act("buy-gear"), obs, controller);
    expect(gearResult.call).toBe("buyGear");

    const hullResult = await applyLiveAction(
      act("upgrade-hull"),
      obs,
      controller,
    );
    expect(hullResult.call).toBe("upgradeHull");
    expect(calls).toEqual(["buyGear", "upgradeHull"]);
  });

  it.each<SceneType>([SceneType.PLANET, SceneType.TRADE])(
    "sell-cargo at %s is legal only when cargo is held",
    async (scene) => {
      const { controller, calls } = makeController();
      const obs = makeObs(scene, { cargoUsed: 3 });
      expect(obs.legalActions).toContain("sell-cargo");

      const result = await applyLiveAction(act("sell-cargo"), obs, controller);
      expect(result.call).toBe("sellCargo");
      expect(calls).toEqual(["sellCargo"]);
    },
  );

  it("warp while warpInTransit=true calls tick (not openStarMap)", async () => {
    const { controller, calls } = makeController();
    const obs: Observation = {
      ...makeObs(SceneType.SPACE_FLIGHT),
      warpInTransit: true,
    };
    const result = await applyLiveAction(act("warp"), obs, controller);
    expect(result.call).toBe("tick");
    expect(calls).toEqual(["tick"]);
  });

  it.each<Action["kind"]>(["land", "dock", "move"])(
    "%s while warpInTransit=true calls tick instead (would otherwise redirect/cancel the route)",
    async (kind) => {
      const { controller, calls } = makeController();
      const obs: Observation = {
        ...makeObs(SceneType.SPACE_FLIGHT),
        warpInTransit: true,
      };
      const result = await applyLiveAction(act(kind), obs, controller);
      expect(result.call).toBe("tick");
      expect(calls).toEqual(["tick"]);
    },
  );

  it.each<Action["kind"]>(["attack", "flee"])(
    "%s while warpInTransit=true still drives its own verb (combat reaction overrides warp-wait)",
    async (kind) => {
      const { controller, calls } = makeController();
      const obs: Observation = {
        ...makeObs(SceneType.SPACE_FLIGHT),
        warpInTransit: true,
      };
      const result = await applyLiveAction(act(kind), obs, controller);
      expect(result.call).toBe(kind);
      expect(calls).toEqual([kind]);
    },
  );

  it("forwards the action targetId to the controller verb", async () => {
    const land = vi.fn();
    const { controller } = makeController();
    const result = await applyLiveAction(
      act("land", "planet-7"),
      makeObs(SceneType.SPACE_FLIGHT),
      { ...controller, land },
    );

    expect(result.call).toBe("land");
    expect(land).toHaveBeenCalledWith("planet-7");
  });
});

describe("applyLiveAction — illegal actions are a safe no-op", () => {
  it("skips an action not in the current scene's legalActions", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.STAR_MAP);
    expect(obs.legalActions).not.toContain("land");

    const result = await applyLiveAction(act("land"), obs, controller);

    expect(result.applied).toBe(false);
    expect(result.call).toBe("none");
    expect(result.reason).toMatch(/illegal/);
    expect(calls).toEqual([]); // nothing driven
  });

  it("skips attack/flee when no hostile is present", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.SPACE_FLIGHT, { hostileCount: 0 });
    expect(obs.legalActions).not.toContain("attack");

    const attackResult = await applyLiveAction(act("attack"), obs, controller);
    const fleeResult = await applyLiveAction(act("flee"), obs, controller);

    expect(attackResult.applied).toBe(false);
    expect(fleeResult.applied).toBe(false);
    expect(calls).toEqual([]);
  });

  it("skips take-quest where no work is offered", async () => {
    const { controller, calls } = makeController();
    const obs = makeObs(SceneType.PLANET, { availableQuestCount: 0 });
    expect(obs.legalActions).not.toContain("take-quest");

    const result = await applyLiveAction(act("take-quest"), obs, controller);

    expect(result.applied).toBe(false);
    expect(calls).toEqual([]);
  });

  it("never throws and always returns a result for every action kind", async () => {
    const { controller } = makeController();
    const scenes = [
      SceneType.SPACE_FLIGHT,
      SceneType.PLANET,
      SceneType.TRADE,
      SceneType.STATION,
      SceneType.STAR_MAP,
      SceneType.EQUIPMENT_SHOP,
      SceneType.BANK,
    ];
    const kinds: Action["kind"][] = [
      "move",
      "warp",
      "land",
      "dock",
      "trade",
      "take-quest",
      "attack",
      "flee",
      "repair",
      "wait",
      "buy-gear",
      "upgrade-hull",
      "buy-module",
      "take-loan",
      "repay-loan",
      "sell-cargo",
    ];
    for (const scene of scenes) {
      const obs = makeObs(scene);
      for (const kind of kinds) {
        const result = await applyLiveAction(act(kind), obs, controller);
        expect(typeof result.applied).toBe("boolean");
        expect(result.call).toBeDefined();
      }
    }
  });
});
