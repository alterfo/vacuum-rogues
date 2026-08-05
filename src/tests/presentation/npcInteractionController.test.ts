import { describe, it, expect } from "vitest";
import {
  NpcInteractionController,
  type NpcInteractionDeps,
} from "@/presentation/flight/NpcInteractionController";
import type { NpcShipManagerDeps } from "@/presentation/flight/NpcShipManager";
import type { ContactPanelManager } from "@/presentation/flight/ContactPanelManager";
import type { NpcContactCallbacks } from "@/presentation/NpcContactPanel";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { setupPlayerBanking } from "@/systems/banking/economy";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType, NpcGoalKind } from "@/types";
import { PIRATE_FACTION_ID } from "@/systems/galaxy/landingAccess";
import { GAME_BALANCE } from "@/config/balance";

function makeNpc(
  id: string,
  opts: Partial<{
    name: string;
    speed: number;
    faction: string;
    role: string;
    aggressive: boolean;
  }> = {},
): NpcShip {
  let hostile = false;
  return {
    id,
    name: opts.name ?? id,
    speed: opts.speed ?? 40,
    faction: opts.faction ?? "traders",
    role: opts.role ?? "trader",
    goal: undefined,
    isAggressive: () => opts.aggressive ?? false,
    markHostile: () => {
      hostile = true;
    },
    get hostile() {
      return hostile;
    },
  } as unknown as NpcShip;
}

function makeSprite(npc: NpcShip, x: number, y: number): NpcShipSprite {
  return {
    npc,
    x,
    y,
    cruiseSpeed: 30,
    container: { rotation: 0 },
    setAggressive: () => {},
  } as unknown as NpcShipSprite;
}

function makePhysics(maxSpeed: number): ShipPhysics {
  return {
    shipX: 0,
    shipY: 0,
    getMaxSpeed: () => maxSpeed,
  } as unknown as ShipPhysics;
}

interface Harness {
  ctrl: NpcInteractionController;
  panels: {
    lastOpen: {
      npc: NpcShip;
      callbacks: NpcContactCallbacks;
      inRange: boolean;
      scanPower: number;
      context?: string;
    } | null;
    openCount: number;
    closeCount: number;
  };
  msgs: { text: string; color?: number }[];
  routes: { x: number; y: number }[];
  set: {
    followNpcId: string | null;
    approachNpcId: string | null;
    steerTargetId: string | null;
    pursuitSuspended: boolean;
    lastAim: { x: number; y: number } | null;
    anchorsCleared: NpcShipSprite[];
  };
  escalated: NpcShip[];
  launched: NpcShip[];
  combatStarted: NpcShipSprite[];
  combatSelected: NpcShipSprite[];
  endTurns: number;
  clearRouteCount: number;
}

function makeHarness(
  opts: {
    sprites?: NpcShipSprite[];
    physics?: ShipPhysics | null;
    inCombat?: boolean;
    turnRunning?: boolean;
    engine?: GameEngine | null;
  } = {},
): Harness {
  const panels: Harness["panels"] = {
    lastOpen: null,
    openCount: 0,
    closeCount: 0,
  };
  const msgs: Harness["msgs"] = [];
  const routes: Harness["routes"] = [];
  const set: Harness["set"] = {
    followNpcId: null,
    approachNpcId: null,
    steerTargetId: null,
    pursuitSuspended: false,
    lastAim: null,
    anchorsCleared: [],
  };
  const escalated: NpcShip[] = [];
  const launched: NpcShip[] = [];
  const combatStarted: NpcShipSprite[] = [];
  const combatSelected: NpcShipSprite[] = [];
  const counters = { endTurns: 0, clearRoute: 0 };

  const flight: NpcShipManagerDeps = {
    getShipPhysics: () => opts.physics ?? null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 0, y: 0 }),
    isTurnRunning: () => opts.turnRunning ?? false,
    showMessage: (text, color) => msgs.push({ text, color }),
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: (x, y) => routes.push({ x, y }),
    clearRouteTarget: () => {
      counters.clearRoute++;
    },
    endTurn: () => {
      counters.endTurns++;
    },
    startInFlightCombat: (sprite) => combatStarted.push(sprite),
    selectCombatTarget: (sprite) => combatSelected.push(sprite),
    isInCombat: () => opts.inCombat ?? false,
  };

  const fakePanels = {
    open: (
      npc: NpcShip,
      callbacks: NpcContactCallbacks,
      inRange: boolean,
      scanPower: number,
      context?: string,
    ) => {
      panels.openCount++;
      panels.lastOpen = { npc, callbacks, inRange, scanPower, context };
    },
    close: () => {
      panels.closeCount++;
    },
  } as unknown as ContactPanelManager;

  const deps: NpcInteractionDeps = {
    flight,
    panels: fakePanels,
    getGameEngine: () => opts.engine ?? null,
    getNpcSprites: () => opts.sprites ?? [],
    scannerRange: GAME_BALANCE.scannerRange,
    weaponRange: GAME_BALANCE.weaponRange,
    escalateHostility: (npc) => escalated.push(npc),
    launchCombatWithNpc: (npc) => launched.push(npc),
    setFollowNpcId: (id) => {
      set.followNpcId = id;
    },
    setApproachNpcId: (id) => {
      set.approachNpcId = id;
    },
    setSteerTargetId: (id) => {
      set.steerTargetId = id;
    },
    setPursuitSuspended: (v) => {
      set.pursuitSuspended = v;
    },
    setLastAim: (x, y) => {
      set.lastAim = { x, y };
    },
    clearNpcAnchor: (sprite) => {
      set.anchorsCleared.push(sprite);
    },
  };

  return {
    ctrl: new NpcInteractionController(deps),
    panels,
    msgs,
    routes,
    set,
    escalated,
    launched,
    combatStarted,
    combatSelected,
    get endTurns() {
      return counters.endTurns;
    },
    get clearRouteCount() {
      return counters.clearRoute;
    },
  } as Harness;
}

