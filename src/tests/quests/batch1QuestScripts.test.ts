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

// Task 14 — batch 1 of new branching text-quests. Four distinct puzzle genres:
//   evacuation       — logistics routing under a draining evac window
//   locked-room      — deduction/whodunit under an airlock clock
//   life-support     — resource optimisation against a fixed oxygen budget
//   boarding-standoff — negotiation under pressure (tension + leverage)
// The parametrised graph suite (questScriptGraph.test.ts) already re-checks the
// structural invariants over the whole registry; here we drive the best / worst
// / mixed paths per script so every branch reaches its intended terminal with
// the right rewards, and verify board issuance + dedup.

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
});

// ---------------------------------------------------------------------------
// Registry + board integration
// ---------------------------------------------------------------------------

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
    // Mirror buildTextQuest's exact selection (uniform over ALL_QUEST_SCRIPTS);
    // over enough draws every registered script — including the new four — is
    // reachable, so the board can issue them.
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
      // Every text quest's script id must resolve via the registry.
      for (const q of textQuests) {
        const scriptId = q.template.targetObjectId;
        expect(scriptId).toBeTruthy();
        expect(getQuestScript(scriptId as string)).toBeDefined();
        issuedScriptIds.add(scriptId as string);
      }
      // Dedup holds: a single board never repeats the same script (its questKey
      // is TEXT|<scriptId>, so duplicates would collapse).
      const keys = textQuests.map(questKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
    // The new scripts actually surface on real boards over the horizon.
    for (const id of NEW_IDS) expect(issuedScriptIds.has(id)).toBe(true);
  });
});
