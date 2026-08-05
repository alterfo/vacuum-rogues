import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState, FactionType } from "@/types";
import type { NewsEvent } from "@/types";
import { Faction } from "@/types/faction";

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
  return new Galaxy("galaxy_liberation", [sysA, sysB], new Overmind(), [], []);
}

function makeRanger(id: string, systemId: string): NpcShip {
  return new NpcShip({
    id,
    name: `Ranger ${id}`,
    race: FactionType.BASTIONS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.RANGER,
    hullHP: 120,
    maxHull: 120,
    shields: 60,
    speed: 0.1,
    damage: 25,
    currentSystemId: systemId,
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("NpcSimulator liberation campaigns", () => {
  it("emits a LIBERATION_CAMPAIGN news event with target/staging/date within 50 days", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    const collected: NewsEvent[] = [];
    for (let i = 0; i < 50; i++) {
      galaxy.addOvermindSystem("sys_a");
      galaxy.simulateDay();
      const events = sim.tick(galaxy, new SeededRNG(`lib_tick_${i}`));
      collected.push(...events);
    }

    const campaign = collected.find((e) => e.type === "LIBERATION_CAMPAIGN");
    expect(campaign).toBeDefined();
    expect(campaign?.targetSystemId).toBe("sys_a");
    expect(campaign?.stagingSystemId).toBe("sys_b");
    expect(campaign?.liberationDate).toBe((campaign?.day ?? 0) + 30);
  });

  it("assembleLiberationCampaign returns the event directly with correct fields", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    galaxy.gameDays = 50;

    const sim = new NpcSimulator();
    const event = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("lib_direct"),
    );

    expect(event).not.toBeNull();
    expect(event?.type).toBe("LIBERATION_CAMPAIGN");
    expect(event?.targetSystemId).toBe("sys_a");
    expect(event?.stagingSystemId).toBe("sys_b");
    expect(event?.liberationDate).toBe(80);
    expect(event?.description).toContain("Сбор");
  });

  it("rallies rangers from the staging system toward the target after the liberation date", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const r1 = makeRanger("r1", "sys_b");
    const r2 = makeRanger("r2", "sys_b");
    galaxy.npcShips.push(r1, r2);

    const sim = new NpcSimulator();
    const event = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("rally_seed"),
    );
    expect(event?.liberationDate).toBe(30);

    galaxy.gameDays = 30;
    sim.tick(galaxy, new SeededRNG("rally_tick"));

    expect(r1.state).toBe(NpcState.TRAVELING);
    expect(r1.destinationSystemId).toBe("sys_a");
    expect(r1.goal?.kind).toBeDefined();
    expect(r2.state).toBe(NpcState.TRAVELING);
    expect(r2.destinationSystemId).toBe("sys_a");
  });

  it("retries the rally on a later tick when no ranger is staged on the liberation date", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    const event = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("retry_seed"),
    );
    expect(event?.liberationDate).toBe(30);

    galaxy.gameDays = 30;
    sim.tick(galaxy, new SeededRNG("retry_tick_empty"));

    const r1 = makeRanger("r1", "sys_b");
    galaxy.npcShips.push(r1);
    galaxy.gameDays = 31;
    sim.tick(galaxy, new SeededRNG("retry_tick_staged"));

    expect(r1.state).toBe(NpcState.TRAVELING);
    expect(r1.destinationSystemId).toBe("sys_a");
  });

  it("does not announce a campaign when no system is hostile", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();
    const event = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("noop_seed"),
    );
    expect(event).toBeNull();
  });
});
