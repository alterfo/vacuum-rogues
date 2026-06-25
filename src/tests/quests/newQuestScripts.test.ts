import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import { ALL_QUEST_SCRIPTS } from "@/systems/quests/TextQuestRegistry";
import { derelictSalvageScript } from "@/systems/quests/scripts/derelict-salvage";
import { smugglingRunScript } from "@/systems/quests/scripts/smuggling-run";
import { hostageRescueScript } from "@/systems/quests/scripts/hostage-rescue";
import type { QuestScript } from "@/systems/quests/QuestScript";

// Advance through all autoExecute transitions until a manual choice or finished.
function advanceAuto(vm: QuestVM): void {
  const MAX = 50;
  let steps = 0;
  while (!vm.isFinished() && steps < MAX) {
    steps++;
    const avail = vm.availableTransitions();
    if (avail.length === 0 || !avail[0].autoExecute) break;
    vm.execute(avail[0].id);
  }
}

// Generic reachability check: from the start, BFS over every transition target
// and verify there are no unreachable locations and every terminal is reachable.
function reachableLocationIds(script: QuestScript): Set<string> {
  const byId = new Map(script.locations.map((l) => [l.id, l]));
  const seen = new Set<string>();
  // Seed with the start plus every critTarget — crit thresholds can redirect
  // execution to those locations from anywhere (e.g. checkpoint critMax → arrival).
  const critTargets = script.params
    .map((p) => p.critTarget)
    .filter((t): t is string => !!t);
  const queue = [script.startLocation, ...critTargets];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const loc = byId.get(id);
    if (!loc) continue;
    for (const t of loc.transitions) {
      if (!seen.has(t.toLocation)) queue.push(t.toLocation);
    }
  }
  return seen;
}

describe("New quest scripts — structural invariants", () => {
  const scripts = [
    derelictSalvageScript,
    smugglingRunScript,
    hostageRescueScript,
  ];

  for (const script of scripts) {
    describe(`${script.id}`, () => {
      it("has a unique id within ALL_QUEST_SCRIPTS", () => {
        const matches = ALL_QUEST_SCRIPTS.filter((s) => s.id === script.id);
        expect(matches.length).toBe(1);
      });

      it("start location exists", () => {
        const ids = script.locations.map((l) => l.id);
        expect(ids).toContain(script.startLocation);
      });

      it("has no unreachable locations", () => {
        const reachable = reachableLocationIds(script);
        const unreachable = script.locations
          .map((l) => l.id)
          .filter((id) => !reachable.has(id));
        expect(unreachable).toEqual([]);
      });

      it("every transition points at a real location", () => {
        const ids = new Set(script.locations.map((l) => l.id));
        for (const loc of script.locations) {
          for (const t of loc.transitions) {
            expect(ids.has(t.toLocation)).toBe(true);
          }
        }
      });

      it("every critTarget points at a real location", () => {
        const ids = new Set(script.locations.map((l) => l.id));
        for (const p of script.params) {
          if (p.critTarget) expect(ids.has(p.critTarget)).toBe(true);
        }
      });

      it("has at least one success and one failure terminal", () => {
        const successes = script.locations.filter((l) => l.isSuccess);
        const failures = script.locations.filter((l) => l.isFailure);
        expect(successes.length).toBeGreaterThanOrEqual(1);
        expect(failures.length).toBeGreaterThanOrEqual(1);
      });
    });
  }
});

