import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import {
  ALL_QUEST_SCRIPTS,
  getQuestScript,
} from "@/systems/quests/TextQuestRegistry";
import { signalDecodeScript } from "@/systems/quests/scripts/signal-decode";
import { orbitalEscapeScript } from "@/systems/quests/scripts/orbital-escape";
import { tribunalScript } from "@/systems/quests/scripts/tribunal";
import { quarantineScript } from "@/systems/quests/scripts/quarantine";
import {
  generateQuestBoard,
  questKey,
  type BoardOptions,
} from "@/systems/quests/QuestGenerator";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";

// Task 15 — batch 2 of new branching text-quests. Four distinct puzzle genres,
// none repeating batch 1 (logistics / whodunit / resource-opt / negotiation):
//   signal-decode  — cryptanalysis under a decoder-power budget
//   orbital-escape — orbital burn-scheduling against a decaying orbit
//   tribunal       — courtroom defense (defense vs the judge's hostility)
//   quarantine     — containment dilemma (containment + panic vs saved)
// The parametrised graph suite (questScriptGraph.test.ts) re-checks structural
// invariants over the whole registry; here we drive the best / worst / mixed
// paths per script so every branch reaches its intended terminal with the right
// rewards, and verify board issuance + dedup.

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

describe("Signal-decode quest (cryptanalysis)", () => {
  it("starts intercepting with a full clarity-zero read and an 8-charge decoder", () => {
    const vm = new QuestVM(signalDecodeScript, 1);
    expect(vm.currentLocation().id).toBe("intercept");
    expect(vm.getParam("power")).toBe(8);
    expect(vm.getParam("clarity")).toBe(0);
  });

  it("efficient pattern-analysis + a clean filter fully decodes the message", () => {
    const vm = new QuestVM(signalDecodeScript, 1);
    vm.execute("analyze_pattern"); // power 6, clarity 4
    vm.execute("clean_filter"); // power 4, clarity 8
    advanceAuto(vm); // interpret -> read_full (clarity >= 8)
    expect(vm.currentLocation().id).toBe("ending_decoded");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("clarity")).toBe(8);
    expect(vm.getParam("credits")).toBe(3000);
    expect(vm.getParam("rating")).toBe(120);
  });

  it("locking early on a thin read recovers only the coords (partial)", () => {
    const vm = new QuestVM(signalDecodeScript, 1);
    vm.execute("analyze_pattern"); // clarity 4
    vm.execute("quick_lock");
    advanceAuto(vm); // read_part (4 <= clarity < 8)
    expect(vm.currentLocation().id).toBe("ending_partial");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1200);
  });

  it("too little clarity leaves nothing usable (garbled, failure)", () => {
    const vm = new QuestVM(signalDecodeScript, 1);
    vm.execute("cross_ref"); // clarity 3
    vm.execute("quick_lock");
    advanceAuto(vm); // read_none (clarity < 4)
    expect(vm.currentLocation().id).toBe("ending_garbled");
    expect(vm.isSuccess()).toBe(false);
  });

  it("draining the decoder mid-read loses the signal (failure)", () => {
    const vm = new QuestVM(signalDecodeScript, 1);
    vm.execute("brute_force"); // power 3, clarity 5
    vm.execute("overclock"); // power 2, roll randomised
    vm.setParam("roll", 0); // overheat: -2 power -> 0
    advanceAuto(vm); // oc_bad -> power 0 < 1 -> crit
    expect(vm.currentLocation().id).toBe("ending_signal_lost");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("a lucky overclock pushes a thin read over the line (decoded)", () => {
    const vm = new QuestVM(signalDecodeScript, 1);
    vm.execute("analyze_pattern"); // clarity 4, power 6
    vm.execute("overclock"); // power 5, roll randomised
    vm.setParam("roll", 9); // clean lock: +5 clarity -> 9
    advanceAuto(vm); // oc_good -> read_full
    expect(vm.currentLocation().id).toBe("ending_decoded");
    expect(vm.isSuccess()).toBe(true);
  });

  it("is deterministic for the same seed (overclock path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(signalDecodeScript, seed);
      const b = new QuestVM(signalDecodeScript, seed);
      a.execute("analyze_pattern");
      a.execute("overclock");
      advanceAuto(a);
      b.execute("analyze_pattern");
      b.execute("overclock");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("clarity")).toBe(b.getParam("clarity"));
    }
  });
});

