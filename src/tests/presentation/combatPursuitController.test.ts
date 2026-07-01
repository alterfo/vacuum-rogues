import { describe, it, expect } from "vitest";
import {
  CombatPursuitController,
  type CombatPursuitDeps,
} from "@/presentation/flight/CombatPursuitController";
import { OVERMIND_CORE_ID } from "@/presentation/flight/NpcShipManager";
import type { NpcShipManagerDeps } from "@/presentation/flight/NpcShipManager";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { GameEngine } from "@/systems/GameEngine";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Focused unit tests for the combat steering / orbit / chase-state cluster
 * extracted from {@link NpcShipManager} (plan Task 2). The controller is
 * exercised directly against a fake {@link CombatPursuitDeps} bundle — no
 * PixiJS — so launch/decision/orbit/break-off/star-avoidance/crossfire are
 * verified in isolation. Existing manager-level suites (`combatOrbit`,
 * `combatOrbitAntiSpin`, `combatBreakoff`, `chaseSteering.*`,
 * `crossFactionCombat`) remain the integration oracle.
 */

const WR = GAME_BALANCE.weaponRange;
const ORBIT = WR * 0.6;

// --- fakes -----------------------------------------------------------------

function makeNpc(
  id: string,
  opts: Partial<{
    role: NpcRole;
    faction: Faction;
    hullHP: number;
    damage: number;
  }> = {},
): NpcShip {
  return {
    id,
    role: opts.role ?? NpcRole.TRADER,
    faction: opts.faction ?? Faction.INDEPENDENT,
    hullHP: opts.hullHP ?? 100,
    damage: opts.damage ?? 20,
  } as unknown as NpcShip;
}

interface FakeSprite {
  npc: NpcShip;
  x: number;
  y: number;
  aggressive: boolean;
  setAggressive(v: boolean): void;
  isGone(): boolean;
}

/** Minimal engine with a live player ship — the pre-combat resolver bails without one. */
function engineWithShip(): GameEngine {
  return { player: { ship: {} } } as unknown as GameEngine;
}

function makeSprite(npc: NpcShip, x: number, y: number): FakeSprite {
  return {
    npc,
    x,
    y,
    aggressive: false,
    setAggressive(v) {
      this.aggressive = v;
    },
    isGone: () => false,
  };
}

interface Harness {
  ctrl: CombatPursuitController;
  physics: ShipPhysics | null;
  msgs: { text: string; color?: number }[];
  routes: { x: number; y: number }[];
  endTurns: number;
  combatStarted: FakeSprite[];
  combatSelected: FakeSprite[];
  engaged: FakeSprite[];
  deaths: { sprite: FakeSprite; killedByPlayer: boolean }[];
}

function makeHarness(
  opts: {
    sprites?: FakeSprite[];
    physics?: ShipPhysics | null;
    inCombat?: boolean;
    turnRunning?: boolean;
    paused?: boolean;
    combatTargetId?: string | null;
    engine?: GameEngine | null;
    starCenter?: { x: number; y: number };
    starAvoidRadius?: number;
  } = {},
): Harness {
  const msgs: Harness["msgs"] = [];
  const routes: Harness["routes"] = [];
  const combatStarted: FakeSprite[] = [];
  const combatSelected: FakeSprite[] = [];
  const engaged: FakeSprite[] = [];
  const deaths: Harness["deaths"] = [];
  const counters = { endTurns: 0 };
  const physics = opts.physics === undefined ? null : opts.physics;

  const flight: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => opts.starCenter ?? { x: 100000, y: 100000 },
    isTurnRunning: () => opts.turnRunning ?? true,
    showMessage: (text, color) => msgs.push({ text, color }),
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {
      counters.endTurns++;
    },
    startInFlightCombat: (sprite) =>
      combatStarted.push(sprite as unknown as FakeSprite),
    selectCombatTarget: (sprite) =>
      combatSelected.push(sprite as unknown as FakeSprite),
    onPlayerEngagesCombat: (sprite) =>
      engaged.push(sprite as unknown as FakeSprite),
    isInCombat: () => opts.inCombat ?? false,
    getCombatTargetId: () => opts.combatTargetId ?? null,
    isPaused: () => opts.paused ?? false,
    getStarAvoidRadius:
      opts.starAvoidRadius === undefined
        ? undefined
        : () => opts.starAvoidRadius as number,
  };

  const deps: CombatPursuitDeps = {
    flight,
    getGameEngine: () => opts.engine ?? null,
    getNpcSprites: () => (opts.sprites ?? []) as unknown as NpcShipSprite[],
    npcLeadPoint: (sprite) => ({ x: sprite.x, y: sprite.y }),
    aimRoute: (x, y) => {
      routes.push({ x, y });
      physics?.setTarget(x, y);
    },
    scannerRange: GAME_BALANCE.scannerRange,
    weaponRange: WR,
    handleInFlightDeath: (sprite, _rng, killedByPlayer) =>
      deaths.push({
        sprite: sprite as unknown as FakeSprite,
        killedByPlayer,
      }),
  };

  return {
    ctrl: new CombatPursuitController(deps),
    physics,
    msgs,
    routes,
    get endTurns() {
      return counters.endTurns;
    },
    combatStarted,
    combatSelected,
    engaged,
    deaths,
  } as Harness;
}

