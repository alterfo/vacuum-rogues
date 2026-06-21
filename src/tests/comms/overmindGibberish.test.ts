import { describe, it, expect } from "vitest";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import {
  commsContextFor,
  commsOptionsFor,
  overmindGibberish,
} from "@/systems/comms/commsOptions";
import { SeededRNG } from "@/utils/seededRNG";

type NpcOpts = {
  role?: NpcRole;
  faction?: Faction;
  hostile?: boolean;
};

function makeNpc(opts: NpcOpts = {}): NpcShip {
  return new NpcShip({
    id: "npc_1",
    name: "Predecessor Hulk",
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.OVERMIND,
    role: opts.role ?? NpcRole.RANGER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 500,
    reputation: 0,
    hostile: opts.hostile ?? false,
  });
}

describe("Overmind hail exposes no actionable options", () => {
  it("classifies any Overmind ship into the overmind context", () => {
    const peaceful = makeNpc({ hostile: false });
    const angry = makeNpc({ hostile: true, role: NpcRole.PIRATE });
    expect(commsContextFor(peaceful)).toBe("overmind");
    expect(commsContextFor(angry)).toBe("overmind");
  });

  it("offers no trade / hire / ally / attack / pay-tribute / flee options", () => {
    const npc = makeNpc();
    const opts = commsOptionsFor(npc); // context defaults to overmind from ship
    expect(opts).toHaveLength(0);
    for (const forbidden of [
      "trade",
      "hire",
      "ally",
      "attack",
      "pay-tribute",
      "flee",
    ] as const) {
      expect(opts).not.toContain(forbidden);
    }
  });

  it("offers nothing even when the overmind context is passed explicitly", () => {
    const npc = makeNpc();
    expect(commsOptionsFor(npc, "overmind")).toEqual([]);
  });
});

describe("overmindGibberish", () => {
  it("returns a non-empty nonsense line", () => {
    const line = overmindGibberish(new SeededRNG("overmind:npc_1:0"));
    expect(line.length).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed", () => {
    const a = overmindGibberish(new SeededRNG("overmind:npc_7:3"));
    const b = overmindGibberish(new SeededRNG("overmind:npc_7:3"));
    expect(a).toBe(b);
  });

  it("can vary across seeds (not a single hard-coded string)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 32; i++) {
      seen.add(overmindGibberish(new SeededRNG(`overmind:npc:${i}`)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
