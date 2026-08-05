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
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

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
    expect(
      [...versions].some((v) => v < MigrationPipeline.CURRENT_VERSION),
    ).toBe(true);
  });

  describe.each(FIXTURES)("%s", (name) => {
    it("validates (gate) → migrates to CURRENT_VERSION → re-validates", () => {
      const raw = readFixture(name) as unknown as Record<string, unknown>;

      expect(() => validateSaveState(raw)).not.toThrow();

      const migrated = MigrationPipeline.migrate(raw as unknown as SaveState);
      expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);

      expect(() => validateSaveState(migrated)).not.toThrow();
    });

    it("preserves credits and galaxy through migration", () => {
      const before = readFixture(name);
      const migrated = MigrationPipeline.migrate(
        readFixture(name) as unknown as SaveState,
      ) as unknown as RawSave;

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

      const resolvedScene = transitionSpy.mock.calls[0]?.[0] as SceneType;
      expect(Object.values(SceneType)).toContain(resolvedScene);
      expect(NON_RESUMABLE.has(resolvedScene)).toBe(false);

      expect(engine.player!.credits).toBe(before.player.credits);
      expect(engine.galaxy!.systems.length).toBe(before.galaxy.systems.length);
      expect(
        engine.galaxy!.systems.some(
          (s) => s.id === engine.player!.currentSystemId,
        ),
      ).toBe(true);
      expect(engine.playerLoadout).not.toBeNull();
      expect(engine.playerLoadout!.derivedStats().canTakeOff).toBe(true);

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