describe("NpcInteractionController.onNpcClick", () => {
  it("opens the contact panel (in range) when idle and not in combat", () => {
    const npc = makeNpc("t1");
    const h = makeHarness({
      sprites: [makeSprite(npc, 10, 0)],
      physics: makePhysics(100),
      turnRunning: false,
      inCombat: false,
    });
    h.ctrl.onNpcClick(npc);
    expect(h.panels.openCount).toBe(1);
    expect(h.panels.lastOpen?.inRange).toBe(true);
    const cb = h.panels.lastOpen?.callbacks;
    expect(cb?.onHail).toBeTypeOf("function");
    expect(cb?.onAttack).toBeTypeOf("function");
    expect(cb?.onApproach).toBeTypeOf("function");
    expect(cb?.onHire).toBeTypeOf("function");
    expect(cb?.onAlly).toBeTypeOf("function");
  });

  it("opens with inRange=false when the ship is beyond scanner range", () => {
    const npc = makeNpc("t2");
    const h = makeHarness({
      sprites: [makeSprite(npc, GAME_BALANCE.scannerRange + 500, 0)],
      physics: makePhysics(100),
    });
    h.ctrl.onNpcClick(npc);
    expect(h.panels.lastOpen?.inRange).toBe(false);
  });

  it("opens the panel while a turn is running (continuous flight keeps ships clickable)", () => {
    const npc = makeNpc("t3");
    const h = makeHarness({
      sprites: [makeSprite(npc, 10, 0)],
      physics: makePhysics(100),
      turnRunning: true,
    });
    h.ctrl.onNpcClick(npc);
    expect(h.panels.openCount).toBe(1);
    expect(h.panels.lastOpen?.inRange).toBe(true);
  });

  it("retargets combat and drops the break-off when clicked mid-fight", () => {
    const npc = makeNpc("t4");
    const sprite = makeSprite(npc, 10, 0);
    const h = makeHarness({
      sprites: [sprite],
      physics: makePhysics(100),
      inCombat: true,
    });
    h.set.pursuitSuspended = true;
    h.ctrl.onNpcClick(npc);
    expect(h.panels.openCount).toBe(0); // no panel mid-fight
    expect(h.combatSelected).toEqual([sprite]);
    expect(h.set.pursuitSuspended).toBe(false);
  });
});

describe("NpcInteractionController.onAttackNpc", () => {
  it("escalates hostility and engages immediately when in weapon range", () => {
    const npc = makeNpc("a1");
    const sprite = makeSprite(npc, GAME_BALANCE.weaponRange - 10, 0);
    const h = makeHarness({ sprites: [sprite], physics: makePhysics(100) });
    h.ctrl.onAttackNpc(npc);
    expect(h.escalated).toEqual([npc]);
    expect(h.launched).toEqual([npc]);
    expect(h.panels.closeCount).toBe(1);
  });

  it("auto-follows toward a lead point when out of weapon range", () => {
    const npc = makeNpc("a2");
    const sprite = makeSprite(npc, GAME_BALANCE.weaponRange + 400, 0);
    const h = makeHarness({ sprites: [sprite], physics: makePhysics(100) });
    h.ctrl.onAttackNpc(npc);
    expect(h.escalated).toEqual([npc]); // still turns hostile
    expect(h.launched).toEqual([]); // but does not engage yet
    expect(h.set.followNpcId).toBe("a2");
    expect(h.set.approachNpcId).toBeNull();
    expect(h.clearRouteCount).toBe(1);
    expect(h.routes.length).toBe(1); // aimRoute plotted a course
    expect(h.set.lastAim).not.toBeNull();
    expect(h.msgs.some((m) => m.text.includes("Перехват"))).toBe(true);
  });
});

