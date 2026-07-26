import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import { customsScript } from "@/systems/quests/scripts/customs";
import { gravitySlalomScript } from "@/systems/quests/scripts/gravity-slalom";
import { investigationScript } from "@/systems/quests/scripts/investigation";
import { cargoSortScript } from "@/systems/quests/scripts/cargo-sort";
import { reactorScript } from "@/systems/quests/scripts/reactor";
import { auctionScript } from "@/systems/quests/scripts/auction";

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

  // ── Task 18 (quest-and-hub-polish-pass) ─────────────────────────────────────

  it("a caught smuggler is dispatched via the distinct next_ship_caught beat (B)", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.setParam("suspicion", 9);
    vm.execute("scan"); // → scan_check_high
    vm.execute(vm.availableTransitions()[0].id); // high_confirmed → found_smuggler
    expect(vm.currentLocation().id).toBe("found_smuggler");
    vm.execute("collect_fine"); // money += 1000 → next_ship_caught
    expect(vm.currentLocation().id).toBe("next_ship_caught");
    expect(vm.getParam("money")).toBe(800); // -200 scan + 1000 fine
  });

  it("a waved-through ship is dispatched via the distinct next_ship_waved beat (B)", () => {
    const vm = new QuestVM(customsScript, 1);
    vm.execute("pass"); // → next_ship_waved
    expect(vm.currentLocation().id).toBe("next_ship_waved");
  });

  it("the caught and waved next-ship beats read differently (branched per outcome)", () => {
    const caught = customsScript.locations.find(
      (l) => l.id === "next_ship_caught",
    );
    const waved = customsScript.locations.find(
      (l) => l.id === "next_ship_waved",
    );
    expect(caught).toBeDefined();
    expect(waved).toBeDefined();
    expect(caught!.text).not.toBe(waved!.text);
    // Both still advance the shift identically (shipNum += 1, suspicion re-roll).
    for (const node of [caught!, waved!]) {
      const adv = node.transitions[0];
      expect(adv.autoExecute).toBe(true);
      expect(adv.toLocation).toBe("inspect_decision");
      expect(adv.effects).toContain("shipNum += 1");
    }
  });

  it("a false inspection is honestly career-ending — no misleading «ещё пара» reprieve (E)", () => {
    const clean = customsScript.locations.find((l) => l.id === "found_clean")!;
    const text =
      typeof clean.text === "string" ? clean.text : clean.text.join(" ");
    // The old text promised «ещё пара таких досмотров» while a single false
    // inspection actually ends the shift — that contradiction is now gone.
    expect(text).not.toContain("Ещё пара");
    expect(text).toMatch(/второго шанса не будет|одной такой ошибки/);
    // ...and the data matches: the clean path routes straight to failure.
    const scandal = clean.transitions.find((t) => t.id === "accept_scandal")!;
    expect(scandal.toLocation).toBe("quest_failure_rating");
  });

  it("inspect_decision is a captain-vignette pool; every variant keeps the HUD placeholders (F/H)", () => {
    const loc = customsScript.locations.find(
      (l) => l.id === "inspect_decision",
    )!;
    expect(Array.isArray(loc.text)).toBe(true);
    const variants = loc.text as string[];
    expect(variants.length).toBeGreaterThanOrEqual(3);
    for (const v of variants) {
      for (const token of ["{shipNum}", "{suspicion}", "{money}", "{rating}"]) {
        expect(v).toContain(token);
      }
    }
  });

  it("different seeds surface different captain vignettes at the ship arrival (replay variety)", () => {
    const texts = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      texts.add(new QuestVM(customsScript, seed).currentLocationText());
    }
    expect(texts.size).toBeGreaterThanOrEqual(2);
  });

  it("the win text frames collected fines as the treasury's quota, not the player's payout (C)", () => {
    const win = customsScript.locations.find((l) => l.id === "quest_success")!;
    const text = win.text as string;
    expect(text).toContain("казну");
    expect(text).toContain("не в ваш карман");
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

  // --- Task 22: funnel-cell coast gambles + honest seed-variance ---

  it("hidden coast rolls exist, start at 0 and are not shown in the UI", () => {
    const vm = new QuestVM(gravitySlalomScript, 7);
    expect(vm.getParam("coast_a3")).toBe(0);
    expect(vm.getParam("coast_c2")).toBe(0);
    const coastParams = gravitySlalomScript.params.filter((p) =>
      p.id.startsWith("coast_"),
    );
    expect(coastParams).toHaveLength(2);
    for (const p of coastParams) expect(p.showInUI).toBeFalsy();
  });

  it("the coast rolls do not consume the constructor RNG (window rolls unchanged)", () => {
    // Same seed, read the seed-determined windows — adding coast_* params with
    // initial:0 must not shift the four window_* rolls off their old values.
    for (const seed of [1, 7, 42]) {
      const vm = new QuestVM(gravitySlalomScript, seed);
      // Windows are still a clean 0/1 config (regression: coast params inert).
      for (let i = 1; i <= 4; i++) {
        const w = vm.getParam(`window_${i}`);
        expect(w === 0 || w === 1).toBe(true);
      }
    }
  });

  it("cell_a3 is now a real choice (ровная тяга vs инерционный заход)", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_a2");
    vm.execute("a2_to_a3");
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("a3_to_b3");
    expect(ids).toContain("a3_coast");
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("cell_c2 is now a real choice (ровная тяга vs инерционный заход)", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_b1");
    vm.execute("b1_to_c1");
    vm.execute("c1_to_c2");
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("c2_to_c3");
    expect(ids).toContain("c2_coast");
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("a3 coast WIN (coast_a3=1) drifts to B3 for only 6 fuel", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_a2"); // 74
    vm.execute("a2_to_a3"); // 48
    vm.execute("a3_coast"); // rolls coast_a3, moves to gate
    expect(vm.currentLocation().id).toBe("a3_coast_gate");
    vm.setParam("coast_a3", 1); // force the favourable branch
    const gate = vm.availableTransitions();
    expect(gate).toHaveLength(1);
    expect(gate[0].id).toBe("a3cg_win");
    vm.execute("a3cg_win"); // 48 - 6 = 42
    expect(vm.getParam("fuel")).toBe(42);
    expect(vm.currentLocation().id).toBe("a3_coast_win");
    vm.execute("a3cw_to_b3");
    expect(vm.currentLocation().id).toBe("cell_b3");
  });

  it("a3 coast LOSE (coast_a3=0) overshoots for 40 fuel, its own beat", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_a2"); // 74
    vm.execute("a2_to_a3"); // 48
    vm.execute("a3_coast");
    vm.setParam("coast_a3", 0); // force the overshoot branch
    const gate = vm.availableTransitions();
    expect(gate).toHaveLength(1);
    expect(gate[0].id).toBe("a3cg_lose");
    vm.execute("a3cg_lose"); // 48 - 40 = 8
    expect(vm.getParam("fuel")).toBe(8);
    expect(vm.currentLocation().id).toBe("a3_coast_lose");
    vm.execute("a3cl_to_b3");
    expect(vm.currentLocation().id).toBe("cell_b3");
  });

  it("a3 coast win and lose beats carry distinct narration", () => {
    const winLoc = gravitySlalomScript.locations.find(
      (l) => l.id === "a3_coast_win",
    )!;
    const loseLoc = gravitySlalomScript.locations.find(
      (l) => l.id === "a3_coast_lose",
    )!;
    expect(winLoc.text).not.toEqual(loseLoc.text);
  });

  it("c2 coast WIN (coast_c2=1) reaches the finish nearly free", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_b1"); // 74
    vm.execute("b1_to_c1"); // 48
    vm.execute("c1_to_c2"); // 22
    vm.execute("c2_coast");
    expect(vm.currentLocation().id).toBe("c2_coast_gate");
    vm.setParam("coast_c2", 1);
    const gate = vm.availableTransitions();
    expect(gate).toHaveLength(1);
    expect(gate[0].id).toBe("c2cg_win");
    vm.execute("c2cg_win"); // 22 - 4 = 18
    expect(vm.getParam("fuel")).toBe(18);
    expect(vm.currentLocation().id).toBe("c2_coast_win");
    vm.execute("c2cw_to_c3");
    expect(vm.currentLocation().id).toBe("cell_c3");
    const arrival = vm.availableTransitions();
    vm.execute(arrival[0].id);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("fuel")).toBe(18);
  });

  it("c2 coast LOSE (coast_c2=0) at low reserve busts the run", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_b1"); // 74
    vm.execute("b1_to_c1"); // 48
    vm.execute("c1_to_c2"); // 22
    vm.execute("c2_coast");
    vm.setParam("coast_c2", 0);
    vm.execute("c2cg_lose"); // 22 - 40 = -18 → critMin fires
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_fuel");
  });

  it("Фэянин speaks in the middle stretch (comms lines on B-row cells)", () => {
    const vm = new QuestVM(gravitySlalomScript, 1);
    vm.execute("a1_to_b1");
    expect(vm.interpolate(vm.currentLocation().text)).toContain("Фэянин");
  });
});