describe("Orbital-escape quest (burn scheduling)", () => {
  it("starts caught in a decaying orbit with altitude 5 and full fuel", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    expect(vm.currentLocation().id).toBe("caught");
    expect(vm.getParam("altitude")).toBe(5);
    expect(vm.getParam("fuel")).toBe(10);
  });

  it("an efficient periapsis burn + a trim burn breaks clean (escaped)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("burn_periapsis"); // altitude 10, fuel 6
    vm.execute("trim_burn"); // altitude 14, fuel 3
    advanceAuto(vm); // gate_clean (altitude >= 10)
    expect(vm.currentLocation().id).toBe("ending_escaped");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("altitude")).toBe(14);
    expect(vm.getParam("credits")).toBe(2500);
    expect(vm.getParam("rating")).toBe(115);
  });

  it("coasting on a single hard burn scrapes free (grazing)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("burn_periapsis"); // altitude 10
    vm.execute("hold_coast"); // altitude 7
    advanceAuto(vm); // gate_graze (altitude 7)
    expect(vm.currentLocation().id).toBe("ending_grazing");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1000);
  });

  it("a wasteful burn then a coast falls short of escape (stranded, failure)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("burn_now"); // altitude 8, fuel 4
    vm.execute("hold_coast"); // altitude 5
    advanceAuto(vm); // gate_low (altitude < 7)
    expect(vm.currentLocation().id).toBe("ending_stranded");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("altitude")).toBe(5);
  });

  it("scanning first then coasting lets the orbit decay into burn-up (failure)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("steady_scan"); // altitude 3
    vm.execute("hold_coast"); // altitude 0 < 1 -> crit
    expect(vm.currentLocation().id).toBe("ending_burnup");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("a good ballast dump can substitute for a burn (escaped)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("burn_now"); // altitude 8, fuel 4
    vm.execute("dump_ballast"); // roll randomised
    vm.setParam("roll", 9); // clean jettison: +3 altitude, -800 cr
    advanceAuto(vm); // dump_good -> gate_clean (altitude 11)
    expect(vm.currentLocation().id).toBe("ending_escaped");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1700); // -800 + 2500
  });

  it("is deterministic for the same seed (ballast path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(orbitalEscapeScript, seed);
      const b = new QuestVM(orbitalEscapeScript, seed);
      a.execute("burn_now");
      a.execute("dump_ballast");
      advanceAuto(a);
      b.execute("burn_now");
      b.execute("dump_ballast");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("altitude")).toBe(b.getParam("altitude"));
    }
  });

  // Task 27 — trim_burn was strictly dominant (always available, free, best).
  // It is now gated on a conserved fuel reserve, so the wasteful first burn
  // locks it out and forces the fuel-free endgame.
  it("the trim burn is gated on a conserved fuel reserve, not a free universal button (A)", () => {
    const efficient = new QuestVM(orbitalEscapeScript, 1);
    efficient.execute("burn_periapsis"); // fuel 6 — reserve intact
    expect(efficient.availableTransitions().map((t) => t.id)).toContain(
      "trim_burn",
    );

    const wasteful = new QuestVM(orbitalEscapeScript, 1);
    wasteful.execute("burn_now"); // fuel 4 — reserve spent
    const ids = wasteful.availableTransitions().map((t) => t.id);
    expect(ids).not.toContain("trim_burn");
    // the fuel-starved line is never a dead end: the fuel-free options remain
    expect(ids).toEqual(
      expect.arrayContaining(["plasma_vent", "dump_ballast", "hold_coast"]),
    );
  });

  it("a clean ballast dump and a jammed hatch narrate distinct outcomes (D)", () => {
    const good = new QuestVM(orbitalEscapeScript, 1);
    good.execute("burn_now");
    good.execute("dump_ballast");
    good.setParam("roll", 9); // clean jettison
    good.execute("dump_good");
    expect(good.currentLocation().id).toBe("dump_freed");

    const bad = new QuestVM(orbitalEscapeScript, 1);
    bad.execute("burn_now");
    bad.execute("dump_ballast");
    bad.setParam("roll", 0); // jammed hatch
    bad.execute("dump_bad");
    expect(bad.currentLocation().id).toBe("dump_jammed");

    // the roll now has its own success/fail narrative, not a silent "..." jump
    expect(good.currentLocation().text).not.toBe(bad.currentLocation().text);
    expect(good.currentLocation().text).not.toBe("...");
    expect(bad.currentLocation().text).not.toBe("...");

    // both funnel back through the escape gate to a real terminal
    advanceAuto(good);
    advanceAuto(bad);
    expect(good.isFinished()).toBe(true);
    expect(bad.isFinished()).toBe(true);
  });

  it("a clean plasma vent gives a fuel-free shove to a clean escape (A/D)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("burn_now"); // altitude 8, fuel 4
    const fuelBefore = vm.getParam("fuel");
    vm.execute("plasma_vent");
    vm.setParam("roll", 9); // coil holds: +5 altitude
    vm.execute("vent_ok");
    expect(vm.currentLocation().id).toBe("vent_surge");
    expect(vm.getParam("fuel")).toBe(fuelBefore); // vent burns no fuel
    advanceAuto(vm); // -> escape_gate -> gate_clean (altitude 13)
    expect(vm.currentLocation().id).toBe("ending_escaped");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("altitude")).toBe(13);
  });

  it("a shorted plasma vent knocks the ship back down (the gamble's real downside) (A/D)", () => {
    const vm = new QuestVM(orbitalEscapeScript, 1);
    vm.execute("burn_now"); // altitude 8
    vm.execute("plasma_vent");
    vm.setParam("roll", 0); // coil shorts: -3 altitude
    vm.execute("vent_bad");
    expect(vm.currentLocation().id).toBe("vent_misfire");
    expect(vm.getParam("altitude")).toBe(5);
    advanceAuto(vm); // -> escape_gate -> gate_low (altitude 5 < 7)
    expect(vm.currentLocation().id).toBe("ending_stranded");
    expect(vm.isSuccess()).toBe(false);
  });

  it("orbital control is on comms through the coast, not only at the ending (H)", () => {
    const coast = orbitalEscapeScript.locations.find((l) => l.id === "coast")!;
    const text =
      typeof coast.text === "string" ? coast.text : coast.text.join(" ");
    expect(text).toContain("диспетчер");
  });

  it("is deterministic for the same seed (plasma vent path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(orbitalEscapeScript, seed);
      const b = new QuestVM(orbitalEscapeScript, seed);
      a.execute("burn_now");
      a.execute("plasma_vent");
      advanceAuto(a);
      b.execute("burn_now");
      b.execute("plasma_vent");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("altitude")).toBe(b.getParam("altitude"));
    }
  });
});

