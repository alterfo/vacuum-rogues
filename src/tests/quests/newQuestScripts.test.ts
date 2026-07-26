import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import {
  ALL_QUEST_SCRIPTS,
  getQuestScript,
} from "@/systems/quests/TextQuestRegistry";
import { derelictSalvageScript } from "@/systems/quests/scripts/derelict-salvage";
import { smugglingRunScript } from "@/systems/quests/scripts/smuggling-run";
import { hostageRescueScript } from "@/systems/quests/scripts/hostage-rescue";
import { sabotageHeistScript } from "@/systems/quests/scripts/sabotage-heist";
import { firstContactScript } from "@/systems/quests/scripts/first-contact";
import { plagueCrisisScript } from "@/systems/quests/scripts/plague-crisis";
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
    sabotageHeistScript,
    firstContactScript,
    plagueCrisisScript,
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

  // Task 19 — defect C: the catastrophic ending now carries a real credit penalty.
  it("outbreak catastrophe now docks credits, not just reputation", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful");
    vm.execute("explore_hold_b");
    vm.execute("take_sample"); // +1000
    advanceAuto(vm);
    vm.execute("load_full"); // +3000 → 4000
    vm.execute("blackmarket");
    advanceAuto(vm); // bg_outbreak: rating -= 60, credits -= 3000
    expect(vm.currentLocation().id).toBe("ending_outbreak");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("credits")).toBe(1000); // 4000 - 3000 dezact bill
  });

  // Task 19 — defect B: the boarding method (breach) surfaces in a distinct ending.
  it("forced entry + clean report reaches a breach-specific ending", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("force_entry"); // forced = 1
    vm.execute("go_cargo_c"); // no sample
    advanceAuto(vm); // → cargo_damaged
    vm.execute("load_damaged"); // +2000
    vm.execute("report");
    advanceAuto(vm); // report_gate → ending_report_forced (forced == 1)
    expect(vm.currentLocation().id).toBe("ending_report_forced");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(3000); // 2000 + 1000 bounty
    expect(vm.getParam("rating")).toBe(140);
    // The ending text must actually acknowledge how we boarded.
    expect(vm.currentLocationText()).toContain("резак");
  });

  it("careful entry + clean report keeps the original (non-breach) ending", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful"); // forced = 0
    vm.execute("go_cargo_b");
    advanceAuto(vm); // → cargo_full
    vm.execute("load_full");
    vm.execute("report");
    advanceAuto(vm); // report_gate → ending_report (forced == 0)
    expect(vm.currentLocation().id).toBe("ending_report");
  });

  // Task 19 — defect I: `sealed` is now read — sealing then fencing the intact
  // container is a distinct, higher-payout (but reputation-wrecking) branch.
  it("sealed container on the black market fetches a premium (sealed flag is read)", () => {
    const vm = new QuestVM(derelictSalvageScript, 1);
    vm.execute("dock_careful");
    vm.execute("explore_hold_b");
    vm.execute("seal_it"); // sealed = 1, no sample
    advanceAuto(vm); // → cargo_full
    vm.execute("load_full"); // +3000
    vm.execute("blackmarket");
    advanceAuto(vm); // bg_sold_sealed (sealed == 1): +3500, -45
    expect(vm.currentLocation().id).toBe("ending_blackmarket_sealed");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(6500); // 3000 + 3500 premium
    expect(vm.getParam("rating")).toBe(55); // 100 - 45
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

  it("two dumps then a bribe lands the mid payout tier", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.execute("dump"); // cargo 4
    advanceAuto(vm);
    vm.execute("dump"); // cargo 2
    advanceAuto(vm);
    vm.execute("bribe"); // -150
    advanceAuto(vm); // arrival → payout (cargo 2 → pay_mid +1000) → success
    expect(vm.isSuccess()).toBe(true);
    expect(vm.currentLocation().id).toBe("quest_success");
    expect(vm.getParam("cargo")).toBe(2);
    expect(vm.getParam("credits")).toBe(850); // -150 bribe + 1000 mid payout
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

  // --- Task 33: bluff de-domination (A), tier-branched success (B), a
  // differentiating checkpoint-2 beat (F). New coverage only. ---

  it("a low-heat bluff on the worst roll (roll 0) still gets you caught (A)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("heat", 0);
    vm.execute("bluff"); // roll randomised
    vm.setParam("roll", 0); // force the worst beat
    // bluff_nervous (roll <= 0) fires before bluff_safe → caught
    expect(vm.availableTransitions()[0].id).toBe("bluff_nervous");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("quest_failure_caught");
    expect(vm.isSuccess()).toBe(false);
  });

  it("a low-heat bluff on any non-zero roll still passes safely (A gradient)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.setParam("heat", 0);
    vm.execute("bluff");
    vm.setParam("roll", 1); // just above the catch threshold
    expect(vm.availableTransitions()[0].id).toBe("bluff_safe");
    vm.execute("bluff_safe");
    expect(vm.currentLocation().id).toBe("after_checkpoint");
    expect(vm.getParam("heat")).toBe(2);
  });

  it("the corrupt-officer deal exists only at checkpoint 2 and wipes heat (F)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    // Checkpoint 1: no officer option.
    expect(vm.availableTransitions().map((t) => t.id)).not.toContain(
      "officer_deal",
    );
    // Advance to checkpoint 2 by bribing once.
    vm.execute("bribe");
    advanceAuto(vm);
    expect(vm.getParam("checkpoint")).toBe(2);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("officer_deal");
  });

  it("taking the officer deal costs 400, resets heat to 0, and passes clean (F)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.execute("bribe"); // -150, → checkpoint 2
    advanceAuto(vm);
    vm.setParam("heat", 5); // ran hot up to here
    vm.execute("officer_deal"); // -400, heat = 0
    expect(vm.getParam("heat")).toBe(0);
    expect(vm.getParam("credits")).toBe(-550); // -150 bribe - 400 deal
    // The narrated beat then auto-advances to the next checkpoint.
    advanceAuto(vm);
    expect(vm.getParam("checkpoint")).toBe(3);
    expect(vm.currentLocation().id).toBe("checkpoint_decision");
  });

  it("the three payout tiers route through distinct, differently-worded beats (B)", () => {
    const byId = new Map(smugglingRunScript.locations.map((l) => [l.id, l]));
    const full = byId.get("payout_full");
    const high = byId.get("payout_high");
    const mid = byId.get("payout_mid");
    expect(full && high && mid).toBeTruthy();
    const texts = [full!.text, high!.text, mid!.text];
    // All three are scalar strings, and all three differ from one another.
    for (const t of texts) expect(typeof t).toBe("string");
    expect(new Set(texts as string[]).size).toBe(3);
    // Each beat auto-executes into the shared success coda.
    for (const beat of [full!, high!, mid!]) {
      expect(beat.transitions).toHaveLength(1);
      expect(beat.transitions[0].autoExecute).toBe(true);
      expect(beat.transitions[0].toLocation).toBe("quest_success");
    }
  });

  it("a mid-tier delivery reads its own beat before the shared coda (B)", () => {
    const vm = new QuestVM(smugglingRunScript, 1);
    vm.execute("dump"); // cargo 4
    advanceAuto(vm);
    vm.execute("dump"); // cargo 2
    advanceAuto(vm);
    // Bribe the last checkpoint, then step to the payout gate manually so we can
    // observe the tier beat before it auto-advances into quest_success.
    vm.execute("bribe");
    // Walk the auto-chain up to (but not through) the payout beat.
    while (
      !vm.isFinished() &&
      vm.availableTransitions()[0]?.autoExecute &&
      vm.currentLocation().id !== "payout_mid"
    ) {
      vm.execute(vm.availableTransitions()[0].id);
    }
    expect(vm.currentLocation().id).toBe("payout_mid");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("quest_success");
    expect(vm.getParam("credits")).toBe(850); // -150 bribe + 1000 mid payout
  });

  it("the encounter framing is a per-seed variance pool (F)", () => {
    const start = smugglingRunScript.locations.find(
      (l) => l.id === "checkpoint_decision",
    )!;
    expect(Array.isArray(start.text)).toBe(true);
    expect((start.text as string[]).length).toBeGreaterThanOrEqual(2);
    // Different seeds can surface different framings while staying deterministic
    // per seed (the resolver keys on (seed, locationId), not the RNG stream).
    const a1 = new QuestVM(smugglingRunScript, 1).currentLocationText();
    const a2 = new QuestVM(smugglingRunScript, 1).currentLocationText();
    expect(a1).toBe(a2);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
      new QuestVM(smugglingRunScript, s).currentLocationText(),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
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

  // ── Task 23: sniping is no longer a free risk-eraser ──────────────────────
  it("sniping first now carries a real cost (lost bounty + standing)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("assault");
    vm.setParam("guards", 4);
    vm.execute("snipe_first");
    // guaranteed -2 guards still holds (locked elsewhere), but it is now paid for
    expect(vm.getParam("guards")).toBe(2);
    expect(vm.getParam("credits")).toBe(-2500);
    expect(vm.getParam("rating")).toBe(80);
  });

  it("snipe→clean nets LESS than a raw clean breach — snipe no longer dominates at low guard counts", () => {
    // Raw breach against 2 guards: full 3500 bounty, +25 rep, all saved.
    const raw = new QuestVM(hostageRescueScript, 1);
    raw.execute("assault");
    raw.setParam("guards", 2);
    raw.execute("breach_loud");
    advanceAuto(raw);
    expect(raw.currentLocation().id).toBe("ending_assault_clean");
    expect(raw.getParam("credits")).toBe(3500);
    expect(raw.getParam("rating")).toBe(125);

    // Snipe→clean against the same 2 guards: same ending, but strictly worse
    // credits and rating because sniping was paid for — so a player who sees a
    // low guard count has a real reason to breach instead of snipe.
    const snipe = new QuestVM(hostageRescueScript, 1);
    snipe.execute("assault");
    snipe.setParam("guards", 2);
    snipe.execute("snipe_first"); // -2500 cr, -20 rep, guards clamped
    snipe.execute("now_breach");
    advanceAuto(snipe);
    expect(snipe.currentLocation().id).toBe("ending_assault_clean");
    expect(snipe.getParam("credits")).toBeLessThan(raw.getParam("credits"));
    expect(snipe.getParam("rating")).toBeLessThan(raw.getParam("rating"));
    expect(snipe.getParam("hostages")).toBe(4); // still a guaranteed rescue
  });

  // ── Task 23: pay_ransom gains a real, higher-variance upside ───────────────
  it("marking the ransom offers a distinct branch from simply trusting", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("pay_ransom");
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("trust");
    expect(ids).toContain("mark_ransom");
    vm.execute("mark_ransom");
    expect(vm.currentLocation().id).toBe("ransom_marked");
  });

  it("a marked ransom that goes unnoticed recovers the money AND pays a bounty (net positive)", () => {
    const vm = new QuestVM(hostageRescueScript, 1);
    vm.execute("pay_ransom"); // -2000
    vm.execute("mark_ransom");
    vm.execute("spring_trap"); // roll randomised
    vm.setParam("roll", 9); // >= 5 → paid off
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_ransom_marked_good");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("hostages")).toBe(4);
    expect(vm.getParam("credits")).toBe(2000); // -2000 ransom + 4000 recovered
    expect(vm.getParam("rating")).toBe(125);
  });

  it("a detected tag turns the exchange bloody — a worse floor than a plain betrayal", () => {
    const marked = new QuestVM(hostageRescueScript, 1);
    marked.execute("pay_ransom");
    marked.execute("mark_ransom");
    marked.execute("spring_trap");
    marked.setParam("roll", 0); // < 5 → burned
    advanceAuto(marked);
    expect(marked.currentLocation().id).toBe("ending_ransom_marked_botched");
    expect(marked.isSuccess()).toBe(false);
    expect(marked.getParam("hostages")).toBe(0);

    // Plain betrayal leaves rating untouched; the botched tag also costs standing,
    // so the clever line genuinely has a worse floor than naive trust.
    const plain = new QuestVM(hostageRescueScript, 1);
    plain.execute("pay_ransom");
    plain.execute("trust");
    plain.setParam("roll", 0);
    advanceAuto(plain);
    expect(marked.getParam("rating")).toBeLessThan(plain.getParam("rating"));
  });

  // ── Task 23: antagonist gets more than one line before vanishing ───────────
  it("the pirate leader speaks again on the marked-ransom and assault paths", () => {
    const byId = new Map(hostageRescueScript.locations.map((l) => [l.id, l]));
    const marked = byId.get("ransom_marked")!.text as string;
    const prep = byId.get("assault_prep")!.text as string;
    expect(marked).toContain("главарь");
    expect(prep).toContain("Главарь");
    expect(prep).toContain("рейнджер");
  });
});

