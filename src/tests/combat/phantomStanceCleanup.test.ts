import { describe, it, expect } from "vitest";
import {
  CombatPauseController,
  type PauseReason,
} from "@/presentation/flight/combatPause";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

const ESCAPE = GAME_BALANCE.combatEscapeRange;

function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: false,
    currentSpeed: 0,
    setTarget(_x: number, _y: number): void {},
    stop(): void {},
  } as unknown as ShipPhysics;
}

function makeSprite(
  id: string,
  x: number,
): NpcShipSprite & {
  container: { destroyed: boolean };
} {
  return {
    x,
    y: 0,
    container: { destroyed: false },
    npc: { id, name: id, hullHP: 100, maxHull: 100, damage: 20 },
  } as unknown as NpcShipSprite & { container: { destroyed: boolean } };
}

interface Host {
  module: CombatModule;
  controller: CombatPauseController<NpcShipSprite, WeaponSpec>;
  endedCount: () => number;
  pauseReason: () => PauseReason | null;
}

function makeHost(): Host {
  let endedCount = 0;
  let reason: PauseReason | null = null;
  const ship = { hullHP: 100, maxHull: 100 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");

  const controller = new CombatPauseController<NpcShipSprite, WeaponSpec>({
    onPause: (r) => {
      reason = r;
    },
    onConfirm: (a) => module.confirmAttack(a.target, a.weapon),
  });

  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    isPaused: () => controller.paused,
    onPlayerUnderAttack: () => controller.requestPause("incoming-attack"),
    onTargetLost: (npc) => controller.loseTarget(npc),
    onCombatEnded: () => {
      endedCount += 1;
      if (controller.paused) controller.resume();
      controller.reset();
    },
  };
  const module = new CombatModule(deps);
  return {
    module,
    controller,
    endedCount: () => endedCount,
    pauseReason: () => reason,
  };
}

describe("phantom combat stance is cleaned up while frozen (Task 9 vi)", () => {
  it("ends a frozen fight whose only combatant's sprite was destroyed, and resumes the pause", () => {
    const host = makeHost();
    const a = makeSprite("a", 50);
    host.module.addCombatant(a);
    expect(host.module.isActive).toBe(true);

    host.controller.requestPause("incoming-attack");
    expect(host.controller.paused).toBe(true);

    host.module.update(16);
    expect(host.module.isActive).toBe(true);
    expect(host.controller.paused).toBe(true);

    a.container.destroyed = true;

    host.module.update(16);
    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
    expect(host.controller.paused).toBe(false); // resumed — not left frozen
  });

  it("does NOT drop a live, merely distance-disengaged combatant while frozen", () => {
    const host = makeHost();
    const a = makeSprite("a", 50);
    host.module.addCombatant(a);
    host.controller.requestPause("incoming-attack");

    a.x = ESCAPE + 500;
    host.module.update(16);
    expect(host.module.isActive).toBe(true); // still engaged while frozen
    expect(host.controller.paused).toBe(true);

    host.controller.resume();
    host.module.update(16);
    expect(host.module.isActive).toBe(false);
    expect(host.endedCount()).toBe(1);
  });

  it("with several combatants, only the destroyed sprite is dropped while frozen", () => {
    const host = makeHost();
    const a = makeSprite("a", 50);
    const b = makeSprite("b", 60);
    host.module.addCombatant(a);
    host.module.addCombatant(b);
    host.controller.requestPause("incoming-attack");

    a.container.destroyed = true;
    host.module.update(16);
    expect(host.module.isActive).toBe(true);
    expect(host.module.combatants.has(a)).toBe(false);
    expect(host.module.combatants.has(b)).toBe(true);
    expect(host.controller.paused).toBe(true);
    expect(host.endedCount()).toBe(0);
  });
});
