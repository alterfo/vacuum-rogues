/**
 * Three-year-campaign Task 10: the **18-action neural vocabulary** plumbing.
 *
 * The net's output head expanded 16 → 18 (`arm-up` + `liberate` appended to
 * {@link ACTION_ORDER}) so the trained student can express the Overmind-slayer
 * moves the `MemoryHeuristicPolicy` teacher uses. These pins guard the pure
 * mapping seam independent of any trained weights:
 *  - every one of the 18 slots round-trips (a net that argmaxes slot `i` yields
 *    `ACTION_ORDER[i]` when that kind is legal);
 *  - the two NEW slots (`arm-up`, `liberate`) are selectable end-to-end;
 *  - legality masking still filters an illegal argmax down to the best legal
 *    action, `"wait"` as the guaranteed floor.
 *
 * Pure + synthetic (no engine); PixiJS is untouched here.
 */
import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import {
  ACTION_ORDER,
  type Observation,
  type PlayerActionKind,
} from "./observe";
import { mapNetOutputToAction } from "./NeuralPolicy";

/** A one-hot score vector that argmaxes `kind`'s slot (all others 0). */
function scoresFavouring(kind: PlayerActionKind): number[] {
  const idx = ACTION_ORDER.indexOf(kind);
  return ACTION_ORDER.map((_, i) => (i === idx ? 1 : 0));
}

/** Minimal observation carrying only the fields `mapNetOutputToAction` reads. */
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
    // Net wants `liberate`, but only `move`/`wait` are legal ⇒ falls through to
    // the next-highest legal slot. With liberate scored 1 and everything else 0,
    // `move` and `wait` tie at 0; ACTION_ORDER puts `move` first, so it wins.
    const action = mapNetOutputToAction(
      scoresFavouring("liberate"),
      obs(["move", "wait"]),
    );
    expect(action.kind).toBe("move");
  });

  it("falls to wait when the net's whole argmax set is illegal", () => {
    // arm-up scored 1, nothing else; only `wait` legal ⇒ wait floor.
    expect(
      mapNetOutputToAction(scoresFavouring("arm-up"), obs(["wait"])).kind,
    ).toBe("wait");
  });
});