describe("Tribunal quest (courtroom defense)", () => {
  it("starts at arraignment with no defense and a wary bench", () => {
    const vm = new QuestVM(tribunalScript, 1);
    expect(vm.currentLocation().id).toBe("arraignment");
    expect(vm.getParam("defense")).toBe(0);
    expect(vm.getParam("hostility")).toBe(4);
  });

  it("a strong case that stays just short of contempt wins acquittal", () => {
    const vm = new QuestVM(tribunalScript, 1);
    vm.execute("plea_defiant"); // defense 3, hostility 7
    vm.execute("table_manifest"); // defense 6, hostility 8
    vm.execute("closing_appeal"); // defense 8
    advanceAuto(vm); // verdict_acquit (defense >= 8)
    expect(vm.currentLocation().id).toBe("ending_acquitted");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(3000);
    expect(vm.getParam("rating")).toBe(125);
  });

  it("a modest case earns a fine but not a conviction (lenient)", () => {
    const vm = new QuestVM(tribunalScript, 1);
    vm.execute("plea_evidence"); // defense 2
    vm.execute("concede_point"); // hostility 3
    vm.execute("closing_appeal"); // defense 4
    advanceAuto(vm); // verdict_lenient (4 <= defense < 8)
    expect(vm.currentLocation().id).toBe("ending_lenient");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(500);
  });

  it("a weak defense is convicted (guilty, failure)", () => {
    const vm = new QuestVM(tribunalScript, 1);
    vm.execute("plea_contrite"); // defense 1, hostility 2
    vm.execute("concede_point"); // hostility 1
    vm.execute("closing_mercy"); // defense still 1
    advanceAuto(vm); // verdict_guilty (defense < 4)
    expect(vm.currentLocation().id).toBe("ending_guilty");
    expect(vm.isSuccess()).toBe(false);
    expect(vm.getParam("rating")).toBe(80);
  });

  it("inflaming the judge past breaking gets you held in contempt (failure)", () => {
    const vm = new QuestVM(tribunalScript, 1);
    vm.execute("plea_defiant"); // hostility 7
    vm.execute("discredit_witness"); // roll randomised
    vm.setParam("roll", 0); // backfires: +3 hostility -> 10 > 9
    advanceAuto(vm); // discredit_bad -> crit
    expect(vm.currentLocation().id).toBe("ending_contempt");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("a brilliant grandstand can clinch an acquittal", () => {
    const vm = new QuestVM(tribunalScript, 1);
    vm.execute("plea_evidence"); // defense 2
    vm.execute("table_manifest"); // defense 5, hostility 5
    vm.execute("grandstand"); // roll randomised
    vm.setParam("roll", 9); // lands: +5 defense -> 10
    advanceAuto(vm); // grand_ok -> verdict_acquit
    expect(vm.currentLocation().id).toBe("ending_acquitted");
    expect(vm.isSuccess()).toBe(true);
  });

  it("is deterministic for the same seed (discredit path)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = new QuestVM(tribunalScript, seed);
      const b = new QuestVM(tribunalScript, seed);
      a.execute("plea_evidence");
      a.execute("discredit_witness");
      advanceAuto(a);
      b.execute("plea_evidence");
      b.execute("discredit_witness");
      advanceAuto(b);
      expect(a.currentLocation().id).toBe(b.currentLocation().id);
      expect(a.getParam("hostility")).toBe(b.getParam("hostility"));
    }
  });
});

