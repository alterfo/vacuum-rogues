import { describe, it, expect } from "vitest";
import { Inventory } from "@/domain/Inventory";
import type { Player } from "@/domain/Player";
import { Faction } from "@/types/faction";
import { ResourceType } from "@/types";
import {
  applyEncounterOutcome,
  encounterPlayerStateFor,
  encounterSystemDanger,
  encounterSystemView,
  rescueBeneficiaryFaction,
  type EncounterGalaxyView,
} from "@/systems/encounters/encounterFlight";
import type { Encounter } from "@/systems/encounters/encounterGenerator";
import type { EncounterOutcome } from "@/systems/encounters/encounterOutcome";

/** A minimal galaxy view with the three systems the helper reads. */
function fakeGalaxy(opts: {
  overmind?: string[];
  pirate?: string[];
  systems?: { id: string; ownerFaction: Faction }[];
}): EncounterGalaxyView {
  const overmind = new Set(opts.overmind ?? []);
  const pirate = new Set(opts.pirate ?? []);
  return {
    isOvermindSystem: (id) => overmind.has(id),
    isPirateSystem: (id) => pirate.has(id),
    systems: opts.systems ?? [],
  };
}

/** A lightweight Player stand-in — applyEncounterOutcome only touches these. */
function fakePlayer(level = 1, credits = 1000): Player {
  const reputation: Record<string, number> = {};
  return {
    credits,
    level,
    reputation,
    inventory: new Inventory(),
    getReputation(f: string) {
      return reputation[f] ?? 0;
    },
    adjustReputation(f: string, d: number) {
      reputation[f] = (reputation[f] ?? 0) + d;
    },
    get currentAccountId() {
      return "cur:test";
    },
  } as unknown as Player;
}

function makeEncounter(systemId: string): Encounter {
  return {
    id: `enc:${systemId}:1`,
    type: "derelict",
    systemId,
    danger: 0.2,
    rewardScale: 1,
  };
}

describe("encounterSystemDanger", () => {
  it("maps overmind > pirate > safe to 1 / 0.6 / 0", () => {
    const galaxy = fakeGalaxy({ overmind: ["o"], pirate: ["p"] });
    expect(encounterSystemDanger(galaxy, "o")).toBe(1);
    expect(encounterSystemDanger(galaxy, "p")).toBe(0.6);
    expect(encounterSystemDanger(galaxy, "safe")).toBe(0);
  });

  it("projects a system view carrying that danger", () => {
    const galaxy = fakeGalaxy({ pirate: ["p"] });
    expect(encounterSystemView(galaxy, "p")).toEqual({ id: "p", danger: 0.6 });
  });
});

describe("encounterPlayerStateFor", () => {
  it("reads level (floored at 1) and pirate reputation", () => {
    const player = fakePlayer(4);
    player.adjustReputation("PIRATE", -20);
    const state = encounterPlayerStateFor(player);
    expect(state.level).toBe(4);
    expect(state.pirateRep).toBe(-20);
  });
});

describe("rescueBeneficiaryFaction", () => {
  it("returns the system owner when it is a lawful faction", () => {
    const galaxy = fakeGalaxy({
      systems: [{ id: "s", ownerFaction: Faction.BASTIONS }],
    });
    expect(rescueBeneficiaryFaction(galaxy, "s")).toBe(Faction.BASTIONS);
  });

  it("falls back to BASTIONS for an Overmind / Independent / unknown owner", () => {
    const galaxy = fakeGalaxy({
      systems: [
        { id: "o", ownerFaction: Faction.OVERMIND },
        { id: "i", ownerFaction: Faction.INDEPENDENT },
      ],
    });
    expect(rescueBeneficiaryFaction(galaxy, "o")).toBe(Faction.BASTIONS);
    expect(rescueBeneficiaryFaction(galaxy, "i")).toBe(Faction.BASTIONS);
    expect(rescueBeneficiaryFaction(galaxy, "missing")).toBe(Faction.BASTIONS);
  });
});

describe("applyEncounterOutcome", () => {
  const galaxy = fakeGalaxy({
    systems: [{ id: "s", ownerFaction: Faction.PROGRESSORS }],
  });
  const enc = makeEncounter("s");

  it("books positive credits and looted cargo into the hold", () => {
    const player = fakePlayer(1, 1000);
    const outcome: EncounterOutcome = {
      kind: "salvage",
      credits: 400,
      cargo: [{ type: ResourceType.METALS, amount: 3 }],
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(player.credits).toBe(1400);
    expect(
      player.inventory.resources.find((r) => r.type === ResourceType.METALS)
        ?.amount,
    ).toBe(3);
  });

  it("applies a negative (hazard) credit cost", () => {
    const player = fakePlayer(1, 1000);
    const outcome: EncounterOutcome = {
      kind: "hazard",
      credits: -250,
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(player.credits).toBe(750);
  });

  it("routes a rescue's reputation to the system-owner faction", () => {
    const player = fakePlayer(1, 1000);
    const outcome: EncounterOutcome = {
      kind: "rescue",
      credits: 500,
      reputationDelta: 5,
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(player.getReputation(Faction.PROGRESSORS)).toBe(5);
  });

  it("applies no payoff for a combat (trap/ambush) outcome", () => {
    const player = fakePlayer(1, 1000);
    const outcome: EncounterOutcome = {
      kind: "ambush",
      startCombat: true,
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(player.credits).toBe(1000);
    expect(player.inventory.resources).toEqual([]);
  });

  it("clamps a hazard cost to available credits (never goes negative)", () => {
    // Charge bigger than the balance would brick the save (credits is min(0)).
    const player = fakePlayer(1, 100);
    const outcome: EncounterOutcome = {
      kind: "hazard",
      credits: -250,
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(player.credits).toBe(0);
  });

  it("a hazard on a broke player leaves credits at zero", () => {
    const player = fakePlayer(1, 0);
    const outcome: EncounterOutcome = {
      kind: "hazard",
      credits: -250,
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(player.credits).toBe(0);
  });

  it("clamps looted cargo to the remaining hold capacity", () => {
    const player = fakePlayer(1, 1000);
    player.inventory.addResource(ResourceType.METALS, 4);
    const loadout = {
      derivedStats: () => ({ cargo: 5 }),
    } as unknown as Parameters<typeof applyEncounterOutcome>[0]["loadout"];
    const outcome: EncounterOutcome = {
      kind: "salvage",
      credits: 0,
      cargo: [{ type: ResourceType.ELECTRONICS, amount: 3 }],
      message: "",
    };
    applyEncounterOutcome(
      { bank: null, player, galaxy, loadout },
      enc,
      outcome,
    );
    // Only 1 unit of the 3 fits (4 used of 5), so the hold tops out at capacity.
    const total = player.inventory.resources.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(5);
    expect(
      player.inventory.resources.find(
        (r) => r.type === ResourceType.ELECTRONICS,
      )?.amount,
    ).toBe(1);
  });

  it("with no loadout supplied, cargo is added unclamped (legacy/test path)", () => {
    const player = fakePlayer(1, 1000);
    const outcome: EncounterOutcome = {
      kind: "salvage",
      credits: 0,
      cargo: [{ type: ResourceType.METALS, amount: 9 }],
      message: "",
    };
    applyEncounterOutcome({ bank: null, player, galaxy }, enc, outcome);
    expect(
      player.inventory.resources.find((r) => r.type === ResourceType.METALS)
        ?.amount,
    ).toBe(9);
  });
});