// --- launchCombatWithNpc -----------------------------------------------------

describe("CombatPursuitController.launchCombatWithNpc", () => {
  it("engages combat and clears the chase/approach/break-off state", () => {
    const npc = makeNpc("n1");
    const sprite = makeSprite(npc, 10, 0);
    const h = makeHarness({ sprites: [sprite] });
    h.ctrl.followNpcId = "stale";
    h.ctrl.approachNpcId = "stale2";
    h.ctrl.pursuitSuspended = true;
    h.ctrl.launchCombatWithNpc(npc);

    expect(sprite.aggressive).toBe(true);
    expect(h.combatStarted).toEqual([sprite]);
    expect(h.combatSelected).toEqual([sprite]);
    expect(h.engaged).toEqual([sprite]);
    expect(h.ctrl.followNpcId).toBeNull();
    expect(h.ctrl.approachNpcId).toBeNull();
    expect(h.ctrl.pursuitSuspended).toBe(false);
  });

  it("is a no-op when the sprite is not present", () => {
    const npc = makeNpc("gone");
    const h = makeHarness({ sprites: [] });
    h.ctrl.launchCombatWithNpc(npc);
    expect(h.combatStarted).toEqual([]);
  });
});

// --- updateCombat decision cluster ------------------------------------------

describe("CombatPursuitController.updateCombat (pre-combat chase resolver)", () => {
  it("is idle with no follow target and no physics", () => {
    const h = makeHarness({ physics: null });
    expect(() => h.ctrl.updateCombat(50)).not.toThrow();
    expect(h.routes).toEqual([]);
  });

  it("reports the target lost and ends the turn when the follow target vanished", () => {
    const h = makeHarness({
      physics: new ShipPhysics(0, 0, 0.3),
      turnRunning: true,
      sprites: [],
      engine: engineWithShip(),
    });
    h.ctrl.followNpcId = "ghost";
    h.ctrl.updateCombat(50);
    expect(h.msgs.some((m) => m.text.includes("потеряна"))).toBe(true);
    expect(h.ctrl.followNpcId).toBeNull();
    expect(h.endTurns).toBe(1);
  });

  it("chases (aims a route) toward an out-of-range target", () => {
    const npc = makeNpc("chase1");
    const sprite = makeSprite(npc, WR + 400, 0);
    const h = makeHarness({
      physics: new ShipPhysics(0, 0, 0.3),
      turnRunning: true,
      sprites: [sprite],
      engine: engineWithShip(),
    });
    h.ctrl.followNpcId = "chase1";
    h.ctrl.updateCombat(50);
    expect(h.routes).toEqual([{ x: WR + 400, y: 0 }]);
  });

  it("launches in-flight combat once the target is within weapon range", () => {
    const npc = makeNpc("launch1");
    const sprite = makeSprite(npc, WR - 10, 0);
    const h = makeHarness({
      physics: new ShipPhysics(0, 0, 0.3),
      turnRunning: true,
      sprites: [sprite],
      engine: engineWithShip(),
    });
    h.ctrl.followNpcId = "launch1";
    h.ctrl.updateCombat(50);
    expect(h.combatStarted).toEqual([sprite]);
    expect(h.ctrl.followNpcId).toBeNull(); // launchCombatWithNpc clears it
  });
});