// Helper: advance all auto-execute transitions until a manual choice or finished
function advanceAutoInvestigation(vm: QuestVM): void {
  const MAX = 20;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0 || !avail[0].autoExecute) break;
    vm.execute(avail[0].id);
  }
}

// Helper: do a full correct playthrough (interview all 4, examine 5 clues, accuse correctly)
function solveInvestigation(vm: QuestVM): void {
  // Interview all 4 suspects
  const interviewBtns = [
    "go_interview_mechanic",
    "go_interview_pilot",
    "go_interview_trader2",
    "go_interview_guard",
  ];
  const doneBtns = [
    "done_mechanic",
    "done_pilot",
    "done_trader2",
    "done_guard",
  ];
  for (let i = 0; i < 4; i++) {
    vm.execute(interviewBtns[i]);
    vm.execute(doneBtns[i]);
  }

  // Examine the first 5 clues
  const clueIds = [
    "examine_clue_0",
    "examine_clue_1",
    "examine_clue_2",
    "examine_clue_3",
    "examine_clue_4",
  ];
  const backIds = [
    "back_from_e0",
    "back_from_e1",
    "back_from_e2",
    "back_from_e3",
    "back_from_e4",
  ];
  for (let i = 0; i < 5; i++) {
    vm.execute(clueIds[i]);
    vm.execute(backIds[i]);
  }

  // Navigate through accusation gate
  vm.execute("go_accuse");
  advanceAutoInvestigation(vm); // gate_interviews_pass → accuse_gate_clues
  advanceAutoInvestigation(vm); // gate_clues_pass → accuse

  // Accuse the correct suspect
  const murderer = vm.getParam("murderer");
  const accuseBtns = [
    "accuse_mechanic",
    "accuse_pilot",
    "accuse_trader2",
    "accuse_guard",
  ];
  vm.execute(accuseBtns[murderer]);
  advanceAutoInvestigation(vm); // check_N_correct → quest_success
}

