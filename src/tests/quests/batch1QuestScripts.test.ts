import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import {
  ALL_QUEST_SCRIPTS,
  getQuestScript,
} from "@/systems/quests/TextQuestRegistry";
import { evacuationScript } from "@/systems/quests/scripts/evacuation";
import { lockedRoomScript } from "@/systems/quests/scripts/locked-room";
import { lifeSupportScript } from "@/systems/quests/scripts/life-support";
import { boardingStandoffScript } from "@/systems/quests/scripts/boarding-standoff";
import {
  generateQuestBoard,
  questKey,
  type BoardOptions,
} from "@/systems/quests/QuestGenerator";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";

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

describe("Evacuation quest (logistics routing)", () => {
  it("starts at briefing with a 12-hour window and nobody saved", () => {
    const vm = new QuestVM(evacuationScript, 1);
    expect(vm.currentLocation().id).toBe("briefing");
    expect(vm.getParam("time")).toBe(12);
    expect(vm.getParam("saved")).toBe(0);
  });

  it("hab-block + a second run + the safe route lifts everyone (full evac)", () => {
    const vm = new QuestVM(evacuationScript, 1);
    vm.execute("dock_habblock"); // time 10, saved 14
    vm.execute("grab_more"); // time 7, saved 22
    vm.execute("route_safe"); // time 3
    advanceAuto(vm); // liftoff → lift_hero (saved >= 20)
    expect(vm.currentLocation().id).toBe("ending_full_evac");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(22);
    expect(vm.getParam("credits")).toBe(3000);
  });

  it("hab-block then an immediate lift-off saves most (partial)", () => {
    const vm = new QuestVM(evacuationScript, 1);
    vm.execute("dock_habblock"); // saved 14
    vm.execute("bug_out");
    advanceAuto(vm); // lift_most (10 <= saved < 20)
    expect(vm.currentLocation().id).toBe("ending_partial");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1500);
  });

  it("the VIP-only dock leaves with just a handful (few)", () => {
    const vm = new QuestVM(evacuationScript, 1);
    vm.execute("dock_vipdock"); // saved 4, +2000 credits, -15 rep
    vm.execute("bug_out");
    advanceAuto(vm); // lift_few
    expect(vm.currentLocation().id).toBe("ending_few");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(4);
    expect(vm.getParam("credits")).toBe(2500); // 2000 + 500
    expect(vm.getParam("rating")).toBe(85);
  });

  it("a snagged fast route burns the last of the window (collapse)", () => {
    const vm = new QuestVM(evacuationScript, 1);
    vm.execute("dock_medward"); // time 8, saved 8
    vm.execute("grab_more"); // time 5, saved 16
    vm.execute("route_fast"); // time 4, roll randomised
    vm.setParam("roll", 0); // force the debris hit
    advanceAuto(vm); // route_hit (time -> 0) → crit → ending_collapse
    expect(vm.currentLocation().id).toBe("ending_collapse");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("a clean fast route reaches lift-off in time", () => {
    const vm = new QuestVM(evacuationScript, 1);
    vm.execute("dock_habblock"); // time 10, saved 14
    vm.execute("grab_more"); // time 7, saved 22
    vm.execute("route_fast"); // time 6, roll randomised
    vm.setParam("roll", 9); // clean
    advanceAuto(vm); // route_clear → liftoff → lift_hero
    expect(vm.currentLocation().id).toBe("ending_full_evac");
    expect(vm.isSuccess()).toBe(true);
  });

  it("is deterministic for the same seed (fast route)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(evacuationScript, seed);
      const b = new QuestVM(evacuationScript, seed);
      a.execute("dock_habblock");
      a.execute("grab_more");
      a.execute("route_fast");
      advanceAuto(a);
      b.execute("dock_habblock");
      b.execute("grab_more");
      b.execute("route_fast");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("time")).toBe(b.getParam("time"));
    }
  });

  it("branches the second-run scene per dock chosen", () => {
    const med = new QuestVM(evacuationScript, 1);
    med.execute("dock_medward");
    const hab = new QuestVM(evacuationScript, 1);
    hab.execute("dock_habblock");
    const vip = new QuestVM(evacuationScript, 1);
    vip.execute("dock_vipdock");

    expect(med.currentLocation().id).toBe("second_run_med");
    expect(hab.currentLocation().id).toBe("second_run_hab");
    expect(vip.currentLocation().id).toBe("second_run_vip");

    const medText = med.currentLocationText();
    const habText = hab.currentLocationText();
    const vipText = vip.currentLocationText();
    expect(new Set([medText, habText, vipText]).size).toBe(3);
    for (const vm of [med, hab, vip]) {
      const ids = vm.availableTransitions().map((t) => t.id);
      expect(ids).toContain("grab_more");
      expect(ids).toContain("bug_out");
    }
  });

  it("narrates the fast-route roll with distinct clear/hit outcome scenes", () => {
    const clear = new QuestVM(evacuationScript, 1);
    clear.execute("dock_habblock"); // time 10, saved 14
    clear.execute("grab_more"); // time 7, saved 22
    clear.execute("route_fast"); // time 6, roll randomised
    clear.setParam("roll", 9); // clean run
    clear.execute("route_clear");
    expect(clear.currentLocation().id).toBe("route_clear_scene");
    const clearText = clear.currentLocationText();

    const hit = new QuestVM(evacuationScript, 1);
    hit.execute("dock_habblock"); // time 10, saved 14
    hit.execute("grab_more"); // time 7, saved 22
    hit.execute("route_fast"); // time 6, roll randomised
    hit.setParam("roll", 0); // snagged run (time 6 -> 2, no collapse)
    hit.execute("route_hit");
    expect(hit.currentLocation().id).toBe("route_hit_scene");
    expect(hit.getParam("time")).toBe(2);
    const hitText = hit.currentLocationText();

    expect(clearText.length).toBeGreaterThan(0);
    expect(hitText.length).toBeGreaterThan(0);
    expect(clearText).not.toBe(hitText);

    advanceAuto(clear);
    expect(clear.isSuccess()).toBe(true);
    advanceAuto(hit);
    expect(hit.isFinished()).toBe(true);
  });
});

