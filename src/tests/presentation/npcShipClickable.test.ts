import { describe, it, expect } from "vitest";
import { Circle } from "pixi.js";
import { NpcShipSprite, type SystemBounds } from "@/presentation/NpcShipSprite";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

function makeNpc(id: string, role: NpcRole = NpcRole.TRADER): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
    speed: 0.1,
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

const bounds: SystemBounds = {
  cx: 0,
  cy: 0,
  rInner: 100,
  rOuter: 500,
  boundary: 800,
};

describe("NpcShipSprite clickability (Task 6)", () => {
  // The "NPC ships aren't clickable" bug came from ships either never being made
  // interactive or losing their hit-area. Guard the invariant: after wiring a
  // click handler the container is statically interactive with a circular
  // hit-area so clicks land regardless of camera zoom.
  it("makes the container static with a circular hit-area on setClickHandler", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_1"), 200, 0, bounds);
    sprite.setClickHandler(() => {});

    expect(sprite.container.eventMode).toBe("static");
    expect(sprite.container.hitArea).toBeInstanceOf(Circle);

    sprite.destroy();
  });

  it("restores interactivity for a non-departing ship when the turn ends", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_2"), 200, 0, bounds);
    sprite.setClickHandler(() => {});

    // Simulate a ship that lost interactivity at some point during the turn.
    sprite.container.eventMode = "none";
    sprite.restoreInteractivity();

    expect(sprite.container.eventMode).toBe("static");

    sprite.destroy();
  });

  it("does not restore interactivity on a departing ship", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_3"), 200, 0, bounds);
    sprite.setClickHandler(() => {});

    // Departing ships are about to hyperjump out — they must stay non-interactive.
    sprite.beginDeparture();
    sprite.restoreInteractivity();

    expect(sprite.container.eventMode).toBe("none");

    sprite.destroy();
  });

  // --- Arc-movement/combat hit-area hardening (20260625 Task 2) ----------------
  // The "ships become unclickable mid-fight" report. Two concrete causes guarded
  // here: a non-finite camera zoom collapsing the radius to NaN (a circle that
  // never hit-tests), and `eventMode` getting clobbered without ever being
  // re-asserted on a live ship.

  function hitRadius(sprite: NpcShipSprite): number {
    const area = sprite.container.hitArea as Circle;
    return area.radius;
  }

  it("never lets the hit radius drop below the floor, even at huge zoom", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_zoom"), 200, 0, bounds);
    sprite.setClickHandler(() => {});

    sprite.updateHitArea(10); // very zoomed in → 40/10 = 4, must be floored
    expect(hitRadius(sprite)).toBeGreaterThanOrEqual(28);

    sprite.updateHitArea(0.25); // zoomed out → 40/0.25 = 160, grows freely
    expect(hitRadius(sprite)).toBeCloseTo(160);

    sprite.destroy();
  });

  it("ignores a non-finite/zero camera zoom instead of collapsing the hit-area (regression)", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_nan"), 200, 0, bounds);
    sprite.setClickHandler(() => {});

    sprite.updateHitArea(0.5); // establish a good zoom → radius 80
    const good = hitRadius(sprite);
    expect(good).toBeCloseTo(80);

    // A transient bad transform (NaN / 0 / negative) must NOT produce a NaN
    // radius — that circle never hit-tests, making the ship permanently dead.
    for (const bad of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY]) {
      sprite.updateHitArea(bad);
      const r = hitRadius(sprite);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(28);
      expect(r).toBeCloseTo(good); // keeps the last good zoom
    }

    sprite.destroy();
  });

  it("re-asserts eventMode='static' when the hit-area is refreshed (survives a clobber)", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_clobber"), 200, 0, bounds);
    sprite.setClickHandler(() => {});

    // Simulate combat/cursor logic clobbering interactivity to passive.
    sprite.container.eventMode = "passive";
    sprite.updateHitArea(1);
    expect(sprite.container.eventMode).toBe("static");

    sprite.destroy();
  });

  it("restoreInteractivity restores a finite circular hit-area, not just eventMode", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_restore"), 200, 0, bounds);
    sprite.setClickHandler(() => {});
    sprite.updateHitArea(0.5); // radius 80 at this zoom

    // Lose interactivity mid-turn, then the turn ends → full restore.
    sprite.container.eventMode = "none";
    sprite.restoreInteractivity();

    expect(sprite.container.eventMode).toBe("static");
    expect(sprite.container.hitArea).toBeInstanceOf(Circle);
    const r = hitRadius(sprite);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(28);

    sprite.destroy();
  });

  it("keeps a departing ship non-interactive across an updateHitArea call", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_depart"), 200, 0, bounds);
    sprite.setClickHandler(() => {});
    sprite.beginDeparture();

    // A camera transform while the ship jumps out must not re-arm it.
    sprite.updateHitArea(1);
    expect(sprite.container.eventMode).toBe("none");

    sprite.destroy();
  });
});