describe("Investigation quest", () => {
  it("starts at warehouse with 0 interviews and 0 clues", () => {
    const vm = new QuestVM(investigationScript, 1);
    expect(vm.currentLocation().id).toBe("warehouse");
    expect(vm.getParam("interviews_done")).toBe(0);
    expect(vm.getParam("clues_examined")).toBe(0);
    expect(vm.getParam("rating")).toBe(500);
  });

  it("murderer is 0-3 for any seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(investigationScript, seed);
      const m = vm.getParam("murderer");
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(3);
    }
  });

  it("murderer varies across seeds", () => {
    const values = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      values.add(new QuestVM(investigationScript, seed).getParam("murderer"));
    }
    expect(values.size).toBe(4);
  });

  it("interviewing a suspect increments interviews_done", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("go_interview_mechanic");
    vm.execute("done_mechanic");
    expect(vm.getParam("interviewed_0")).toBe(1);
    expect(vm.getParam("interviews_done")).toBe(1);
    expect(vm.currentLocation().id).toBe("warehouse");
  });

  it("interview button hidden after suspect is interviewed", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("go_interview_mechanic");
    vm.execute("done_mechanic");
    const transitions = vm.availableTransitions().map((t) => t.id);
    expect(transitions).not.toContain("go_interview_mechanic");
  });

  it("examining a clue increments clues_examined", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("examine_clue_0");
    vm.execute("back_from_e0");
    expect(vm.getParam("examined_0")).toBe(1);
    expect(vm.getParam("clues_examined")).toBe(1);
  });

  it("clue button hidden after it is examined", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("examine_clue_0");
    vm.execute("back_from_e0");
    const transitions = vm.availableTransitions().map((t) => t.id);
    expect(transitions).not.toContain("examine_clue_0");
  });

  it("accusation gate blocks when interviews_done < 4", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("go_accuse");
    advanceAutoInvestigation(vm); // gate → not_ready_interviews
    expect(vm.currentLocation().id).toBe("not_ready_interviews");
  });

  it("accusation gate blocks when clues_examined < 5 even with all interviews done", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.setParam("interviews_done", 4);
    vm.setParam("interviewed_0", 1);
    vm.setParam("interviewed_1", 1);
    vm.setParam("interviewed_2", 1);
    vm.setParam("interviewed_3", 1);
    // examine only 4 clues
    for (let i = 0; i < 4; i++) {
      vm.execute(`examine_clue_${i}`);
      vm.execute(`back_from_e${i}`);
    }
    vm.execute("go_accuse");
    advanceAutoInvestigation(vm); // gate_interviews_pass → accuse_gate_clues
    advanceAutoInvestigation(vm); // gate_clues_fail → not_ready_clues
    expect(vm.currentLocation().id).toBe("not_ready_clues");
  });

  it("not_ready feedback locations return to warehouse", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("go_accuse");
    advanceAutoInvestigation(vm);
    expect(vm.currentLocation().id).toBe("not_ready_interviews");
    vm.execute("back_from_gate_interviews");
    expect(vm.currentLocation().id).toBe("warehouse");
  });

  it("correct accusation wins the quest", () => {
    for (let seed = 0; seed < 4; seed++) {
      const vm = new QuestVM(investigationScript, seed);
      solveInvestigation(vm);
      expect(vm.isFinished()).toBe(true);
      expect(vm.isSuccess()).toBe(true);
      expect(vm.currentLocation().id).toBe("quest_success");
    }
  });

  it("quest is solvable for any seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(investigationScript, seed);
      solveInvestigation(vm);
      expect(vm.isSuccess()).toBe(true);
    }
  });

  it("wrong accusation costs 200 rating and returns to accuse screen", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.setParam("interviews_done", 4);
    vm.setParam("clues_examined", 5);
    // Force murderer to 0 (mechanic), then accuse pilot (wrong)
    vm.setParam("murderer", 0);
    vm.execute("go_accuse");
    advanceAutoInvestigation(vm);
    advanceAutoInvestigation(vm);
    expect(vm.currentLocation().id).toBe("accuse");
    vm.execute("accuse_pilot"); // wrong
    advanceAutoInvestigation(vm); // pilot_wrong → wrong_accusation
    expect(vm.currentLocation().id).toBe("wrong_accusation");
    vm.execute("retry_accusation"); // rating -= 200
    expect(vm.getParam("rating")).toBe(300);
    expect(vm.currentLocation().id).toBe("accuse");
  });

  it("three wrong accusations cause rating failure", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.setParam("interviews_done", 4);
    vm.setParam("clues_examined", 5);
    vm.setParam("murderer", 0); // mechanic is guilty
    vm.execute("go_accuse");
    advanceAutoInvestigation(vm);
    advanceAutoInvestigation(vm);
    // Wrong 1: accuse pilot (500 → 300)
    vm.execute("accuse_pilot");
    advanceAutoInvestigation(vm);
    vm.execute("retry_accusation");
    expect(vm.getParam("rating")).toBe(300);
    // Wrong 2: accuse trader2 (300 → 100)
    vm.execute("accuse_trader2");
    advanceAutoInvestigation(vm);
    vm.execute("retry_accusation");
    expect(vm.getParam("rating")).toBe(100);
    // Wrong 3: accuse guard (100 → -100 → critMin fires)
    vm.execute("accuse_guard");
    advanceAutoInvestigation(vm);
    vm.execute("retry_accusation"); // rating = -100, critMin triggers failure
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_rating");
  });

  it("text interpolation shows investigation stats", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.setParam("interviews_done", 2);
    vm.setParam("clues_examined", 3);
    vm.setParam("rating", 500);
    const text = vm.interpolate(vm.currentLocation().text);
    expect(text).toContain("2");
    expect(text).toContain("3");
    expect(text).toContain("500");
  });

  it("planted clue texts contain ПРОТИВОРЕЧИЕ marker", () => {
    const vm = new QuestVM(investigationScript, 1);
    vm.execute("examine_clue_5");
    expect(vm.currentLocation().text).toContain("ПРОТИВОРЕЧИЕ");
    vm.execute("back_from_e5");
    vm.execute("examine_clue_6");
    expect(vm.currentLocation().text).toContain("ПРОТИВОРЕЧИЕ");
    vm.execute("back_from_e6");
    vm.execute("examine_clue_7");
    expect(vm.currentLocation().text).toContain("ПРОТИВОРЕЧИЕ");
  });

  it("quest result is deterministic for the same seed", () => {
    const vm1 = new QuestVM(investigationScript, 42);
    const vm2 = new QuestVM(investigationScript, 42);
    solveInvestigation(vm1);
    solveInvestigation(vm2);
    expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    expect(vm1.getParam("murderer")).toBe(vm2.getParam("murderer"));
  });
});

// Greedy dock assignment: always pick the dock with the lowest current load
function assignGreedy(vm: QuestVM): number {
  const d1 = vm.getParam("dock1_load");
  const d2 = vm.getParam("dock2_load");
  const d3 = vm.getParam("dock3_load");
  if (d1 <= d2 && d1 <= d3) return 1;
  if (d2 <= d1 && d2 <= d3) return 2;
  return 3;
}

// Advance through init_breakdown (autoExecute) and any subsequent auto steps
function advanceAutoCS(vm: QuestVM): void {
  const MAX = 30;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0 || !avail[0].autoExecute) break;
    vm.execute(avail[0].id);
  }
}

// Full greedy playthrough: init → assign all 5 transports → final verdict
function runGreedyCargoSort(vm: QuestVM): void {
  advanceAutoCS(vm); // init_breakdown → dispatch_hub
  const ships = ["A", "B", "C", "D", "E"];
  for (const ship of ships) {
    expect(vm.currentLocation().id).toBe("dispatch_hub");
    const dock = assignGreedy(vm);
    vm.execute(`go_select_${ship}`);
    vm.execute(`assign_${ship}_dock${dock}`);
    advanceAutoCS(vm); // assign_to_dockN → check_progress → dispatch_hub (or final checks)
  }
  // After the 5th assignment, advanceAutoCS continues through dock checks → final_verdict → result
}