describe("Locked-room whodunit quest", () => {
  it("starts at the crime scene with no clues and a 6-hour airlock clock", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    expect(vm.currentLocation().id).toBe("scene");
    expect(vm.getParam("clues")).toBe(0);
    expect(vm.getParam("time")).toBe(6);
  });

  it("a thorough sweep + cracking the medic yields an airtight conviction", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("sweep_lab"); // time 3, clues 3
    vm.execute("go_interrogate");
    vm.execute("press_suspect"); // time 1, roll randomised
    vm.setParam("roll", 9); // crack -> +2 clues
    advanceAuto(vm); // press_crack → accusation
    expect(vm.currentLocation().id).toBe("accusation");
    expect(vm.getParam("clues")).toBe(5);
    vm.execute("accuse_medic");
    advanceAuto(vm); // verdict_gate → convicted (clues >= 5)
    expect(vm.currentLocation().id).toBe("ending_solved");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(3000);
    expect(vm.getParam("rating")).toBe(130);
  });

  it("naming the right suspect without proof lets the killer walk (failure)", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("examine_body"); // clues 2
    vm.execute("go_interrogate");
    vm.execute("go_accuse");
    vm.execute("accuse_medic");
    advanceAuto(vm); // insufficient (clues 2 < 5) → ending_walks
    expect(vm.currentLocation().id).toBe("ending_walks");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(90);
  });

  it("accusing the wrong suspect condemns an innocent (failure)", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("sweep_lab");
    vm.execute("go_interrogate");
    vm.execute("go_accuse");
    vm.execute("accuse_engineer");
    expect(vm.currentLocation().id).toBe("ending_wrong");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(75);
  });

  it("dawdling over evidence lets the airlock open (escaped, failure)", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("sweep_lab"); // time 3
    vm.execute("gather_more"); // time 1, clues 5
    vm.execute("press_suspect"); // time -> -1 → crit → ending_escaped
    expect(vm.currentLocation().id).toBe("ending_escaped");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("is deterministic for the same seed (press path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(lockedRoomScript, seed);
      const b = new QuestVM(lockedRoomScript, seed);
      a.execute("examine_body");
      a.execute("go_interrogate");
      a.execute("press_suspect");
      advanceAuto(a);
      b.execute("examine_body");
      b.execute("go_interrogate");
      b.execute("press_suspect");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("clues")).toBe(b.getParam("clues"));
    }
  });

  it("cracking the medic shows its own confession beat before the accusation (D)", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("sweep_lab");
    vm.execute("go_interrogate");
    vm.execute("press_suspect");
    vm.setParam("roll", 9); // roll >= 4 → crack
    const first = vm.availableTransitions()[0];
    expect(first.autoExecute).toBe(true);
    vm.execute(first.id); // one step reveals the distinct cracked scene
    expect(vm.currentLocation().id).toBe("press_cracked");
    expect(vm.currentLocationText()).toContain("ломается");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("accusation");
  });

  it("stonewalling shows a distinct dead-end beat, not the same crack text (D)", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("sweep_lab");
    vm.execute("go_interrogate");
    vm.execute("press_suspect");
    vm.setParam("roll", 0); // roll < 4 → stonewall
    const first = vm.availableTransitions()[0];
    vm.execute(first.id);
    expect(vm.currentLocation().id).toBe("press_stonewalled");
    const stonewallText = vm.currentLocationText();
    expect(stonewallText).toContain("нечего вам сказать");

    const cracked = new QuestVM(lockedRoomScript, 1);
    cracked.execute("sweep_lab");
    cracked.execute("go_interrogate");
    cracked.execute("press_suspect");
    cracked.setParam("roll", 9);
    cracked.execute(cracked.availableTransitions()[0].id);
    expect(cracked.currentLocationText()).not.toBe(stonewallText);
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("accusation");
  });

  it("the verdict resolves through distinct success/fail beats (D)", () => {
    const win = new QuestVM(lockedRoomScript, 1);
    win.execute("sweep_lab");
    win.execute("go_interrogate");
    win.execute("press_suspect");
    win.setParam("roll", 9);
    advanceAuto(win); // → accusation, clues 5
    win.execute("accuse_medic");
    win.execute(win.availableTransitions()[0].id); // convicted → verdict_broken
    expect(win.currentLocation().id).toBe("verdict_broken");
    const brokenText = win.currentLocationText();
    advanceAuto(win);
    expect(win.currentLocation().id).toBe("ending_solved");

    const lose = new QuestVM(lockedRoomScript, 1);
    lose.execute("examine_body"); // clues 2 < 5
    lose.execute("go_interrogate");
    lose.execute("go_accuse");
    lose.execute("accuse_medic");
    lose.execute(lose.availableTransitions()[0].id); // insufficient → verdict_smirk
    expect(lose.currentLocation().id).toBe("verdict_smirk");
    expect(lose.currentLocationText()).not.toBe(brokenText);
    advanceAuto(lose);
    expect(lose.currentLocation().id).toBe("ending_walks");
  });

  it("gives each suspect more than one trait of characterization (H)", () => {
    const vm = new QuestVM(lockedRoomScript, 1);
    vm.execute("examine_body");
    vm.execute("go_interrogate");
    const text = vm.currentLocationText();
    expect(text).toContain("Инженер");
    expect(text).toContain("мозолистыми");
    expect(text).toContain("Связистка");
    expect(text).toContain("вздрагивает");
    expect(text).toContain("Медик");
    expect(text).toContain("слишком спокойный");
  });
});