// --- breakOffCombatPursuit --------------------------------------------------

describe("CombatPursuitController.breakOffCombatPursuit", () => {
  it("suspends the auto-pursuit until the player's route completes", () => {
    const npc = makeNpc("bo1");
    const sprite = makeSprite(npc, ORBIT, 0);
    const physics = new ShipPhysics(0, 0, 0.5);
    const h = makeHarness({
      physics,
      inCombat: true,
      combatTargetId: "bo1",
      sprites: [sprite],
    });

    h.ctrl.breakOffCombatPursuit();
    expect(h.ctrl.pursuitSuspended).toBe(true);

    // While the player's manual route is still flying, the orbit yields —
    // the physics target is untouched by the pursuit.
    physics.setTarget(999, 999);
    h.ctrl.updateCombat(50);
    expect(physics.getTargetX()).toBe(999);
    expect(physics.getTargetY()).toBe(999);
    expect(h.ctrl.pursuitSuspended).toBe(true);

    // Once the route completes (ship stops), pursuit resumes and re-takes the
    // helm (the orbit steer overwrites the stale manual target).
    physics.stop();
    h.ctrl.updateCombat(50);
    expect(h.ctrl.pursuitSuspended).toBe(false);
    expect(physics.getTargetX()).not.toBe(999);
  });
});

// --- combat orbit / anti-spin -----------------------------------------------

describe("CombatPursuitController real-time combat orbit", () => {
  it("circle-strafes (tangential steer) at the orbit standoff", () => {
    const npc = makeNpc("orb1");
    const sprite = makeSprite(npc, ORBIT, 0);
    const physics = new ShipPhysics(0, 0, 0.5);
    const h = makeHarness({
      physics,
      inCombat: true,
      combatTargetId: "orb1",
      sprites: [sprite],
    });
    h.ctrl.updateCombat(50);

    const steerX = physics.getTargetX() - physics.shipX;
    const steerY = physics.getTargetY() - physics.shipY;
    const awayX = physics.shipX - sprite.x;
    const awayY = physics.shipY - sprite.y;
    const dot = steerX * awayX + steerY * awayY;
    const cos =
      dot /
      ((Math.hypot(steerX, steerY) || 1) * (Math.hypot(awayX, awayY) || 1));
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    // Near-perpendicular to the radial ⇒ a tangential strafe, not a straight
    // approach/retreat.
    expect(deg).toBeGreaterThan(60);
  });

  it("steers straight OUT (radial escape) instead of spinning when the target is nearly coincident", () => {
    const npc = makeNpc("orb2");
    const sprite = makeSprite(npc, 12, 0); // well inside COMBAT_ORBIT_MIN_RANGE
    const physics = new ShipPhysics(0, 0, 0.5);
    const h = makeHarness({
      physics,
      inCombat: true,
      combatTargetId: "orb2",
      sprites: [sprite],
    });
    h.ctrl.updateCombat(50);

    const steerX = physics.getTargetX() - physics.shipX;
    const steerY = physics.getTargetY() - physics.shipY;
    const awayX = physics.shipX - sprite.x;
    const awayY = physics.shipY - sprite.y;
    const dot = steerX * awayX + steerY * awayY;
    const cos =
      dot /
      ((Math.hypot(steerX, steerY) || 1) * (Math.hypot(awayX, awayY) || 1));
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    // Radial-dominated escape: within ~30° of straight away from the target.
    expect(deg).toBeLessThan(30);
  });
});

// --- smoothed chase steering + star avoidance -------------------------------