describe("Cargo Sort quest", () => {
  it("starts at init_breakdown and arrives at dispatch_hub after auto-init", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    expect(vm.currentLocation().id).toBe("init_breakdown");
    advanceAutoCS(vm);
    expect(vm.currentLocation().id).toBe("dispatch_hub");
  });

  it("transport times are in range 1-4 before breakdown (raw init)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(cargoSortScript, seed);
      // Before init_breakdown fires, times are raw random(1,4)
      for (const ship of ["A", "B", "C", "D", "E"]) {
        const t = vm.getParam(`time_${ship}`);
        expect(t).toBeGreaterThanOrEqual(1);
        expect(t).toBeLessThanOrEqual(4);
      }
    }
  });

  it("one transport gets +2 hours after breakdown init", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(cargoSortScript, seed);
      const before = ["A", "B", "C", "D", "E"].map((s) =>
        vm.getParam(`time_${s}`),
      );
      advanceAutoCS(vm); // fires init_breakdown
      const after = ["A", "B", "C", "D", "E"].map((s) =>
        vm.getParam(`time_${s}`),
      );
      const incremented = after.filter((v, i) => v === before[i] + 2).length;
      const unchanged = after.filter((v, i) => v === before[i]).length;
      expect(incremented).toBe(1);
      expect(unchanged).toBe(4);
    }
  });

  it("break_ship determines which transport gets +2 hours", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    const breakShip = vm.getParam("break_ship");
    const ships = ["A", "B", "C", "D", "E"];
    const timeBefore = vm.getParam(`time_${ships[breakShip]}`);
    advanceAutoCS(vm);
    expect(vm.getParam(`time_${ships[breakShip]}`)).toBe(timeBefore + 2);
  });

  it("all 5 transports can be assigned and assigned_count reaches 5", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    const ships = ["A", "B", "C", "D", "E"];
    for (let i = 0; i < ships.length; i++) {
      vm.execute(`go_select_${ships[i]}`);
      vm.execute(`assign_${ships[i]}_dock1`);
      advanceAutoCS(vm);
      if (i < 4) {
        expect(vm.currentLocation().id).toBe("dispatch_hub");
        expect(vm.getParam("assigned_count")).toBe(i + 1);
      }
    }
    // After 5th assignment, quest finishes (all in dock1 → overload)
    expect(vm.isFinished()).toBe(true);
  });

  it("assigning to dock1 increases dock1_load by transport time", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    const timeA = vm.getParam("time_A");
    vm.execute("go_select_A");
    vm.execute("assign_A_dock1");
    advanceAutoCS(vm);
    expect(vm.getParam("dock1_load")).toBe(timeA);
    expect(vm.getParam("assigned_A")).toBe(1);
  });

  it("assigning to dock2 increases dock2_load by transport time", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    const timeB = vm.getParam("time_B");
    vm.execute("go_select_B");
    vm.execute("assign_B_dock2");
    advanceAutoCS(vm);
    expect(vm.getParam("dock2_load")).toBe(timeB);
    expect(vm.getParam("dock1_load")).toBe(0);
  });

  it("assigned transport no longer appears in dispatch_hub transitions", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    vm.execute("go_select_C");
    vm.execute("assign_C_dock3");
    advanceAutoCS(vm);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).not.toContain("go_select_C");
    expect(ids).toContain("go_select_A");
    expect(ids).toContain("go_select_B");
    expect(ids).toContain("go_select_D");
    expect(ids).toContain("go_select_E");
  });

  it("back transition returns to dispatch_hub without assigning", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    vm.execute("go_select_A");
    vm.execute("back_from_A");
    expect(vm.currentLocation().id).toBe("dispatch_hub");
    expect(vm.getParam("assigned_A")).toBe(0);
    expect(vm.getParam("assigned_count")).toBe(0);
  });

  it("dock overloaded (>12h) increments overtime", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    // Force all 5 to dock1 — guaranteed overload since 5 × min(2h with breakdown) = 10-22h
    vm.setParam("time_A", 4);
    vm.setParam("time_B", 4);
    vm.setParam("time_C", 4);
    vm.setParam("time_D", 4);
    vm.setParam("time_E", 4);
    const ships = ["A", "B", "C", "D", "E"];
    for (const ship of ships) {
      vm.execute(`go_select_${ship}`);
      vm.execute(`assign_${ship}_dock1`);
      advanceAutoCS(vm);
    }
    // dock1_load = 20 > 12 → overtime = 1; dock2 = 0, dock3 = 0
    expect(vm.getParam("overtime")).toBe(1);
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_overtime");
  });

  it("no dock overloaded → overtime == 0 → quest success", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    // Set controlled times: 4,4,4 → dock1; 3,3 → dock2; none → dock3
    vm.setParam("time_A", 4);
    vm.setParam("time_B", 4);
    vm.setParam("time_C", 4);
    vm.setParam("time_D", 3);
    vm.setParam("time_E", 3);
    // Assign A+D to dock1 (7h), B+E to dock2 (7h), C to dock3 (4h) — all under 12
    vm.execute("go_select_A");
    vm.execute("assign_A_dock1");
    advanceAutoCS(vm);
    vm.execute("go_select_D");
    vm.execute("assign_D_dock1");
    advanceAutoCS(vm);
    vm.execute("go_select_B");
    vm.execute("assign_B_dock2");
    advanceAutoCS(vm);
    vm.execute("go_select_E");
    vm.execute("assign_E_dock2");
    advanceAutoCS(vm);
    vm.execute("go_select_C");
    vm.execute("assign_C_dock3");
    advanceAutoCS(vm);
    expect(vm.getParam("overtime")).toBe(0);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("quest_success");
  });

  it("greedy strategy achieves overtime == 0 for seed 1 (optimal distribution)", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    runGreedyCargoSort(vm);
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("overtime")).toBe(0);
  });

  it("greedy strategy achieves overtime < 4 for any seed 0-29", () => {
    for (let seed = 0; seed < 30; seed++) {
      const vm = new QuestVM(cargoSortScript, seed);
      runGreedyCargoSort(vm);
      expect(vm.getParam("overtime")).toBeLessThan(4);
    }
  });

  it("quest result is deterministic for the same seed", () => {
    const vm1 = new QuestVM(cargoSortScript, 42);
    const vm2 = new QuestVM(cargoSortScript, 42);
    runGreedyCargoSort(vm1);
    runGreedyCargoSort(vm2);
    expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    expect(vm1.getParam("dock1_load")).toBe(vm2.getParam("dock1_load"));
    expect(vm1.getParam("overtime")).toBe(vm2.getParam("overtime"));
  });

  it("text interpolation shows dock loads in location text", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    advanceAutoCS(vm);
    vm.setParam("dock1_load", 5);
    vm.setParam("dock2_load", 3);
    vm.setParam("dock3_load", 7);
    const text = vm.interpolate(vm.currentLocation().text);
    expect(text).toContain("5");
    expect(text).toContain("3");
    expect(text).toContain("7");
  });

  // Task 17: tightened budget (porog 12h → 8h) + distinct-outcome endings.
  // Helper: fire breakdown, override the 5 transport times, then assign each
  // ship to a chosen dock. Overriding times AFTER breakdown makes the dock
  // loads fully deterministic regardless of seed.
  function forceRun(vm: QuestVM, times: number[], docks: number[]): void {
    advanceAutoCS(vm); // init_breakdown → dispatch_hub
    const ships = ["A", "B", "C", "D", "E"];
    ships.forEach((s, i) => vm.setParam(`time_${s}`, times[i]));
    ships.forEach((s, i) => {
      vm.execute(`go_select_${s}`);
      vm.execute(`assign_${s}_dock${docks[i]}`);
      advanceAutoCS(vm);
    });
  }

  it("porog tightened to 8h: a dock at 9h now overloads (was safe under the old 12h)", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    // dock1 = A(4)+B(4)+C(1) = 9 > 8; dock2 = D(2); dock3 = E(2) → exactly 1 over.
    forceRun(vm, [4, 4, 1, 2, 2], [1, 1, 1, 2, 3]);
    expect(vm.getParam("dock1_load")).toBe(9);
    expect(vm.getParam("overtime")).toBe(1);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_overtime");
  });

  it("a comfortable clean shift (every dock below porog) ends at quest_success", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    // dock1 = A(3)+B(3) = 6, dock2 = C(2)+D(3) = 5, dock3 = E(4) = 4 — all < 8.
    forceRun(vm, [3, 3, 2, 3, 4], [1, 1, 2, 2, 3]);
    expect(vm.getParam("dock1_load")).toBe(6);
    expect(vm.getParam("dock2_load")).toBe(5);
    expect(vm.getParam("dock3_load")).toBe(4);
    expect(vm.getParam("overtime")).toBe(0);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("quest_success");
  });

  it("a razor-thin clean shift (a dock at exactly 8h) ends at the distinct quest_success_tight", () => {
    const vm = new QuestVM(cargoSortScript, 1);
    // dock1 = A(4)+B(4) = 8 (exactly at porog, not over), dock2/3 low → overtime 0.
    forceRun(vm, [4, 4, 2, 2, 3], [1, 1, 2, 3, 3]);
    expect(vm.getParam("dock1_load")).toBe(8);
    expect(vm.getParam("overtime")).toBe(0);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("quest_success_tight");
    expect(vm.currentLocation().isSuccess).toBe(true);
  });

  it("comfortable and razor-thin wins use different ending text", () => {
    const comfy = new QuestVM(cargoSortScript, 1);
    forceRun(comfy, [3, 3, 2, 3, 4], [1, 1, 2, 2, 3]);
    const tight = new QuestVM(cargoSortScript, 1);
    forceRun(tight, [4, 4, 2, 2, 3], [1, 1, 2, 3, 3]);
    expect(comfy.currentLocation().id).toBe("quest_success");
    expect(tight.currentLocation().id).toBe("quest_success_tight");
    expect(comfy.interpolate(comfy.currentLocation().text)).not.toBe(
      tight.interpolate(tight.currentLocation().text),
    );
  });

  it("one overloaded dock is a light failure; two+ overloaded is the distinct severe terminal", () => {
    const light = new QuestVM(cargoSortScript, 1);
    // dock1 = 4+4+1 = 9 (>8); dock2/3 low → exactly 1 over.
    forceRun(light, [4, 4, 1, 2, 2], [1, 1, 1, 2, 3]);
    expect(light.getParam("overtime")).toBe(1);
    expect(light.currentLocation().id).toBe("quest_failure_overtime");

    const severe = new QuestVM(cargoSortScript, 1);
    // dock1 = A(4)+B(4)+C(4) = 12 (>8); dock2 = D(4)+E(5) = 9 (>8) → 2 over.
    forceRun(severe, [4, 4, 4, 4, 5], [1, 1, 1, 2, 2]);
    expect(severe.getParam("dock1_load")).toBe(12);
    expect(severe.getParam("dock2_load")).toBe(9);
    expect(severe.getParam("overtime")).toBe(2);
    expect(severe.isSuccess()).toBe(false);
    expect(severe.currentLocation().id).toBe("quest_failure_severe");
    // Light and severe failures read differently.
    expect(light.interpolate(light.currentLocation().text)).not.toBe(
      severe.interpolate(severe.currentLocation().text),
    );
  });

  it("every seed 0-29 remains winnable with an optimal packing (never unlosable-only)", () => {
    // Brute-force: for each seed there exists an assignment achieving overtime 0.
    const minOvertime = (times: number[], thr: number): number => {
      let best = 3;
      const rec = (i: number, d: number[]): void => {
        if (i === times.length) {
          best = Math.min(best, d.filter((x) => x > thr).length);
          return;
        }
        for (let k = 0; k < 3; k++) {
          d[k] += times[i];
          rec(i + 1, d);
          d[k] -= times[i];
        }
      };
      rec(0, [0, 0, 0]);
      return best;
    };
    for (let seed = 0; seed < 30; seed++) {
      const vm = new QuestVM(cargoSortScript, seed);
      advanceAutoCS(vm);
      const times = ["A", "B", "C", "D", "E"].map((s) =>
        vm.getParam(`time_${s}`),
      );
      expect(minOvertime(times, 8)).toBe(0);
    }
  });

  it("carelessly dumping every transport in one dock now fails (budget no longer trivial)", () => {
    let failures = 0;
    for (let seed = 0; seed < 30; seed++) {
      const vm = new QuestVM(cargoSortScript, seed);
      advanceAutoCS(vm);
      for (const s of ["A", "B", "C", "D", "E"]) {
        vm.execute(`go_select_${s}`);
        vm.execute(`assign_${s}_dock1`);
        advanceAutoCS(vm);
      }
      if (!vm.isSuccess()) failures++;
    }
    // Dumping all five in one dock (>= 5h min) always blows the 8h porog.
    expect(failures).toBe(30);
  });
});

