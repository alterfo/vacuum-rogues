import { describe, it, expect, vi } from "vitest";

// The pure prefix resolver lives in NpcShipSprite.ts, which imports PixiJS at
// module level — mock it (same pattern as the other presentation tests) so the
// resolver is testable in jsdom without a renderer.
vi.mock("pixi.js", () => ({
  Container: class {},
  Graphics: class {},
  Sprite: class {},
  Circle: class {},
  Assets: { load: vi.fn() },
  Texture: class {},
}));

import { shipArtPrefix } from "@/presentation/NpcShipSprite";
import { pickVariant } from "@/presentation/textures";
import { NpcRole, type NpcSizeTier } from "@/types";
import { Faction } from "@/types/faction";

function npcLike(
  role: NpcRole,
  faction: Faction,
  sizeTier?: NpcSizeTier,
): { role: NpcRole; faction: Faction; sizeTier?: NpcSizeTier } {
  return { role, faction, sizeTier };
}

/**
 * Task 2 of 20260709-overmind-ship-identity-and-balance: Overmind-faction
 * ships resolve size-tier-specific hull art (`overmind_<tier>`); every other
 * faction/role keeps its existing role-keyed prefix.
 */
describe("shipArtPrefix — Overmind size-tier art selection", () => {
  it("resolves overmind_<tier> for Overmind-faction ships", () => {
    expect(
      shipArtPrefix(npcLike(NpcRole.OVERMIND, Faction.OVERMIND, "small")),
    ).toBe("overmind_small");
    expect(
      shipArtPrefix(npcLike(NpcRole.OVERMIND, Faction.OVERMIND, "large")),
    ).toBe("overmind_large");
    expect(
      shipArtPrefix(npcLike(NpcRole.OVERMIND, Faction.OVERMIND, "boss")),
    ).toBe("overmind_boss");
  });

  it("defaults a tier-less Overmind ship (old save) to the medium art", () => {
    expect(shipArtPrefix(npcLike(NpcRole.OVERMIND, Faction.OVERMIND))).toBe(
      "overmind_medium",
    );
  });

  it("leaves every other faction/role on its role-keyed prefix", () => {
    expect(shipArtPrefix(npcLike(NpcRole.RANGER, Faction.BASTIONS))).toBe(
      "ranger",
    );
    expect(shipArtPrefix(npcLike(NpcRole.TRADER, Faction.SYNDICATE))).toBe(
      "trader",
    );
    expect(shipArtPrefix(npcLike(NpcRole.PIRATE, Faction.OUTLANDERS))).toBe(
      "pirate",
    );
    expect(shipArtPrefix(npcLike(NpcRole.PATROL, Faction.PROGRESSORS))).toBe(
      "patrol",
    );
    // A sizeTier on a non-Overmind ship is ignored — no parallel art axis.
    expect(
      shipArtPrefix(npcLike(NpcRole.PATROL, Faction.PROGRESSORS, "large")),
    ).toBe("patrol");
  });

  it("an ungenerated overmind_* variant degrades gracefully (pickVariant → undefined, no throw)", () => {
    // Nothing is preloaded in the unit env, mirroring the not-yet-generated
    // art state in production: pickVariant returns undefined and the sprite
    // constructor falls back to its procedural Graphics hull.
    expect(pickVariant("ships", "overmind_medium", "npc_x")).toBeUndefined();
  });
});
