import { describe, it, expect } from "vitest";
import {
  canLandOnPlanet,
  grantPirateTributeRep,
  landingDenialMessage,
  PIRATE_FACTION_ID,
} from "@/systems/galaxy/landingAccess";
import {
  GOOD_PIRATE_REP_THRESHOLD,
  PIRATE_TRIBUTE_REP_GAIN,
} from "@/config/balance";
import { shakedownTribute } from "@/systems/npc/NpcBrain";

/**
 * Task 3 — pirate-rep recovery. Today only *decreases* (or no upward path) exist
 * for pirate reputation, so a player whose pirate standing fell to −50 is locked
 * out of every pirate-captured system forever. Buying off a shakedown
 * («Откупиться») is the repeatable, credit-costed way back up.
 */

/** Minimal mutable player rep stub keyed by faction id, clamped [-100,100]. */
function makePlayer(initialPirateRep = 0) {
  const rep: Record<string, number> = { [PIRATE_FACTION_ID]: initialPirateRep };
  return {
    getReputation: (f: string) => rep[f] ?? 0,
    adjustReputation: (f: string, d: number) => {
      rep[f] = Math.max(-100, Math.min(100, (rep[f] ?? 0) + d));
    },
  };
}

/** A pirate-captured planet (the only kind gated by pirate reputation). */
const piratePlanet = { capturedBy: PIRATE_FACTION_ID } as unknown as Parameters<
  typeof canLandOnPlanet
>[0];

describe("pirate-rep recovery (Task 3)", () => {
  it("buying off a shakedown raises pirate reputation (a repeatable way up)", () => {
    const player = makePlayer(-50);
    const before = player.getReputation(PIRATE_FACTION_ID);
    const after = grantPirateTributeRep(player);
    expect(after).toBe(before + PIRATE_TRIBUTE_REP_GAIN);
    expect(after).toBeGreaterThan(before);
  });

  it("the per-interaction gain is small and bounded — cannot one-shot to good standing", () => {
    expect(PIRATE_TRIBUTE_REP_GAIN).toBeGreaterThan(0);
    expect(PIRATE_TRIBUTE_REP_GAIN).toBeLessThan(GOOD_PIRATE_REP_THRESHOLD);
  });

  it("a single payoff from −50 does NOT regain landing access (no one-shot recovery)", () => {
    const player = makePlayer(-50);
    expect(canLandOnPlanet(piratePlanet, player).allowed).toBe(false);
    grantPirateTributeRep(player);
    expect(canLandOnPlanet(piratePlanet, player).allowed).toBe(false);
  });

  it("repeated payoffs eventually regain landing access — over several, not one", () => {
    const player = makePlayer(-50);
    expect(canLandOnPlanet(piratePlanet, player).allowed).toBe(false);
    let payoffs = 0;
    while (!canLandOnPlanet(piratePlanet, player).allowed && payoffs < 1000) {
      grantPirateTributeRep(player);
      payoffs++;
    }
    expect(canLandOnPlanet(piratePlanet, player).allowed).toBe(true);
    // A genuine grind (several costly payoffs), not a free one-shot.
    expect(payoffs).toBeGreaterThan(1);
  });

  it("never overshoots the +100 reputation clamp", () => {
    const player = makePlayer(99);
    grantPirateTributeRep(player);
    expect(player.getReputation(PIRATE_FACTION_ID)).toBeLessThanOrEqual(100);
  });

  it("the payoff has a meaningful credit cost — standing is bought, not free", () => {
    expect(shakedownTribute(10_000)).toBeGreaterThan(0);
  });

  it("the denial text surfaces the recovery hint (how to regain access)", () => {
    const msg = landingDenialMessage("pirate-rep");
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toBe(landingDenialMessage("overmind"));
    // Mentions the buy-off path so a blocked player learns how to climb back.
    expect(msg).toContain("Откуп");
  });
});