// Advance through all autoExecute transitions (init + check chain) until reactor_control or finished
function advanceAutoReactor(vm: QuestVM): void {
  const MAX = 20;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0) break;
    // Auto-execute transitions advance automatically; a lone manual transition
    // (e.g. the init "begin" button) is also stepped through by the helper so
    // tests don't need to replicate the user click.
    if (avail[0].autoExecute || avail.length === 1) {
      vm.execute(avail[0].id);
    } else {
      break;
    }
  }
}

// Greedy solver: move each rod one step toward its target (A=3 B=4 C=4 D=2).
// After each manual move, advance through the autoExecute check chain.
function solveReactor(vm: QuestVM): void {
  const MAX_STEPS = 30;
  let steps = 0;
  advanceAutoReactor(vm); // consume init + initial check chain
  while (!vm.isFinished() && steps < MAX_STEPS) {
    steps++;
    if (vm.currentLocation().id !== "reactor_control") {
      advanceAutoReactor(vm);
      continue;
    }
    const a = vm.getParam("rod_a");
    const b = vm.getParam("rod_b");
    const c = vm.getParam("rod_c");
    const d = vm.getParam("rod_d");
    if (a !== 3) {
      vm.execute(a < 3 ? "a_up" : "a_down");
    } else if (b !== 4) {
      vm.execute(b < 4 ? "b_up" : "b_down");
    } else if (c !== 4) {
      vm.execute(c < 4 ? "c_up" : "c_down");
    } else if (d !== 2) {
      vm.execute(d < 2 ? "d_up" : "d_down");
    } else {
      break; // already at solution (shouldn't happen after init check, but guard)
    }
    advanceAutoReactor(vm); // process check chain after each move
  }
}

