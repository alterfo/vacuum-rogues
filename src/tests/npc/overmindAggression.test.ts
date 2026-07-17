import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { isHostile, type FactionKind } from "@/systems/npc/factionHostility";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

// ---------------------------------------------------------------------------
// Task 4 — Overmind indiscriminate aggression + retained expansion goal.
// The Overmind attacks EVERY non-Overmind ship (player, trader, pirate, Ranger)
// via the shared hostility matrix, while its capture-fleet expansion persists.
// ---------------------------------------------------------------------------

function makeNpc(
  id: string,
  opts: {
    role?: NpcRole;
    faction?: Faction;
    systemId?: string;
    hull?: number;
    damage?: number;
  } = {},
): NpcShip {
  const hull = opts.hull ?? 100;
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.TRADER,
    hullHP: hull,
    maxHull: hull,
    shields: 0,
    speed: 0.1,
    damage: opts.damage ?? 20,
    currentSystemId: opts.systemId ?? "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

/** sys_a ←→ sys_b two-system chain (both start neutral/INDEPENDENT). */
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
    "galaxy_overmind_aggro",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

describe("Overmind aggression matrix (indiscriminate)", () => {
  it("the Overmind is hostile to every non-Overmind kind", () => {
    const prey: FactionKind[] = [
      "pirate",
      "trader",
      "player",
      "ranger",
      "patrol",
    ];
    for (const target of prey) {
      // Good pirate rep must not shield anything from the Overmind — it is keyed
      // off the pirate faction only, never the Overmind.
      expect(isHostile("overmind", target, { pirateRep: 100 })).toBe(true);
    }
  });

  it("the Overmind never turns on its own hive", () => {
    expect(isHostile("overmind", "overmind", { pirateRep: 0 })).toBe(false);
  });
});

describe("NpcSimulator Overmind off-screen aggression", () => {
  it("an Overmind garrison destroys a wandering PIRATE in a captured system", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("overmind_aggro_pirate"));

    // A lone pirate strays into the Overmind-held system (player elsewhere).
    const pirate = makeNpc("stray_pirate", {
      role: NpcRole.PIRATE,
      faction: FactionType.OUTLANDERS as unknown as Faction,
      systemId: "sys_a",
      hull: 110,
    });
    galaxy.npcShips.push(pirate);

    const simAny = sim as unknown as {
      garrison: {
        resolveOffscreenCombat(
          g: Galaxy,
          rng: SeededRNG,
          playerSystemId?: string,
        ): void;
      };
    };
    for (let i = 0; i < 20 && pirate.state !== NpcState.DEAD; i++) {
      simAny.garrison.resolveOffscreenCombat(
        galaxy,
        new SeededRNG(`ov_aggro_${i}`),
        "elsewhere",
      );
    }

    expect(pirate.state).toBe(NpcState.DEAD);
    expect(pirate.hullHP).toBe(0);
  });

  it("an Overmind garrison also destroys a wandering friendly trader (everyone is prey)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("overmind_aggro_trader"));

    const trader = makeNpc("stray_trader", {
      role: NpcRole.TRADER,
      faction: Faction.INDEPENDENT,
      systemId: "sys_a",
      hull: 100,
    });
    galaxy.npcShips.push(trader);

    const simAny = sim as unknown as {
      garrison: {
        resolveOffscreenCombat(
          g: Galaxy,
          rng: SeededRNG,
          playerSystemId?: string,
        ): void;
      };
    };
    for (let i = 0; i < 20 && trader.state !== NpcState.DEAD; i++) {
      simAny.garrison.resolveOffscreenCombat(
        galaxy,
        new SeededRNG(`ov_trader_${i}`),
        "elsewhere",
      );
    }

    expect(trader.state).toBe(NpcState.DEAD);
  });
});

describe("NpcSimulator Overmind expansion goal persists", () => {
  it("a capture fleet still seizes an undefended neutral system after the aggression change", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_b");

    const sim = new NpcSimulator();
    // This test exercises capture-fleet expansion, not garrison-discount
    // economics — pin the ratcheted power at max (win-rate-100pct plan's Task
    // 2/3 raised the discount ceiling) so this scenario's garrisons stay at
    // today's undiscounted baseline instead of the new, much smaller
    // zero-power range, which was destabilizing the transient-defender churn
    // this capture race depends on (collateral from the discount retune, not
    // a capture-logic regression).
    sim.attachCampaignPeakPower(() => 1);
    sim.assembleCaptureFleet(galaxy, new SeededRNG("expansion_seed"));

    // Fleet of OVERMIND ships travels sys_b → sys_a (still neutral on launch).
    expect(galaxy.isHostileSystem("sys_a")).toBe(false);

    let captured: string | undefined;
    for (let i = 0; i < 20 && !captured; i++) {
      const events = sim.tick(galaxy, new SeededRNG(`expand_tick_${i}`));
      captured = events.find((e) => e.type === "SYSTEM_CAPTURED")?.systemId;
    }

    expect(captured).toBe("sys_a");
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
  });
});
