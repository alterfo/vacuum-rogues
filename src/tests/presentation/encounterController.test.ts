import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  EncounterController,
  type EncounterControllerDeps,
} from "@/presentation/flight/EncounterController";
import type { NpcShipManagerDeps } from "@/presentation/flight/NpcShipManager";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Player } from "@/domain/Player";
import { Inventory } from "@/domain/Inventory";
import { Faction } from "@/types/faction";
import {
  rollEncounter,
  type Encounter,
} from "@/systems/encounters/encounterGenerator";
import { ENCOUNTER_CONFIG } from "@/config/balance";

const SYSTEM_ID = "sys1";

function fakeGalaxy(
  opts: { overmind?: boolean; pirate?: boolean; day?: number } = {},
) {
  return {
    id: "g1",
    gameDays: opts.day ?? 0,
    npcShips: [] as NpcShip[],
    isOvermindSystem: () => opts.overmind ?? false,
    isPirateSystem: () => opts.pirate ?? false,
    systems: [{ id: SYSTEM_ID, ownerFaction: Faction.INDEPENDENT }],
  };
}

function fakePlayer(opts: { level?: number; credits?: number } = {}): Player {
  const reputation: Record<string, number> = {};
  return {
    credits: opts.credits ?? 1000,
    level: opts.level ?? 1,
    currentSystemId: SYSTEM_ID,
    inventory: new Inventory(),
    getReputation(f: string) {
      return reputation[f] ?? 0;
    },
    adjustReputation(f: string, d: number) {
      reputation[f] = (reputation[f] ?? 0) + d;
    },
    get currentAccountId() {
      return "cur:test";
    },
  } as unknown as Player;
}

function makeNpcShip(id: string): NpcShip {
  let hostile = false;
  return {
    id,
    name: id,
    markHostile: () => {
      hostile = true;
    },
    get hostile() {
      return hostile;
    },
  } as unknown as NpcShip;
}

function makeSprite(npc: NpcShip): NpcShipSprite {
  return {
    npc,
    x: 0,
    y: 0,
    container: { rotation: 0 },
    setAggressive: () => {},
  } as unknown as NpcShipSprite;
}

interface Harness {
  ctrl: EncounterController;
  gameEngine: {
    galaxy: ReturnType<typeof fakeGalaxy>;
    player: Player;
    offeredEncounterIds: Set<string>;
  };
  npcSprites: NpcShipSprite[];
  addedNpcs: NpcShip[];
  flightStarted: NpcShipSprite[];
  flightSelected: NpcShipSprite[];
  msgs: { text: string; color?: number }[];
}

function makeHarness(
  opts: {
    inCombat?: boolean;
    overmindOpen?: boolean;
    noEngine?: boolean;
    galaxy?: { overmind?: boolean; pirate?: boolean; day?: number };
    player?: { level?: number; credits?: number };
  } = {},
): Harness {
  const galaxy = fakeGalaxy(opts.galaxy);
  const player = fakePlayer(opts.player);
  const offeredEncounterIds = new Set<string>();
  const gameEngine = { galaxy, player, offeredEncounterIds };
  const npcSprites: NpcShipSprite[] = [];
  const addedNpcs: NpcShip[] = [];
  const flightStarted: NpcShipSprite[] = [];
  const flightSelected: NpcShipSprite[] = [];
  const msgs: { text: string; color?: number }[] = [];

  const flight: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 0, y: 0 }),
    isTurnRunning: () => false,
    showMessage: (text, color) => msgs.push({ text, color }),
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
    startInFlightCombat: (s) => flightStarted.push(s),
    selectCombatTarget: (s) => flightSelected.push(s),
    isInCombat: () => opts.inCombat ?? false,
  };

  const deps: EncounterControllerDeps = {
    uiLayer: new Container(),
    getScreenSize: () => ({ width: 800, height: 600 }),
    flight,
    getGameEngine: () =>
      opts.noEngine ? null : (gameEngine as unknown as GameEngine),
    getNpcSprites: () => npcSprites,
    isOvermindPromptOpen: () => opts.overmindOpen ?? false,
    addNpcSprite: (npc) => {
      addedNpcs.push(npc);
      npcSprites.push(makeSprite(npc));
    },
    spawnPirateInSystem: (_rng, id) => makeNpcShip(id),
  };

  return {
    ctrl: new EncounterController(deps),
    gameEngine,
    npcSprites,
    addedNpcs,
    flightStarted,
    flightSelected,
    msgs,
  };
}

function findFiringDay(danger = 0): number {
  for (let day = 0; day < 500; day++) {
    const enc = rollEncounter(
      { id: SYSTEM_ID, danger },
      `${SYSTEM_ID}:${day}`,
      { level: 1, pirateRep: 0 },
      ENCOUNTER_CONFIG,
    );
    if (enc) return day;
  }
  return -1;
}