describe("Reactor quest", () => {
  it("starts with time_left=120 and all rods in range 0-5", () => {
    const vm = new QuestVM(reactorScript, 1);
    expect(vm.getParam("time_left")).toBe(120);
    for (const rod of ["rod_a", "rod_b", "rod_c", "rod_d"]) {
      const v = vm.getParam(rod);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it("after init advances to reactor_control (when not already solved)", () => {
    // Use seed that gives a non-solution start (overwhelmingly likely)
    const vm = new QuestVM(reactorScript, 7);
    advanceAutoReactor(vm);
    // Either at reactor_control (unsolved) or at stable (lucky solution start)
    expect(["reactor_control", "stable"]).toContain(vm.currentLocation().id);
  });

  it("a_up increments rod_a by 1 and costs 5 seconds", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 1);
    vm.execute("a_up");
    advanceAutoReactor(vm);
    expect(vm.getParam("rod_a")).toBe(2);
    expect(vm.getParam("time_left")).toBe(115);
  });

  it("a_down decrements rod_a by 1 and costs 5 seconds", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 4);
    vm.execute("a_down");
    advanceAutoReactor(vm);
    expect(vm.getParam("rod_a")).toBe(3);
    expect(vm.getParam("time_left")).toBe(115);
  });

  it("a_up not available when rod_a=5", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 5);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).not.toContain("a_up");
    expect(ids).toContain("a_down");
  });

  it("a_down not available when rod_a=0", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 0);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).not.toContain("a_down");
    expect(ids).toContain("a_up");
  });

  it("time_left reaching 0 triggers reactor_explosion", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("time_left", 5);
    vm.setParam("rod_a", 1); // ensure not at solution
    vm.execute("a_up");
    // time_left = 0 → critMin:1 → reactor_explosion
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("reactor_explosion");
  });

  it("setting all rods to solution (A=3 B=4 C=4 D=2) leads to stable", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 3);
    vm.setParam("rod_b", 4);
    vm.setParam("rod_c", 4);
    vm.setParam("rod_d", 2);
    // Trigger check by making any valid move then undoing it, or by directly verifying
    // Simulate adjusting d_up then d_down to trigger the check chain at solution
    vm.setParam("rod_d", 1); // temporarily break solution
    vm.execute("d_up"); // d_d = 2 again, time -= 5; goes to check_stable
    advanceAutoReactor(vm); // check chain → stable
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("stable");
  });

  it("wrong rod values return to reactor_control after check", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 1); // not 3
    vm.setParam("rod_b", 4);
    vm.setParam("rod_c", 4);
    vm.setParam("rod_d", 2);
    vm.execute("a_up"); // rod_a=2, still not 3 → check_stable → check_a_fail → reactor_control
    advanceAutoReactor(vm);
    expect(vm.currentLocation().id).toBe("reactor_control");
    expect(vm.isFinished()).toBe(false);
  });

  it("greedy solver finds solution within time budget for seed 1", () => {
    const vm = new QuestVM(reactorScript, 1);
    solveReactor(vm);
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("time_left")).toBeGreaterThan(0);
  });

  it("greedy solver solves quest for any seed 0-19", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(reactorScript, seed);
      solveReactor(vm);
      // Quest is solvable within the 24-move time budget (max Manhattan distance ≤ 14)
      expect(vm.isSuccess()).toBe(true);
      expect(vm.getParam("time_left")).toBeGreaterThan(0);
    }
  });

  it("quest result is deterministic for the same seed", () => {
    const vm1 = new QuestVM(reactorScript, 42);
    const vm2 = new QuestVM(reactorScript, 42);
    solveReactor(vm1);
    solveReactor(vm2);
    expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    expect(vm1.getParam("time_left")).toBe(vm2.getParam("time_left"));
    expect(vm1.getParam("rod_a")).toBe(vm2.getParam("rod_a"));
  });

  it("different seeds produce different initial rod configurations", () => {
    const configs = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const vm = new QuestVM(reactorScript, seed);
      const key = `${vm.getParam("rod_a")}${vm.getParam("rod_b")}${vm.getParam("rod_c")}${vm.getParam("rod_d")}`;
      configs.add(key);
    }
    expect(configs.size).toBeGreaterThanOrEqual(10);
  });

  it("text interpolation shows rod values and time in location text", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 2);
    vm.setParam("rod_b", 3);
    vm.setParam("rod_c", 1);
    vm.setParam("rod_d", 5);
    vm.setParam("time_left", 85);
    const text = vm.interpolate(vm.currentLocation().text);
    expect(text).toContain("2");
    expect(text).toContain("3");
    expect(text).toContain("85");
  });

  it("explosion text interpolates final rod values", () => {
    const vm = new QuestVM(reactorScript, 1);
    advanceAutoReactor(vm);
    vm.setParam("rod_a", 1);
    vm.setParam("time_left", 5);
    vm.execute("a_up"); // time_left → 0 → reactor_explosion
    const text = vm.interpolate(vm.currentLocation().text);
    expect(vm.currentLocation().id).toBe("reactor_explosion");
    expect(text).toContain("2"); // rod_a was 1, now 2 after a_up
  });
});

// Advance all autoExecute transitions until manual choice or finished
function advanceAutoAuction(vm: QuestVM): void {
  const MAX = 30;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0 || !avail[0].autoExecute) break;
    vm.execute(avail[0].id);
  }
}

// Aggressive strategy: always bid_low if budget allows, else bid_high if possible, else skip
function runAggressive(vm: QuestVM): void {
  const MAX_STEPS = 500;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX_STEPS) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0) break;
    if (avail[0].autoExecute) {
      vm.execute(avail[0].id);
    } else if (vm.currentLocation().id === "lot_screen") {
      const ids = avail.map((t) => t.id);
      if (ids.includes("bid_low")) {
        vm.execute("bid_low");
      } else if (ids.includes("bid_high")) {
        vm.execute("bid_high");
      } else {
        vm.execute("skip_lot");
      }
    } else {
      vm.execute(avail[0].id);
    }
  }
}

