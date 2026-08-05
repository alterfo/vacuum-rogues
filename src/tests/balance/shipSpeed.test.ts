import { describe, it, expect } from "vitest";
import { GAME_BALANCE } from "@/config/balance";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  npcCruiseSpeed,
  isInterceptorClass,
} from "@/presentation/flight/npcCruiseSpeed";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

function starterLoadout(): ShipLoadout {
  const l = new ShipLoadout("hull_corvette");
  l.install("eq_engine_i");
  l.install("eq_tank");
  l.install("wpn_pulse");
  l.install("grav_tractor_1");
  return l;
}

function cruise(maxSpeed: number): ShipPhysics {
  const p = new ShipPhysics(0, 0, maxSpeed);
  p.setTarget(100_000, 0);
  for (let i = 0; i < 200; i++) p.update(50);
  return p;
}

function makeNpc(role: NpcRole, faction: Faction): NpcShip {
  return new NpcShip({
    id: `${faction}_${role}`,
    name: "n",
    race: FactionType.OUTLANDERS,
    faction,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 10,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("ship speed: starter vs NPC classes (Task 1)", () => {
  it("the basic NPC tier is slower than the interceptor tier (the split exists)", () => {
    expect(GAME_BALANCE.npcBasicSpeed).toBeGreaterThan(0);
    expect(GAME_BALANCE.npcBasicSpeed).toBeLessThan(GAME_BALANCE.npcSpeed);
  });

  it("classifies OVERMIND craft and PIRATE raiders as interceptors, others as basic", () => {
    expect(isInterceptorClass(makeNpc(NpcRole.TRADER, Faction.OVERMIND))).toBe(
      true,
    );
    expect(
      isInterceptorClass(makeNpc(NpcRole.PIRATE, Faction.INDEPENDENT)),
    ).toBe(true);
    expect(
      isInterceptorClass(makeNpc(NpcRole.TRADER, Faction.INDEPENDENT)),
    ).toBe(false);
    expect(isInterceptorClass(makeNpc(NpcRole.PATROL, Faction.BASTIONS))).toBe(
      false,
    );

    expect(npcCruiseSpeed(makeNpc(NpcRole.PIRATE, Faction.SYNDICATE))).toBe(
      GAME_BALANCE.npcSpeed,
    );
    expect(npcCruiseSpeed(makeNpc(NpcRole.TRADER, Faction.INDEPENDENT))).toBe(
      GAME_BALANCE.npcBasicSpeed,
    );
  });

  it("the fresh starter ship is faster than a basic NPC (can flee one)", () => {
    const starterSpeed = starterLoadout().derivedStats().speed;
    expect(starterSpeed).toBeGreaterThan(0);
    expect(starterSpeed).toBeGreaterThan(GAME_BALANCE.npcBasicSpeed);
  });

  it("a cruising starter out-runs a basic NPC but NOT an interceptor", () => {
    const starterSpeed = starterLoadout().derivedStats().speed;
    const ship = cruise(starterSpeed);
    expect(ship.canOutrun(GAME_BALANCE.npcBasicSpeed)).toBe(true);
    expect(ship.canOutrun(GAME_BALANCE.npcSpeed)).toBe(false);
  });

  it("the apex engine finally out-runs the interceptor tier (long-climb payoff)", () => {
    const apex = new ShipLoadout("hull_bastion");
    apex.install("eq_engine_v");
    const ship = cruise(apex.derivedStats().speed);
    expect(ship.canOutrun(GAME_BALANCE.npcSpeed)).toBe(true);
  });

  it("the mid-tier engine still cannot out-run the interceptor tier", () => {
    const mid = new ShipLoadout("hull_corvette");
    mid.install("eq_engine_iii");
    const ship = cruise(mid.derivedStats().speed);
    expect(ship.canOutrun(GAME_BALANCE.npcSpeed)).toBe(false);
  });
});
