import { describe, it, expect } from "vitest";
import {
  canLandOnPlanet,
  PIRATE_FACTION_ID,
} from "@/systems/galaxy/landingAccess";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";
import { Faction } from "@/types/faction";

/** Minimal planet stub carrying only the captured-control flag the rule reads. */
function planet(capturedBy: string | null) {
  return { capturedBy } as unknown as Parameters<typeof canLandOnPlanet>[0];
}

/** Minimal player stub returning `rep` for the pirate faction (0 otherwise). */
function player(rep: number) {
  return {
    getReputation: (factionId: string) =>
      factionId === PIRATE_FACTION_ID ? rep : 0,
  } as unknown as Parameters<typeof canLandOnPlanet>[1];
}

describe("canLandOnPlanet", () => {
  it("allows landing on an uncaptured planet", () => {
    expect(canLandOnPlanet(planet(null), player(0))).toEqual({ allowed: true });
  });

  it("never allows landing on an Overmind-captured planet, even with high pirate rep", () => {
    expect(canLandOnPlanet(planet(Faction.OVERMIND), player(100))).toEqual({
      allowed: false,
      reason: "overmind",
    });
  });

  it("allows landing on a pirate planet with good pirate reputation", () => {
    expect(
      canLandOnPlanet(
        planet(PIRATE_FACTION_ID),
        player(GOOD_PIRATE_REP_THRESHOLD + 10),
      ),
    ).toEqual({ allowed: true });
  });

  it("blocks landing on a pirate planet without good pirate reputation", () => {
    expect(canLandOnPlanet(planet(PIRATE_FACTION_ID), player(0))).toEqual({
      allowed: false,
      reason: "pirate-rep",
    });
  });

  it("blocks landing on a pirate planet with hostile pirate reputation", () => {
    expect(canLandOnPlanet(planet(PIRATE_FACTION_ID), player(-100))).toEqual({
      allowed: false,
      reason: "pirate-rep",
    });
  });

  describe("pirate-rep threshold boundary", () => {
    it("allows at exactly the threshold", () => {
      expect(
        canLandOnPlanet(
          planet(PIRATE_FACTION_ID),
          player(GOOD_PIRATE_REP_THRESHOLD),
        ),
      ).toEqual({ allowed: true });
    });

    it("blocks just below the threshold", () => {
      expect(
        canLandOnPlanet(
          planet(PIRATE_FACTION_ID),
          player(GOOD_PIRATE_REP_THRESHOLD - 1),
        ),
      ).toEqual({ allowed: false, reason: "pirate-rep" });
    });
  });

  it("allows landing on a planet captured by an ordinary faction (rule does not gate it)", () => {
    expect(canLandOnPlanet(planet(Faction.BASTIONS), player(0))).toEqual({
      allowed: true,
    });
  });
});