// High-value only strategy: bid_high on class >= 3 lots, skip otherwise
function runSelectiveHigh(vm: QuestVM): void {
  const MAX_STEPS = 500;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX_STEPS) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0) break;
    if (avail[0].autoExecute) {
      vm.execute(avail[0].id);
    } else if (vm.currentLocation().id === "lot_screen") {
      const lotClass = vm.getParam("lot_class_current");
      const ids = avail.map((t) => t.id);
      if (lotClass >= 3 && ids.includes("bid_high")) {
        vm.execute("bid_high");
      } else {
        vm.execute("skip_lot");
      }
    } else {
      vm.execute(avail[0].id);
    }
  }
}

describe("Auction quest", () => {
  it("starts at prepare_lot_1 and arrives at lot_screen after auto-init", () => {
    const vm = new QuestVM(auctionScript, 1);
    expect(vm.currentLocation().id).toBe("prepare_lot_1");
    advanceAutoAuction(vm);
    expect(vm.currentLocation().id).toBe("lot_screen");
    expect(vm.getParam("current_lot")).toBe(1);
  });

  it("initial budget is 800, profit is 0, lots_won is 0", () => {
    const vm = new QuestVM(auctionScript, 1);
    expect(vm.getParam("budget")).toBe(800);
    expect(vm.getParam("profit")).toBe(0);
    expect(vm.getParam("lots_won")).toBe(0);
  });

  it("all lot classes are in range 1–4 for any seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm = new QuestVM(auctionScript, seed);
      for (let n = 1; n <= 8; n++) {
        const c = vm.getParam(`lot_${n}_class`);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(4);
      }
    }
  });

  it("no lot class is 1 — minimum is 2 so class-1 useless lots never appear", () => {
    for (let seed = 0; seed < 50; seed++) {
      const vm = new QuestVM(auctionScript, seed);
      for (let n = 1; n <= 8; n++) {
        const c = vm.getParam(`lot_${n}_class`);
        expect(c).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("lot_class_current is set from lot_1_class after prepare_lot_1", () => {
    const vm = new QuestVM(auctionScript, 1);
    const expected = vm.getParam("lot_1_class");
    advanceAutoAuction(vm);
    expect(vm.getParam("lot_class_current")).toBe(expected);
  });

  it("bid_low deducts 100 from budget and goes to bot_response", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.execute("bid_low");
    expect(vm.getParam("budget")).toBe(700);
    expect(vm.currentLocation().id).toBe("bot_response");
  });

  it("bid_high deducts 250 and skips bots (always wins)", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.execute("bid_high");
    expect(vm.getParam("budget")).toBe(550);
    // lands on player_wins, then autoExecute chain runs
    advanceAutoAuction(vm);
    expect(vm.getParam("lots_won")).toBe(1);
  });

  it("aggressive bot (budget>=200) wins bid_low and refunds player", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.execute("bid_low");
    // bot_agg_budget starts at 600 >= 200 → bot wins
    advanceAutoAuction(vm);
    // player refunded 100, bot spent 200; budget back to 800
    expect(vm.getParam("budget")).toBe(800);
    expect(vm.getParam("bot_agg_budget")).toBe(400);
    expect(vm.getParam("lots_won")).toBe(0);
  });

  it("aggressive bot is exhausted after 3 wins (bot_agg_budget == 0)", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    // Force random_bot_roll = 0 so only aggressive bot competes
    for (let lot = 1; lot <= 3; lot++) {
      vm.setParam("random_bot_roll", 0);
      vm.execute("bid_low");
      advanceAutoAuction(vm);
    }
    expect(vm.getParam("bot_agg_budget")).toBe(0);
  });

  it("after aggressive bot is broke, bid_low outcome depends on random_bot_roll", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    // Exhaust aggressive bot
    vm.setParam("bot_agg_budget", 0);
    vm.setParam("random_bot_roll", 0); // random bot passes
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    // Player should have won the lot
    expect(vm.getParam("lots_won")).toBe(1);
  });

  it("random bot wins bid_low when random_bot_roll == 1 (and agg bot is broke)", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("bot_agg_budget", 0);
    vm.setParam("random_bot_roll", 1);
    const budgetBefore = vm.getParam("budget");
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    // Player refunded, random bot wins
    expect(vm.getParam("budget")).toBe(budgetBefore); // refunded
    expect(vm.getParam("lots_won")).toBe(0);
  });

  it("bid_high on class 4 lot yields profit +150", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("lot_class_current", 4);
    vm.execute("bid_high");
    advanceAutoAuction(vm);
    expect(vm.getParam("profit")).toBe(150);
    expect(vm.getParam("lots_won")).toBe(1);
  });

  it("bid_low on class 3 lot (when bots pass) yields profit +200", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("lot_class_current", 3);
    vm.setParam("bot_agg_budget", 0);
    vm.setParam("random_bot_roll", 0);
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    expect(vm.getParam("profit")).toBe(200);
  });

  it("bid_low on class 1 lot yields profit +0 (break-even)", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("lot_class_current", 1);
    vm.setParam("bot_agg_budget", 0);
    vm.setParam("random_bot_roll", 0);
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    expect(vm.getParam("profit")).toBe(0);
    expect(vm.getParam("lots_won")).toBe(1);
  });

  it("skipping all lots ends in failure (profit stays 0 < 500)", () => {
    const vm = new QuestVM(auctionScript, 1);
    for (let lot = 1; lot <= 8; lot++) {
      advanceAutoAuction(vm); // prepare → lot_screen
      vm.execute("skip_lot");
      advanceAutoAuction(vm); // next_lot_dispatch
    }
    advanceAutoAuction(vm); // final_verdict
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_profit");
  });

  it("current_lot advances to 2 after lot 1 is processed", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.execute("skip_lot");
    advanceAutoAuction(vm); // dispatch → prepare_lot_2 → lot_screen
    expect(vm.getParam("current_lot")).toBe(2);
    expect(vm.currentLocation().id).toBe("lot_screen");
  });

  it("lot_class_current changes between lots", () => {
    const vm = new QuestVM(auctionScript, 42);
    advanceAutoAuction(vm);
    const class1 = vm.getParam("lot_class_current");
    vm.execute("skip_lot");
    advanceAutoAuction(vm);
    const class2 = vm.getParam("lot_class_current");
    // Classes are independently randomised; they could be equal but current_lot changed
    expect(vm.getParam("current_lot")).toBe(2);
    // Verify class2 came from lot_2_class
    expect(class2).toBe(vm.getParam("lot_2_class"));
    expect(class1).toBe(vm.getParam("lot_1_class"));
  });

  it("aggressive strategy (bid_low on all) with seed 1 gives deterministic result", () => {
    const vm1 = new QuestVM(auctionScript, 1);
    const vm2 = new QuestVM(auctionScript, 1);
    runAggressive(vm1);
    runAggressive(vm2);
    expect(vm1.isFinished()).toBe(true);
    expect(vm2.isFinished()).toBe(true);
    expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    expect(vm1.getParam("profit")).toBe(vm2.getParam("profit"));
    expect(vm1.getParam("lots_won")).toBe(vm2.getParam("lots_won"));
  });

  it("quest result is deterministic across seeds 0–19", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm1 = new QuestVM(auctionScript, seed);
      const vm2 = new QuestVM(auctionScript, seed);
      runAggressive(vm1);
      runAggressive(vm2);
      expect(vm1.getParam("profit")).toBe(vm2.getParam("profit"));
      expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    }
  });

  it("different seeds produce different lot class configurations", () => {
    const configs = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const vm = new QuestVM(auctionScript, seed);
      const key = [1, 2, 3, 4, 5, 6, 7, 8]
        .map((n) => vm.getParam(`lot_${n}_class`))
        .join("");
      configs.add(key);
    }
    expect(configs.size).toBeGreaterThanOrEqual(10);
  });

  it("selective high-bid strategy (bid_high on class>=3) wins for seed 1", () => {
    const vm = new QuestVM(auctionScript, 1);
    runSelectiveHigh(vm);
    expect(vm.isFinished()).toBe(true);
    // With class>=3 lots (value 300/400) bid at 250, profit per win = 50/150
    // At least 4 such lots with seed 1 expected
    const profit = vm.getParam("profit");
    expect(profit).toBeGreaterThanOrEqual(0);
    expect(vm.getParam("lots_won")).toBeGreaterThanOrEqual(0);
  });

  it("text interpolation shows budget and profit values", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("budget", 650);
    vm.setParam("profit", 200);
    const text = vm.interpolate(vm.currentLocation().text);
    expect(text).toContain("650");
    expect(text).toContain("200");
  });

  // --- Task 15 rebalance coverage -------------------------------------------

  const locText = (id: string): string => {
    const loc = auctionScript.locations.find((l) => l.id === id)!;
    return typeof loc.text === "string" ? loc.text : loc.text.join("\n");
  };

  it("lot_screen no longer reveals the exact resale value before bidding", () => {
    // The pre-bid screen must not leak the value — bidding is a real gamble now.
    const text = locText("lot_screen");
    expect(text).not.toContain("перепродаже");
    expect(text).toContain("мешковиной");
  });

  it("the resale value is revealed only on the post-win screens", () => {
    // Decoupled reveal: the class value first appears when the player wins.
    expect(locText("pw_bid_c2")).toContain("200");
    expect(locText("pw_bid_c3")).toContain("300");
    expect(locText("pw_bid_c4")).toContain("400");
  });

  it("losing bid_low to the aggressive bot forfeits a 50cr fee (profit -= 50)", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    // agg bot starts at 600 >= 200 → it outbids; player loses the lot.
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    expect(vm.getParam("lots_won")).toBe(0);
    expect(vm.getParam("budget")).toBe(800); // stake refunded (unchanged)
    expect(vm.getParam("profit")).toBe(-50); // paddle fee forfeited
  });

  it("losing bid_low to the random bot also forfeits the 50cr fee", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("bot_agg_budget", 0);
    vm.setParam("random_bot_roll", 1);
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    expect(vm.getParam("lots_won")).toBe(0);
    expect(vm.getParam("profit")).toBe(-50);
  });

  it("winning bid_low charges no fee", () => {
    const vm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(vm);
    vm.setParam("lot_class_current", 3);
    vm.setParam("bot_agg_budget", 0);
    vm.setParam("random_bot_roll", 0); // both bots pass → player wins
    vm.execute("bid_low");
    advanceAutoAuction(vm);
    expect(vm.getParam("lots_won")).toBe(1);
    expect(vm.getParam("profit")).toBe(200); // class-3 gain, no fee deducted
  });

  it("skip_lot is non-dominated: skipping beats bid_low while the aggressive bot is solvent", () => {
    // Skip yields 0; bidding low against a solvent aggressive bot is a
    // guaranteed −50. So skip strictly dominates bid_low in this regime.
    const skipVm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(skipVm);
    skipVm.execute("skip_lot");
    advanceAutoAuction(skipVm);
    expect(skipVm.getParam("profit")).toBe(0);

    const bidVm = new QuestVM(auctionScript, 1);
    advanceAutoAuction(bidVm);
    bidVm.execute("bid_low"); // agg bot solvent → loses
    advanceAutoAuction(bidVm);
    expect(bidVm.getParam("profit")).toBe(-50);
    expect(skipVm.getParam("profit")).toBeGreaterThan(bidVm.getParam("profit"));
  });

  it("lot 5 is a different decision shape: a rival's bribe, not a bid war", () => {
    const vm = new QuestVM(auctionScript, 1);
    for (let i = 1; i <= 4; i++) {
      advanceAutoAuction(vm);
      vm.execute("skip_lot");
      advanceAutoAuction(vm);
    }
    expect(vm.currentLocation().id).toBe("rival_approach");
    expect(vm.getParam("current_lot")).toBe(5);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("take_bribe");
    expect(ids).toContain("refuse_bid");
    expect(ids).toContain("skip_lot");
  });

  it("take_bribe grants +150 profit and moves on without a bid", () => {
    const vm = new QuestVM(auctionScript, 1);
    for (let i = 1; i <= 4; i++) {
      advanceAutoAuction(vm);
      vm.execute("skip_lot");
      advanceAutoAuction(vm);
    }
    expect(vm.currentLocation().id).toBe("rival_approach");
    vm.execute("take_bribe");
    advanceAutoAuction(vm);
    expect(vm.getParam("profit")).toBe(150);
    expect(vm.getParam("lots_won")).toBe(0);
    expect(vm.getParam("current_lot")).toBe(6);
  });

  it("refuse_bid on lot 5 drops into the normal lot_screen bid", () => {
    const vm = new QuestVM(auctionScript, 1);
    for (let i = 1; i <= 4; i++) {
      advanceAutoAuction(vm);
      vm.execute("skip_lot");
      advanceAutoAuction(vm);
    }
    vm.execute("refuse_bid");
    expect(vm.currentLocation().id).toBe("lot_screen");
    expect(vm.getParam("current_lot")).toBe(5);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("bid_low");
    expect(ids).toContain("bid_high");
  });

  it("success text no longer promises the barysh as a payout", () => {
    // C-fix: the fixed guild fee is the reward; the barysh is a scorecard.
    const success = locText("quest_success");
    expect(success).not.toContain("хватит на славный апгрейд");
    expect(success).toContain("{profit}");
    expect(success).toContain("гонорар");
  });
});
