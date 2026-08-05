import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import {
  mutuallyHostile,
  overmindCombatTargets,
  type RangedNpc,
} from "@/systems/npc/factionHostility";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { SeededRNG } from "@/utils/seededRNG";
import { GAME_BALANCE } from "@/config/balance";
import { StarType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

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

describe("mutuallyHostile — spontaneous NPC-vs-NPC enmity", () => {
  it("pirate ↔ Overmind are mutual enemies (both directions)", () => {
    expect(mutuallyHostile("pirate", "overmind", { pirateRep: 0 })).toBe(true);
    expect(mutuallyHostile("overmind", "pirate", { pirateRep: 0 })).toBe(true);
  });

  it("the Overmind ↔ the law (ranger/patrol) are mutual enemies", () => {
    expect(mutuallyHostile("overmind", "ranger", { pirateRep: 0 })).toBe(true);
    expect(mutuallyHostile("overmind", "patrol", { pirateRep: 0 })).toBe(true);
  });

  it("peaceful kinds never spontaneously brawl (one-sided predation only)", () => {
    expect(mutuallyHostile("pirate", "trader", { pirateRep: 0 })).toBe(false);
    expect(mutuallyHostile("overmind", "trader", { pirateRep: 0 })).toBe(false);
    expect(mutuallyHostile("pirate", "player", { pirateRep: 0 })).toBe(false);
  });

  it("good pirate rep does not shield the Overmind's mutual enmity with pirates", () => {
    expect(mutuallyHostile("pirate", "overmind", { pirateRep: 100 })).toBe(
      true,
    );
  });
});

describe("overmindCombatTargets — in-flight cross-faction target selection", () => {
  it("an Overmind engages the nearest in-range mutually-hostile ship", () => {
    const combatants: RangedNpc[] = [
      { id: "ov", kind: "overmind", x: 0, y: 0 },
      { id: "ranger", kind: "ranger", x: 30, y: 0 }, // mutual + nearest
      { id: "pirate", kind: "pirate", x: 60, y: 0 }, // mutual but farther
    ];
    const targets = overmindCombatTargets(combatants, 240, { pirateRep: 0 });
    expect(targets.get("ov")).toBe("ranger");
  });

  it("skips a closer peaceful trader (not a mutual enemy)", () => {
    const combatants: RangedNpc[] = [
      { id: "ov", kind: "overmind", x: 0, y: 0 },
      { id: "trader", kind: "trader", x: 10, y: 0 }, // closer, but not mutual
      { id: "pirate", kind: "pirate", x: 50, y: 0 }, // the real target
    ];
    const targets = overmindCombatTargets(combatants, 240, { pirateRep: 0 });
    expect(targets.get("ov")).toBe("pirate");
  });

  it("ignores foes beyond weapon range", () => {
    const combatants: RangedNpc[] = [
      { id: "ov", kind: "overmind", x: 0, y: 0 },
      { id: "pirate", kind: "pirate", x: 300, y: 0 }, // out of range (>240)
    ];
    const targets = overmindCombatTargets(combatants, 240, { pirateRep: 0 });
    expect(targets.size).toBe(0);
  });

  it("is a no-op when no Overmind is present (scoped to Overmind attackers)", () => {
    const combatants: RangedNpc[] = [
      { id: "pirate", kind: "pirate", x: 0, y: 0 },
      { id: "ranger", kind: "ranger", x: 20, y: 0 },
    ];
    const targets = overmindCombatTargets(combatants, 240, { pirateRep: 0 });
    expect(targets.size).toBe(0);
  });
});

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
    "galaxy_crossfaction",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

type OffscreenSim = {
  garrison: {
    resolveOffscreenCombat(
      g: Galaxy,
      rng: SeededRNG,
      playerSystemId?: string,
    ): void;
  };
};

describe("NpcSimulator cross-faction off-screen combat", () => {
  it("a wandering Overmind and pirate deal MUTUAL damage in one round", () => {
    const galaxy = makeGalaxy();
    const ov = makeNpc("wander_ov", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      systemId: "sys_a",
      hull: 300,
      damage: 28,
    });
    const pirate = makeNpc("wander_pirate", {
      role: NpcRole.PIRATE,
      faction: FactionType.OUTLANDERS as unknown as Faction,
      systemId: "sys_a",
      hull: 110,
      damage: 30,
    });
    galaxy.npcShips.push(ov, pirate);

    const sim = new NpcSimulator();
    (sim as unknown as OffscreenSim).garrison.resolveOffscreenCombat(
      galaxy,
      new SeededRNG("cf_round"),
      "elsewhere",
    );

    expect(ov.hullHP).toBeLessThan(300);
    expect(pirate.hullHP).toBeLessThan(110);
  });

  it("the Overmind eventually destroys the pirate (matrix-driven, player elsewhere)", () => {
    const galaxy = makeGalaxy();
    const ov = makeNpc("wander_ov", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      systemId: "sys_a",
      hull: 300,
      damage: 28,
    });
    const pirate = makeNpc("wander_pirate", {
      role: NpcRole.PIRATE,
      faction: FactionType.OUTLANDERS as unknown as Faction,
      systemId: "sys_a",
      hull: 110,
      damage: 30,
    });
    galaxy.npcShips.push(ov, pirate);

    const sim = new NpcSimulator();
    for (let i = 0; i < 30 && pirate.state !== NpcState.DEAD; i++) {
      (sim as unknown as OffscreenSim).garrison.resolveOffscreenCombat(
        galaxy,
        new SeededRNG(`cf_${i}`),
        "elsewhere",
      );
    }

    expect(pirate.state).toBe(NpcState.DEAD);
    expect(pirate.hullHP).toBe(0);
    expect(ov.hullHP).toBeLessThan(300);
  });

  it("leaves a co-present friendly trader to the existing pirate-raid path", () => {
    const galaxy = makeGalaxy();
    const pirate = makeNpc("raider", {
      role: NpcRole.PIRATE,
      systemId: "sys_a",
      hull: 200,
      damage: 30,
    });
    const trader = makeNpc("victim_trader", {
      role: NpcRole.TRADER,
      systemId: "sys_a",
      hull: 100,
      damage: 5,
    });
    galaxy.npcShips.push(pirate, trader);

    const sim = new NpcSimulator();
    (sim as unknown as OffscreenSim).garrison.resolveOffscreenCombat(
      galaxy,
      new SeededRNG("raid_round"),
      "elsewhere",
    );

    expect(trader.hullHP).toBeLessThan(100);
  });
});

