import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import { customsScript } from "@/systems/quests/scripts/customs";

// Advance through all autoExecute transitions until a manual decision or finished state
function advanceAuto(vm: QuestVM): void {
  while (!vm.isFinished()) {
    const avail = vm.availableTransitions();
    if (avail.length === 0) break;
    if (!avail[0].autoExecute) break;
    vm.execute(avail[0].id);
  }
}

// Run optimal strategy: scan only when suspicion >= 7 (certain smuggler)
function runOptimalStrategy(vm: QuestVM): void {
  const MAX_STEPS = 500; // guard against infinite loops
  let steps = 0;
  while (!vm.isFinished() && steps < MAX_STEPS) {
    steps++;
    const loc = vm.currentLocation();
    const avail = vm.availableTransitions();
    if (avail.length === 0) break;

    if (avail[0].autoExecute) {
      vm.execute(avail[0].id);
    } else if (loc.id === "inspect_decision") {
      const suspicion = vm.getParam("suspicion");
      vm.execute(suspicion >= 7 ? "scan" : "pass");
    } else {
      vm.execute(avail[0].id);
    }
  }
}

describe("Customs quest", () => {
  it("starts at inspect_decision", () => {
    const vm = new QuestVM(customsScript, 1);
    expect(vm.currentLocation().id).toBe("inspect_decision");
  });

  it("initial money is 0, rating is 100, shipNum is 1", () => {
    const vm = new QuestVM(customsScript, 1);
    expect(vm.getParam("money")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
    expect(vm.getParam("shipNum")).toBe(1);
  });

  it("initial suspicion is in range 0-10", () => {
    const vm = new QuestVM(customsScript, 1);
    const s = vm.getParam("suspicion");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(10);
  });

  it("pass does not cost money and advances to next ship", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.execute("pass");
    // now at next_ship (autoExecute)
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("inspect_decision");
    expect(vm.getParam("money")).toBe(0);
    expect(vm.getParam("shipNum")).toBe(2);
  });

  it("scan deducts 200 credits immediately", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.execute("scan");
    // deduction happens on transition, before arriving at scan_check_high
    expect(vm.getParam("money")).toBe(-200);
  });

  it("high-suspicion ship (>=7) always yields smuggler", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("suspicion", 9);
    vm.execute("scan");
    advanceAuto(vm); // scan_check_high → found_smuggler → (money += 1000) → next_ship
    // net: -200 + 1000 = +800, then advance shipNum
    expect(vm.getParam("money")).toBe(800);
    advanceAuto(vm); // next_ship autoExecute → inspect_decision
    expect(vm.currentLocation().id).toBe("inspect_decision");
    expect(vm.getParam("shipNum")).toBe(2);
  });

  it("low-suspicion ship (<4) always yields clean result (diplomatic incident)", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("suspicion", 2);
    vm.execute("scan");
    advanceAuto(vm); // → found_clean → rating -= 500 → next_ship → inspect_decision
    expect(vm.getParam("money")).toBe(-200); // scan cost, no fine collected
    expect(vm.getParam("rating")).toBe(-400); // 100 - 500
  });

  it("diplomatic incident with rating < 0 triggers quest_failure_rating", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("suspicion", 2);
    vm.execute("scan");
    advanceAuto(vm);
    // rating dropped to -400 < 0 → critical → quest_failure_rating
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_rating");
  });

  it("medium-suspicion ship (4-6) yields smuggler when scan_roll <= 3", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("rating", 1000); // prevent rating critical
    vm.setParam("suspicion", 5);
    vm.execute("scan"); // scan_roll is re-rolled by the scan effect
    vm.setParam("scan_roll", 2); // force roll <= 3 after the scan effect fires
    advanceAuto(vm); // scan_check_high → scan_check_medium → found_smuggler (roll <= 3)
    expect(vm.getParam("money")).toBe(800); // -200 + 1000
  });

  it("medium-suspicion ship (4-6) yields clean when scan_roll > 3", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("suspicion", 5);
    vm.execute("scan"); // scan_roll is re-rolled by the scan effect
    vm.setParam("scan_roll", 7); // force roll > 3 after the scan effect fires
    advanceAuto(vm); // → found_clean → rating -= 500
    expect(vm.getParam("money")).toBe(-200); // only scan cost
    expect(vm.getParam("rating")).toBe(-400); // 100 - 500 diplomatic incident
  });

  it("scan_roll is re-rolled on each scan (not static)", () => {
    const vm1 = new QuestVM(customsScript, "roll-test-a");
    const vm2 = new QuestVM(customsScript, "roll-test-b");
    vm1.execute("scan");
    vm2.execute("scan");
    const roll1 = vm1.getParam("scan_roll");
    const roll2 = vm2.getParam("scan_roll");
    expect(roll1).toBeGreaterThanOrEqual(0);
    expect(roll1).toBeLessThanOrEqual(9);
    expect(roll2).toBeGreaterThanOrEqual(0);
    expect(roll2).toBeLessThanOrEqual(9);
  });

  it("quest ends in failure when money < 5000 after 20 ships", () => {
    const vm = new QuestVM(customsScript, 1);
    // Force all 20 ships to pass (no money earned)
    for (let ship = 1; ship <= 20; ship++) {
      expect(vm.currentLocation().id).toBe("inspect_decision");
      vm.execute("pass");
      advanceAuto(vm); // next_ship → inspect_decision (or check_final on ship 20)
    }
    // After 20 passes, critMax fires → check_final → fail (money = 0 < 5000)
    advanceAuto(vm); // execute check_final autoExecute transition
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_credits");
  });

  it("quest ends in success when money >= 5000 after 20 ships", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("money", 4800);
    vm.setParam("shipNum", 20);
    vm.setParam("suspicion", 9);
    // Scan ship 20 (suspicion 9 = certain smuggler): -200 + 1000 = +800 → total 5600
    vm.execute("scan");
    advanceAuto(vm); // found_smuggler (+1000) → next_ship → check_final (shipNum becomes 21)
    advanceAuto(vm); // check_final autoExecute → quest_success
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("quest_success");
  });

  it("optimal strategy (scan all suspicion>=7) wins with seed 1", () => {
    // Seed 1 generates 8 high-suspicion ships → 8 × 800 = 6400 credits
    const vm = new QuestVM(customsScript, 1);
    runOptimalStrategy(vm);
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("money")).toBeGreaterThanOrEqual(5000);
  });

  it("quest result is deterministic for the same seed", () => {
    const vm1 = new QuestVM(customsScript, 42);
    const vm2 = new QuestVM(customsScript, 42);
    runOptimalStrategy(vm1);
    runOptimalStrategy(vm2);
    expect(vm1.isFinished()).toBe(vm2.isFinished());
    expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    expect(vm1.getParam("money")).toBe(vm2.getParam("money"));
  });

  it("text interpolation shows param values in location text", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("money", 1234);
    vm.setParam("rating", 75);
    vm.setParam("suspicion", 6);
    vm.setParam("shipNum", 3);
    const text = vm.interpolate(vm.currentLocation().text);
    expect(text).toContain("3");
    expect(text).toContain("6");
    expect(text).toContain("1234");
    expect(text).toContain("75");
  });
});
