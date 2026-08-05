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