describe("EncounterController.maybeShowEntryEncounter", () => {
  it("does not roll while a fight is already underway", () => {
    const day = findFiringDay();
    expect(day).toBeGreaterThanOrEqual(0);
    const h = makeHarness({ inCombat: true, galaxy: { day } });
    h.ctrl.maybeShowEntryEncounter();
    expect(h.ctrl.isOpen).toBe(false);
  });

  it("does not roll while the OVERMIND-core prompt is open", () => {
    const day = findFiringDay();
    expect(day).toBeGreaterThanOrEqual(0);
    const h = makeHarness({ overmindOpen: true, galaxy: { day } });
    h.ctrl.maybeShowEntryEncounter();
    expect(h.ctrl.isOpen).toBe(false);
  });

  it("rolls deterministically by (system, day) and opens the prompt", () => {
    const day = findFiringDay();
    expect(day).toBeGreaterThanOrEqual(0);
    const h = makeHarness({ galaxy: { day } });
    h.ctrl.maybeShowEntryEncounter();
    expect(h.ctrl.isOpen).toBe(true);
  });

  it("does not re-offer the identical (system, day) encounter twice", () => {
    const day = findFiringDay();
    expect(day).toBeGreaterThanOrEqual(0);
    const h = makeHarness({ galaxy: { day } });

    h.ctrl.maybeShowEntryEncounter();
    expect(h.ctrl.isOpen).toBe(true);
    h.ctrl.closeEncounterPrompt();
    expect(h.ctrl.isOpen).toBe(false);

    h.ctrl.maybeShowEntryEncounter();
    expect(h.ctrl.isOpen).toBe(false); // deduped via offeredEncounterIds
  });
});

describe("EncounterController prompt open/close", () => {
  it("showEncounterPrompt opens, closeEncounterPrompt closes", () => {
    const h = makeHarness();
    const enc: Encounter = {
      id: "e1",
      type: "anomaly",
      systemId: SYSTEM_ID,
      danger: 0,
      rewardScale: 1,
    };
    h.ctrl.showEncounterPrompt(enc);
    expect(h.ctrl.isOpen).toBe(true);

    h.ctrl.closeEncounterPrompt();
    expect(h.ctrl.isOpen).toBe(false);
  });

  it("no-ops without a GameEngine", () => {
    const h = makeHarness({ noEngine: true });
    const enc: Encounter = {
      id: "e2",
      type: "anomaly",
      systemId: SYSTEM_ID,
      danger: 0,
      rewardScale: 1,
    };
    h.ctrl.showEncounterPrompt(enc);
    expect(h.ctrl.isOpen).toBe(false);
  });

  it("destroy tears down an open prompt", () => {
    const h = makeHarness();
    const enc: Encounter = {
      id: "e3",
      type: "anomaly",
      systemId: SYSTEM_ID,
      danger: 0,
      rewardScale: 1,
    };
    h.ctrl.showEncounterPrompt(enc);
    h.ctrl.destroy();
    expect(h.ctrl.isOpen).toBe(false);
  });
});

describe("EncounterController.refreshFontScale", () => {
  it("rebuilds the open prompt in place", () => {
    const h = makeHarness();
    const enc: Encounter = {
      id: "e4",
      type: "anomaly",
      systemId: SYSTEM_ID,
      danger: 0,
      rewardScale: 1,
    };
    h.ctrl.showEncounterPrompt(enc);
    expect(h.ctrl.isOpen).toBe(true);

    h.ctrl.refreshFontScale();
    expect(h.ctrl.isOpen).toBe(true);
  });

  it("no-ops when no prompt is open", () => {
    const h = makeHarness();
    expect(() => h.ctrl.refreshFontScale()).not.toThrow();
    expect(h.ctrl.isOpen).toBe(false);
  });
});

describe("EncounterController.applyEncounterChoice", () => {
  it("a salvage choice pays out credits (no combat spawn)", () => {
    const h = makeHarness();
    const before = h.gameEngine.player.credits;
    const enc: Encounter = {
      id: "e5",
      type: "derelict",
      systemId: SYSTEM_ID,
      danger: 0,
      rewardScale: 1,
    };

    const outcome = h.ctrl.applyEncounterChoice(enc, "engage", () => 0.99);

    expect(outcome.kind).toBe("salvage");
    expect(h.gameEngine.player.credits).toBe(before + (outcome.credits ?? 0));
    expect(outcome.credits).toBeGreaterThan(0);
    expect(h.addedNpcs).toEqual([]);
    expect(h.msgs.some((m) => m.text.includes("Обломок обчищен"))).toBe(true);
  });

  it("an ignore choice applies no payoff and spawns nothing", () => {
    const h = makeHarness();
    const before = h.gameEngine.player.credits;
    const enc: Encounter = {
      id: "e6",
      type: "derelict",
      systemId: SYSTEM_ID,
      danger: 1,
      rewardScale: 1,
    };

    const outcome = h.ctrl.applyEncounterChoice(enc, "ignore");

    expect(outcome.kind).toBe("ignored");
    expect(h.gameEngine.player.credits).toBe(before);
    expect(h.addedNpcs).toEqual([]);
    expect(h.flightStarted).toEqual([]);
  });

  it("an ambush outcome spawns a hostile and opens in-flight combat", () => {
    const h = makeHarness();
    const before = h.gameEngine.player.credits;
    const enc: Encounter = {
      id: "e7",
      type: "distress",
      systemId: SYSTEM_ID,
      danger: 1,
      rewardScale: 1,
    };

    const outcome = h.ctrl.applyEncounterChoice(enc, "engage", () => 0);

    expect(outcome.kind).toBe("ambush");
    expect(outcome.startCombat).toBe(true);
    expect(h.gameEngine.player.credits).toBe(before); // an ambush has no payout
    expect(h.addedNpcs.length).toBe(1);
    expect(h.gameEngine.galaxy.npcShips.length).toBe(1); // registered in the domain galaxy
    expect(h.flightStarted.length).toBe(1);
    expect(h.flightSelected.length).toBe(1);
  });
});
