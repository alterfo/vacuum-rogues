import { describe, it, expect } from "vitest";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import {
  commsContextFor,
  commsOptionsFor,
  type CommsContext,
  type CommsOption,
} from "@/systems/comms/commsOptions";

type NpcOpts = {
  role?: NpcRole;
  faction?: Faction;
  hostile?: boolean;
};

function makeNpc(opts: NpcOpts = {}): NpcShip {
  return new NpcShip({
    id: "npc_1",
    name: "Test Ship",
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.TRADER,
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

describe("commsContextFor", () => {
  it("classifies an Overmind ship as overmind regardless of role/hostility", () => {
    const peaceful = makeNpc({ faction: Faction.OVERMIND, hostile: false });
    const angry = makeNpc({
      faction: Faction.OVERMIND,
      hostile: true,
      role: NpcRole.PIRATE,
    });
    expect(commsContextFor(peaceful)).toBe("overmind");
    expect(commsContextFor(angry)).toBe("overmind");
  });

  it("classifies a hostile pirate as a pirate-shakedown", () => {
    const npc = makeNpc({ role: NpcRole.PIRATE, hostile: true });
    expect(commsContextFor(npc)).toBe("pirate-shakedown");
  });

  it("classifies a hostile non-pirate as hostile-other", () => {
    const npc = makeNpc({ role: NpcRole.PATROL, hostile: true });
    expect(commsContextFor(npc)).toBe("hostile-other");
  });

  it("classifies a non-hostile ship as neutral", () => {
    const trader = makeNpc({ role: NpcRole.TRADER, hostile: false });
    const idlePirate = makeNpc({ role: NpcRole.PIRATE, hostile: false });
    expect(commsContextFor(trader)).toBe("neutral");
    expect(commsContextFor(idlePirate)).toBe("neutral");
  });
});

describe("commsOptionsFor", () => {
  it("pirate-shakedown → pay / fight / flee, never trade/hire/ally", () => {
    const npc = makeNpc({ role: NpcRole.PIRATE, hostile: true });
    const opts = commsOptionsFor(npc, "pirate-shakedown");
    expect(opts).toEqual(
      expect.arrayContaining<CommsOption>(["pay-tribute", "attack", "flee"]),
    );
    expect(opts).not.toContain("trade");
    expect(opts).not.toContain("hire");
    expect(opts).not.toContain("ally");
  });

  it("neutral → trade / hire / ally, never pay-tribute/flee", () => {
    const npc = makeNpc({ role: NpcRole.TRADER });
    const opts = commsOptionsFor(npc, "neutral");
    expect(opts).toEqual(
      expect.arrayContaining<CommsOption>(["trade", "hire", "ally"]),
    );
    expect(opts).not.toContain("pay-tribute");
    expect(opts).not.toContain("flee");
  });

  it("neutral always offers attack (you can open fire on a neutral ship)", () => {
    const npc = makeNpc({ role: NpcRole.TRADER });
    expect(commsOptionsFor(npc, "neutral")).toContain("attack");
  });

  it("hostile-other → fight or flee, never trade", () => {
    const npc = makeNpc({ role: NpcRole.PATROL, hostile: true });
    const opts = commsOptionsFor(npc, "hostile-other");
    expect(opts).toEqual(
      expect.arrayContaining<CommsOption>(["attack", "flee"]),
    );
    expect(opts).not.toContain("trade");
    expect(opts).not.toContain("pay-tribute");
  });

  it("overmind → no actionable options (gibberish only)", () => {
    const npc = makeNpc({ faction: Faction.OVERMIND });
    const opts = commsOptionsFor(npc, "overmind");
    expect(opts).toHaveLength(0);
  });

  it("defaults the context from the ship when omitted", () => {
    const pirate = makeNpc({ role: NpcRole.PIRATE, hostile: true });
    const overmind = makeNpc({ faction: Faction.OVERMIND });
    const contexts: CommsContext[] = [
      commsContextFor(pirate),
      commsContextFor(overmind),
    ];
    expect(contexts).toEqual(["pirate-shakedown", "overmind"]);
    expect(commsOptionsFor(pirate)).toContain("pay-tribute");
    expect(commsOptionsFor(overmind)).toHaveLength(0);
  });
});
