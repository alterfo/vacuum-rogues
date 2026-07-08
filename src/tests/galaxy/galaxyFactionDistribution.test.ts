import { describe, it, expect } from "vitest";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

/**
 * Task 4 (galaxy faction diversity): `GalaxySimulator.generateGalaxy` used to
 * hardcode every system's `ownerFaction` to `"INDEPENDENT" as Faction` — a
 * galaxy where every star system's owner plaque reads the same, with no
 * faction presence anywhere. These tests assert the *relationships* (more
 * than one distinct owner, faction-home systems owned by their own faction)
 * rather than exact magnitudes, so weight tuning won't churn them.
 */
describe("GalaxySimulator seeds varied system owners", () => {
  it("a generated galaxy is not a field of identical INDEPENDENT owners", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "faction-variety",
      40,
    );
    const owners = new Set(galaxy.systems.map((s) => s.ownerFaction));
    // More than one distinct owner faction across the galaxy.
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