describe("Quarantine quest (containment dilemma)", () => {
  it("starts at the alert with the seal intact and low panic", () => {
    const vm = new QuestVM(quarantineScript, 1);
    expect(vm.currentLocation().id).toBe("alert");
    expect(vm.getParam("containment")).toBe(8);
    expect(vm.getParam("panic")).toBe(3);
    expect(vm.getParam("saved")).toBe(0);
  });

  it("screening + a medic push + holding the seals saves the most (contained)", () => {
    const vm = new QuestVM(quarantineScript, 1);
    vm.execute("screen_all"); // containment 6, saved 6
    vm.execute("treat_infected"); // containment 3, saved 12, panic 4
    vm.execute("hold_seals"); // containment 5
    advanceAuto(vm); // gate_full (saved >= 12)
    expect(vm.currentLocation().id).toBe("ending_contained");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(12);
    expect(vm.getParam("credits")).toBe(3000);
    expect(vm.getParam("rating")).toBe(125);
  });

  it("a cautious remote-treat run saves most at a hard toll (partial)", () => {
    const vm = new QuestVM(quarantineScript, 1);
    vm.execute("screen_all"); // containment 6, saved 6
    vm.execute("isolate_ward"); // containment 8, saved 8
    vm.execute("hold_seals"); // containment 10
    advanceAuto(vm); // gate_partial (6 <= saved < 12)
    expect(vm.currentLocation().id).toBe("ending_partial");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("credits")).toBe(1200);
  });

  it("purging the sector seals the station but saves only a few (grim)", () => {
    const vm = new QuestVM(quarantineScript, 1);
    vm.execute("seal_hard"); // containment 11, panic 5, saved 2
    vm.execute("isolate_ward"); // containment 13, saved 4
    vm.execute("purge_section"); // containment 18, -15 rating
    advanceAuto(vm); // gate_grim (saved < 6)
    expect(vm.currentLocation().id).toBe("ending_grim");
    expect(vm.isSuccess()).toBe(true);
    expect(vm.getParam("saved")).toBe(4);
    expect(vm.getParam("rating")).toBe(85);
  });

  it("breaking the seal for one evac too many lets the virus out (outbreak, failure)", () => {
    const vm = new QuestVM(quarantineScript, 1);
    vm.execute("screen_all"); // containment 6, saved 6
    vm.execute("treat_infected"); // containment 3, saved 12
    vm.execute("last_evac"); // containment -1 < 1 -> crit
    expect(vm.currentLocation().id).toBe("ending_outbreak");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("letting panic boil over tears the quarantine open (riot, failure)", () => {
    const vm = new QuestVM(quarantineScript, 1);
    vm.execute("seal_hard"); // panic 5
    vm.execute("request_help"); // roll randomised
    vm.setParam("roll", 0); // help delayed: +5 panic -> 10 > 9
    advanceAuto(vm); // help_delayed -> crit
    expect(vm.currentLocation().id).toBe("ending_riot");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("a med-frigate arriving in time bolsters the save count", () => {
    const vm = new QuestVM(quarantineScript, 1);
    vm.execute("calm_broadcast"); // panic 1
    vm.execute("request_help"); // roll randomised
    vm.setParam("roll", 9); // arrives: +8 saved, +1 containment
    advanceAuto(vm); // help_arrives -> final_call (manual)
    expect(vm.currentLocation().id).toBe("final_call");
    expect(vm.getParam("saved")).toBe(8);
    vm.execute("hold_seals"); // containment 11
    advanceAuto(vm); // gate_partial (saved 8)
    expect(vm.currentLocation().id).toBe("ending_partial");
    expect(vm.isSuccess()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry + board integration
// ---------------------------------------------------------------------------

const NEW_IDS = ["signal-decode", "orbital-escape", "tribunal", "quarantine"];

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
    seed: "batch2-seed",
    ...over,
  };
}

describe("Batch 2 registry + board integration", () => {
  it("registers all four new scripts and keeps ids unique", () => {
    const ids = ALL_QUEST_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_QUEST_SCRIPTS.length).toBeGreaterThanOrEqual(20);
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
    const rng = new SeededRNG("board-draws-2");
    for (let i = 0; i < 3000; i++) {
      const script =
        ALL_QUEST_SCRIPTS[rng.nextInt(0, ALL_QUEST_SCRIPTS.length - 1)];
      seen.add(script.id);
    }
    for (const id of NEW_IDS) expect(seen.has(id)).toBe(true);
  });

  it("issues resolvable, deduped text quests across many boards", () => {
    const issuedScriptIds = new Set<string>();
    for (let day = 0; day < 600; day++) {
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
      // Dedup holds: a single board never repeats the same script (its questKey
      // is TEXT|<scriptId>, so duplicates would collapse).
      const keys = textQuests.map(questKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
    // The new scripts actually surface on real boards over the horizon.
    for (const id of NEW_IDS) expect(issuedScriptIds.has(id)).toBe(true);
  });
});