describe("Derelict Salvage quest", () => {
  it("starts at approach with 0 credits and 100 rating", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    expect(vm.currentLocation().id).toBe("approach");
    expect(vm.getParam("credits")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
  });

  it("careful dock + seal + report: full cargo, official bounty, +rep", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful");
    vm.execute("explore_hold_b");
    vm.execute("seal_it");
    advanceAuto(vm); // cargo_gate → cargo_full
    expect(vm.currentLocation().id).toBe("cargo_full");
    vm.execute("load_full"); // +3000
    vm.execute("report");
    advanceAuto(vm); // report_gate → ending_report
    expect(vm.currentLocation().id).toBe("ending_report");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(4000); // 3000 + 1000 bounty
    expect(vm.getParam("rating")).toBe(140); // 100 + 40
  });

  it("forced entry yields damaged (lower) cargo", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("force_entry");
    vm.execute("go_cargo_c");
    advanceAuto(vm); // cargo_gate → cargo_damaged (forced == 1)
    expect(vm.currentLocation().id).toBe("cargo_damaged");
    vm.execute("load_damaged"); // +2000
    expect(vm.getParam("credits")).toBe(2000);
  });

  it("taking the sample then reporting gets it seized (fine, but success)", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful");
    vm.execute("explore_hold_b");
    vm.execute("take_sample"); // +1000, sample = 1
    advanceAuto(vm); // → cargo_full
    vm.execute("load_full"); // +3000
    vm.execute("report");
    advanceAuto(vm); // report_gate → ending_sample_seized (sample == 1)
    expect(vm.currentLocation().id).toBe("ending_sample_seized");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(3500); // 1000 + 3000 - 500 fine
  });

  it("selling the bio-sample on the black market triggers an outbreak (failure)", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful");
    vm.execute("explore_hold_b");
    vm.execute("take_sample");
    advanceAuto(vm);
    vm.execute("load_full");
    vm.execute("blackmarket");
    advanceAuto(vm); // blackmarket_gate → ending_outbreak (sample == 1)
    expect(vm.currentLocation().id).toBe("ending_outbreak");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(40); // 100 - 60
  });

  it("black market without the sample is a richer (but reputation-costing) success", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful");
    vm.execute("go_cargo_b"); // skip hold, no sample
    advanceAuto(vm);
    vm.execute("load_full"); // +3000
    vm.execute("blackmarket");
    advanceAuto(vm); // ending_blackmarket (sample == 0)
    expect(vm.currentLocation().id).toBe("ending_blackmarket");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(5500); // 3000 + 2500
    expect(vm.getParam("rating")).toBe(70); // 100 - 30
  });

  it("text interpolation shows credits in final decision", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.setParam("credits", 3000);
    const text = vm.interpolate("Кредиты: {credits}");
    expect(text).toContain("3000");
  });
});

describe("Smuggling Run quest", () => {
  it("starts at checkpoint 1 with 6 cargo and 0 heat", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    expect(vm.currentLocation().id).toBe("checkpoint_decision");
    expect(vm.getParam("checkpoint")).toBe(1);
    expect(vm.getParam("cargo")).toBe(6);
    expect(vm.getParam("heat")).toBe(0);
  });

  it("bribing all 3 checkpoints delivers full cargo for max payout", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    for (let i = 0; i < 3; i++) {
      expect(vm.currentLocation().id).toBe("checkpoint_decision");
      vm.execute("bribe"); // -150
      advanceAuto(vm); // after_checkpoint → next (or arrival → payout → success on 3rd)
    }
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("quest_success");
    expect(vm.getParam("credits")).toBe(2550); // -450 bribes + 3000 full payout
  });

  it("bluffing while hot (heat >= 6) gets you caught", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("heat", 6);
    vm.execute("bluff");
    advanceAuto(vm); // bluff_check → quest_failure_caught
    expect(vm.currentLocation().id).toBe("quest_failure_caught");
    expect(vm.isSuccess()).toBe(false);
  });

  it("bluffing at low heat passes but raises heat", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("heat", 0);
    vm.execute("bluff");
    // bluff_check (heat < 3) → after_checkpoint (+2 heat)
    expect(vm.availableTransitions()[0].id).toBe("bluff_safe");
    vm.execute("bluff_safe");
    expect(vm.getParam("heat")).toBe(2);
    expect(vm.currentLocation().id).toBe("after_checkpoint");
  });

  it("a bad roll at medium heat gets you caught", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("heat", 4); // medium band
    vm.execute("bluff"); // roll randomised
    vm.setParam("roll", 1); // force bad roll
    vm.execute(vm.availableTransitions()[0].id); // bluff_check → bluff_roll_check
    expect(vm.currentLocation().id).toBe("bluff_roll_check");
    vm.execute(vm.availableTransitions()[0].id); // roll <= 2 → caught
    expect(vm.currentLocation().id).toBe("quest_failure_caught");
  });

  it("a good roll at medium heat passes (heat +3)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("heat", 4);
    vm.execute("bluff");
    vm.setParam("roll", 8); // safe roll
    vm.execute(vm.availableTransitions()[0].id); // → bluff_roll_check
    vm.execute(vm.availableTransitions()[0].id); // roll_pass → after_checkpoint
    expect(vm.currentLocation().id).toBe("after_checkpoint");
    expect(vm.getParam("heat")).toBe(7);
  });

  it("dumping all cargo means arriving empty-handed (failure)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    for (let i = 0; i < 3; i++) {
      expect(vm.currentLocation().id).toBe("checkpoint_decision");
      vm.execute("dump"); // -2 cargo each
      advanceAuto(vm);
    }
    expect(vm.getParam("cargo")).toBe(0);
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    expect(vm.currentLocation().id).toBe("quest_failure_nocargo");
  });

  it("dump is unavailable when cargo is below 2", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("cargo", 1);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).not.toContain("dump");
    expect(ids).toContain("bribe");
  });

  it("one dump then bribes yields a high (not full) payout", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.execute("dump"); // cargo 4
    advanceAuto(vm);
    vm.execute("bribe");
    advanceAuto(vm);
    vm.execute("bribe");
    advanceAuto(vm); // arrival → payout (cargo 4 → +2000)
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("cargo")).toBe(4);
    expect(vm.getParam("credits")).toBe(1700); // -300 bribes + 2000
  });

  it("result is deterministic for the same seed", () => {
    const vm1 = new QuestVM(smugglingRunScript, 42);
    const vm2 = new QuestVM(smugglingRunScript, 42);
    for (let i = 0; i < 3; i++) {
      vm1.execute("bribe");
      advanceAuto(vm1);
      vm2.execute("bribe");
      advanceAuto(vm2);
    }
    expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    expect(vm1.getParam("credits")).toBe(vm2.getParam("credits"));
  });
});

