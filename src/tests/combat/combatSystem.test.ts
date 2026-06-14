import { describe, it, expect, vi, afterEach } from "vitest";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { ResourceType } from "@/types";
import type { EnemyType, AIProfile } from "@/types";
import {
  ARTIFACT_DROP_CHANCE,
  ARTIFACT_DROP_COUNT_MIN,
  ARTIFACT_DROP_COUNT_MAX,
} from "@/config/balance";

function makeEnemy(techLevel = 2): EnemyShip {
  return new EnemyShip(
    `e_${techLevel}`,
    "FIGHTER" as EnemyType,
    60,
    0,
    0.1,
    10,
    false,
    [],
    {} as AIProfile,
    techLevel,
  );
}

function makeSystem(): CombatSystem {
  return new CombatSystem(new AdaptiveQualityProfile());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CombatSystem.resolveVictory — Overmind artifact drops", () => {
  it("drops artifacts when isOvermindSystem=true and RNG < ARTIFACT_DROP_CHANCE", () => {
    // First call is for gear drop (Math.random() < 0.3), second for artifact roll.
    // We want gear drop to miss (0.5 >= 0.3) and artifact roll to hit (0.1 < 0.4).
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.5) // gear drop: miss
      .mockReturnValueOnce(0.1) // artifact roll: hit
      .mockReturnValue(0); // artifact count rng → min

    const system = makeSystem();
    system.isOvermindSystem = true;
    const result = system.resolveVictory([makeEnemy()]);

    const artifacts = result.items.filter(
      (i) => i.type === ResourceType.ARTIFACTS,
    );
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts[0].amount).toBeGreaterThanOrEqual(ARTIFACT_DROP_COUNT_MIN);
    expect(artifacts[0].amount).toBeLessThanOrEqual(ARTIFACT_DROP_COUNT_MAX);
  });

  it("drops no artifacts when isOvermindSystem=true but RNG >= ARTIFACT_DROP_CHANCE", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.5) // gear drop: miss
      .mockReturnValue(ARTIFACT_DROP_CHANCE); // artifact roll: miss (equal = no drop)

    const system = makeSystem();
    system.isOvermindSystem = true;
    const result = system.resolveVictory([makeEnemy()]);

    const artifacts = result.items.filter(
      (i) => i.type === ResourceType.ARTIFACTS,
    );
    expect(artifacts).toHaveLength(0);
  });

  it("never drops artifacts when isOvermindSystem=false regardless of RNG", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // would always trigger if checked

    const system = makeSystem();
    system.isOvermindSystem = false;
    const result = system.resolveVictory([makeEnemy()]);

    const artifacts = result.items.filter(
      (i) => i.type === ResourceType.ARTIFACTS,
    );
    expect(artifacts).toHaveLength(0);
  });

  it("defaults isOvermindSystem to false on construction", () => {
    const system = makeSystem();
    expect(system.isOvermindSystem).toBe(false);
  });

  it("items array is empty when no artifacts dropped (non-Overmind)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const system = makeSystem();
    const result = system.resolveVictory([makeEnemy()]);
    expect(result.items).toHaveLength(0);
  });
});
