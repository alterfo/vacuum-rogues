import { describe, expect, it } from "vitest";
import {
  questDestination,
  questRouteAction,
  type QuestDestinationGalaxyLike,
} from "@/systems/quests/questDestination";

/** A two-system galaxy: "sol" (with planet "earth") and "alpha" (with "alphab"). */
const galaxy: QuestDestinationGalaxyLike = {
  systems: [
    {
      id: "sol",
      name: "Солнечная",
      planets: [
        { id: "earth", name: "Земля" },
        { id: "mars", name: "Марс" },
      ],
    },
    {
      id: "alpha",
      name: "Альфа Центавра",
      planets: [{ id: "alphab", name: "Альфа-Б" }],
    },
  ],
};

describe("questDestination", () => {
  it("resolves system + planet names and marks same-system when ids match", () => {
    const dest = questDestination(
      { targetSystemId: "sol", targetPlanetId: "earth" },
      galaxy,
      "sol",
    );
    expect(dest).toEqual({
      systemId: "sol",
      systemName: "Солнечная",
      planetId: "earth",
      planetName: "Земля",
      sameSystem: true,
    });
  });

  it("marks sameSystem false when the target system differs from the current one", () => {
    const dest = questDestination(
      { targetSystemId: "alpha", targetPlanetId: "alphab" },
      galaxy,
      "sol",
    );
    expect(dest.systemName).toBe("Альфа Центавра");
    expect(dest.planetName).toBe("Альфа-Б");
    expect(dest.sameSystem).toBe(false);
  });

  it("tolerates a null targetPlanetId (planetName null)", () => {
    const dest = questDestination(
      { targetSystemId: "alpha", targetPlanetId: null },
      galaxy,
      "sol",
    );
    expect(dest.planetId).toBeNull();
    expect(dest.planetName).toBeNull();
    expect(dest.systemName).toBe("Альфа Центавра");
  });

  it("falls back to the id for an unknown system and null for an unknown planet", () => {
    const dest = questDestination(
      { targetSystemId: "ghost", targetPlanetId: "nowhere" },
      galaxy,
      "sol",
    );
    expect(dest.systemName).toBe("ghost");
    expect(dest.planetName).toBeNull();
    expect(dest.sameSystem).toBe(false);
  });

  it("does not match a planet that belongs to a different system", () => {
    // "earth" lives in "sol", not "alpha" → unresolved within the target system.
    const dest = questDestination(
      { targetSystemId: "alpha", targetPlanetId: "earth" },
      galaxy,
      "alpha",
    );
    expect(dest.planetName).toBeNull();
    expect(dest.sameSystem).toBe(true);
  });
});

describe("questRouteAction", () => {
  it("approaches the planet when same-system with a concrete planet", () => {
    const action = questRouteAction({
      systemId: "sol",
      systemName: "Солнечная",
      planetId: "earth",
      planetName: "Земля",
      sameSystem: true,
    });
    expect(action).toEqual({ kind: "approach-planet", planetId: "earth" });
  });

  it("warps to the system when the target is in another system", () => {
    const action = questRouteAction({
      systemId: "alpha",
      systemName: "Альфа Центавра",
      planetId: "alphab",
      planetName: "Альфа-Б",
      sameSystem: false,
    });
    expect(action).toEqual({ kind: "warp-to-system", systemId: "alpha" });
  });

  it("falls back to warp-to-system when same-system but no planet is named", () => {
    const action = questRouteAction({
      systemId: "sol",
      systemName: "Солнечная",
      planetId: null,
      planetName: null,
      sameSystem: true,
    });
    expect(action).toEqual({ kind: "warp-to-system", systemId: "sol" });
  });
});
