import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { NpcRole, NpcState, FactionType, StarType } from "@/types";
import { Faction } from "@/types/faction";

type NpcOpts = {
  role?: NpcRole;
  faction?: Faction;
  systemId?: string;
  hull?: number;
  damage?: number;
};

function makeNpc(id: string, opts: NpcOpts = {}): NpcShip {
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

/** Sprites are private; expose them for white-box assertions (test-only seam). */
function sprites(manager: NpcShipManager): Array<{
  npc: NpcShip;
  aggressive: boolean;
  x: number;
  y: number;
}> {
  return (
    manager as unknown as {
      npcSprites: Array<{
        npc: NpcShip;
        aggressive: boolean;
        x: number;
        y: number;
      }>;
    }
  ).npcSprites;
}

function makeManager(
  npcs: NpcShip[],
  opts: { hostile: boolean; physics?: ShipPhysics; pirateControlled?: boolean },
): NpcShipManager {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const galaxy = {
    npcShips: npcs,
    isHostileSystem: (id: string) => opts.hostile && id === "sys_a",
    isPirateSystem: (id: string) => !!opts.pirateControlled && id === "sys_a",
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => opts.physics ?? null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  return new NpcShipManager(renderer, gameEngine, gameLayer, uiLayer, deps);
}

describe("NpcShipManager.checkGarrisonAggro", () => {
  it("flags the Overmind garrison aggressive in an Overmind system, but NOT a stray pirate (playtest 2026-06-27 #6)", () => {
    // The garrison is faction-matched: an Overmind-controlled (hostile, NOT
    // pirate-controlled) system aggros its Overmind craft, but a pirate merely
    // passing through is the Overmind's prey — an intruder it fights, never an
    // ally that ganged up on the player (the "they look allied" bug).
    const manager = makeManager(
      [
        makeNpc("ov_1", { role: NpcRole.PATROL, faction: Faction.OVERMIND }),
        makeNpc("ov_2", { role: NpcRole.PATROL, faction: Faction.OVERMIND }),
        makeNpc("pirate_1", { role: NpcRole.PIRATE }),
        makeNpc("trader_1", { role: NpcRole.TRADER }),
      ],
      { hostile: true }, // Overmind-held (not pirateControlled)
    );
    manager.initialize();

    // refresh() → checkGarrisonAggro path (the system is captured/hostile).
    manager.refresh();
    manager.checkGarrisonAggro("sys_a", true);

    const byId = new Map(sprites(manager).map((s) => [s.npc.id, s]));
    expect(byId.get("ov_1")!.aggressive).toBe(true);
    expect(byId.get("ov_2")!.aggressive).toBe(true);
    // A stray pirate in an Overmind system does NOT gang up on the player.
    expect(byId.get("pirate_1")!.aggressive).toBe(false);
    // A friendly trader co-located in the captured system is never an aggressor.
    expect(byId.get("trader_1")!.aggressive).toBe(false);

    manager.destroy();
  });

  it("flags a pirate aggressive in a PIRATE-controlled system (their own turf)", () => {
    // The faction-matched counterpart: pirates defend the systems they hold.
    const manager = makeManager(
      [
        makeNpc("pirate_1", { role: NpcRole.PIRATE }),
        makeNpc("trader_1", { role: NpcRole.TRADER }),
      ],
      { hostile: true, pirateControlled: true },
    );
    manager.initialize();
    manager.refresh();
    manager.checkGarrisonAggro("sys_a", true);

    const byId = new Map(sprites(manager).map((s) => [s.npc.id, s]));
    expect(byId.get("pirate_1")!.aggressive).toBe(true);
    // A friendly trader is still spared.
    expect(byId.get("trader_1")!.aggressive).toBe(false);
    manager.destroy();
  });

  it("never flags garrison sprites aggressive in a non-hostile system", () => {
    const manager = makeManager(
      [
        makeNpc("ov_1", { role: NpcRole.PATROL, faction: Faction.OVERMIND }),
        makeNpc("pirate_1", { role: NpcRole.PIRATE }),
      ],
      { hostile: false },
    );
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    for (const s of sprites(manager)) expect(s.aggressive).toBe(false);
    manager.destroy();
  });

  it("clears aggression once a system stops being hostile", () => {
    const manager = makeManager(
      [makeNpc("ov_1", { role: NpcRole.PATROL, faction: Faction.OVERMIND })],
      { hostile: true },
    );
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", true);
    expect(sprites(manager)[0].aggressive).toBe(true);

    manager.checkGarrisonAggro("sys_a", false);
    expect(sprites(manager)[0].aggressive).toBe(false);
    manager.destroy();
  });

  it("aggressive garrison sprites pursue the player ship in update()", () => {
    const physics = new ShipPhysics(0, 0, 0.3);
    const manager = makeManager(
      [makeNpc("ov_1", { role: NpcRole.PATROL, faction: Faction.OVERMIND })],
      { hostile: true, physics },
    );
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", true);

    const sprite = sprites(manager)[0];
    sprite.x = 500;
    sprite.y = 0;
    const before = sprite.x;

    // Several update ticks advance the chase toward the player at (0,0).
    for (let i = 0; i < 20; i++) manager.update(100, 0);

    expect(sprite.x).toBeLessThan(before);
    manager.destroy();
  });
});

// ---------------------------------------------------------------------------
// Off-screen garrison combat: an OVERMIND garrison defends its captured system
// against friendly NPCs that wander into it (mirrors the wandering-pirate path).
// ---------------------------------------------------------------------------
function makeOffscreenGalaxy(): Galaxy {
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
    "galaxy_garrison_combat",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

describe("NpcSimulator garrison off-screen combat", () => {
  it("an Overmind garrison destroys a friendly NPC that wanders into a captured system", () => {
    const galaxy = makeOffscreenGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("garrison_combat"));

    // A friendly trader strays into the captured system (player elsewhere).
    const victim = makeNpc("stray_trader", {
      role: NpcRole.TRADER,
      faction: Faction.INDEPENDENT,
      systemId: "sys_a",
      hull: 100,
    });
    galaxy.npcShips.push(victim);

    const simAny = sim as unknown as {
      garrison: {
        resolveOffscreenCombat(
          g: Galaxy,
          rng: SeededRNG,
          playerSystemId?: string,
        ): void;
      };
    };
    for (let i = 0; i < 20 && victim.state !== NpcState.DEAD; i++) {
      simAny.garrison.resolveOffscreenCombat(
        galaxy,
        new SeededRNG(`gc_${i}`),
        "elsewhere",
      );
    }

    expect(victim.state).toBe(NpcState.DEAD);
    expect(victim.hullHP).toBe(0);
  });

  it("leaves a friendly NPC unharmed when no garrison shares its system", () => {
    const galaxy = makeOffscreenGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("garrison_safe"));

    // Friendly trader is in the friendly system sys_b — no garrison there.
    const safe = makeNpc("safe_trader", {
      role: NpcRole.TRADER,
      faction: Faction.INDEPENDENT,
      systemId: "sys_b",
      hull: 100,
    });
    galaxy.npcShips.push(safe);

    const simAny = sim as unknown as {
      garrison: {
        resolveOffscreenCombat(
          g: Galaxy,
          rng: SeededRNG,
          playerSystemId?: string,
        ): void;
      };
    };
    for (let i = 0; i < 20; i++) {
      simAny.garrison.resolveOffscreenCombat(
        galaxy,
        new SeededRNG(`safe_${i}`),
        "elsewhere",
      );
    }

    expect(safe.hullHP).toBe(100);
    expect(safe.state).not.toBe(NpcState.DEAD);
  });
});
