import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  selectPirateTarget,
  wantsToShakedownPlayer,
  shipCombatStrength,
  type PirateTargetCandidate,
} from "@/systems/npc/NpcBrain";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { SeededRNG } from "@/utils/seededRNG";
import type { HostilityContext } from "@/systems/npc/factionHostility";
import { PIRATE_FACTION_ID } from "@/systems/galaxy/landingAccess";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

/** Hostile-rep player: pirates treat as prey. */
const HOSTILE_REP: HostilityContext = { pirateRep: 0 };
/** Good-rep player: pirates leave alone (at the threshold). */
const GOOD_REP: HostilityContext = { pirateRep: GOOD_PIRATE_REP_THRESHOLD };

function candidate(
  id: string,
  kind: PirateTargetCandidate["kind"],
  stats: { hullHP: number; shields: number; damage: number },
): PirateTargetCandidate {
  return { id, kind, stats };
}

describe("selectPirateTarget — pirates pick the weakest prey", () => {
  it("chooses the weaker of two traders", () => {
    const weak = candidate("weak", "trader", {
      hullHP: 20,
      shields: 0,
      damage: 5,
    });
    const strong = candidate("strong", "trader", {
      hullHP: 200,
      shields: 100,
      damage: 40,
    });
    // Order must not decide it — strong-first still yields the weak prey.
    expect(selectPirateTarget([strong, weak], HOSTILE_REP)?.id).toBe("weak");
    expect(selectPirateTarget([weak, strong], HOSTILE_REP)?.id).toBe("weak");
  });

  it("never targets pack-mates (other pirates)", () => {
    const mate = candidate("mate", "pirate", {
      hullHP: 1,
      shields: 0,
      damage: 0,
    });
    const trader = candidate("trader", "trader", {
      hullHP: 100,
      shields: 50,
      damage: 20,
    });
    // The fellow pirate is weaker but still ignored — the trader is the mark.
    expect(selectPirateTarget([mate, trader], HOSTILE_REP)?.id).toBe("trader");
  });

  it("returns null when no candidate is a valid target", () => {
    const mate = candidate("mate", "pirate", {
      hullHP: 50,
      shields: 0,
      damage: 10,
    });
    expect(selectPirateTarget([mate], HOSTILE_REP)).toBeNull();
    expect(selectPirateTarget([], HOSTILE_REP)).toBeNull();
  });

  it("treats the Overmind as prey (mutual enmity) and picks it when weakest", () => {
    const overmind = candidate("om", "overmind", {
      hullHP: 10,
      shields: 0,
      damage: 5,
    });
    const trader = candidate("trader", "trader", {
      hullHP: 100,
      shields: 50,
      damage: 20,
    });
    expect(selectPirateTarget([trader, overmind], HOSTILE_REP)?.id).toBe("om");
  });

  describe("good-pirate-rep player exemption", () => {
    const weakPlayer = candidate("player", "player", {
      hullHP: 10,
      shields: 0,
      damage: 0,
    });
    const trader = candidate("trader", "trader", {
      hullHP: 100,
      shields: 50,
      damage: 20,
    });

    it("targets a hostile-rep player (and prefers it when weakest)", () => {
      expect(selectPirateTarget([trader, weakPlayer], HOSTILE_REP)?.id).toBe(
        "player",
      );
    });

    it("skips a good-rep player even though it is the weakest mark", () => {
      // The player is by far the weakest, yet exempt — the trader is chosen.
      expect(selectPirateTarget([trader, weakPlayer], GOOD_REP)?.id).toBe(
        "trader",
      );
    });

    it("returns null when the only candidate is a good-rep player", () => {
      expect(selectPirateTarget([weakPlayer], GOOD_REP)).toBeNull();
    });
  });
});

/** A hostile (aggressive) pirate with the given combat stats. */
function makePirate(
  stats: { hullHP?: number; shields?: number; damage?: number } = {},
  hostile = true,
  role: NpcRole = NpcRole.PIRATE,
): NpcShip {
  return new NpcShip({
    id: "p1",
    name: "Пират",
    race: FactionType.SYNDICATE,
    faction: Faction.SYNDICATE,
    role,
    hullHP: stats.hullHP ?? 100,
    maxHull: stats.hullHP ?? 100,
    shields: stats.shields ?? 50,
    speed: 0.1,
    damage: stats.damage ?? 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 500,
    reputation: 0,
    hostile,
  });
}

