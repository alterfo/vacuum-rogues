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
});
