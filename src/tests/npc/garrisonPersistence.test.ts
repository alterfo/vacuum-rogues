import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState } from "@/types";
import { Faction } from "@/types/faction";
import { OVERMIND_GARRISON_POWER_MAX_DISCOUNT } from "@/config/balance";

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
  return new Galaxy(
    "galaxy_garrison_persist",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

describe("garrison persistence across save/load", () => {
  it("re-derives the garrison hold set so standing ships do not scatter after a load", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const before = new NpcSimulator();
    before.ensureGarrison(galaxy, new SeededRNG("garrison_persist_seed"));

    const originalIds = npcsPresentInSystem(galaxy, "sys_a")
      .filter((n) => n.id.startsWith("garrison_"))
      .map((n) => n.id);
    expect(originalIds.length).toBeGreaterThanOrEqual(
      5 - OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
    );

    const afterLoad = new NpcSimulator();
    for (let day = 0; day < 40; day++) {
      afterLoad.tick(galaxy, new SeededRNG(`post_load_${day}`));
    }

    for (const id of originalIds) {
      const ship = galaxy.npcShips.find((n) => n.id === id);
      expect(ship, `garrison ship ${id} vanished`).toBeDefined();
      expect(ship!.currentSystemId).toBe("sys_a");
      expect(ship!.state).not.toBe(NpcState.TRAVELING);
      expect(ship!.state).not.toBe(NpcState.DEAD);
    }

    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
    const hostile = npcsPresentInSystem(galaxy, "sys_a").filter(
      (n) => n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE,
    );
    expect(hostile.length).toBeGreaterThanOrEqual(
      5 - OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
    );

    const leaked = npcsPresentInSystem(galaxy, "sys_b").filter((n) =>
      n.id.startsWith("garrison_"),
    );
    expect(leaked).toHaveLength(0);
  });
});
