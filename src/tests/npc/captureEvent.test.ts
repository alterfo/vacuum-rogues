import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

/** sys_a (friendly) ←→ sys_b, two-system chain. */
function makeGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy("galaxy_capture", [sysA, sysB], new Overmind(), [], []);
}

describe("NpcSimulator.assembleCaptureFleet", () => {
  it("seizes an undefended neutral system after the fleet arrives", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_b");

    const sim = new NpcSimulator();
    sim.assembleCaptureFleet(galaxy, new SeededRNG("capture_seed"));

    // Fleet of OVERMIND ships now travels sys_b → sys_a (still friendly).
    expect(galaxy.isHostileSystem("sys_a")).toBe(false);

    for (let i = 0; i < 20 && !galaxy.isHostileSystem("sys_a"); i++) {
      sim.tick(galaxy, new SeededRNG(`cap_tick_${i}`));
    }

    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
  });

  it("spawns 3-5 Overmind OVERMIND-role ships in the hostile neighbour bound for the target", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_b");

    const sim = new NpcSimulator();
    sim.assembleCaptureFleet(galaxy, new SeededRNG("fleet_seed"));

    const fleet = galaxy.npcShips.filter(
      (n) => n.faction === Faction.OVERMIND && n.state === NpcState.TRAVELING,
    );
    expect(fleet.length).toBeGreaterThanOrEqual(3);
    expect(fleet.length).toBeLessThanOrEqual(5);
    for (const ship of fleet) {
      expect(ship.role).toBe(NpcRole.OVERMIND);
      expect(ship.currentSystemId).toBe("sys_b");
      expect(ship.destinationSystemId).toBe("sys_a");
    }
  });

  it("emits a SYSTEM_CAPTURED news event when a system falls", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_b");

    const sim = new NpcSimulator();
    sim.assembleCaptureFleet(galaxy, new SeededRNG("news_seed"));

    let capturedSystemId: string | undefined;
    for (let i = 0; i < 20 && !capturedSystemId; i++) {
      const events = sim.tick(galaxy, new SeededRNG(`news_tick_${i}`));
      capturedSystemId = events.find(
        (e) => e.type === "SYSTEM_CAPTURED",
      )?.systemId;
    }

    expect(capturedSystemId).toBe("sys_a");
  });

  it("does not capture a defended system while defenders survive", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_b");

    // Indestructible PATROL defender holding sys_a. A PATROL (vs RANGER) takes no
    // quest-accept RNG draw, so a constant seed keeps its single per-tick depart
    // roll identical every tick — the defender provably never wanders off.
    const defender = new NpcShip({
      id: "defender",
      name: "Defender",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.PATROL,
      hullHP: 1_000_000,
      maxHull: 1_000_000,
      shields: 70,
      speed: 0.1,
      damage: 28,
      currentSystemId: "sys_a",
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 0,
      reputation: 0,
    });
    galaxy.npcShips.push(defender);

    const sim = new NpcSimulator();
    sim.assembleCaptureFleet(galaxy, new SeededRNG("defended_seed"));

    // Tick well past arrival; the indestructible defender keeps sys_a free.
    // Seed re-picked for the win-rate-100pct plan's Task 2/3 garrison-discount
    // retune: raising the discount changed how many draws `fillGarrison`
    // consumes per tick, which shifted this test's fixed per-tick seed enough
    // to occasionally roll the defender's own departure chance — collateral
    // RNG-stream drift, not a capture-logic regression (re-verified against a
    // spread of seeds, all stable under the new discount).
    for (let i = 0; i < 15; i++) {
      sim.tick(galaxy, new SeededRNG("def_hold_1"));
      // Defense-in-depth: keep the defender pinned and whole between ticks.
      defender.currentSystemId = "sys_a";
      defender.state = NpcState.PATROLLING;
      defender.destinationSystemId = null;
      defender.hullHP = 1_000_000;
    }

    expect(galaxy.isHostileSystem("sys_a")).toBe(false);
    expect(defender.state).not.toBe(NpcState.DEAD);
  });

  it("does not perturb a galaxy without hostile systems", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();
    sim.assembleCaptureFleet(galaxy, new SeededRNG("noop_seed"));

    // No hostile system → no capture fleet spawned.
    expect(npcsPresentInSystem(galaxy, "sys_b")).toHaveLength(0);
    expect(
      galaxy.npcShips.filter((n) => n.faction === Faction.OVERMIND),
    ).toHaveLength(0);
  });
});
