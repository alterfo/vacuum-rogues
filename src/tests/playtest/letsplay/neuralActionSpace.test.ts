import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import {
  ACTION_ORDER,
  type Observation,
  type PlayerActionKind,
} from "./observe";
import { mapNetOutputToAction } from "./NeuralPolicy";

function scoresFavouring(kind: PlayerActionKind): number[] {
  const idx = ACTION_ORDER.indexOf(kind);
  return ACTION_ORDER.map((_, i) => (i === idx ? 1 : 0));
}

function obs(legalActions: PlayerActionKind[]): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
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

describe("neural action space — 18-slot vocabulary (campaign Task 10)", () => {
  it("ACTION_ORDER is 18 wide and ends with arm-up, liberate", () => {
    expect(ACTION_ORDER).toHaveLength(18);
    expect(ACTION_ORDER[16]).toBe("arm-up");
    expect(ACTION_ORDER[17]).toBe("liberate");
  });

  it("round-trips every slot: a net argmaxing slot i yields ACTION_ORDER[i] when legal", () => {
    for (const kind of ACTION_ORDER) {
      const action = mapNetOutputToAction(scoresFavouring(kind), obs([kind]));
      expect(action.kind).toBe(kind);
      expect(action.reason).toBe("neural");
    }
  });

  it("selects the two NEW slots (arm-up, liberate) end-to-end", () => {
    expect(
      mapNetOutputToAction(scoresFavouring("arm-up"), obs(["arm-up", "wait"]))
        .kind,
    ).toBe("arm-up");
    expect(
      mapNetOutputToAction(
        scoresFavouring("liberate"),
        obs(["liberate", "wait"]),
      ).kind,
    ).toBe("liberate");
  });

  it("legality-masks an illegal new-slot argmax down to the best legal action", () => {
    const action = mapNetOutputToAction(
      scoresFavouring("liberate"),
      obs(["move", "wait"]),
    );
    expect(action.kind).toBe("move");
  });

  it("falls to wait when the net's whole argmax set is illegal", () => {
    expect(
      mapNetOutputToAction(scoresFavouring("arm-up"), obs(["wait"])).kind,
    ).toBe("wait");
  });
});
