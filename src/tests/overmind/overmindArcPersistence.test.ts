import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { SaveState } from "@/domain/SaveState";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { GalaxySchema, OvermindSpreadStateSchema } from "@/validation/schemas";
import { initialOvermindSpreadState } from "@/systems/overmind/overmindSpread";
import type { StarSystem } from "@/domain/StarSystem";
import type { Player } from "@/domain/Player";
import type { OvermindSpreadState } from "@/types";

/**
 * Task 2 — persisted Overmind-arc state (`Galaxy.overmindArc`).
 *
 * The arc clock/threat snapshot is a new *persisted* field, so it follows the
 * schema + migration + version-bump lockstep. These tests pin the round-trip
 * (save → serialize → deserialize) and the old-save default path: a save made
 * before the field existed must load with a dormant default, never `undefined`.
 */

/** Minimal Galaxy with `systemCount` linear systems (reused from overmind.test). */
function makeGalaxy(systemCount = 6): Galaxy {
  const systems: StarSystem[] = Array.from({ length: systemCount }, (_, i) => ({
    id: `sys_${i}`,
    name: `System ${i}`,
    coordinates: { q: i, r: 0 },
    planets: [],
    stations: [],
    connections:
      i < systemCount - 1
        ? [{ toSystemId: `sys_${i + 1}` }]
        : [{ toSystemId: `sys_${i - 1}` }],
    starType: "YELLOW_DWARF" as const,
    explored: true,
    fogOfWar: false,
    economyType: "MIXED" as const,
    politicalSystem: "REPUBLIC" as const,
    ownerFaction: "INDEPENDENT" as const,
    enter: () => {},
    lastVisitedDay: undefined,
  })) as unknown as StarSystem[];

  return new Galaxy("g_test", systems, new Overmind(), [], [], [], "sys_5");
}

/** A non-default arc state — the value the round-trip must preserve verbatim. */
const ADVANCING_ARC: OvermindSpreadState = {
  dayZero: 4,
  lastSpreadDay: 12,
  status: "advancing",
  threat: 0.34,
  peakThreat: 0.41,
};

describe("Overmind-arc state — fresh-galaxy default", () => {
  it("a freshly constructed Galaxy starts with the dormant arc state", () => {
    const galaxy = makeGalaxy();
    expect(galaxy.overmindArc).toEqual(initialOvermindSpreadState());
    expect(galaxy.overmindArc.status).toBe("dormant");
  });
});

describe("Overmind-arc state — save/load round-trip", () => {
  it("serialize → deserialize preserves a non-default arc verbatim", () => {
    const galaxy = makeGalaxy();
    galaxy.overmindArc = { ...ADVANCING_ARC };

    const save = new SaveState(
      MigrationPipeline.CURRENT_VERSION,
      galaxy,
      {} as unknown as Player,
      [],
      Date.now(),
    );

    const restored = SaveState.deserialize(save.serialize());
    expect(
      (restored.galaxy as unknown as { overmindArc: OvermindSpreadState })
        .overmindArc,
    ).toEqual(ADVANCING_ARC);
  });

  it("the Zod schema round-trips a non-default arc unchanged", () => {
    expect(OvermindSpreadStateSchema.parse(ADVANCING_ARC)).toEqual(
      ADVANCING_ARC,
    );
  });

  it("the schema rejects an unknown status / out-of-range threat", () => {
    expect(() =>
      OvermindSpreadStateSchema.parse({ ...ADVANCING_ARC, status: "nope" }),
    ).toThrow();
    expect(() =>
      OvermindSpreadStateSchema.parse({ ...ADVANCING_ARC, threat: 1.5 }),
    ).toThrow();
  });
});

describe("Overmind-arc state — old saves default safely", () => {
  /** Minimal raw save object at the prior version, with NO overmindArc. */
  function makeOldRawSave(): Record<string, unknown> {
    return {
      version: 27,
      timestamp: 1_000_000,
      persistentDialogs: [],
      galaxy: {
        id: "g_old",
        gameDays: 9,
        systems: [{ id: "sys_0" }, { id: "sys_1" }],
        overmindSystems: ["sys_1"],
        overmindCoreSystemId: "sys_1",
        // NOTE: deliberately omits overmindArc to simulate a pre-arc save.
      },
      player: { id: "p", credits: 100 },
    };
  }

  it("the migration backfills a dormant arc on a save that lacks it", () => {
    const raw = makeOldRawSave();
    expect((raw.galaxy as Record<string, unknown>).overmindArc).toBeUndefined();

    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);

    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);
    const gal = migrated.galaxy as unknown as {
      overmindArc: OvermindSpreadState;
      overmindSystems: string[];
    };
    expect(gal.overmindArc).toEqual(initialOvermindSpreadState());
    // The already-persisted captured set is untouched by the arc migration.
    expect(gal.overmindSystems).toEqual(["sys_1"]);
  });

  it("the GalaxySchema default matches initialOvermindSpreadState() (one source of truth)", () => {
    const schemaDefault = GalaxySchema.shape.overmindArc.parse(undefined);
    expect(schemaDefault).toEqual(initialOvermindSpreadState());
  });

  it("migrating an already-current arc is idempotent (no clobber)", () => {
    const raw = makeOldRawSave();
    (raw.galaxy as Record<string, unknown>).overmindArc = { ...ADVANCING_ARC };
    (raw as Record<string, unknown>).version =
      MigrationPipeline.CURRENT_VERSION;

    const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);
    expect(
      (migrated.galaxy as unknown as { overmindArc: OvermindSpreadState })
        .overmindArc,
    ).toEqual(ADVANCING_ARC);
  });
});
