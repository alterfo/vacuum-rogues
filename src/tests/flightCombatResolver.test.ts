import { describe, it, expect } from "vitest";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import type { NpcSpriteView } from "@/systems/FlightCombatResolver";
import { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShip } from "@/domain/NpcShip";

function makeShipPhysics(x: number, y: number): ShipPhysics {
  return new ShipPhysics(x, y, 0.1);
}

function makeNpcSprite(id: string, x: number, y: number): NpcSpriteView {
  return { npc: { id } as NpcShip, x, y };
}

describe("FlightCombatResolver", () => {
  const resolver = new FlightCombatResolver();

  it("returns idle when turn is not running", () => {
    const physics = makeShipPhysics(0, 0);
    const result = resolver.decide({
      isTurnRunning: false,
      followNpcId: "npc-1",
      shipPhysics: physics,
      npcSprites: [makeNpcSprite("npc-1", 100, 0)],
      weaponRange: 240,
    });
    expect(result.action).toBe("idle");
  });

  it("returns idle when no follow target", () => {
    const physics = makeShipPhysics(0, 0);
    const result = resolver.decide({
      isTurnRunning: true,
      followNpcId: null,
      shipPhysics: physics,
      npcSprites: [],
      weaponRange: 240,
    });
    expect(result.action).toBe("idle");
  });

  it("returns lost when follow target not found in sprites", () => {
    const physics = makeShipPhysics(0, 0);
    const result = resolver.decide({
      isTurnRunning: true,
      followNpcId: "missing-npc",
      shipPhysics: physics,
      npcSprites: [makeNpcSprite("other-npc", 100, 0)],
      weaponRange: 240,
    });
    expect(result.action).toBe("lost");
  });

  it("returns chase when target is beyond weapon range", () => {
    const physics = makeShipPhysics(0, 0);
    const result = resolver.decide({
      isTurnRunning: true,
      followNpcId: "npc-1",
      shipPhysics: physics,
      npcSprites: [makeNpcSprite("npc-1", 500, 0)],
      weaponRange: 240,
    });
    expect(result.action).toBe("chase");
    if (result.action === "chase") {
      expect(result.targetX).toBe(500);
      expect(result.targetY).toBe(0);
    }
  });

  it("returns launch when target is within weapon range", () => {
    const physics = makeShipPhysics(0, 0);
    const sprite = makeNpcSprite("npc-1", 100, 0);
    const result = resolver.decide({
      isTurnRunning: true,
      followNpcId: "npc-1",
      shipPhysics: physics,
      npcSprites: [sprite],
      weaponRange: 240,
    });
    expect(result.action).toBe("launch");
    if (result.action === "launch") {
      expect(result.npc).toBe(sprite.npc);
    }
  });
});