function makeManager(npcs: NpcShip[]): NpcShipManager {
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
    isHostileSystem: (id: string) => id === "sys_a",
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
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

type InFlightSprites = Array<{
  npc: NpcShip;
  x: number;
  y: number;
}>;

function spritesOf(manager: NpcShipManager): InFlightSprites {
  return (manager as unknown as { npcSprites: InFlightSprites }).npcSprites;
}

function crossfire(manager: NpcShipManager, dt: number): void {
  (
    manager as unknown as { resolveNpcVsNpcCombat(deltaTime: number): void }
  ).resolveNpcVsNpcCombat(dt);
}

describe("NpcShipManager in-flight NPC-vs-NPC combat", () => {
  it("an Overmind sprite and a co-present pirate trade mutual hull damage", () => {
    const ov = makeNpc("ov_flight", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hull: 300,
      damage: 50,
    });
    const pirate = makeNpc("pirate_flight", {
      role: NpcRole.PIRATE,
      hull: 100,
      damage: 20,
    });
    const manager = makeManager([ov, pirate]);
    manager.initialize();

    const sprites = spritesOf(manager);
    const ovSprite = sprites.find((s) => s.npc.id === "ov_flight")!;
    const piSprite = sprites.find((s) => s.npc.id === "pirate_flight")!;
    ovSprite.x = 0;
    ovSprite.y = 0;
    piSprite.x = 100;
    piSprite.y = 0;

    crossfire(manager, GAME_BALANCE.combatFireIntervalMs);

    expect(pirate.hullHP).toBe(50);
    expect(ov.hullHP).toBe(280);
    expect(manager.npcCount).toBe(2);

    manager.destroy();
  });

  it("a lethal round removes the pirate from the scene and the galaxy", () => {
    const ov = makeNpc("ov_flight", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hull: 300,
      damage: 50,
    });
    const pirate = makeNpc("pirate_flight", {
      role: NpcRole.PIRATE,
      hull: 100,
      damage: 20,
    });
    const galaxyNpcs = [ov, pirate];
    const manager = makeManager(galaxyNpcs);
    manager.initialize();

    const sprites = spritesOf(manager);
    sprites.find((s) => s.npc.id === "ov_flight")!.x = 0;
    sprites.find((s) => s.npc.id === "ov_flight")!.y = 0;
    sprites.find((s) => s.npc.id === "pirate_flight")!.x = 100;
    sprites.find((s) => s.npc.id === "pirate_flight")!.y = 0;

    crossfire(manager, GAME_BALANCE.combatFireIntervalMs);
    crossfire(manager, GAME_BALANCE.combatFireIntervalMs);

    expect(manager.npcCount).toBe(1);
    expect(galaxyNpcs.some((n) => n.id === "pirate_flight")).toBe(false);
    expect(ov.hullHP).toBeLessThan(300);

    manager.destroy();
  });

  it("never engages the OVERMIND core via crossfire (no false-positive win)", () => {
    const core = makeNpc("overmind_core", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hull: 450,
      damage: 45,
    });
    const pirate = makeNpc("pirate_flight", {
      role: NpcRole.PIRATE,
      hull: 9999,
      damage: 500, // would one-shot the core if it were not excluded
    });
    const manager = makeManager([core, pirate]);
    manager.initialize();

    const sprites = spritesOf(manager);
    sprites.find((s) => s.npc.id === "overmind_core")!.x = 0;
    sprites.find((s) => s.npc.id === "overmind_core")!.y = 0;
    sprites.find((s) => s.npc.id === "pirate_flight")!.x = 100;
    sprites.find((s) => s.npc.id === "pirate_flight")!.y = 0;

    for (let i = 0; i < 20; i++) {
      crossfire(manager, GAME_BALANCE.combatFireIntervalMs);
    }

    expect(core.hullHP).toBe(450); // untouched — never an engagement participant
    expect(manager.npcCount).toBe(2); // both still present (no win, no kill)

    manager.destroy();
  });

  it("does nothing when no Overmind is present (normal systems unperturbed)", () => {
    const pirate = makeNpc("pirate_only", { role: NpcRole.PIRATE, hull: 100 });
    const trader = makeNpc("trader_only", { role: NpcRole.TRADER, hull: 100 });
    const manager = makeManager([pirate, trader]);
    manager.initialize();

    const sprites = spritesOf(manager);
    sprites.find((s) => s.npc.id === "pirate_only")!.x = 0;
    sprites.find((s) => s.npc.id === "trader_only")!.x = 50;

    crossfire(manager, GAME_BALANCE.combatFireIntervalMs);

    expect(pirate.hullHP).toBe(100);
    expect(trader.hullHP).toBe(100);
    expect(manager.npcCount).toBe(2);

    manager.destroy();
  });
});
