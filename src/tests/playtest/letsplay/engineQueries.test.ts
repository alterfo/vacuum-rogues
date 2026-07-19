/**
 * Task 9 (`docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md`,
 * live report #11 "autopilot frequently fails/bungles quests"): a `_questProbe`
 * diagnostic run (`QUEST_PROBE=1 QUEST_SEED=QUEST-PROBE-0`) traced a DELIVERY
 * quest (target sys_8, needs 10 ORGANICS, reward 712cr) that expired after 42
 * days without ever completing. The trace showed the ship oscillating ONLY
 * between the departure system (sys_0, 3 neighbours incl. the target) and the
 * target system (sys_8) for the whole quest window, never buying the required
 * cargo and never exploring the other two neighbours where it might be sold.
 *
 * Root cause: `questRoutingPreference` names the quest's target system as the
 * warp-bias destination for ANY active DELIVERY quest, regardless of whether
 * its cargo requirement is met yet. `pickWarpNeighbor` then makes a direct
 * neighbour match to that target "win outright" over generic exploration
 * (`MemoryHeuristicPolicy.ts`'s doc comment above `pickWarpNeighbor`) — so once
 * a quest is taken, every exploratory warp beelines to the target/departure
 * pair even though the cargo hasn't been sourced yet, starving out the
 * exploration that would find a stockist.
 *
 * Fix: `questRoutingPreference` should only name the target once the quest is
 * actually ready to turn in (no unmet COLLECT_ITEM need) — mirroring the
 * `!q.collectItem || carried >= required` gate already used by
 * `deliveryReadyToTurnIn`/the PLANET-tier ladder. With cargo still unmet,
 * routing falls through to the generic explore score (all 4 call sites:
 * `observe.ts`'s `hopsToQuestTarget` stamping, `pickWarpNeighbor`'s own
 * direct-match check via both `PlayerAgent`/`installAutopilotHook`'s appliers,
 * and `MemoryHeuristicPolicy`'s danger-ahead check) so the ship keeps
 * discovering new systems until the `unmetNeed`/`stockSystem` sourcing bias (or
 * plain exploration) finds where the good is actually sold.
 */
import { describe, it, expect } from "vitest";
import { QuestType } from "@/types";
import { questRoutingPreference } from "./engineQueries";

describe("questRoutingPreference (Task 9, live report #11)", () => {
  it("names the target when a DELIVERY quest has no cargo requirement", () => {
    expect(
      questRoutingPreference(
        [{ type: QuestType.DELIVERY, targetSystemId: "sys_8" }],
        "sys_0",
      ),
    ).toBe("sys_8");
  });

  it("names the target once the COLLECT_ITEM requirement is fully met", () => {
    expect(
      questRoutingPreference(
        [
          {
            type: QuestType.DELIVERY,
            targetSystemId: "sys_8",
            collectItem: { carried: 10, required: 10 },
          },
        ],
        "sys_0",
      ),
    ).toBe("sys_8");
  });

  it("does NOT name the target while the COLLECT_ITEM requirement is unmet — the reported bug", () => {
    expect(
      questRoutingPreference(
        [
          {
            type: QuestType.DELIVERY,
            targetSystemId: "sys_8",
            collectItem: { carried: 0, required: 10 },
          },
        ],
        "sys_0",
      ),
    ).toBeNull();
  });

  it("returns null with no active DELIVERY quest, or one already targeting the current system", () => {
    expect(questRoutingPreference([], "sys_0")).toBeNull();
    expect(
      questRoutingPreference(
        [{ type: QuestType.DELIVERY, targetSystemId: "sys_0" }],
        "sys_0",
      ),
    ).toBeNull();
  });
});