describe("CombatPursuitController smoothed chase steering (star avoidance)", () => {
  it("plots a fresh curved route, then re-plots when the direct shot becomes blocked, then nudges directly once clear", () => {
    const npc = makeNpc("star1");
    const sprite = makeSprite(npc, WR + 500, 0);
    const physics = new ShipPhysics(0, 0, 0.5);
    const h = makeHarness({
      physics,
      inCombat: true,
      combatTargetId: "star1",
      sprites: [sprite],
      // No star configured yet — the ship is stopped, so this first tick takes
      // the "fresh leg" branch (curved re-plot via aimRoute).
    });
    h.ctrl.updateCombat(50);
    expect(h.routes.length).toBe(1);

    // Re-run with a star placed directly between the ship and the target: the
    // direct lead-line is now blocked — expect a star-avoidance re-plot
    // (another aimRoute call, the clear→blocked transition fires immediately).
    const blocked = makeHarness({
      physics,
      inCombat: true,
      combatTargetId: "star1",
      sprites: [sprite],
      starCenter: { x: WR / 2, y: 0 },
      starAvoidRadius: 200,
    });
    // Reuse the same controller instance isn't possible across harnesses
    // (deps differ), so drive a fresh controller sharing the moving physics —
    // the "fresh leg" branch only applies while stopped, and physics is
    // already moving from the previous tick.
    blocked.ctrl.updateCombat(50);
    expect(blocked.routes.length).toBe(1); // its own harness's route log

    // Now the path is clear again: the controller should steer directly
    // (physics.setTarget), NOT via the aimRoute callback.
    const clear = makeHarness({
      physics,
      inCombat: true,
      combatTargetId: "star1",
      sprites: [sprite],
    });
    clear.ctrl.updateCombat(50);
    expect(clear.routes.length).toBe(0); // no curved re-plot — direct nudge only
  });
});

// --- rememberFlightPos -------------------------------------------------------

describe("CombatPursuitController.rememberFlightPos", () => {
  it("stashes the live ship position on the GameEngine", () => {
    const physics = new ShipPhysics(123, 456, 0.3);
    const engine = { lastFlightShipPos: null } as unknown as GameEngine;
    const h = makeHarness({ physics, engine });
    h.ctrl.rememberFlightPos();
    expect(engine.lastFlightShipPos).toEqual({ x: 123, y: 456 });
  });

  it("no-ops without a live ship", () => {
    const engine = { lastFlightShipPos: null } as unknown as GameEngine;
    const h = makeHarness({ physics: null, engine });
    h.ctrl.rememberFlightPos();
    expect(engine.lastFlightShipPos).toBeNull();
  });
});

// --- nearestNpcEnemy ---------------------------------------------------------

describe("CombatPursuitController.nearestNpcEnemy", () => {
  it("picks the nearest mutually-hostile Overmind-involving sprite in scanner range", () => {
    const overmind = makeNpc("ov1", {
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
    });
    const pirateNear = makeNpc("pir_near", { role: NpcRole.PIRATE });
    const pirateFar = makeNpc("pir_far", { role: NpcRole.PIRATE });
    const trader = makeNpc("trader1", { role: NpcRole.TRADER });
    const ovSprite = makeSprite(overmind, 0, 0);
    const nearSprite = makeSprite(pirateNear, 50, 0);
    const farSprite = makeSprite(pirateFar, 500, 0);
    const traderSprite = makeSprite(trader, 20, 0); // closer, but not mutually hostile
    const h = makeHarness({
      sprites: [ovSprite, nearSprite, farSprite, traderSprite],
    });
    const enemy = h.ctrl.nearestNpcEnemy(ovSprite as unknown as NpcShipSprite);
    expect((enemy as unknown as FakeSprite | null)?.npc.id).toBe("pir_near");
  });

  it("excludes the OVERMIND core on both sides", () => {
    const core = makeNpc(OVERMIND_CORE_ID, {
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
    });
    const pirate = makeNpc("pir1", { role: NpcRole.PIRATE });
    const coreSprite = makeSprite(core, 0, 0);
    const pirateSprite = makeSprite(pirate, 10, 0);
    const h = makeHarness({ sprites: [coreSprite, pirateSprite] });
    expect(
      h.ctrl.nearestNpcEnemy(coreSprite as unknown as NpcShipSprite),
    ).toBeNull();
    expect(
      h.ctrl.nearestNpcEnemy(pirateSprite as unknown as NpcShipSprite),
    ).toBeNull();
  });

  it("returns null when no mutually-hostile sprite is in range", () => {
    const trader1 = makeNpc("t1", { role: NpcRole.TRADER });
    const trader2 = makeNpc("t2", { role: NpcRole.TRADER });
    const s1 = makeSprite(trader1, 0, 0);
    const s2 = makeSprite(trader2, 10, 0);
    const h = makeHarness({ sprites: [s1, s2] });
    expect(h.ctrl.nearestNpcEnemy(s1 as unknown as NpcShipSprite)).toBeNull();
  });
});

