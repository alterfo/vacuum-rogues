import { describe, it, expect } from "vitest";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

describe("GalaxySimulator seeds varied system owners", () => {
  it("a generated galaxy is not a field of identical INDEPENDENT owners", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "faction-variety",
      40,
    );
    const owners = new Set(galaxy.systems.map((s) => s.ownerFaction));
    expect(owners.size).toBeGreaterThan(1);
  });

  it("every faction-home system is owned by its own home faction", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "faction-home-owner",
      40,
    );
    const homeSystems = galaxy.systems.filter((s) => s.isFactionHome);
    expect(homeSystems.length).toBeGreaterThan(0);
    for (const s of homeSystems) {
      expect(s.ownerFaction).toBe(s.homeFactionId);
    }
  });
});
