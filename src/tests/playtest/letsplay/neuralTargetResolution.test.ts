/**
 * Guard: the neural seam attaches a concrete `targetId` for a chosen `land` kind
 * (Task 9 of the 20260701 smart-autopilot plan).
 *
 * The net's output head only picks an action **kind** — it never names a target.
 * The appliers resolve most targets themselves, but `PlayerAgent.apply`'s `land`
 * case lands *only* on `action.targetId` (a deliberate guard against spin-landing
 * an uninhabited planet) with **no fallback**, so a bare `{kind:"land"}` from the
 * net teleport-lands nowhere and the agent stalls in a land→no-op→land loop — the
 * net can never actually land. `mapNetOutputToAction` now fills that gap by
 * resolving a habitable in-system planet as the land target. This pins that
 * behaviour so the net's most-important economy action stays executable.
 *
 * Dev-only, like the rest of `letsplay/`. A **new** file — the existing
 * `NeuralPolicy.test.ts` assertions (kind/reason/legality) are left untouched.
 */
import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import { mapNetOutputToAction } from "./NeuralPolicy";
import {
  ACTION_ORDER,
  legalActionsForScene,
  type Observation,
  type PlayerActionKind,
} from "./observe";

/** A score vector that maxes out `kind` and zeroes the rest. */
function favour(kind: PlayerActionKind): number[] {
  return ACTION_ORDER.map((k) => (k === kind ? 1 : 0));
}

/** Minimal SPACE_FLIGHT observation with the given in-system planets. */
function flightObs(
  planets: {
    id: string;
    name: string;
    availableQuests: number;
    isHabitable?: boolean;
  }[],
): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: {
      credits: 1000,
      hull: 100,
      maxHull: 100,
      hullFraction: 1,
      fuel: 50,
      maxFuel: 100,
      fuelFraction: 0.5,
      cargo: [],
      cargoUsed: 0,
      cargoCapacity: 20,
      systemId: "sys-1",
      position: { x: 0, y: 0 },
    },
    system: { id: "sys-1", name: "Сол", planets, stations: [], connections: 1 },
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: legalActionsForScene(SceneType.SPACE_FLIGHT, {
      hasPlayer: true,
      planetCount: planets.length,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: 1,
      availableQuestCount: 0,
    }),
  };
}

describe("mapNetOutputToAction — land target resolution", () => {
  it("prefers a habitable planet as the land target", () => {
    const obs = flightObs([
      { id: "rock", name: "Rock", availableQuests: 0, isHabitable: false },
      { id: "eden", name: "Eden", availableQuests: 0, isHabitable: true },
    ]);
    expect(obs.legalActions).toContain("land");
    const action = mapNetOutputToAction(favour("land"), obs);
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("eden");
    expect(action.reason).toBe("neural");
  });

  it("falls back to the first planet when none is flagged habitable", () => {
    const obs = flightObs([
      { id: "a", name: "A", availableQuests: 0 },
      { id: "b", name: "B", availableQuests: 0 },
    ]);
    const action = mapNetOutputToAction(favour("land"), obs);
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("a");
  });

  it("emits no targetId for a non-land kind (applier resolves those)", () => {
    const obs = flightObs([
      { id: "eden", name: "Eden", availableQuests: 0, isHabitable: true },
    ]);
    // warp is legal here (1 connection); its target is applier-resolved.
    const action = mapNetOutputToAction(favour("warp"), obs);
    expect(action.kind).toBe("warp");
    expect(action.targetId).toBeUndefined();
  });

  it("is deterministic — same obs ⇒ same targeted action", () => {
    const obs = flightObs([
      { id: "eden", name: "Eden", availableQuests: 0, isHabitable: true },
    ]);
    expect(mapNetOutputToAction(favour("land"), obs)).toEqual(
      mapNetOutputToAction(favour("land"), obs),
    );
  });

  it("stays legal + reason-tagged even when the argmax kind is illegal", () => {
    // No planets in-system ⇒ land not legal; the net argmaxes land anyway.
    const obs = flightObs([]);
    expect(obs.legalActions).not.toContain("land");
    const action = mapNetOutputToAction(favour("land"), obs);
    expect(obs.legalActions).toContain(action.kind);
    expect(action.reason).toBe("neural");
  });
});