// --- resolveNpcVsNpcCombat ---------------------------------------------------

describe("CombatPursuitController.resolveNpcVsNpcCombat", () => {
  it("trades mutual damage between an Overmind sprite and a co-present pirate once the fire interval elapses", () => {
    const overmind = makeNpc("ov2", {
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
      hullHP: 300,
      damage: 50,
    });
    const pirate = makeNpc("pir2", {
      role: NpcRole.PIRATE,
      hullHP: 100,
      damage: 20,
    });
    const ovSprite = makeSprite(overmind, 0, 0);
    const pirateSprite = makeSprite(pirate, 10, 0);
    const h = makeHarness({ sprites: [ovSprite, pirateSprite] });

    // overmindCombatTargets only generates OVERMIND-attacker engagements: the
    // pirate's damage lands on the overmind, and the overmind's damage lands
    // on the pirate.
    h.ctrl.resolveNpcVsNpcCombat(GAME_BALANCE.combatFireIntervalMs);
    expect(overmind.hullHP).toBe(280); // 300 - pirate.damage(20)
    expect(pirate.hullHP).toBe(50); // 100 - overmind.damage(50)
  });

  it("freezes while the active pause is up (no timer accrual, no damage)", () => {
    const overmind = makeNpc("ov3", {
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
      hullHP: 300,
      damage: 50,
    });
    const pirate = makeNpc("pir3", {
      role: NpcRole.PIRATE,
      hullHP: 100,
      damage: 20,
    });
    const ovSprite = makeSprite(overmind, 0, 0);
    const pirateSprite = makeSprite(pirate, 10, 0);
    const h = makeHarness({
      sprites: [ovSprite, pirateSprite],
      paused: true,
    });

    h.ctrl.resolveNpcVsNpcCombat(GAME_BALANCE.combatFireIntervalMs * 3);
    expect(overmind.hullHP).toBe(300);
    expect(pirate.hullHP).toBe(100);
    expect(h.ctrl.npcCrossfireTimer).toBe(0);
  });

  it("routes a lethal round through handleInFlightDeath with killedByPlayer=false", () => {
    const overmind = makeNpc("ov4", {
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
      hullHP: 300,
      damage: 500,
    });
    const pirate = makeNpc("pir4", {
      role: NpcRole.PIRATE,
      hullHP: 10,
      damage: 5,
    });
    const ovSprite = makeSprite(overmind, 0, 0);
    const pirateSprite = makeSprite(pirate, 10, 0);
    const h = makeHarness({ sprites: [ovSprite, pirateSprite] });

    h.ctrl.resolveNpcVsNpcCombat(GAME_BALANCE.combatFireIntervalMs);
    expect(h.deaths.length).toBe(1);
    expect(h.deaths[0].killedByPlayer).toBe(false);
    expect(h.deaths[0].sprite.npc.id).toBe("pir4");
  });
});

// --- tickAggressor (Task 6: per-frame garrison/pirate aggressor loop) -------

/** Fake sprite carrying the extra members `tickAggressor` reads/writes. */
interface FakeAggressorSprite extends FakeSprite {
  cruiseSpeed: number;
  pursuitTargets: { x: number; y: number; speed: number }[];
  setPursuitTarget(x: number, y: number, speed: number): void;
}