describe("Life-support resource-allocation quest", () => {
  it("starts at the breach with a 10-unit air reserve and nobody saved", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    expect(vm.currentLocation().id).toBe("scene");
    expect(vm.getParam("oxygen")).toBe(10);
    expect(vm.getParam("saved")).toBe(0);
  });

  it("hold first + a lucky scrubber restart saves everyone", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_hold"); // oxygen 4, saved 6
    vm.execute("fix_scrubber"); // oxygen 3, roll randomised
    vm.setParam("roll", 9); // scrubber comes back: +5
    advanceAuto(vm); // scrub_ok → final_seal
    expect(vm.currentLocation().id).toBe("final_seal");
    expect(vm.getParam("oxygen")).toBe(8);
    vm.execute("save_last"); // oxygen 3, saved 12
    advanceAuto(vm); // tally_all (saved >= 10)
    expect(vm.currentLocation().id).toBe("ending_all_survive");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(12);
    expect(vm.getParam("credits")).toBe(3000);
  });

  it("bridge first, conserve, then save the last section saves most", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_bridge"); // oxygen 7, saved 2
    vm.execute("skip_repair");
    vm.execute("save_last"); // oxygen 2, saved 8
    advanceAuto(vm); // tally_most (6 <= saved < 10)
    expect(vm.currentLocation().id).toBe("ending_most");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1500);
  });

  it("sealing the last section off saves only a few but guarantees them", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_eng"); // oxygen 8, saved 2
    vm.execute("skip_repair");
    vm.execute("seal_last"); // -10 rep, nobody added
    advanceAuto(vm); // tally_few (saved < 6)
    expect(vm.currentLocation().id).toBe("ending_few");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(2);
    expect(vm.getParam("rating")).toBe(90);
  });

  it("over-spending the reserve blows the remaining sections (suffocate, failure)", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_hold"); // oxygen 4, saved 6
    vm.execute("skip_repair");
    vm.execute("save_last"); // oxygen -1 → crit → ending_suffocate
    expect(vm.currentLocation().id).toBe("ending_suffocate");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("a failed scrubber restart makes things worse", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_bridge"); // oxygen 7
    vm.execute("fix_scrubber"); // oxygen 6, roll randomised
    vm.setParam("roll", 0); // scrubber fails: -2
    advanceAuto(vm); // scrub_fail → final_seal
    expect(vm.currentLocation().id).toBe("final_seal");
    expect(vm.getParam("oxygen")).toBe(4);
  });

  it("(A) a lucky medbay patch saves four for almost no air", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_medbay"); // oxygen 8, roll randomised
    vm.setParam("roll", 9); // patch holds
    advanceAuto(vm); // medbay_ok → medbay_held → allocate2
    expect(vm.currentLocation().id).toBe("allocate2");
    expect(vm.getParam("saved")).toBe(4);
    expect(vm.getParam("oxygen")).toBe(8); // only the -2 attempt cost
  });

  it("(A) a blown medbay patch wastes air on a single soul", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_medbay"); // oxygen 8, roll randomised
    vm.setParam("roll", 0); // patch tears loose
    advanceAuto(vm); // medbay_fail → medbay_blown → allocate2
    expect(vm.currentLocation().id).toBe("allocate2");
    expect(vm.getParam("saved")).toBe(1);
    expect(vm.getParam("oxygen")).toBe(6); // -2 attempt, -2 vent
  });

  it("(A) the medbay roll router always fires exactly one branch", () => {
    const medbay = lifeSupportScript.locations.find(
      (l) => l.id === "medbay_check",
    )!;
    expect(medbay.transitions.some((t) => t.condition === "roll >= 5")).toBe(
      true,
    );
    expect(medbay.transitions.some((t) => !t.condition)).toBe(true);
  });

  it("(D) a lucky scrubber restart shows a distinct 'restored' beat", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_hold"); // oxygen 4, saved 6
    vm.execute("fix_scrubber"); // oxygen 3, roll randomised
    vm.setParam("roll", 7);
    expect(vm.availableTransitions()[0].id).toBe("scrub_ok");
    vm.execute("scrub_ok");
    expect(vm.currentLocation().id).toBe("scrubber_restored");
    advanceAuto(vm); // beat auto-advances on to final_seal
    expect(vm.currentLocation().id).toBe("final_seal");
  });

  it("(D) a failed scrubber restart shows a distinct 'dead' beat", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_bridge"); // oxygen 7
    vm.execute("fix_scrubber"); // oxygen 6, roll randomised
    vm.setParam("roll", 1);
    expect(vm.availableTransitions()[0].id).toBe("scrub_fail");
    vm.execute("scrub_fail");
    expect(vm.currentLocation().id).toBe("scrubber_dead");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("final_seal");
  });

  it("(D) the scrubber-outcome beats carry real prose, not a '...' placeholder", () => {
    for (const id of ["scrubber_restored", "scrubber_dead"]) {
      const loc = lifeSupportScript.locations.find((l) => l.id === id)!;
      const text = loc.text as string;
      expect(text).not.toBe("...");
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it("(G) the scrubber-restart label discloses the failure penalty", () => {
    const alloc = lifeSupportScript.locations.find(
      (l) => l.id === "allocate2",
    )!;
    const fix = alloc.transitions.find((t) => t.id === "fix_scrubber")!;
    expect(fix.label).toContain("−2"); // failure sting is now stated
    expect(fix.label).toContain("+5");
    expect(fix.label).toContain("−1");
  });

  it("(B) saving a fair handful (4-5) reaches a distinct 'few_more' ending", () => {
    const vm = new QuestVM(lifeSupportScript, 1);
    vm.execute("air_medbay");
    vm.setParam("roll", 9); // patch holds → saved 4
    advanceAuto(vm); // → allocate2
    expect(vm.getParam("saved")).toBe(4);
    vm.execute("skip_repair");
    vm.execute("seal_last"); // saved stays 4
    advanceAuto(vm); // tally_some → ending_few_more
    expect(vm.currentLocation().id).toBe("ending_few_more");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(4);
  });

  it("(B) the 4-5 ending prose differs from the <4 handful ending", () => {
    const fewMore = lifeSupportScript.locations.find(
      (l) => l.id === "ending_few_more",
    )!.text as string;
    const few = lifeSupportScript.locations.find((l) => l.id === "ending_few")!
      .text as string;
    expect(fewMore).not.toBe(few);
  });
});

describe("Boarding-standoff negotiation quest", () => {
  it("starts at the airlock with low tension and no leverage", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    expect(vm.currentLocation().id).toBe("airlock");
    expect(vm.getParam("tension")).toBe(3);
    expect(vm.getParam("leverage")).toBe(0);
  });

  it("stalling for info then buying them off lands a fair deal (negotiated)", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    vm.execute("stall_talk"); // tension 4, leverage 2
    vm.execute("offer_cargo"); // -2000, tension 2, leverage 4
    vm.execute("talk_down");
    advanceAuto(vm); // deal_struck (leverage >= 4)
    expect(vm.currentLocation().id).toBe("ending_negotiated");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(-1000); // -2000 + 1000
    expect(vm.getParam("rating")).toBe(120);
  });

  it("a bluff that lands earns a grudging retreat (bought off)", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    vm.execute("hands_up"); // tension 2
    vm.execute("bluff_backup"); // roll randomised
    vm.setParam("roll", 8); // bluff lands: +3 leverage
    advanceAuto(vm); // bluff_lands → resolve
    expect(vm.currentLocation().id).toBe("resolve");
    vm.execute("talk_down");
    advanceAuto(vm); // grudging_exit (2 <= leverage < 4)
    expect(vm.currentLocation().id).toBe("ending_bought_off");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("rating")).toBe(105);
  });

  it("no leverage means you get robbed but spared (success)", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    vm.execute("hands_up"); // tension 2
    vm.execute("defiance"); // tension 5, leverage 1
    vm.execute("talk_down");
    advanceAuto(vm); // forced_tribute (leverage < 2)
    expect(vm.currentLocation().id).toBe("ending_robbed");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(-1000);
    expect(vm.getParam("rating")).toBe(95);
  });

  it("drawing first gets you killed (bloodbath, failure)", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    vm.execute("hands_up");
    vm.execute("offer_cargo");
    vm.execute("pull_trigger");
    expect(vm.currentLocation().id).toBe("ending_bloodbath");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(80);
  });

  it("letting tension boil over triggers a shoot-out (firefight, failure)", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    vm.execute("draw_weapon"); // tension 7
    vm.execute("defiance"); // tension 10 > 9 → crit → ending_firefight
    expect(vm.currentLocation().id).toBe("ending_firefight");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("is deterministic for the same seed (bluff path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(boardingStandoffScript, seed);
      const b = new QuestVM(boardingStandoffScript, seed);
      a.execute("stall_talk");
      a.execute("bluff_backup");
      advanceAuto(a);
      b.execute("stall_talk");
      b.execute("bluff_backup");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("leverage")).toBe(b.getParam("leverage"));
    }
  });

  it("the resolve scene branches by how the standoff got there (Task 16, B)", () => {
    const paid = new QuestVM(boardingStandoffScript, 1);
    paid.execute("hands_up");
    paid.execute("offer_cargo");
    expect(paid.currentLocation().id).toBe("resolve_paid");

    const defiant = new QuestVM(boardingStandoffScript, 1);
    defiant.execute("hands_up");
    defiant.execute("defiance");
    expect(defiant.currentLocation().id).toBe("resolve_defiant");

    const bluffed = new QuestVM(boardingStandoffScript, 1);
    bluffed.execute("hands_up");
    bluffed.execute("bluff_backup");
    bluffed.setParam("roll", 8);
    advanceAuto(bluffed); // bluff_lands → resolve
    expect(bluffed.currentLocation().id).toBe("resolve");

    const texts = [
      paid.currentLocation().text,
      defiant.currentLocation().text,
      bluffed.currentLocation().text,
    ] as string[];
    expect(new Set(texts).size).toBe(3);
  });

  it("each branched resolve node still offers talk_down and pull_trigger (Task 16)", () => {
    for (const id of ["resolve", "resolve_paid", "resolve_defiant"]) {
      const loc = boardingStandoffScript.locations.find((l) => l.id === id)!;
      const ids = loc.transitions.map((t) => t.id).sort();
      expect(ids).toEqual(["pull_trigger", "talk_down"]);
    }
  });

  it("the paid-off resolve path still reaches a negotiated deal (Task 16)", () => {
    const vm = new QuestVM(boardingStandoffScript, 1);
    vm.execute("stall_talk"); // leverage 2
    vm.execute("offer_cargo"); // leverage 4 → resolve_paid
    expect(vm.currentLocation().id).toBe("resolve_paid");
    vm.execute("talk_down");
    advanceAuto(vm);
    expect(vm.currentLocation().id).toBe("ending_negotiated");
    expect(vm.isSuccess()).toBe(true);
  });

  it("choice labels use qualitative risk language, not exact numeric deltas (Task 16, G)", () => {
    for (const id of ["airlock", "parley"]) {
      const loc = boardingStandoffScript.locations.find((l) => l.id === id)!;
      for (const t of loc.transitions) {
        expect(
          t.label,
          `${id}/${t.id} label still prints a number`,
        ).not.toMatch(/\d/);
      }
    }
  });

  it("the negotiated ending no longer promises wealth at a negative balance (Task 16, C)", () => {
    const end = boardingStandoffScript.locations.find(
      (l) => l.id === "ending_negotiated",
    )!;
    const text = end.text as string;
    expect(text).not.toContain("щедрую");
    expect(text).not.toContain("при деньгах");
  });
});

