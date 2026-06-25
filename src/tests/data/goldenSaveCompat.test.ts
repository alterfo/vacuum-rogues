/**
 * Golden-save compatibility gate (the safety net).
 *
 * Beta-testers have real, progressed saves. Every balance/schema change must keep
 * an old save loadable: it must still **deserialize → validate → migrate to the
 * CURRENT version → re-validate → load into the engine on a resumable scene**,
 * with credits and galaxy intact and no logged/thrown error. This test replays a
 * frozen corpus of representative saves (see `goldenSaves/`) against the current
 * code on every run — so a future change that would brick a progressed save fails
 * here instead of in a beta-tester's browser.
 *
 * The corpus mixes engine-generated current-version saves (regenerate with
 * `generateGoldenSaves.test.ts`) and hand-pinned older-version saves that
 * exercise the migration chain end-to-end. Add a new golden save whenever a new
 * *persisted* feature ships (see CLAUDE.md, "save-compat contract").
 *
 * The read pipeline mirrored here is exactly `SaveManager.read`: validate is the
 * gate (the schema tolerates old versions via `.optional()`/`.default()`), then
 * `MigrationPipeline.migrate` brings the raw object up to CURRENT_VERSION. The
 * engine load consumes that migrated object (just as production does — the mock
 * save service stands in only for IndexedDB).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MigrationPipeline } from "@/data/MigrationPipeline";
import { validateSaveState } from "@/validation/schemas";
import { logger } from "@/utils/logger";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import type { SaveState } from "@/domain/SaveState";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

// GameEngine → scenes → PlanetRotationFilter extends Filter at module load.
vi.mock("pixi.js", () => ({
  Filter: class {},
  Container: class {
    addChild = vi.fn();
    addChildAt = vi.fn();
    removeChild = vi.fn();
    children: unknown[] = [];
  },
  Graphics: class {},
  Text: class {},
  BlurFilter: class {},
  Application: class {},
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "goldenSaves");

/** Every committed golden-save fixture (generator + hand-pinned), sorted. */
const FIXTURES = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

interface RawSave {
  version: number;
  currentSceneType?: string;
  player: { credits: number; currentSystemId?: string };
  galaxy: { systems: Array<{ id: string }> };
}

function readFixture(name: string): RawSave {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, name), "utf8")) as RawSave;
}

/** Scenes that cannot resume from a bare `{ gameEngine }` — must never be the
 *  resolved load scene (loadGame falls back to SPACE_FLIGHT for these). */
const NON_RESUMABLE = new Set<SceneType>([
  SceneType.PLANET,
  SceneType.TRADE,
  SceneType.DIALOGUE,
  SceneType.INVENTORY,
  SceneType.STATION,
  SceneType.EQUIPMENT_SHOP,
  SceneType.GOVERNMENT,
  SceneType.TEXT_QUEST,
  SceneType.WIN_SCREEN,
  SceneType.INFO_CENTER,
  SceneType.BANK,
]);

describe("golden-save compatibility", () => {
  it("the corpus is non-empty and spans more than one save version", () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    const versions = new Set(FIXTURES.map((f) => readFixture(f).version));
    expect(versions.size).toBeGreaterThan(1);
    // At least one genuinely old save below the current version (a real
    // migration, not just a current-version round-trip).
    expect(
      [...versions].some((v) => v < MigrationPipeline.CURRENT_VERSION),
    ).toBe(true);
  });

  describe.each(FIXTURES)("%s", (name) => {
    it("validates (gate) → migrates to CURRENT_VERSION → re-validates", () => {
      const raw = readFixture(name) as unknown as Record<string, unknown>;

      // Gate: the current schema must accept the old save shape (the real
      // SaveManager.read validates BEFORE migrating).
      expect(() => validateSaveState(raw)).not.toThrow();

      const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);
      expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);

      // The migrated state must still satisfy the schema.
      expect(() => validateSaveState(migrated)).not.toThrow();
    });

    it("preserves credits and galaxy through migration", () => {
      const before = readFixture(name);
      const migrated = MigrationPipeline.migrate(
        readFixture(name) as unknown as SaveState,
      ) as unknown as RawSave;

      // Migration never touches money or destroys systems.
      expect(migrated.player.credits).toBe(before.player.credits);
      expect(migrated.galaxy.systems.length).toBe(before.galaxy.systems.length);
    });
  });

  describe("loads into the engine on a resumable scene (no logged error)", () => {
    let diDeps: GameEngineDIDependencies;
    let engine: GameEngine;
    let errorSpy: MockInstance;

    beforeEach(() => {
      localStorage.clear();
      errorSpy = vi.spyOn(logger, "error");
      diDeps = {
        saveService: new MockSaveService(),
        galaxyService: new MockGalaxyService(),
        playerService: new MockPlayerService(),
        onnxService: new MockOnnxService(),
        exceptionHandler: new MockExceptionHandler(),
        qualityProfile: new AdaptiveQualityProfile(),
        questService: new MockQuestService(),
      };
      engine = new GameEngine(diDeps);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it.each(FIXTURES)("%s", async (name) => {
      const before = readFixture(name);
      // Mirror SaveManager.read: validate gate, then migrate. The engine load
      // consumes the migrated object (production: SaveManager.read returns it).
      const migrated = MigrationPipeline.migrate(
        readFixture(name) as unknown as SaveState,
      );
      (diDeps.saveService as MockSaveService).setSave(
        "golden",
        migrated as unknown as SaveState,
      );

      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      await expect(engine.loadGame("golden")).resolves.toBe(true);

      // Resolved to a real, resumable scene — never a context-dependent one
      // (which would soft-lock "Continue" on a blank screen).
      const resolvedScene = transitionSpy.mock.calls[0]?.[0] as SceneType;
      expect(Object.values(SceneType)).toContain(resolvedScene);
      expect(NON_RESUMABLE.has(resolvedScene)).toBe(false);

      // Credits + galaxy intact, current system resolvable, a loadout in hand.
      expect(engine.player!.credits).toBe(before.player.credits);
      expect(engine.galaxy!.systems.length).toBe(before.galaxy.systems.length);
      expect(
        engine.galaxy!.systems.some(
          (s) => s.id === engine.player!.currentSystemId,
        ),
      ).toBe(true);
      expect(engine.playerLoadout).not.toBeNull();
      expect(engine.playerLoadout!.derivedStats().canTakeOff).toBe(true);

      // Nothing logged an error during deserialize → migrate → load.
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
