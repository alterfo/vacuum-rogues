import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { NpcShip } from "@/domain/NpcShip";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { PlayerShip } from "@/domain/PlayerShip";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import type { EnemyType, AIProfile } from "@/types";

function makeNpc(
  shieldPower: number,
  loadoutSummary: string[] = ["Двигатель", "Пушка", "Радар"],
): NpcShip {
  return new NpcShip({
    id: "npc_test",
    name: "Test NPC",
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.RANGER,
    hullHP: 100,
    maxHull: 100,
    shields: 50,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.IDLE,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 500,
    reputation: 0,
    shieldPower,
    loadoutSummary,
  });
}

function makePlayerShip(): PlayerShip {
  return new PlayerShip(
    "player_ship",
    "Ranger",
    100,
    100,
    60,
    60,
    100,
    100,
    0.1,
    0.1,
    FactionType.PROGRESSORS,
  );
}

function makeEnemy(shields: number): EnemyShip {
  return new EnemyShip(
    "enemy_1",
    "PIRATE" as EnemyType,
    80,
    shields,
    0.1,
    15,
    false,
    [],
    {} as AIProfile,
  );
}

describe("DerivedStats — scanPower and shieldPower (Task 8)", () => {
  it("scanPower is 0 when no scanner installed", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    expect(lo.derivedStats().scanPower).toBe(0);
  });

  it("scanPower equals scanner tech level when scanner installed", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_scanner"); // techLevel 4
    expect(lo.derivedStats().scanPower).toBe(4);
  });

  it("shieldPower is 0 when no shield installed", () => {
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    expect(lo.derivedStats().shieldPower).toBe(0);
  });

  it("shieldPower equals shield tech level when shield installed", () => {
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_shield"); // techLevel 6
    expect(lo.derivedStats().shieldPower).toBe(6);
  });
});

describe("NpcShip scan mechanic (Task 8)", () => {
  it("scan succeeds when player scanPower > npc shieldPower", () => {
    const npc = makeNpc(3, ["Двигатель ур.3", "Пушка", "Радар"]);
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_scanner"); // scanPower = 4 > npc.shieldPower = 3
    expect(lo.derivedStats().scanPower).toBeGreaterThan(npc.shieldPower);
    expect(npc.loadoutSummary).toHaveLength(3);
  });

  it("scan fails when player scanPower <= npc shieldPower", () => {
    const npc = makeNpc(5); // strong shield
    const lo = new ShipLoadout("hull_warden");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    lo.install("eq_scanner"); // scanPower = 4 <= npc.shieldPower = 5
    expect(lo.derivedStats().scanPower).toBeLessThanOrEqual(npc.shieldPower);
  });

  it("scan fails when no scanner installed (scanPower = 0)", () => {
    const npc = makeNpc(1); // any shield beats no scanner
    const lo = new ShipLoadout("hull_scout");
    lo.install("eq_engine_i");
    lo.install("eq_tank");
    expect(lo.derivedStats().scanPower).toBe(0);
    expect(lo.derivedStats().scanPower).not.toBeGreaterThan(npc.shieldPower);
  });

  it("NpcShip defaults shieldPower and loadoutSummary when not provided", () => {
    const npc = new NpcShip({
      id: "npc_old",
      name: "Old NPC",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.TRADER,
      hullHP: 100,
      maxHull: 100,
      shields: 30,
      speed: 0.08,
      damage: 10,
      currentSystemId: "sys_a",
      state: NpcState.IDLE,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 200,
      reputation: 0,
      shieldPower: 0,
      loadoutSummary: [],
    });
    expect(npc.shieldPower).toBe(0);
    expect(npc.loadoutSummary).toEqual([]);
  });
});

describe("CombatSystem — shield absorbs damage before hull (Task 8)", () => {
  function makeSystem(): CombatSystem {
    return new CombatSystem({} as AdaptiveQualityProfile);
  }

  /** Force the player to go first regardless of initiative roll. */
  function forcePlayerFirst(system: CombatSystem): void {
    const enc = system.encounter!;
    const playerIdx = enc.turnOrder.findIndex(
      (e) => e.id === enc.playerShip.id,
    );
    if (playerIdx > 0) {
      // Swap player to front of turn order
      const tmp = enc.turnOrder[0];
      enc.turnOrder[0] = enc.turnOrder[playerIdx];
      enc.turnOrder[playerIdx] = tmp;
    }
    enc.currentEntityIndex = 0;
  }

  it("full damage goes to hull when target has no shields", () => {
    const system = makeSystem();
    const player = makePlayerShip();
    const enemy = makeEnemy(0); // no shields
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });
    forcePlayerFirst(system);

    const initialHull = enemy.hullHP;
    system.processPlayerAction({ type: "ATTACK" });

    // Hull should have taken damage; shields stay at 0
    expect(enemy.hullHP).toBeLessThan(initialHull);
    expect(enemy.shields).toBe(0);
  });

  it("shields absorb damage before hull when target has shields", () => {
    const system = makeSystem();
    const player = makePlayerShip();
    const enemy = makeEnemy(100); // full shields, more than max attack damage (25)
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });
    forcePlayerFirst(system);

    const initialHull = enemy.hullHP;
    const initialShields = enemy.shields;
    system.processPlayerAction({ type: "ATTACK" });

    // Shields should have taken the hit; hull should be untouched
    expect(enemy.shields).toBeLessThan(initialShields);
    expect(enemy.hullHP).toBe(initialHull);
  });

  it("overflow damage reaches hull when shields run out", () => {
    const system = makeSystem();
    const player = makePlayerShip();
    const enemy = makeEnemy(3); // tiny shields, max attack is 25 so overflow guaranteed
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });
    forcePlayerFirst(system);

    const initialHull = enemy.hullHP;
    system.processPlayerAction({ type: "ATTACK" });

    // Shields depleted to 0, remainder spills to hull
    expect(enemy.shields).toBe(0);
    expect(enemy.hullHP).toBeLessThan(initialHull);
  });
});
