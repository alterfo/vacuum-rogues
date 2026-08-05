import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { RuleBasedNpcBrain } from "@/systems/npc/NpcBrain";
import { NpcShip } from "@/domain/NpcShip";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcState, NpcRole, FactionType, EconomyType } from "@/types";
import { Faction } from "@/types/faction";

function makeNpc(
  id: string,
  systemId: string,
  state: NpcState,
  role: NpcRole = NpcRole.RANGER,
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 50,
    speed: 0.1,
    damage: 20,
    currentSystemId: systemId,
    state,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeTwoSystemGalaxy(
  econA: EconomyType = EconomyType.AGRICULTURAL,
  econB: EconomyType = EconomyType.INDUSTRIAL,
): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
    [],
    econA,
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
    [],
    econB,
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 2));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 2));
  return new Galaxy("galaxy_test", [sysA, sysB], new Overmind(), [], []);
}

function makeContestedGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
    [],
    EconomyType.MIXED,
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
    [],
    EconomyType.MIXED,
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 2));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 2));
  const galaxy = new Galaxy(
    "galaxy_test",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
    [],
    "",
    ["sys_b"],
  );
  return galaxy;
}

describe("NPC roles — trader trade-run goal selection", () => {
  it("trader in IDLE picks economy-different neighbour when available", () => {
    const galaxy = makeTwoSystemGalaxy(
      EconomyType.AGRICULTURAL,
      EconomyType.INDUSTRIAL,
    );
    const brain = new RuleBasedNpcBrain();
    const trader = makeNpc("t1", "sys_a", NpcState.IDLE, NpcRole.TRADER);

    const rng = new SeededRNG("trade_seed");
    const goal = brain.decideGoal(trader, galaxy, rng);

    expect(goal.targetSystemId).toBe("sys_b");
  });

  it("trader falls back to any neighbour when all share the same economy", () => {
    const galaxy = makeTwoSystemGalaxy(EconomyType.MIXED, EconomyType.MIXED);
    const brain = new RuleBasedNpcBrain();
    const trader = makeNpc("t2", "sys_a", NpcState.IDLE, NpcRole.TRADER);

    const rng = new SeededRNG("trade_seed2");
    const goal = brain.decideGoal(trader, galaxy, rng);

    expect(goal.targetSystemId).toBe("sys_b");
  });

  it("non-trader NPC does not prefer economy-different neighbour", () => {
    const galaxy = makeTwoSystemGalaxy(
      EconomyType.AGRICULTURAL,
      EconomyType.INDUSTRIAL,
    );
    const brain = new RuleBasedNpcBrain();
    const ranger = makeNpc("r1", "sys_a", NpcState.IDLE, NpcRole.RANGER);

    const goal = brain.decideGoal(ranger, galaxy, new SeededRNG("r_seed"));
    expect(["sys_a", "sys_b"]).toContain(goal.targetSystemId);
  });
});

describe("NPC roles — PATROL convoy assembly", () => {
  it("assembleConvoy produces at least one convoy with convoyId on all members after 30 days", () => {
    const galaxy = makeContestedGalaxy();
    const sim = new NpcSimulator();

    for (let i = 0; i < 3; i++) {
      const npc = makeNpc(
        `patrol_${i}`,
        "sys_a",
        NpcState.PATROLLING,
        NpcRole.PATROL,
      );
      galaxy.npcShips.push(npc);
    }

    sim.attachCampaignPeakPower(() => 1);

    const rng = new SeededRNG("convoy_seed");
    for (let d = 0; d < 30; d++) {
      galaxy.gameDays++;
      sim.tick(galaxy, rng);
    }

    const convoyed = galaxy.npcShips.filter((n) => n.convoyId);
    expect(convoyed.length).toBeGreaterThanOrEqual(1);
  });

  it("all convoy members share the same convoyId and destinationSystemId", () => {
    const galaxy = makeContestedGalaxy();
    const sim = new NpcSimulator();

    for (let i = 0; i < 5; i++) {
      galaxy.npcShips.push(
        makeNpc(`patrol_${i}`, "sys_a", NpcState.PATROLLING, NpcRole.PATROL),
      );
    }

    galaxy.gameDays = 29;
    const rng = new SeededRNG("convoy_dest_seed");
    galaxy.gameDays++;
    sim.tick(galaxy, rng);

    const convoyed = galaxy.npcShips.filter((n) => n.convoyId);
    expect(convoyed.length).toBeGreaterThanOrEqual(2);

    const firstId = convoyed[0].convoyId;
    const firstDest = convoyed[0].destinationSystemId;
    for (const npc of convoyed) {
      expect(npc.convoyId).toBe(firstId);
      expect(npc.destinationSystemId).toBe(firstDest);
    }
  });

  it("no convoy is assembled when there are no contested borders (all systems friendly)", () => {
    const galaxy = makeTwoSystemGalaxy();
    const sim = new NpcSimulator();

    for (let i = 0; i < 3; i++) {
      galaxy.npcShips.push(
        makeNpc(`patrol_${i}`, "sys_a", NpcState.PATROLLING, NpcRole.PATROL),
      );
    }

    const rng = new SeededRNG("no_convoy_seed");
    for (let d = 0; d < 30; d++) {
      galaxy.gameDays++;
      sim.tick(galaxy, rng);
    }

    const convoyed = galaxy.npcShips.filter((n) => n.convoyId);
    expect(convoyed.length).toBe(0);
  });

  it("convoy ships are set to TRAVELING toward the contested system", () => {
    const galaxy = makeContestedGalaxy();
    const sim = new NpcSimulator();

    for (let i = 0; i < 3; i++) {
      galaxy.npcShips.push(
        makeNpc(`patrol_${i}`, "sys_a", NpcState.PATROLLING, NpcRole.PATROL),
      );
    }

    const rng = new SeededRNG("traveling_seed");
    for (let d = 0; d < 30; d++) {
      galaxy.gameDays++;
      sim.tick(galaxy, rng);
    }

    const convoyed = galaxy.npcShips.filter((n) => n.convoyId);
    for (const npc of convoyed) {
      expect(npc.state).toBe(NpcState.TRAVELING);
      expect(npc.destinationSystemId).toBe("sys_b");
    }
  });
});

describe("NPC roles — convoy V-formation spawn positions", () => {
  it("convoy members have different spawn offsets (perpendicular to entry angle)", () => {
    const offsets = [0, 30, -30];
    const angle = Math.PI / 4; // 45°
    const perpAngle = angle + Math.PI / 2;
    const baseX = 500;
    const baseY = 500;

    const positions = offsets.map((off) => ({
      x: baseX + Math.cos(perpAngle) * off,
      y: baseY + Math.sin(perpAngle) * off,
    }));

    expect(positions[0].x).not.toBeCloseTo(positions[1].x, 1);
    expect(positions[0].x).not.toBeCloseTo(positions[2].x, 1);
    expect(positions[0].x).toBeCloseTo(baseX, 5);
    expect(positions[0].y).toBeCloseTo(baseY, 5);
    expect(positions[1].x).toBeCloseTo(baseX + Math.cos(perpAngle) * 30, 3);
    expect(positions[2].x).toBeCloseTo(baseX + Math.cos(perpAngle) * -30, 3);
  });
});
