import { describe, expect, it } from "vitest";
import {
  questDestination,
  questRouteAction,
  type QuestDestinationGalaxyLike,
} from "@/systems/quests/questDestination";
import { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import type { GalacticEvent } from "@/domain/GalacticEvent";

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

describe("questRouteAction id resolves through real Galaxy.systemForLocation", () => {
  function makeSystem(
    id: string,
    planets: Array<{ id: string; name: string }>,
  ): StarSystem {
    return {
      id,
      name: id,
      planets,
      connections: [],
      explored: false,
      fogOfWar: false,
    } as unknown as StarSystem;
  }

  const realGalaxy = new Galaxy(
    "g1",
    [
      makeSystem("sys_home", [{ id: "planet_home", name: "Дом" }]),
      makeSystem("sys_far", [{ id: "planet_far", name: "Даль" }]),
    ],
    {} as Overmind,
    [] as GalacticEvent[],
    [],
    [],
    "",
    [],
  );

  it("cross-system: the dispatched SYSTEM id resolves to the target system", () => {
    const dest = questDestination(
      { targetSystemId: "sys_far", targetPlanetId: "planet_far" },
      realGalaxy,
      "sys_home", // player elsewhere
    );
    const action = questRouteAction(dest);
    expect(action.kind).toBe("warp-to-system");
    const id =
      action.kind === "warp-to-system" ? action.systemId : action.planetId;
    expect(realGalaxy.systemForLocation(id)?.id).toBe("sys_far");
  });

  it("same-system: the dispatched PLANET id resolves to its hosting system", () => {
    const dest = questDestination(
      { targetSystemId: "sys_home", targetPlanetId: "planet_home" },
      realGalaxy,
      "sys_home", // player here
    );
    const action = questRouteAction(dest);
    expect(action.kind).toBe("approach-planet");
    const id =
      action.kind === "approach-planet" ? action.planetId : action.systemId;
    expect(realGalaxy.systemForLocation(id)?.id).toBe("sys_home");
  });
});
