/**
 * Golden-save GENERATOR (dev-only, opt-in).
 *
 * Boots the *real* {@link GameEngine} with the real game-logic services and
 * freezes a couple of representative, progressed saves to disk as committed JSON
 * fixtures. Those frozen fixtures are the corpus the safety-net load test
 * (`goldenSaveCompat.test.ts`) replays against the *current* code on every CI
 * run — so a future schema/balance change that would brick a beta-tester's save
 * fails the gate.
 *
 * It is deliberately **skipped** unless `GEN_GOLDEN=1` is set, so a normal test
 * run never regenerates (and thus never silently re-freezes the fixtures to the
 * current code shape — that would defeat the point of a frozen corpus). To add
 * or refresh the engine-generated fixtures:
 *
 *   GEN_GOLDEN=1 npm test -- --run src/tests/data/goldenSaves/generateGoldenSaves.test.ts
 *
 * then commit the emitted `*.json`. Older-version fixtures are hand-pinned JSON
 * checked in alongside (see `legacy-v1.json` / `progressed-v23.json`) — they
 * predate features the current engine cannot produce, so they are authored by
 * hand rather than generated.
 */
import { describe, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { GalaxyService, PlayerService } from "@/core/services";
import { QuestManagerAdapter } from "@/core/adapters";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import {
  MockSaveService,
  MockOnnxService,
  MockExceptionHandler,
} from "@/tests/mocks";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  setupPlayerBanking,
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import {
  openSavings,
  deposit,
  savingsAccountId,
} from "@/systems/banking/products";
import { FactionType, SceneType } from "@/types";

// GameEngine → scenes → PlanetRotationFilter extends Filter at module load, so a
// constructable Filter must exist even though no scene is rendered here.
vi.mock("pixi.js", () => ({
  Filter: class {},
  Container: class {
    addChild = vi.fn();
    removeChild = vi.fn();
    children: unknown[] = [];
  },
  Graphics: class {},
  Text: class {},
  BlurFilter: class {},
  Application: class {},
}));

const HERE = dirname(fileURLToPath(import.meta.url));

function buildEngine(): {
  engine: GameEngine;
  save: MockSaveService;
  galaxy: GalaxyService;
  players: PlayerService;
} {
  const save = new MockSaveService();
  const galaxy = new GalaxyService();
  const players = new PlayerService();
  const diDeps: GameEngineDIDependencies = {
    saveService: save,
    galaxyService: galaxy,
    playerService: players,
    questService: new QuestManagerAdapter(),
    onnxService: new MockOnnxService(),
    exceptionHandler: new MockExceptionHandler(),
    qualityProfile: new AdaptiveQualityProfile(),
  };
  return { engine: new GameEngine(diDeps), save, galaxy, players };
}

/** Serialize the engine's current state to the on-disk save payload object. */
async function freeze(
  engine: GameEngine,
  save: MockSaveService,
  filename: string,
): Promise<void> {
  await engine.saveGame("golden");
  const state = (await save.read("golden"))!;
  const payload = JSON.parse(state.serialize().payload);
  // MockSaveService has no `currentVersion`, so the engine stamps `undefined`;
  // a real save carries CURRENT_VERSION. Freeze the fixture at the current
  // version (these are "made by today's engine" saves).
  payload.version = MigrationPipeline.CURRENT_VERSION;
  writeFileSync(join(HERE, filename), JSON.stringify(payload, null, 2) + "\n");
}

describe.skipIf(!process.env.GEN_GOLDEN)(
  "generate golden saves (GEN_GOLDEN=1)",
  () => {
    it("early-current.json — fresh corvette, current version", async () => {
      const { engine, save, galaxy, players } = buildEngine();
      engine.galaxy = await galaxy.generate("GOLDEN_EARLY", 6);
      engine.player = players.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });
      engine.player.currentSystemId = engine.galaxy.systems[0].id;
      engine.currentSceneType = SceneType.SPACE_FLIGHT;
      const lo = new ShipLoadout("hull_corvette");
      lo.install("eq_engine_i");
      lo.install("eq_tank");
      lo.install("wpn_pulse");
      lo.install("grav_tractor_1");
      engine.playerLoadout = lo;
      setupPlayerBanking(engine.bankBus, engine.bankingService, engine.player);

      await freeze(engine, save, "early-current.json");
    });

    it("late-banking-current.json — high-credit late progress with savings", async () => {
      const { engine, save, galaxy, players } = buildEngine();
      engine.galaxy = await galaxy.generate("GOLDEN_LATE", 8);
      engine.player = players.createPlayer({
        factionType: FactionType.BASTIONS,
      });
      engine.player.currentSystemId = engine.galaxy.systems[2].id;
      engine.currentSceneType = SceneType.SPACE_FLIGHT;

      // A frigate kitted out the way a progressed player would have it.
      const lo = new ShipLoadout("hull_warden");
      lo.install("eq_engine_iii");
      lo.install("eq_tank");
      lo.install("wpn_beam");
      lo.install("wpn_railgun");
      engine.playerLoadout = lo;

      setupPlayerBanking(engine.bankBus, engine.bankingService, engine.player);
      // A late-game pile of credits, booked through the ledger so the persisted
      // banking snapshot and the `credits` projection agree (they must, or the
      // re-derived balance on load would not match the frozen credits).
      adjustPlayerCredits(
        engine.bank,
        engine.player,
        5_000_000,
        GL_COUNTERPARTY.REWARDS,
        "Накопленные трофеи",
      );
      // Stash a chunk in savings — exercises a non-trivial ledger snapshot.
      openSavings(engine.bankBus, engine.bankingService, engine.player.id);
      deposit(
        engine.bankBus,
        engine.player.currentAccountId,
        savingsAccountId(engine.player.id),
        1_000_000,
        "Депозит",
      );

      // Late-progress markers (these are not tied to the ledger).
      engine.player.experience = 50_000;
      engine.player.level = 18;
      engine.player.adjustReputation(FactionType.BASTIONS, 60);
      engine.player.adjustReputation(FactionType.OUTLANDERS, 25);
      engine.player.adjustReputation(FactionType.SYNDICATE, -40);
      for (const sys of engine.galaxy.systems) {
        engine.player.markVisited(sys.id);
      }

      await freeze(engine, save, "late-banking-current.json");
    });
  },
);