describe("Hostage Rescue quest", () => {
  it("starts at briefing with 4 hostages and a guard count of 2-4", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    expect(vm.currentLocation().id).toBe("briefing");
    expect(vm.getParam("hostages")).toBe(4);
    const g = vm.getParam("guards");
    expect(g).toBeGreaterThanOrEqual(2);
    expect(g).toBeLessThanOrEqual(4);
  });

  it("guard count varies across seeds", () => {
    const values = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      values.add(new QuestVM(hostageRescueScript, seed).getParam("guards"));
    }
    expect(values.size).toBeGreaterThanOrEqual(2);
  });

  it("ransom honored frees everyone (success, money spent, +rep)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("pay_ransom"); // -2000
    vm.execute("trust"); // roll randomised
    vm.setParam("roll", 9); // honored
    advanceAuto(vm); // ransom_outcome → ending_ransom_good
    expect(vm.currentLocation().id).toBe("ending_ransom_good");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(4);
    expect(vm.getParam("credits")).toBe(-2000);
    expect(vm.getParam("rating")).toBe(110);
  });

  it("ransom betrayed kills the hostages (failure)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("pay_ransom");
    vm.execute("trust");
    vm.setParam("roll", 0); // betrayed
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_ransom_betrayed");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("hostages")).toBe(0);
  });

  it("clean stealth frees all hostages with a big bounty", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("stealth");
    vm.execute("sneak");
    vm.setParam("roll", 8); // clean
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_stealth_clean");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(4);
    expect(vm.getParam("credits")).toBe(3000);
    expect(vm.getParam("rating")).toBe(130);
  });

  it("spotted stealth saves only 2 hostages (partial success)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("stealth");
    vm.execute("sneak");
    vm.setParam("roll", 0); // spotted
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_stealth_partial");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(2);
    expect(vm.getParam("credits")).toBe(1000);
  });

  it("methodical stealth frees everyone slowly (success)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("stealth");
    vm.execute("methodical");
    expect(vm.currentLocation().id).toBe("ending_stealth_methodical");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(4);
    expect(vm.getParam("credits")).toBe(1500);
    expect(vm.getParam("rating")).toBe(120);
  });

  it("assault against few guards (<=2) is clean", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("assault");
    vm.setParam("guards", 2);
    vm.execute("breach_loud");
    advanceAuto(vm); // assault_check → ending_assault_clean
    expect(vm.currentLocation().id).toBe("ending_assault_clean");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(4);
    expect(vm.getParam("credits")).toBe(3500);
    expect(vm.getParam("rating")).toBe(125);
  });

  it("assault against 3 guards is costly (2 hostages lost, rep hit)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("assault");
    vm.setParam("guards", 3);
    vm.execute("breach_loud");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_assault_costly");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(2);
    expect(vm.getParam("rating")).toBe(90);
    expect(vm.getParam("credits")).toBe(1500);
  });

  it("assault against 4 guards collapses (failure)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("assault");
    vm.setParam("guards", 4);
    vm.execute("breach_loud");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_assault_fail");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("hostages")).toBe(0);
    expect(vm.getParam("rating")).toBe(70);
  });

  it("sniping first guarantees a clean assault even against 4 guards", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("assault");
    vm.setParam("guards", 4);
    vm.execute("snipe_first"); // guards -> 2
    expect(vm.getParam("guards")).toBe(2);
    vm.execute("now_breach");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_assault_clean");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(4);
  });

  it("result is deterministic for the same seed (assault path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm1 = new QuestVM(hostageRescueScript, seed);
      const vm2 = new QuestVM(hostageRescueScript, seed);
      vm1.execute("assault");
      vm1.execute("breach_loud");
      advanceAuto(vm1);
      vm2.execute("assault");
      vm2.execute("breach_loud");
      advanceAuto(vm2);
      expect(vm1.currentLocation().id).toBe(vm2.currentLocation().id);
      expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    }
  });
});