describe("Sabotage Heist quest", () => {
  it("starts at approach with 0 credits, 100 rating, no partner", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    expect(vm.currentLocation().id).toBe("approach");
    expect(vm.getParam("credits")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
    expect(vm.getParam("partner")).toBe(0);
  });

  it("bribe gives a partner and costs 500 credits", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("bribe_contact");
    expect(vm.getParam("partner")).toBe(1);
    expect(vm.getParam("credits")).toBe(-500);
    expect(vm.currentLocation().id).toBe("inside");
  });

  it("bribe + grab core + honored partner: clean success, partner takes a cut, +rep", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("bribe_contact"); // -500, partner = 1
    vm.execute("grab_core"); // loot 3
    vm.execute("meet_partner");
    vm.execute("trust_partner"); // roll randomised
    vm.setParam("roll", 8); // honored
    advanceAuto(vm); // trust_check → escape_gate → payout_gate → disposition_gate → ending_clean
    expect(vm.currentLocation().id).toBe("ending_clean");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("loot")).toBe(2); // 3 - 1 partner cut
    expect(vm.getParam("rating")).toBe(110); // 100 + 10 honored
    expect(vm.getParam("credits")).toBe(500); // -500 bribe + 1000 (pay_small fallthrough at loot 2)
  });

  it("partner betrayal on a bad roll loses the loot (failure)", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("bribe_contact");
    vm.execute("grab_all"); // loot 5
    vm.execute("meet_partner");
    vm.execute("trust_partner");
    vm.setParam("roll", 0); // betrayed
    advanceAuto(vm); // → ending_betrayed
    expect(vm.currentLocation().id).toBe("ending_betrayed");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("loot")).toBe(0);
    expect(vm.getParam("rating")).toBe(90); // 100 - 10
  });

  it("double-crossing the partner keeps the full haul but costs reputation", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("bribe_contact"); // -500
    vm.execute("grab_all"); // loot 5, alarm 3
    vm.execute("double_cross"); // crossed = 1, rating -20
    advanceAuto(vm); // escape_gate (alarm 3 < 6) → payout (loot>=5 +4000) → ending_double_cross
    expect(vm.currentLocation().id).toBe("ending_double_cross");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("rating")).toBe(80); // 100 - 20
    expect(vm.getParam("credits")).toBe(3500); // -500 + 4000
  });

  it("a loud entry plus the greedy grab gets you caught (failure)", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("force_airlock"); // alarm 4
    vm.execute("grab_all"); // alarm 7, loot 5
    vm.execute("slip_out");
    advanceAuto(vm); // escape_gate (alarm 7 >= 6) → ending_caught
    expect(vm.currentLocation().id).toBe("ending_caught");
    expect(vm.isSuccess()).toBe(false);
  });

  it("a quiet grab after a loud entry escapes cleanly", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("force_airlock"); // alarm 4
    vm.execute("grab_core"); // loot 3, no extra alarm
    vm.execute("slip_out");
    advanceAuto(vm); // alarm 4 < 6 → payout (loot>=3 +2500) → ending_clean
    expect(vm.currentLocation().id).toBe("ending_clean");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(2500);
  });

  it("hacking clean (good roll) keeps the alarm down", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("hack_grid"); // roll randomised
    vm.setParam("roll", 9); // clean
    advanceAuto(vm); // hack_check → inside
    expect(vm.currentLocation().id).toBe("inside");
    expect(vm.getParam("alarm")).toBe(0);
  });

  it("hacking loud (bad roll) raises the alarm", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("hack_grid");
    vm.setParam("roll", 0); // loud
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("inside");
    expect(vm.getParam("alarm")).toBe(5);
  });

  it("partner-only options are hidden without a partner", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("force_airlock");
    vm.execute("grab_core");
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("slip_out");
    expect(ids).not.toContain("meet_partner");
    expect(ids).not.toContain("double_cross");
  });

  it("result is deterministic for the same seed (partner path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm1 = new QuestVM(sabotageHeistScript, seed);
      const vm2 = new QuestVM(sabotageHeistScript, seed);
      vm1.execute("bribe_contact");
      vm1.execute("grab_core");
      vm1.execute("meet_partner");
      vm1.execute("trust_partner");
      advanceAuto(vm1);
      vm2.execute("bribe_contact");
      vm2.execute("grab_core");
      vm2.execute("meet_partner");
      vm2.execute("trust_partner");
      advanceAuto(vm2);
      expect(vm1.currentLocation().id).toBe(vm2.currentLocation().id);
      expect(vm1.isSuccess()).toBe(vm2.isSuccess());
    }
  });

  // Task 31: give the hack roll its own text (D), name the partner (H), and make
  // slip_out with a partner actually differ from going alone (I).
  it("hacking clean routes through its own narrated beat before entering (D)", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("hack_grid");
    vm.setParam("roll", 9); // clean
    const first = vm.availableTransitions()[0];
    expect(first.autoExecute).toBe(true);
    vm.execute(first.id);
    expect(vm.currentLocation().id).toBe("hacked_clean");
    advanceAuto(vm); // hacked_clean → inside
    expect(vm.currentLocation().id).toBe("inside");
    expect(vm.getParam("alarm")).toBe(0);
  });

  it("hacking loud routes through its own narrated beat and raises the alarm (D)", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("hack_grid");
    vm.setParam("roll", 0); // loud
    const first = vm.availableTransitions()[0];
    vm.execute(first.id); // hack_loud
    expect(vm.currentLocation().id).toBe("hacked_loud");
    expect(vm.getParam("alarm")).toBe(5);
    advanceAuto(vm); // hacked_loud → inside
    expect(vm.currentLocation().id).toBe("inside");
  });

  it("the two hack outcomes narrate differently (silent roll gets its own text)", () => {
    const clean = sabotageHeistScript.locations.find(
      (l) => l.id === "hacked_clean",
    );
    const loud = sabotageHeistScript.locations.find(
      (l) => l.id === "hacked_loud",
    );
    expect(clean).toBeTruthy();
    expect(loud).toBeTruthy();
    expect(clean!.text).not.toBe(loud!.text);
  });

  it("names the partner (Векслер) with presence before the betrayal roll (H)", () => {
    const meet = sabotageHeistScript.locations.find(
      (l) => l.id === "partner_meet",
    )!;
    const check = sabotageHeistScript.locations.find(
      (l) => l.id === "trust_check",
    )!;
    const meetText =
      typeof meet.text === "string" ? meet.text : meet.text.join(" ");
    const checkText =
      typeof check.text === "string" ? check.text : check.text.join(" ");
    expect(meetText).toContain("Векслер");
    expect(checkText).toContain("Векслер");
    const bribe = sabotageHeistScript.locations
      .find((l) => l.id === "approach")!
      .transitions.find((t) => t.id === "bribe_contact")!;
    expect(bribe.label).toContain("Векслер");
  });

  it("slipping out WITH a partner loses part of the haul (bringing a partner changes it) (I)", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("bribe_contact"); // partner = 1, -500
    vm.execute("grab_all"); // loot 5, alarm 3
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("slip_out_partner");
    expect(ids).not.toContain("slip_out"); // no-partner variant hidden with a partner
    vm.execute("slip_out_partner"); // loot -= 2
    expect(vm.getParam("loot")).toBe(3);
    advanceAuto(vm); // escape_gate (alarm 3 < 6) → pay_mid (+2500) → ending_clean
    expect(vm.currentLocation().id).toBe("ending_clean");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(2000); // -500 bribe + 2500
  });

  it("slipping out WITHOUT a partner keeps the full haul", () => {
    const vm = new QuestVM(sabotageHeistScript, 1);
    vm.execute("force_airlock"); // alarm 4, no partner
    vm.execute("grab_core"); // loot 3
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("slip_out");
    expect(ids).not.toContain("slip_out_partner");
    vm.execute("slip_out"); // no loot change
    expect(vm.getParam("loot")).toBe(3);
  });
});

