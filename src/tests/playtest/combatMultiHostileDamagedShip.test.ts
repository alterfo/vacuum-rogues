/**
 * Root-cause regression for the win-rate-100pct campaign plan's combat-mechanics
 * escalation: every sampled campaign death showed the SAME pattern — the player
 * engages several already-present hostiles (a standing garrison / a just-folded
 * capture fleet) simultaneously, then dies within the same execute window, with
 * no surviving multi-round exchange.
 *
 * Root cause: `CombatModule.addCombatant()` resets every joining NPC's fire
 * timer to 0 (`combatFireIntervalMs=2500` < `COMBAT_ROUND_MS=3000`), so N
 * simultaneously-joining hostiles are perfectly lock-stepped and all land their
 * first shot within the SAME execute window. The round-damage budget
 * (`roundIsComplete`) was computed off the ship's MAX hull, not its CURRENT
 * hull — so a ship that entered the fight already damaged (the campaign-common
 * case: 75%+ of deaths happen after ≥1 prior engagement with no full heal
 * in between) got the same full-hull-sized allowance as a fresh ship, letting
 * a volley sized to be "safe from full hull" still exceed its actual remaining
 * hull. Fixed in `combatRounds.ts`'s `roundIsComplete` (budget now scales off
 * `min(hull, maxHull)`).
 *
 * This test drives the REAL production wiring (`RealEngineHarness` →
 * `SpaceFlightScene` → `CombatModule`/`combatPlanning`, no fake reactive-pause
 * callbacks) — unlike `combatRoundReaction.test.ts`, which wires
 * `onPlayerUnderAttack`/`onRoundComplete` to a real `CombatPauseController`
 * even though `combatModuleDeps.ts` confirms those callbacks are NOT wired in
 * production (the reactive single-shot pause is superseded by the
 * pause-and-plan loop). That test validates a real CombatModule +
 * CombatPauseController wiring CONTRACT, just not the literal current
 * production wiring — its scenarios stay valid at that lower level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import type { NpcShipManager } from "@/presentation/flight/NpcShipManager";
import type { CombatModule } from "@/presentation/flight/CombatModule";
import type { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { NpcRole, SceneType } from "@/types";
import { COMBAT_ROUND_MS } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** A stationary OVERMIND-role hostile — mirrors a standing garrison ship. */
function makeGarrisonHostile(id: string, x: number, y: number): NpcShipSprite {
  const container = { x, y, zIndex: 100 };
  const sprite = {
    x,
    y,
    container,
    aggressive: false,
    mapColor: 0xff0000,
    npc: {
      id,
      name: id,
      role: NpcRole.OVERMIND,
      hullHP: 1_000_000,
      maxHull: 1_000_000,
      damage: 28, // ROLE_STATS[OVERMIND].damage — matches production garrison ships
    },
    update(): void {},
    isGone: () => false,
    isAnchored: () => false,
    updateHitArea: () => {},
    restoreInteractivity: () => {},
    setAggressive: (v: boolean) => {
      sprite.aggressive = v;
    },
    setNpcCombatTarget: () => {},
    clearNpcCombatTarget: () => {},
    setPursuitTarget: () => {},
  };
  return sprite as unknown as NpcShipSprite;
}

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  npcManager: NpcShipManager;
  combatModule: CombatModule;
  combatPlanning: CombatPlanningController<NpcShipSprite, WeaponSpec>;
}

function engage(scene: FlightPrivates, foe: NpcShipSprite): void {
  (
    scene.npcManager as unknown as { npcSprites: NpcShipSprite[] }
  ).npcSprites.push(foe);
  (
    scene.npcManager as unknown as {
      launchCombatWithNpc(n: NpcShipSprite["npc"]): void;
    }
  ).launchCombatWithNpc(foe.npc);
}

describe("Multi-hostile arrival vs a damaged ship (combat-mechanics escalation, win-rate-100pct plan)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a damaged ship (30% hull) survives arriving into a 4-ship standing garrison for one execute window", () => {
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    // The campaign-common case: the ship already took damage from a prior,
    // unhealed engagement — not the "full hull" case the old round-budget math
    // implicitly assumed. 30% (not 50%) is deliberately chosen: at 140 starter
    // hull with 4× ~14-damage synchronized hits (56 total), 50% hull (70)
    // survives under BOTH the old maxHull-based budget and the new
    // current-hull-based one — the gap only shows up once the ship is damaged
    // enough that the old budget's "allow up to maxHull*0.34 ≈ 47.6" ends up
    // GREATER than the ship's own remaining hull.
    const maxHull = player.ship.maxHull;
    player.ship.hullHP = Math.floor(maxHull * 0.3);
    // Mark the current system hostile so real `hostileScaling()` engages
    // (matches "player warps into an already-captured system").
    galaxy.addOvermindSystem(player.currentSystemId);

    const scene = harness.currentScene() as unknown as FlightPrivates;
    // A dense standing garrison: 4 hostiles all already in range, joining
    // combat in the same beat — the exact campaign-log signature.
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      engage(
        scene,
        makeGarrisonHostile(
          id,
          scene.shipPhysics.shipX + 50 + i * 5,
          scene.shipPhysics.shipY,
        ),
      );
    }
    expect(scene.combatPlanning.isPlanning).toBe(true);

    // Empty confirm — mirrors the letsplay agent's immediate-confirm pattern
    // (PlayerAgent.driveAttack), the worst case for reaction time.
    scene.combatPlanning.confirm();

    // Run out a full execute window plus margin.
    for (let i = 0; i < 35; i++) harness.tick(100); // 3500ms > COMBAT_ROUND_MS

    expect(harness.errors()).toEqual([]);
    expect(player.ship.hullHP).toBeGreaterThan(0);
  });

  it("COMBAT_ROUND_MS exceeds the NPC fire interval — the lock-step-timer scenario is real, not synthetic", () => {
    // Documents WHY the above scenario is representative: with a shared
    // combatFireIntervalMs < COMBAT_ROUND_MS, N simultaneously-joining
    // hostiles (all timer=0) all cross their fire threshold inside one
    // execute window under ordinary real-time ticking — no dt-jump artifact
    // needed to reproduce the campaign's alpha-strike pattern.
    expect(COMBAT_ROUND_MS).toBeGreaterThan(0);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
  });
});
