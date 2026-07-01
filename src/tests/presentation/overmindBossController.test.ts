import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  OvermindBossController,
  type OvermindBossControllerDeps,
} from "@/presentation/flight/OvermindBossController";
import { OVERMIND_CORE_ID } from "@/presentation/flight/NpcShipManager";
import type { NpcShipManagerDeps } from "@/presentation/flight/NpcShipManager";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

/**
 * Focused unit tests for the OVERMIND-core final-boss cluster extracted from
 * {@link NpcShipManager} (plan Task 4). The controller is exercised directly
 * against a fake {@link OvermindBossControllerDeps} bundle — no real
 * GameEngine — so the prompt open/close, font-scale rebuild and combatant
 * spawn/idempotency are verified in isolation. The real-engine suite
 * `combat/overmindCoreInflight.test.ts` remains the integration oracle (real
 * NpcShipManager + a genuine CombatModule win condition).
 */

function makeNpcShip(id: string): NpcShip {
  let hostile = false;
  return {
    id,
    name: id,
    hullHP: 100,
    maxHull: 100,
    damage: 0,
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
  ctrl: OvermindBossController;
  uiLayer: Container;
  npcSprites: NpcShipSprite[];
  addedNpcs: NpcShip[];
  flightStarted: NpcShipSprite[];
  flightSelected: NpcShipSprite[];
  msgs: { text: string; color?: number }[];
  galaxy: { npcShips: NpcShip[] };
}

function makeHarness(opts: { noEngine?: boolean } = {}): Harness {
  const uiLayer = new Container();
  const npcSprites: NpcShipSprite[] = [];
  const addedNpcs: NpcShip[] = [];
  const flightStarted: NpcShipSprite[] = [];
  const flightSelected: NpcShipSprite[] = [];
  const msgs: { text: string; color?: number }[] = [];
  const galaxy = { npcShips: [] as NpcShip[] };
  const gameEngine = { galaxy, player: { currentSystemId: "core_sys" } };

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
  };

  const deps: OvermindBossControllerDeps = {
    uiLayer,
    getScreenSize: () => ({ width: 800, height: 600 }),
    flight,
    getGameEngine: () =>
      opts.noEngine ? null : (gameEngine as unknown as GameEngine),
    getNpcSprites: () => npcSprites,
    addNpcSprite: (npc) => {
      addedNpcs.push(npc);
      npcSprites.push(makeSprite(npc));
    },
    spawnOvermindInSystem: (_rng, id) => makeNpcShip(id),
  };

  return {
    ctrl: new OvermindBossController(deps),
    uiLayer,
    npcSprites,
    addedNpcs,
    flightStarted,
    flightSelected,
    msgs,
    galaxy,
  };
}

/**
 * Locate the attack/retreat buttons on the most recently opened overlay
 * (fixed addChild order: bg, border, title, desc, attack, retreat). Reads the
 * *last* uiLayer child, not the first — a closed overlay's destroy is
 * deferred to a microtask, so re-opening the prompt can leave a stale closed
 * overlay still sitting in `uiLayer.children`.
 */
function buttons(uiLayer: Container): {
  attack: Container;
  retreat: Container;
} {
  const overlay = uiLayer.children[uiLayer.children.length - 1] as Container;
  return {
    attack: overlay.children[4] as Container,
    retreat: overlay.children[5] as Container,
  };
}

describe("OvermindBossController prompt open/close", () => {
  it("showOvermindCorePrompt no-ops without a GameEngine", () => {
    const h = makeHarness({ noEngine: true });
    h.ctrl.showOvermindCorePrompt();
    expect(h.ctrl.isOpen).toBe(false);
  });

  it("showOvermindCorePrompt opens the overlay on the ui layer", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
    expect(h.ctrl.isOpen).toBe(true);
    expect(h.uiLayer.children.length).toBe(1);
  });

  it("close() closes an open prompt (idempotent when already closed)", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
    expect(h.ctrl.isOpen).toBe(true);
    h.ctrl.close();
    expect(h.ctrl.isOpen).toBe(false);
    expect(() => h.ctrl.close()).not.toThrow();
    expect(h.ctrl.isOpen).toBe(false);
  });

  it("destroy tears down an open prompt", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
    h.ctrl.destroy();
    expect(h.ctrl.isOpen).toBe(false);
  });
});

describe("OvermindBossController.refreshFontScale", () => {
  it("rebuilds the open prompt in place", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
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

describe("OvermindBossController combatant spawn", () => {
  it("retreat closes the prompt without spawning a combatant", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
    const { retreat } = buttons(h.uiLayer);

    retreat.emit("pointerdown", { stopPropagation: () => {} } as never);

    expect(h.ctrl.isOpen).toBe(false);
    expect(h.addedNpcs).toEqual([]);
    expect(h.flightStarted).toEqual([]);
  });

  it("attack closes the prompt and spawns the core as a hostile in-flight combatant", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
    const { attack } = buttons(h.uiLayer);

    attack.emit("pointerdown", { stopPropagation: () => {} } as never);

    expect(h.ctrl.isOpen).toBe(false);
    expect(h.addedNpcs.length).toBe(1);
    expect(h.addedNpcs[0].id).toBe(OVERMIND_CORE_ID);
    expect(h.addedNpcs[0].hullHP).toBe(450);
    expect(h.addedNpcs[0].maxHull).toBe(450);
    expect(h.addedNpcs[0].damage).toBe(45);
    expect((h.addedNpcs[0] as unknown as { hostile: boolean }).hostile).toBe(
      true,
    );
    expect(h.galaxy.npcShips.length).toBe(1);
    expect(h.flightStarted.length).toBe(1);
    expect(h.flightSelected.length).toBe(1);
    expect(h.msgs.some((m) => m.text.includes("OVERMIND"))).toBe(true);
  });

  it("is idempotent: attacking again while the core is already engaged spawns nothing new", () => {
    const h = makeHarness();
    h.ctrl.showOvermindCorePrompt();
    buttons(h.uiLayer).attack.emit("pointerdown", {
      stopPropagation: () => {},
    } as never);
    expect(h.addedNpcs.length).toBe(1);

    h.ctrl.showOvermindCorePrompt();
    buttons(h.uiLayer).attack.emit("pointerdown", {
      stopPropagation: () => {},
    } as never);

    expect(h.addedNpcs.length).toBe(1);
  });
});