describe("First Contact quest", () => {
  it("starts at the encounter with 0 trust and 100 rating", () => {
    const vm = new QuestVM(firstContactScript, 1);
    expect(vm.currentLocation().id).toBe("encounter");
    expect(vm.getParam("trust")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
  });

  it("greeting + reciprocate reaches a full alliance", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("broadcast"); // trust +2
    vm.execute("reciprocate"); // trust +4 = 6
    advanceAuto(vm); // exchange → resolution_gate → ending_alliance (trust >= 6)
    expect(vm.currentLocation().id).toBe("ending_alliance");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("trust")).toBe(6);
    expect(vm.getParam("credits")).toBe(3000);
    expect(vm.getParam("rating")).toBe(130);
  });

  it("greeting + wary acceptance reaches a trade pact", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("broadcast"); // +2
    vm.execute("accept_wary"); // +1 = 3
    advanceAuto(vm); // → ending_trade_pact (trust >= 2)
    expect(vm.currentLocation().id).toBe("ending_trade_pact");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1500);
    expect(vm.getParam("rating")).toBe(115);
  });

  it("demanding their tech sours it into a wary peace", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("broadcast"); // +2
    vm.execute("demand_tech"); // -4 = -2
    advanceAuto(vm); // → ending_wary_peace (trust < 2)
    expect(vm.currentLocation().id).toBe("ending_wary_peace");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(0); // no credit reward
    expect(vm.getParam("rating")).toBe(105);
  });

  it("a curious scan (good roll) leads into the greeting", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("scan"); // roll randomised
    vm.setParam("roll", 9); // curious
    advanceAuto(vm); // scan_reaction → greeting
    expect(vm.currentLocation().id).toBe("greeting");
    expect(vm.getParam("trust")).toBe(0);
  });

  it("an alarming scan (bad roll) then standing down still reaches a wary peace", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("scan");
    vm.setParam("roll", 0); // alarmed
    advanceAuto(vm); // scan_reaction → standoff (trust -4)
    expect(vm.currentLocation().id).toBe("standoff");
    expect(vm.getParam("trust")).toBe(-4);
    vm.execute("stand_down"); // +4 = 0
    advanceAuto(vm); // exchange → resolution_gate → ending_wary_peace
    expect(vm.currentLocation().id).toBe("ending_wary_peace");
    expect(vm.isSuccess()).toBe(true);
  });

  it("firing a warning shot starts a war (failure)", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("raise_shields"); // -3
    vm.execute("fire_warning"); // -6 = -9
    advanceAuto(vm); // hostility_gate → ending_war (trust <= -6)
    expect(vm.currentLocation().id).toBe("ending_war");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(70);
  });

  it("holding aim after raising shields ends in a cold standoff (failure)", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("raise_shields"); // -3
    vm.execute("hold_aim"); // -2 = -5 (> -6)
    advanceAuto(vm); // hostility_gate → ending_cold_standoff
    expect(vm.currentLocation().id).toBe("ending_cold_standoff");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(95);
  });

  it("an alarming scan then holding aim hits the exact war threshold (trust -6)", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("scan");
    vm.setParam("roll", 0); // alarmed
    advanceAuto(vm); // scan_reaction → standoff (trust -4)
    expect(vm.currentLocation().id).toBe("standoff");
    expect(vm.getParam("trust")).toBe(-4);
    vm.execute("hold_aim"); // -2 = -6 (exactly the trust <= -6 war threshold)
    advanceAuto(vm); // hostility_gate → ending_war
    expect(vm.currentLocation().id).toBe("ending_war");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("trust")).toBe(-6);
    expect(vm.getParam("rating")).toBe(70); // 100 - 30
  });

  it("result is deterministic for the same seed (scan path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm1 = new QuestVM(firstContactScript, seed);
      const vm2 = new QuestVM(firstContactScript, seed);
      vm1.execute("scan");
      advanceAuto(vm1);
      vm2.execute("scan");
      advanceAuto(vm2);
      expect(vm1.currentLocation().id).toBe(vm2.currentLocation().id);
      expect(vm1.getParam("trust")).toBe(vm2.getParam("trust"));
    }
  });

  // Task 21 (A): scan is no longer strictly worse than broadcast — a curious
  // roll yields sellable xeno-intel (+credits) instead of a diplomatic edge.
  it("a curious scan yields a material intel windfall (+credits) but no trust", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("scan");
    vm.setParam("roll", 9); // curious
    advanceAuto(vm); // scan_reaction → scan_intel → greeting
    expect(vm.currentLocation().id).toBe("greeting");
    expect(vm.getParam("trust")).toBe(0); // no diplomatic edge, unlike broadcast's +2
    expect(vm.getParam("credits")).toBe(800); // intel is worth real credits
  });

  it("scan trades the ceiling: broadcast reaches alliance, curious scan only a trade pact", () => {
    const broad = new QuestVM(firstContactScript, 1);
    broad.execute("broadcast"); // +2
    broad.execute("reciprocate"); // +4 = 6 → alliance
    advanceAuto(broad);
    expect(broad.currentLocation().id).toBe("ending_alliance");

    const scanned = new QuestVM(firstContactScript, 1);
    scanned.execute("scan");
    scanned.setParam("roll", 9); // curious, +800 credits, +0 trust
    advanceAuto(scanned);
    scanned.execute("reciprocate"); // +4 = 4 (< 6, no alliance ceiling)
    advanceAuto(scanned);
    expect(scanned.currentLocation().id).toBe("ending_trade_pact");
    expect(scanned.getParam("trust")).toBe(4);
    expect(scanned.getParam("credits")).toBe(800 + 1500);
  });

  // Task 21 (B): the exchange scene branches per how the player got there.
  it("the exchange scene has a distinct beat per generosity/taking/extortion/de-escalation", () => {
    const texts = new Set<unknown>();
    const cases: Array<{ pre: string[]; choice: string; node: string }> = [
      { pre: ["broadcast"], choice: "reciprocate", node: "exchange_gift" },
      { pre: ["broadcast"], choice: "accept_wary", node: "exchange_take" },
      { pre: ["broadcast"], choice: "demand_tech", node: "exchange_demand" },
      {
        pre: ["raise_shields"],
        choice: "stand_down",
        node: "exchange_standdown",
      },
    ];
    for (const c of cases) {
      const vm = new QuestVM(firstContactScript, 1);
      for (const step of c.pre) vm.execute(step);
      vm.execute(c.choice);
      expect(vm.currentLocation().id).toBe(c.node);
      texts.add(vm.currentLocation().text);
    }
    expect(texts.size).toBe(4); // four genuinely distinct exchange beats
  });

  it("every branched exchange still funnels into the same trust-keyed resolution", () => {
    for (const choice of ["reciprocate", "accept_wary", "demand_tech"]) {
      const vm = new QuestVM(firstContactScript, 1);
      vm.execute("broadcast");
      vm.execute(choice);
      advanceAuto(vm); // exchange_* → resolution_gate → an ending
      expect(vm.isFinished()).toBe(true);
      expect(vm.isSuccess()).toBe(true);
    }
  });

  // Task 21 (C): the alliance ending grounds its reward in the real payout.
  it("the alliance ending ties its reward to the credited payout, not an untracked trophy", () => {
    const vm = new QuestVM(firstContactScript, 1);
    vm.execute("broadcast");
    vm.execute("reciprocate");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_alliance");
    const text = vm.currentLocation().text as string;
    expect(text).toContain("на вашем счету");
    // no longer promises star-maps "no human expedition ever knew" as a separate item
    expect(text).not.toContain(
      "которых не знала ни одна человеческая экспедиция",
    );
  });
});