const NEW_IDS = [
  "evacuation",
  "locked-room",
  "life-support",
  "boarding-standoff",
];

function sys(id: string, name: string, toIds: string[]): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
  } as unknown as StarSystem;
}

function galaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B", "C"]),
    sys("B", "Бета", ["A", "C", "D"]),
    sys("C", "Гамма", ["A", "B", "E"]),
    sys("D", "Дельта", ["B", "F"]),
    sys("E", "Эпсилон", ["C", "F"]),
    sys("F", "Фи", ["D", "E"]),
  ];
}

function boardOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: galaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "batch1-seed",
    ...over,
  };
}

describe("Batch 1 registry + board integration", () => {
  it("registers all four new scripts and keeps ids unique", () => {
    const ids = ALL_QUEST_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_QUEST_SCRIPTS.length).toBeGreaterThanOrEqual(16);
    for (const id of NEW_IDS) {
      expect(ids).toContain(id);
      expect(getQuestScript(id)?.id).toBe(id);
    }
  });

  it("makes every new script eligible for the TEXT_ADVENTURE board slot", () => {
    const seen = new Set<string>();
    const rng = new SeededRNG("board-draws");
    for (let i = 0; i < 2000; i++) {
      const script =
        ALL_QUEST_SCRIPTS[rng.nextInt(0, ALL_QUEST_SCRIPTS.length - 1)];
      seen.add(script.id);
    }
    for (const id of NEW_IDS) expect(seen.has(id)).toBe(true);
  });

  it("issues resolvable, deduped text quests across many boards", () => {
    const issuedScriptIds = new Set<string>();
    for (let day = 0; day < 400; day++) {
      const board = generateQuestBoard(
        boardOpts({ day, count: 5, textRatio: 1, excludeKeys: [] }),
      );
      const textQuests = board.filter(
        (q) => q.template.type === QuestType.TEXT_ADVENTURE,
      );
      for (const q of textQuests) {
        const scriptId = q.template.targetObjectId;
        expect(scriptId).toBeTruthy();
        expect(getQuestScript(scriptId as string)).toBeDefined();
        issuedScriptIds.add(scriptId as string);
      }
      const keys = textQuests.map(questKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
    for (const id of NEW_IDS) expect(issuedScriptIds.has(id)).toBe(true);
  });
});
