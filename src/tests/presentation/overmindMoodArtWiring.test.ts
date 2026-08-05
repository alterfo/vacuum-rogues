import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EscalationInputs } from "@/systems/campaign/escalationNotices";

const tx = vi.hoisted(() => ({
  pickVariantKey:
    vi.fn<(cat: string, prefix: string, seed: string) => string | undefined>(),
}));

vi.mock("@/presentation/textures", async () => {
  const actual = await vi.importActual<
    typeof import("@/presentation/textures")
  >("@/presentation/textures");
  return { ...actual, pickVariantKey: tx.pickVariantKey };
});

import { overmindMoodArtKey } from "@/presentation/overmindMoodArt";

function inputs(over: Partial<EscalationInputs> = {}): EscalationInputs {
  return { peakPower: 0, overmindShare: 0, arcStatus: "dormant", ...over };
}

describe("overmindMoodArtKey — delegates to pickVariantKey('overmind_mood', <stage>, <stage>)", () => {
  beforeEach(() => {
    tx.pickVariantKey.mockReset();
  });

  it("returns null without querying art when the stage is dormant", () => {
    expect(overmindMoodArtKey(inputs())).toBeNull();
    expect(tx.pickVariantKey).not.toHaveBeenCalled();
  });

  it("queries the overmind_mood category with the active stage as prefix and seed", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    overmindMoodArtKey(inputs({ peakPower: 1 }));
    expect(tx.pickVariantKey).toHaveBeenCalledWith(
      "overmind_mood",
      "noticed",
      "noticed",
    );
  });

  it("returns the resolved key verbatim when art exists (lights up when art lands)", () => {
    tx.pickVariantKey.mockReturnValue("overmind_mood/hardening");
    expect(overmindMoodArtKey(inputs({ overmindShare: 1 }))).toBe(
      "overmind_mood/hardening",
    );
  });

  it("normalises a missing match to null (no-art fallback)", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    expect(overmindMoodArtKey(inputs({ peakPower: 1 }))).toBeNull();
  });
});