describe("NpcInteractionController panel actions", () => {
  it("«Приблизиться» plots a lead course without engaging", () => {
    const npc = makeNpc("p1");
    const sprite = makeSprite(npc, 200, 0);
    const h = makeHarness({ sprites: [sprite], physics: makePhysics(100) });
    h.ctrl.onNpcClick(npc);
    h.panels.lastOpen?.callbacks.onApproach();
    expect(h.set.followNpcId).toBeNull(); // approach is not an attack
    expect(h.set.approachNpcId).toBe("p1");
    expect(h.set.steerTargetId).toBeNull();
    expect(h.routes.length).toBe(1);
    expect(h.launched).toEqual([]);
    expect(h.msgs.some((m) => m.text.includes("Сближение"))).toBe(true);
  });

  it("«Торговать» is honestly reported as unavailable in flight", () => {
    const npc = makeNpc("p2", { name: "Купец" });
    const h = makeHarness({
      sprites: [makeSprite(npc, 50, 0)],
      physics: makePhysics(100),
    });
    h.ctrl.onNpcClick(npc);
    h.panels.lastOpen?.callbacks.onTrade();
    expect(h.msgs.some((m) => m.text.includes("недоступна"))).toBe(true);
  });

  it("«Связаться» shows a greeting when no text-quest is active", () => {
    const npc = makeNpc("p3", { name: "Пилот" });
    const engine = {
      questManager: { getActiveQuests: () => [] },
    } as unknown as GameEngine;
    const h = makeHarness({
      sprites: [makeSprite(npc, 50, 0)],
      physics: makePhysics(100),
      engine,
    });
    h.ctrl.onNpcClick(npc);
    const before = h.panels.closeCount;
    h.panels.lastOpen?.callbacks.onHail();
    expect(h.panels.closeCount).toBe(before + 1); // panel closes on hail
    expect(h.msgs.some((m) => m.text.startsWith("Пилот:"))).toBe(true);
  });
});

describe("NpcInteractionController.onFleeShakedown", () => {
  it("escapes a slow pirate (chance 1) and disengages it", () => {
    const npc = makeNpc("f1", { name: "Бандит", speed: 0, aggressive: true });
    const sprite = makeSprite(npc, 100, 0);
    const h = makeHarness({ sprites: [sprite], physics: makePhysics(80) });
    h.ctrl.onFleeShakedown(npc);
    expect(h.set.anchorsCleared).toEqual([sprite]); // disengaged
    expect(h.combatStarted).toEqual([]); // no fight
    expect(h.msgs.some((m) => m.text.includes("оторвались"))).toBe(true);
  });

  it("is caught by a fast pirate (chance 0) and drops into combat", () => {
    const npc = makeNpc("f2", {
      name: "Налётчик",
      speed: 60,
      aggressive: true,
    });
    const sprite = makeSprite(npc, 100, 0);
    const h = makeHarness({ sprites: [sprite], physics: makePhysics(0) });
    h.ctrl.onFleeShakedown(npc);
    expect(h.combatStarted).toEqual([sprite]);
    expect(h.combatSelected).toEqual([sprite]);
    expect(h.set.followNpcId).toBe("f2");
    expect(h.routes.length).toBe(1); // closes on the (moving) mark
    expect(h.msgs.some((m) => m.text.includes("атакует"))).toBe(true);
  });
});