describe("wantsToShakedownPlayer — ransom gated on weakness + good-rep exemption", () => {
  it("never shakes down a good-rep player (at the threshold), whatever the roll", () => {
    const pirate = makePirate();
    for (let i = 0; i < 50; i++) {
      // Helpless player (strength 0) → max demand chance, yet rep exempts them.
      expect(
        wantsToShakedownPlayer(
          pirate,
          0,
          GOOD_PIRATE_REP_THRESHOLD,
          new SeededRNG(`g${i}`),
        ),
      ).toBe(false);
    }
  });

  it("still shakes down a player just below the good-rep threshold", () => {
    // chance == maxChance against a helpless player → many seeds must yield true.
    const pirate = makePirate();
    let yes = 0;
    for (let i = 0; i < 50; i++) {
      if (
        wantsToShakedownPlayer(
          pirate,
          0,
          GOOD_PIRATE_REP_THRESHOLD - 1,
          new SeededRNG(`b${i}`),
        )
      ) {
        yes++;
      }
    }
    expect(yes).toBeGreaterThan(0);
  });

  it("is gated on weakness: a pirate the player out-guns never demands, even at hostile rep", () => {
    const weak = makePirate({ hullHP: 10, shields: 0, damage: 2 });
    const playerStrength = shipCombatStrength({
      hullHP: 300,
      shields: 150,
      damage: 60,
    });
    for (let i = 0; i < 50; i++) {
      expect(
        wantsToShakedownPlayer(weak, playerStrength, 0, new SeededRNG(`w${i}`)),
      ).toBe(false);
    }
  });

  it("defers to wantsToShakedown's role/aggression gate (non-pirate, non-hostile)", () => {
    const trader = makePirate({}, true, NpcRole.TRADER);
    const calm = makePirate({}, false);
    for (let i = 0; i < 10; i++) {
      expect(wantsToShakedownPlayer(trader, 0, 0, new SeededRNG(`t${i}`))).toBe(
        false,
      );
      expect(wantsToShakedownPlayer(calm, 0, 0, new SeededRNG(`c${i}`))).toBe(
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// In-flight wiring: a good-rep player is left alone by an aggressive pirate.
// ---------------------------------------------------------------------------

function buildManager(
  pirate: NpcShip,
  pirateRep: number,
): {
  manager: NpcShipManager;
  engaged: Array<{ npc: { id: string } }>;
  physics: ShipPhysics;
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const physics = new ShipPhysics(0, 0, 0.2);
  const galaxy = { npcShips: [pirate] } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: {
      currentSystemId: "sys_a",
      ship: { maxHull: 100, hullHP: 100, shields: 0 },
      getReputation: (factionId: string) =>
        factionId === PIRATE_FACTION_ID ? pirateRep : 0,
    },
  } as unknown as GameEngine;

  const engaged: Array<{ npc: { id: string } }> = [];
  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
    startInFlightCombat: (sprite) =>
      engaged.push(sprite as unknown as { npc: { id: string } }),
  };

  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    gameLayer,
    uiLayer,
    deps,
  );
  manager.initialize();
  return { manager, engaged, physics };
}

describe("NpcShipManager — good pirate rep leaves the player alone (in-flight)", () => {
  it("an aggressive pirate on top of a good-rep player disengages and does NOT open fire", () => {
    const { manager, engaged } = buildManager(
      makePirate(),
      GOOD_PIRATE_REP_THRESHOLD,
    );
    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          x: number;
          y: number;
          aggressive: boolean;
          setAggressive(on: boolean): void;
        }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);
    sprite.x = 0; // on the ship → within weapon range
    sprite.y = 0;

    manager.update(1 / 60, 100);

    expect(engaged.length).toBe(0); // left alone — no in-flight combat opened
    expect(sprite.aggressive).toBe(false); // pirate broke off pursuit

    manager.destroy();
  });

  it("an aggressive pirate still engages a hostile-rep player (gate is rep-driven)", () => {
    // A weak pirate the player out-guns won't bother shaking the player down
    // (chance 0) — so it proceeds straight to the in-flight engage at weapon range.
    const { manager, engaged } = buildManager(
      makePirate({ hullHP: 10, shields: 0, damage: 2 }),
      0,
    );
    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          x: number;
          y: number;
          setAggressive(on: boolean): void;
        }>;
      }
    ).npcSprites[0];
    sprite.setAggressive(true);
    sprite.x = 0;
    sprite.y = 0;

    manager.update(1 / 60, 100);

    expect(engaged.length).toBeGreaterThanOrEqual(1);
    expect(engaged[0].npc.id).toBe("p1");

    manager.destroy();
  });
});