describe("Plague Crisis quest", () => {
  it("starts at briefing with 10 time, 0 credits, 100 rating", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    expect(vm.currentLocation().id).toBe("briefing");
    expect(vm.getParam("time")).toBe(10);
    expect(vm.getParam("credits")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
  });

  it("fast clear route + treating everyone saves the whole colony in time", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("fast_route"); // time 8, roll randomised
    vm.setParam("roll", 8); // clear
    advanceAuto(vm); // fast_check → arrival (time 7)
    expect(vm.currentLocation().id).toBe("arrival");
    expect(vm.getParam("time")).toBe(7);
    vm.execute("treat_all"); // time 2
    advanceAuto(vm); // treat_all_outcome → ending_treat_all
    expect(vm.currentLocation().id).toBe("ending_treat_all");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("time")).toBe(2);
    expect(vm.getParam("credits")).toBe(2000);
    expect(vm.getParam("rating")).toBe(130);
  });

  it("the slow route leaves no time to treat everyone (too late, failure)", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("safe_route"); // time 4
    expect(vm.currentLocation().id).toBe("arrival");
    vm.execute("treat_all"); // time -1 → crit → ending_too_late
    expect(vm.currentLocation().id).toBe("ending_too_late");
    expect(vm.isSuccess()).toBe(false);
  });

  it("a costly fast detour also runs out of time when treating everyone", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("fast_route"); // time 8
    vm.setParam("roll", 0); // hit
    advanceAuto(vm); // fast_hit → arrival (time 3)
    expect(vm.getParam("time")).toBe(3);
    vm.execute("treat_all"); // time -2 → too late
    expect(vm.currentLocation().id).toBe("ending_too_late");
    expect(vm.isSuccess()).toBe(false);
  });

  it("triage saves most even after the slow route (success)", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("safe_route"); // time 4
    vm.execute("triage"); // time 2
    expect(vm.currentLocation().id).toBe("ending_triage");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1500);
    expect(vm.getParam("rating")).toBe(115);
  });

  it("profiteering saves some but tanks reputation (success)", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("safe_route"); // time 4
    vm.execute("profiteer"); // time 2
    expect(vm.currentLocation().id).toBe("ending_profiteer");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(2500);
    expect(vm.getParam("rating")).toBe(75);
  });

  it("result is deterministic for the same seed (fast route)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const vm1 = new QuestVM(plagueCrisisScript, seed);
      const vm2 = new QuestVM(plagueCrisisScript, seed);
      vm1.execute("fast_route");
      advanceAuto(vm1);
      vm2.execute("fast_route");
      advanceAuto(vm2);
      expect(vm1.currentLocation().id).toBe(vm2.currentLocation().id);
      expect(vm1.getParam("time")).toBe(vm2.getParam("time"));
    }
  });

  // Task 28 (A): the fast shortcut is a genuine gamble, not strictly dominant —
  // a bad field crossing now costs a repair bill (credits/rating) the safe route
  // never pays, so the slow way is the risk-averse floor with a real niche.
  it("a clean steady crossing pays no repair bill", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("fast_route");
    vm.setParam("roll", 8); // clear
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("arrival");
    expect(vm.getParam("time")).toBe(7);
    expect(vm.getParam("credits")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
  });

  it("a clipped steady crossing costs a repair bill and reputation", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("fast_route");
    vm.setParam("roll", 0); // hit
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("arrival");
    expect(vm.getParam("time")).toBe(3);
    expect(vm.getParam("credits")).toBe(-600);
    expect(vm.getParam("rating")).toBe(95);
  });

  it("the safe route pays no repair bill (its risk-averse niche)", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("safe_route");
    expect(vm.currentLocation().id).toBe("arrival");
    expect(vm.getParam("time")).toBe(4);
    expect(vm.getParam("credits")).toBe(0);
    expect(vm.getParam("rating")).toBe(100);
  });

  // Task 28 (D): the reckless full-burn is a genuine player decision — a third,
  // higher-variance route the player picks, not a hidden coin flip.
  it("the briefing offers three genuinely distinct routes", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("fast_route");
    expect(ids).toContain("fast_route_reckless");
    expect(ids).toContain("safe_route");
  });

  it("a reckless clean crossing wins the most time in the game (treat_all with margin)", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("fast_route_reckless"); // time 9
    vm.setParam("roll", 9); // clear (roll >= 5)
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("arrival");
    expect(vm.getParam("time")).toBe(9);
    expect(vm.getParam("credits")).toBe(0);
    vm.execute("treat_all"); // time 4
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_treat_all");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("time")).toBe(4);
  });

  it("a reckless hit costs a heavy repair bill and leaves only safe-route time", () => {
    const vm = new QuestVM(plagueCrisisScript, 1);
    vm.execute("fast_route_reckless"); // time 9
    vm.setParam("roll", 0); // hit (roll < 5)
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("arrival");
    expect(vm.getParam("time")).toBe(4); // same time as the safe route...
    expect(vm.getParam("credits")).toBe(-1200); // ...but with a heavy bill safe never pays
    expect(vm.getParam("rating")).toBe(88);
  });

  it("a reckless hit is strictly worse than the safe route (safe is not dominated)", () => {
    const reckless = new QuestVM(plagueCrisisScript, 1);
    reckless.execute("fast_route_reckless");
    reckless.setParam("roll", 0);
    advanceAuto(reckless);
    const safe = new QuestVM(plagueCrisisScript, 1);
    safe.execute("safe_route");
    // Same arrival time, but the gamble's downside carries a cost the safe road avoids.
    expect(reckless.getParam("time")).toBe(safe.getParam("time"));
    expect(reckless.getParam("credits")).toBeLessThan(safe.getParam("credits"));
    expect(reckless.getParam("rating")).toBeLessThan(safe.getParam("rating"));
  });

  // Task 28 (D): each field crossing narrates its roll through a distinct beat
  // node rather than a silent auto-jump straight to arrival.
  it("the steady crossing routes through distinct clear/hit narration beats", () => {
    const clear = new QuestVM(plagueCrisisScript, 1);
    clear.execute("fast_route");
    clear.setParam("roll", 8);
    clear.execute(clear.availableTransitions()[0].id); // one auto step
    expect(clear.currentLocation().id).toBe("fast_clear_beat");

    const hit = new QuestVM(plagueCrisisScript, 1);
    hit.execute("fast_route");
    hit.setParam("roll", 0);
    hit.execute(hit.availableTransitions()[0].id);
    expect(hit.currentLocation().id).toBe("fast_hit_beat");
  });

  it("the reckless crossing routes through distinct clear/hit narration beats", () => {
    const clear = new QuestVM(plagueCrisisScript, 1);
    clear.execute("fast_route_reckless");
    clear.setParam("roll", 9);
    clear.execute(clear.availableTransitions()[0].id);
    expect(clear.currentLocation().id).toBe("reckless_clear_beat");

    const hit = new QuestVM(plagueCrisisScript, 1);
    hit.execute("fast_route_reckless");
    hit.setParam("roll", 0);
    hit.execute(hit.availableTransitions()[0].id);
    expect(hit.currentLocation().id).toBe("reckless_hit_beat");
  });
});

describe("Quest script registry", () => {
  it("all script ids are unique within ALL_QUEST_SCRIPTS", () => {
    const ids = ALL_QUEST_SCRIPTS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every script resolves via getQuestScript by its id", () => {
    for (const script of ALL_QUEST_SCRIPTS) {
      expect(getQuestScript(script.id)).toBe(script);
    }
  });

  it("includes the six Task 1 + Task 2 branching scripts", () => {
    const ids = new Set(ALL_QUEST_SCRIPTS.map((s) => s.id));
    for (const id of [
      "derelict-salvage",
      "smuggling-run",
      "hostage-rescue",
      "sabotage-heist",
      "first-contact",
      "plague-crisis",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
