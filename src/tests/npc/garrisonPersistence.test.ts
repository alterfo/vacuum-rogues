import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState } from "@/types";
import { Faction } from "@/types/faction";

/** Two-system galaxy: sys_a (will be captured) ←→ sys_b (friendly escape route). */
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
    // --- Pre-save session: a captured system gets its standing garrison. ---
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const before = new NpcSimulator();
    before.ensureGarrison(galaxy, new SeededRNG("garrison_persist_seed"));

    const originalIds = npcsPresentInSystem(galaxy, "sys_a")
      .filter((n) => n.id.startsWith("garrison_"))
      .map((n) => n.id);
    expect(originalIds.length).toBeGreaterThanOrEqual(5);

    // --- Save→load: the ships persist on the galaxy, but the simulator's
    // transient hold sets (garrisonIds, dwell countdowns) are gone. A FRESH
    // NpcSimulator models exactly that (fresh GameEngine + loaded galaxy). ---
    const afterLoad = new NpcSimulator();
    for (let day = 0; day < 40; day++) {
      afterLoad.tick(galaxy, new SeededRNG(`post_load_${day}`));
    }

    // Every original garrison ship must still be holding sys_a — not wandered
    // off into friendly space via the random-departure roll. Without the
    // reconciliation these PATROLLING ships (dwell countdown also reset on load)
    // are subject to DEPART_CHANCE every tick and scatter within a few days.
    for (const id of originalIds) {
      const ship = galaxy.npcShips.find((n) => n.id === id);
      expect(ship, `garrison ship ${id} vanished`).toBeDefined();
      expect(ship!.currentSystemId).toBe("sys_a");
      expect(ship!.state).not.toBe(NpcState.TRAVELING);
      expect(ship!.state).not.toBe(NpcState.DEAD);
    }

    // sys_a stays a hostile, fully defended system and is never auto-liberated.
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
    const hostile = npcsPresentInSystem(galaxy, "sys_a").filter(
      (n) => n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE,
    );
    expect(hostile.length).toBeGreaterThanOrEqual(5);

    // No standing-garrison ship leaked into the friendly neighbour (regular
    // wandering NPCs from normal population replenishment may be there — that is
    // expected galaxy life; only garrison_* ships must never escape).
    const leaked = npcsPresentInSystem(galaxy, "sys_b").filter((n) =>
      n.id.startsWith("garrison_"),
    );
    expect(leaked).toHaveLength(0);
  });
});
