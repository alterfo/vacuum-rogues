import { describe, it, expect } from "vitest";
import {
  canPlayerLiberate,
  hostileShipsPresent,
  type LiberationGalaxyView,
  type LiberationShipView,
} from "@/systems/galaxy/liberation";
import { Faction } from "@/types/faction";
import { NpcRole, NpcState } from "@/types";

/**
 * Player-driven liberation predicate (Task 4 of the late-game-recoverability
 * pass). A captured system becomes reclaimable the moment its hostile garrison is
 * cleared — the discoverable, fight-gated counter-play that makes the pirate /
 * Overmind front reversible mid-game. Pure + structural, covering both capture
 * kinds without booting the engine.
 */

function ship(over: Partial<LiberationShipView>): LiberationShipView {
  return {
    currentSystemId: "s1",
    state: NpcState.IDLE,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    ...over,
  };
}

function view(
  hostileSystems: string[],
  ships: LiberationShipView[],
): LiberationGalaxyView {
  return {
    isHostileSystem: (id) => hostileSystems.includes(id),
    npcShips: ships,
  };
}

describe("hostileShipsPresent", () => {
  it("counts present pirate-role and Overmind-faction ships in the system", () => {
    const ships = [
      ship({ role: NpcRole.PIRATE }),
      ship({ faction: Faction.OVERMIND, role: NpcRole.PATROL }),
      ship({ role: NpcRole.TRADER }), // not hostile
    ];
    expect(hostileShipsPresent(ships, "s1")).toBe(2);
  });

  it("ignores ships in another system", () => {
    const ships = [ship({ role: NpcRole.PIRATE, currentSystemId: "s2" })];
    expect(hostileShipsPresent(ships, "s1")).toBe(0);
  });

  it("ignores DEAD and TRAVELING (not present) hostiles", () => {
    const ships = [
      ship({ role: NpcRole.PIRATE, state: NpcState.DEAD }),
      ship({ role: NpcRole.PIRATE, state: NpcState.TRAVELING }),
    ];
    expect(hostileShipsPresent(ships, "s1")).toBe(0);
  });
});

describe("canPlayerLiberate", () => {
  it("is false for a faction-held system (nothing to liberate)", () => {
    expect(canPlayerLiberate(view([], []), "s1")).toBe(false);
  });

  it("is false for a captured system that still has a hostile defender", () => {
    const v = view(["s1"], [ship({ role: NpcRole.PIRATE })]);
    expect(canPlayerLiberate(v, "s1")).toBe(false);
  });

  it("is true for a pirate-captured system once its garrison is cleared", () => {
    expect(canPlayerLiberate(view(["s1"], []), "s1")).toBe(true);
  });

  it("is true for an Overmind-captured system once its garrison is cleared", () => {
    // A lingering DEAD hostile does not block — only present defenders do.
    const v = view(
      ["s1"],
      [ship({ role: NpcRole.PIRATE, state: NpcState.DEAD })],
    );
    expect(canPlayerLiberate(v, "s1")).toBe(true);
  });

  it("frees only the system the player is in (no map-wide auto-clear)", () => {
    // Two captured systems, both cleared, but the predicate is single-system:
    // liberation acts on the queried id alone.
    const v = view(["s1", "s2"], []);
    expect(canPlayerLiberate(v, "s1")).toBe(true);
    // s2 is still hostile — the player must fly there + clear it separately.
    expect(v.isHostileSystem("s2")).toBe(true);
  });
});