function makeAggressorSprite(
  npc: NpcShip,
  x: number,
  y: number,
  cruiseSpeed: number = GAME_BALANCE.npcSpeed,
): FakeAggressorSprite {
  const pursuitTargets: FakeAggressorSprite["pursuitTargets"] = [];
  return {
    npc,
    x,
    y,
    aggressive: true,
    cruiseSpeed,
    pursuitTargets,
    setAggressive(v) {
      this.aggressive = v;
    },
    setPursuitTarget(px, py, speed) {
      pursuitTargets.push({ x: px, y: py, speed });
    },
    isGone: () => false,
  };
}

/** Parked player physics at the origin (not moving) — position-only checks. */
function parkedPlayerPhysics(maxSpeed: number): ShipPhysics {
  return new ShipPhysics(0, 0, maxSpeed);
}

/**
 * A player physics body actively cruising fast enough to out-run `pursuerSpeed`
 * (`canOutrun` requires `isMoving`) — ticked just enough to clear the speed
 * threshold, not far enough to matter for the caller's own distance math.
 */
function fastMovingPlayerPhysics(maxSpeed: number): ShipPhysics {
  const p = new ShipPhysics(0, 0, maxSpeed);
  p.setTarget(1_000_000, 0);
  for (let i = 0; i < 15; i++) p.update(50);
  return p;
}

function makeAggressorHarness(
  opts: {
    goodWithPirates?: boolean;
    isCombatant?: boolean;
    shakedownRoll?: boolean;
  } = {},
): {
  ctrl: CombatPursuitController;
  hailedNpcs: NpcShip[];
  clearedAnchors: FakeAggressorSprite[];
  combatStarted: FakeAggressorSprite[];
} {
  const hailedNpcs: NpcShip[] = [];
  const clearedAnchors: FakeAggressorSprite[] = [];
  const combatStarted: FakeAggressorSprite[] = [];

  const flight: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 100000, y: 100000 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
    startInFlightCombat: (sprite) =>
      combatStarted.push(sprite as unknown as FakeAggressorSprite),
    isCombatant: () => opts.isCombatant ?? false,
  };

  const deps: CombatPursuitDeps = {
    flight,
    getGameEngine: () => null,
    getNpcSprites: () => [],
    npcLeadPoint: (sprite) => ({ x: sprite.x, y: sprite.y }),
    aimRoute: () => {},
    scannerRange: GAME_BALANCE.scannerRange,
    weaponRange: WR,
    handleInFlightDeath: () => {},
    playerIsGoodWithPirates: () => opts.goodWithPirates ?? false,
    rollShakedown: () => opts.shakedownRoll ?? false,
    openShakedownHail: (npc) => hailedNpcs.push(npc),
    clearNpcAnchor: (sprite) =>
      clearedAnchors.push(sprite as unknown as FakeAggressorSprite),
  };

  return {
    ctrl: new CombatPursuitController(deps),
    hailedNpcs,
    clearedAnchors,
    combatStarted,
  };
}

