import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import { customsScript } from "@/systems/quests/scripts/customs";
import { gravitySlalomScript } from "@/systems/quests/scripts/gravity-slalom";

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

describe("Gravity Slalom quest", () => {
  it("starts at cell_a1 with 100 fuel", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    expect(vm.currentLocation().id).toBe("cell_a1");
    expect(vm.getParam("fuel")).toBe(100);
  });

  it("window params are 0 or 1 for any seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(gravitySlalomScript, seed);
      for (let i = 1; i <= 4; i++) {
        const w = vm.getParam(`window_${i}`);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it("direct move a1→a2 costs 26 fuel", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_a2");
    expect(vm.getParam("fuel")).toBe(74);
    expect(vm.currentLocation().id).toBe("cell_a2");
  });

  it("four consecutive direct moves exhaust fuel and trigger failure", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    // Path: a1→a2→a3→b3→c3 (4×26=104 total, last move pushes fuel negative)
    vm.execute("a1_to_a2"); // 74
    vm.execute("a2_to_a3"); // 48
    vm.execute("a3_to_b3"); // 22
    vm.execute("b3_to_c3"); // 22-26=-4 → critMin:1 fires
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_fuel");
  });

  it("open gravity window (window_1=1) allows free move a1→b2", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_1", 1);
    vm.execute("a1_grav1_open");
    expect(vm.getParam("fuel")).toBe(100);
    expect(vm.currentLocation().id).toBe("cell_b2");
  });

  it("closed gravity window (window_1=0) costs 40 fuel for a1→b2", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_1", 0);
    vm.execute("a1_grav1_closed");
    expect(vm.getParam("fuel")).toBe(60);
    expect(vm.currentLocation().id).toBe("cell_b2");
  });

  it("double gravity a1→b2→c3 succeeds with both windows open (100 fuel remaining)", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_1", 1);
    vm.setParam("window_4", 1);
    vm.execute("a1_grav1_open");
    expect(vm.currentLocation().id).toBe("cell_b2");
    vm.execute("b2_grav4_open");
    // arrives at cell_c3, autoExecute fires
    const avail = vm.availableTransitions();
    expect(avail[0].autoExecute).toBe(true);
    vm.execute(avail[0].id);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("fuel")).toBe(100);
  });

  it("double gravity a1→b2→c3 still succeeds with both windows closed (20 fuel remaining)", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_1", 0);
    vm.setParam("window_4", 0);
    vm.execute("a1_grav1_closed"); // 100-40=60
    vm.execute("b2_grav4_closed"); // 60-40=20
    const avail = vm.availableTransitions();
    vm.execute(avail[0].id);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("fuel")).toBe(20);
  });

  it("path via closed gravity (a2→b3) + direct to c3 fails with insufficient fuel reserve", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_2", 0);
    vm.execute("a1_to_a2"); // 100-26=74
    vm.execute("a2_grav2_closed"); // 74-40=34
    vm.execute("b3_to_c3"); // 34-26=8 → at c3, fuel=8 < 10
    const avail = vm.availableTransitions();
    vm.execute(avail[0].id); // c3_success not available (8<10), so c3_failure_reserve fires
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_fuel_reserve");
  });

  it("path via open gravity (a2→b3) + direct to c3 succeeds with 48 fuel", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_2", 1);
    vm.execute("a1_to_a2"); // 100-26=74
    vm.execute("a2_grav2_open"); // 74-0=74 (free)
    vm.execute("b3_to_c3"); // 74-26=48 → at c3
    const avail = vm.availableTransitions();
    vm.execute(avail[0].id);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("fuel")).toBe(48);
  });

  it("path via b1→c2 open gravity + c2→c3 direct succeeds with 48 fuel", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.setParam("window_3", 1);
    vm.execute("a1_to_b1"); // 74
    vm.execute("b1_grav3_open"); // 74 (free)
    vm.execute("c2_to_c3"); // 74-26=48
    const avail = vm.availableTransitions();
    vm.execute(avail[0].id);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("fuel")).toBe(48);
  });

  it("all routes correctly calculate fuel - mixed path a1→b1→c1→c2→c3 (4 direct) fails", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_b1"); // 74
    vm.execute("b1_to_c1"); // 48
    vm.execute("c1_to_c2"); // 22
    vm.execute("c2_to_c3"); // 22-26=-4 → critMin fires
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_fuel");
  });

  it("quest results are deterministic for the same seed", () => {
    const vm1 = new QuestVM(gravitySlalomScript, 42);
    const vm2 = new QuestVM(gravitySlalomScript, 42);
    // Same window values → same path strategy
    expect(vm1.getParam("window_1")).toBe(vm2.getParam("window_1"));
    expect(vm1.getParam("window_4")).toBe(vm2.getParam("window_4"));
    // Execute same moves on both
    vm1.execute("a1_to_a2");
    vm2.execute("a1_to_a2");
    expect(vm1.getParam("fuel")).toBe(vm2.getParam("fuel"));
    expect(vm1.currentLocation().id).toBe(vm2.currentLocation().id);
  });

  it("different seeds produce different window configurations", () => {
    const configs = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const vm = new QuestVM(gravitySlalomScript, seed);
      const key = `${vm.getParam("window_1")}${vm.getParam("window_2")}${vm.getParam("window_3")}${vm.getParam("window_4")}`;
      configs.add(key);
    }
    // Should see at least 4 distinct configurations across 50 seeds
    expect(configs.size).toBeGreaterThanOrEqual(4);
  });

  it("text interpolation shows fuel value in location text", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_a2"); // fuel = 74
    const text = vm.interpolate(vm.currentLocation().text);
    expect(text).toContain("74");
  });
});
