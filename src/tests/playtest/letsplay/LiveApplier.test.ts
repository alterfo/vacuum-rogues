import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import {
  applyLiveAction,
  type ApplyCall,
  type LiveSceneController,
} from "./LiveApplier";
import { legalActionsForScene, type Observation } from "./observe";
import type { Action } from "./PlayerPolicy";

/**
 * Task 1 of the dev-only autopilot: the live-scene action applier.
 *
 * {@link applyLiveAction} is pure dispatch logic over a {@link LiveSceneController}
 * port, so it is tested against a **mocked** controller (no PixiJS, no real scene):
 *  - each legal {@link Action} kind drives exactly the expected controller verb;
 *  - the scene-aware two-step verbs (`move`/`trade`/`warp`) resolve by scene;
 *  - an action illegal for the current scene is a safe no-op (nothing driven).
 */

/** A spy controller recording the verbs invoked, in order. */
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
  };
  return { controller, calls };
}

/**
 * Build an {@link Observation} whose `legalActions` come from the same pure
 * `legalActionsForScene` the real `observe` uses, so an action is filtered
 * against the exact legal set the engine would produce for that scene.
 */
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
  ])("scene %s + %s → %s", async (scene, kind, expectedCall) => {
    const { controller, calls } = makeController();
    const result = await applyLiveAction(act(kind), makeObs(scene), controller);

    expect(result.applied).toBe(true);
    expect(result.call).toBe(expectedCall);
    expect(calls).toEqual([expectedCall]);
  });

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
    // "land" is not legal on the star map.
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
