import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import { CombatModule } from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

// ---------------------------------------------------------------------------
// Playtest bug pass 2 — Task 1: the active combat pause must freeze NPC ship
// movement, not just the player ship. A playtester saw enemy ships keep flying
// their pursuit/orbit courses (circling) while the pause overlay was up.
//
// NpcShipManager.update advances every NPC sprite at `sprite.update(dt * scale)`.
// In the wired scene that loop early-returns because the scene happens to fold
// the pause into the `isTurnRunning` dep — so the live-fight test is green only
// by that coincidence. This regression drives the manager DIRECTLY with the turn
// running BUT the active pause raised (`isPaused: () => true`): the manager
// itself must honour the single `combatPause.paused` freeze signal at the
// movement step and not advance the sprite. It is RED before the `:450` gate
// (the sprite keeps pursuing while paused) and GREEN after.
// ---------------------------------------------------------------------------

const WR = GAME_BALANCE.weaponRange; // 240

function renderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function makeNpc(id: string, role: NpcRole, faction: Faction): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: GAME_BALANCE.npcSpeed,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function spriteOf(manager: NpcShipManager): NpcShipSprite & {
  x: number;
  y: number;
  aggressive: boolean;
} {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & {
    x: number;
    y: number;
    aggressive: boolean;
  };
}

describe("Active pause freezes NPC ship movement (Task 1)", () => {
  it("an engaged enemy on a live pursuit course stops moving while paused, resumes on unpause", () => {
    const physics = new ShipPhysics(0, 0, 0.3); // parked player at the origin
    let paused = false;

    const npc = makeNpc("trd_1", NpcRole.TRADER, Faction.INDEPENDENT);
    const galaxy = {
      npcShips: [npc],
      isHostileSystem: () => false, // neutral system
    } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;

    const combat = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => {
        const l = new ShipLoadout("hull_warden");
        l.install("wpn_pulse");
        return l;
      },
      getPlayerShip: () => ({ hullHP: 1000, maxHull: 1000 }),
      onNpcDestroyed: () => {},
      showMessage: () => {},
    });

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      // The turn is held open by the fight — the manager must NOT rely on the
      // scene folding pause into isTurnRunning; it must check isPaused itself.
      isTurnRunning: () => true,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      startInFlightCombat: (s) => combat.addCombatant(s),
      isInCombat: () => combat.isActive,
      selectCombatTarget: (s) => combat.selectTarget(s),
      getCombatTargetId: () => combat.selectedTarget?.npc.id ?? null,
      isCombatant: (s) => combat.combatants.has(s),
      isPaused: () => paused,
    };

    const manager = new NpcShipManager(
      renderer(),
      gameEngine,
      new Container(),
      new Container(),
      deps,
    );
    manager.initialize();
    const sprite = spriteOf(manager);
    sprite.x = WR + 300; // outside weapon range, so it actively closes in
    sprite.y = 0;

    // Player attacks → the enemy becomes an active combatant and pursues.
    (
      manager as unknown as { launchCombatWithNpc(n: NpcShip): void }
    ).launchCombatWithNpc(npc);
    expect(sprite.aggressive).toBe(true);

    // CONTROL: real-time (not paused) — the sprite is on a live pursuit course
    // and moves toward the parked player. Proves the freeze below is a real halt.
    const before = { x: sprite.x, y: sprite.y };
    for (let i = 0; i < 5; i++) manager.update(100, 0);
    expect(
      Math.hypot(sprite.x - before.x, sprite.y - before.y),
    ).toBeGreaterThan(0);

    // FREEZE: raise the active pause. Several frames pass — a paused fight must
    // move nothing (no circling, no closing the gap).
    paused = true;
    const frozen = { x: sprite.x, y: sprite.y };
    for (let i = 0; i < 10; i++) manager.update(100, 0);
    expect(sprite.x).toBe(frozen.x);
    expect(sprite.y).toBe(frozen.y);

    // RESUME: unpause and the same sprite advances again.
    paused = false;
    for (let i = 0; i < 5; i++) manager.update(100, 0);
    expect(
      Math.hypot(sprite.x - frozen.x, sprite.y - frozen.y),
    ).toBeGreaterThan(0);

    manager.destroy();
  });
});
