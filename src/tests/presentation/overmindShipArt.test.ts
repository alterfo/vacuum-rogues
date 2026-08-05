import { describe, it, expect, vi } from "vitest";

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
    expect(
      shipArtPrefix(npcLike(NpcRole.PATROL, Faction.PROGRESSORS, "large")),
    ).toBe("patrol");
  });

  it("an ungenerated overmind_* variant degrades gracefully (pickVariant → undefined, no throw)", () => {
    expect(pickVariant("ships", "overmind_medium", "npc_x")).toBeUndefined();
  });
});