describe("NpcInteractionController.onPayTribute", () => {
  it("moves credits through the bank bus and raises pirate rep on a real payoff", () => {
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
    const player = new PlayerService().createPlayer({
      factionType: FactionType.OUTLANDERS,
      captainName: "Cap",
      startingMoney: 1000,
    });
    setupPlayerBanking(bus, service, player);
    const engine = {
      galaxy: { npcShips: [], id: "g1", gameDays: 0 },
      player,
      bank: { bus, service },
    } as unknown as GameEngine;

    const npc = makeNpc("pay1", { name: "Рэкетир" });
    const sprite = makeSprite(npc, 100, 0);
    (npc as unknown as { credits: number }).credits = 200;
    const h = makeHarness({ sprites: [sprite], engine });

    const creditsBefore = player.credits;
    const pirateCreditsBefore = npc.credits;
    const repBefore = player.getReputation(PIRATE_FACTION_ID);
    h.ctrl.onPayTribute(npc);

    expect(player.credits).toBeLessThan(creditsBefore); // paid — via the bank bus
    const tribute = creditsBefore - player.credits;
    expect(npc.credits).toBe(pirateCreditsBefore + tribute);
    expect(player.getReputation(PIRATE_FACTION_ID)).toBeGreaterThan(repBefore);
    expect(h.set.anchorsCleared).toEqual([sprite]); // pirate disengaged
    expect(h.panels.closeCount).toBe(1);
  });

  it("a penniless player pays zero tribute and does not farm pirate rep", () => {
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
    const player = new PlayerService().createPlayer({
      factionType: FactionType.OUTLANDERS,
      captainName: "Cap",
      startingMoney: 0,
    });
    setupPlayerBanking(bus, service, player);
    const engine = {
      galaxy: { npcShips: [], id: "g1", gameDays: 0 },
      player,
      bank: { bus, service },
    } as unknown as GameEngine;

    const npc = makeNpc("pay2", { name: "Рэкетир" });
    const sprite = makeSprite(npc, 100, 0);
    (npc as unknown as { credits: number }).credits = 200;
    const h = makeHarness({ sprites: [sprite], engine });

    const repBefore = player.getReputation(PIRATE_FACTION_ID);
    h.ctrl.onPayTribute(npc);

    expect(player.credits).toBe(0);
    expect(npc.credits).toBe(200); // no transfer at all
    expect(player.getReputation(PIRATE_FACTION_ID)).toBe(repBefore); // no rep farm
    expect(h.set.anchorsCleared).toEqual([sprite]); // pirate still disengages
  });
});

describe("NpcInteractionController.offerHireContract (via onHire/onAlly callbacks)", () => {
  it("accepts a contract against a hostile target without charging the player", () => {
    const player = new PlayerService().createPlayer({
      factionType: FactionType.OUTLANDERS,
      captainName: "Cap",
      startingMoney: 1000,
    });
    const engine = { player } as unknown as GameEngine;
    const npc = makeNpc("merc1", { faction: "traders", aggressive: false });
    const hostile = makeNpc("mark1", { faction: "pirates", aggressive: true });
    Object.assign(hostile, { hullHP: 10, shields: 0, damage: 5 });
    const h = makeHarness({
      sprites: [makeSprite(npc, 10, 0), makeSprite(hostile, 20, 0)],
      physics: makePhysics(100),
      engine,
    });

    h.ctrl.onNpcClick(npc);
    const creditsBefore = player.credits;
    h.panels.lastOpen?.callbacks.onHire?.();

    expect(player.credits).toBe(creditsBefore);
    expect(npc.goal).toEqual({
      kind: NpcGoalKind.HUNT,
      targetSystemId: hostile.currentSystemId,
    });
    expect(h.msgs.some((m) => m.text.includes("плата не взята"))).toBe(true);
  });

  it("declines with no hostile target present and does not set a goal", () => {
    const npc = makeNpc("merc2", { aggressive: false });
    const h = makeHarness({
      sprites: [makeSprite(npc, 10, 0)],
      physics: makePhysics(100),
    });

    h.ctrl.onNpcClick(npc);
    h.panels.lastOpen?.callbacks.onAlly?.();

    expect(
      h.msgs.some((m) => m.text.includes("Рядом нет враждебных целей")),
    ).toBe(true);
    expect(npc.goal).toBeUndefined();
  });
});

describe("NpcInteractionController helpers", () => {
  it("npcLeadPoint falls back to the sprite position with no physics", () => {
    const npc = makeNpc("l1");
    const sprite = makeSprite(npc, 123, 456);
    const h = makeHarness({ sprites: [sprite], physics: null });
    expect(h.ctrl.npcLeadPoint(sprite)).toEqual({ x: 123, y: 456 });
  });

  it("aimRoute records the destination and plots the course", () => {
    const h = makeHarness({ physics: makePhysics(100) });
    h.ctrl.aimRoute(70, 90);
    expect(h.set.lastAim).toEqual({ x: 70, y: 90 });
    expect(h.routes).toEqual([{ x: 70, y: 90 }]);
  });
});