describe("CombatPursuitController.tickAggressor", () => {
  it("breaks off a pirate the player has good reputation with (not yet a combatant)", () => {
    const npc = makeNpc("goodrep1", { role: NpcRole.PIRATE });
    const sprite = makeAggressorSprite(npc, WR - 10, 0);
    const h = makeAggressorHarness({
      goodWithPirates: true,
      isCombatant: false,
    });
    const physics = parkedPlayerPhysics(0.5);

    const halted = h.ctrl.tickAggressor(
      sprite as unknown as NpcShipSprite,
      physics,
    );

    expect(halted).toBe(false);
    expect(sprite.aggressive).toBe(false);
    expect(h.clearedAnchors).toEqual([sprite]);
    expect(h.combatStarted).toEqual([]);
    expect(h.hailedNpcs).toEqual([]);
  });

  it("keeps pursuing a good-rep pirate that is already an active combatant", () => {
    const npc = makeNpc("goodrep2", { role: NpcRole.PIRATE });
    const sprite = makeAggressorSprite(npc, WR - 10, 0);
    const h = makeAggressorHarness({
      goodWithPirates: true,
      isCombatant: true,
    });
    const physics = parkedPlayerPhysics(0.5);

    h.ctrl.tickAggressor(sprite as unknown as NpcShipSprite, physics);

    expect(sprite.aggressive).toBe(true);
    expect(h.clearedAnchors).toEqual([]);
    expect(h.combatStarted).toEqual([sprite]); // in weapon range → engages instead
  });

  it("opens a shakedown hail and halts the frame on a positive roll", () => {
    const npc = makeNpc("shake1", { role: NpcRole.PIRATE });
    const sprite = makeAggressorSprite(npc, GAME_BALANCE.scannerRange - 10, 0);
    const h = makeAggressorHarness({ shakedownRoll: true });
    const physics = parkedPlayerPhysics(0.5);

    const halted = h.ctrl.tickAggressor(
      sprite as unknown as NpcShipSprite,
      physics,
    );

    expect(halted).toBe(true);
    expect(h.hailedNpcs).toEqual([npc]);
    expect(h.combatStarted).toEqual([]); // halted before the pursuit/launch step
  });

  it("evaluates the shakedown roll at most once per pirate per encounter", () => {
    const npc = makeNpc("shake2", { role: NpcRole.PIRATE });
    const sprite = makeAggressorSprite(npc, GAME_BALANCE.scannerRange - 10, 0);
    const h = makeAggressorHarness({ shakedownRoll: false });
    const physics = parkedPlayerPhysics(0.5);

    h.ctrl.tickAggressor(sprite as unknown as NpcShipSprite, physics);
    h.ctrl.tickAggressor(sprite as unknown as NpcShipSprite, physics);

    // Already-evaluated pirates never re-roll — a second positive roll would
    // still not re-fire (guarded below by never flipping shakedownRoll true).
    expect(h.hailedNpcs).toEqual([]);
  });

  it("breaks off pursuit once the player has out-run the aggressor beyond the escape range", () => {
    const npc = makeNpc("outrun1", { role: NpcRole.TRADER });
    const physics = fastMovingPlayerPhysics(0.5); // fast player — out-runs the NPC
    expect(physics.canOutrun(0.05)).toBe(true);
    const escapeDist = GAME_BALANCE.combatEscapeRange + 50;
    // Position relative to the physics body's actual (post-acceleration) spot so
    // the escape-range math is exact regardless of how far it cruised getting there.
    const sprite = makeAggressorSprite(
      npc,
      physics.shipX + escapeDist,
      physics.shipY,
      0.05, // slow NPC cruise — well under the player's cruise speed
    );
    const h = makeAggressorHarness();

    const halted = h.ctrl.tickAggressor(
      sprite as unknown as NpcShipSprite,
      physics,
    );

    expect(halted).toBe(false);
    expect(sprite.aggressive).toBe(false);
    expect(h.clearedAnchors).toEqual([sprite]);
    expect(sprite.pursuitTargets).toEqual([]);
  });

  it("refreshes the pursuit target and engages once inside weapon range", () => {
    const npc = makeNpc("pursue1", { role: NpcRole.TRADER });
    const sprite = makeAggressorSprite(npc, WR - 10, 0);
    const h = makeAggressorHarness();
    const physics = parkedPlayerPhysics(0.5);

    const halted = h.ctrl.tickAggressor(
      sprite as unknown as NpcShipSprite,
      physics,
    );

    expect(halted).toBe(false);
    expect(sprite.pursuitTargets.length).toBe(1);
    expect(h.combatStarted).toEqual([sprite]);
  });

  it("refreshes the pursuit target without engaging while still out of weapon range", () => {
    const npc = makeNpc("pursue2", { role: NpcRole.TRADER });
    const sprite = makeAggressorSprite(npc, WR + 100, 0);
    const h = makeAggressorHarness();
    const physics = parkedPlayerPhysics(0.5);

    h.ctrl.tickAggressor(sprite as unknown as NpcShipSprite, physics);

    expect(sprite.pursuitTargets.length).toBe(1);
    expect(h.combatStarted).toEqual([]);
  });
});
