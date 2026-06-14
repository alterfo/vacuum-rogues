import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import {
  StarType,
  NpcState,
  NpcRole,
  FactionType,
  EconomyType,
  QuestType,
} from "@/types";
import { Faction } from "@/types/faction";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { NpcShip } from "@/domain/NpcShip";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import type { QuestTemplate } from "@/systems/QuestManager";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { Quest } from "@/domain/Quest";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
  MockQuestService,
  MockEquipmentService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

vi.mock("pixi.js", () => ({
  Filter: class {},
  Rectangle: class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  },
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  BlurFilter: vi.fn(),
}));

const TARGET_SYSTEM_ID = "sys_target";
const ISSUER_SYSTEM_ID = "sys_issuer";
const TARGET_SHIP_NAME = "Стальной ворон";

function makePirate(id: string, systemId: string, state: NpcState): NpcShip {
  return new NpcShip({
    id,
    name: `pirate_${id}`,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.PIRATE,
    hullHP: 100,
    maxHull: 100,
    shields: 50,
    speed: 0.1,
    damage: 20,
    currentSystemId: systemId,
    state,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeGalaxy(npcShips: NpcShip[]): Galaxy {
  const issuer = new StarSystem(
    ISSUER_SYSTEM_ID,
    "Issuer",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
    [],
    EconomyType.MIXED,
  );
  const target = new StarSystem(
    TARGET_SYSTEM_ID,
    "Target",
    { q: 5, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
    [],
    EconomyType.MIXED,
  );
  issuer.connections.push(new WarpPath(ISSUER_SYSTEM_ID, TARGET_SYSTEM_ID, 5));
  target.connections.push(new WarpPath(TARGET_SYSTEM_ID, ISSUER_SYSTEM_ID, 5));
  return new Galaxy(
    "galaxy_test",
    [issuer, target],
    new Overmind(),
    [],
    npcShips,
  );
}

function makeBountyQuest(): GeneratedQuest {
  const template: QuestTemplate = {
    id: "bounty_test",
    title: "Уничтожить пирата",
    description: "test",
    type: QuestType.BOUNTY,
    objectives: [
      {
        id: "obj1",
        description: "Destroy the ship",
        type: "DEFEAT_ENEMY",
        targetAmount: 1,
      },
    ],
    reward: { credits: 1000, experience: 100, items: [] },
    dialogueAnchors: [],
    deadline: 0,
    failurePenalty: null,
    targetSystemId: TARGET_SYSTEM_ID,
    targetObjectId: null,
  };
  return {
    template,
    targetSystemId: TARGET_SYSTEM_ID,
    targetPlanetId: null,
    jumps: 1,
    issuerName: "Шериф",
    issuerTitle: "Шериф",
    targetNpcName: TARGET_SHIP_NAME,
    highlights: [],
    issuerPlanetId: "planet_issuer",
  };
}

function makeEngine(): { engine: GameEngine; questService: MockQuestService } {
  const questService = new MockQuestService();
  const diDeps: GameEngineDIDependencies = {
    saveService: new MockSaveService(),
    galaxyService: new MockGalaxyService(),
    playerService: new MockPlayerService(),
    onnxService: new MockOnnxService(),
    exceptionHandler: new MockExceptionHandler(),
    qualityProfile: new AdaptiveQualityProfile(),
    questService,
    equipmentService: new MockEquipmentService(),
  };
  return { engine: new GameEngine(diDeps), questService };
}

describe("acceptBoardQuest — BOUNTY real NPC assignment", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renames a live pirate in the target system and links it via targetObjectId", () => {
    const { engine, questService } = makeEngine();
    const pirate = makePirate("npc_pirate_1", TARGET_SYSTEM_ID, NpcState.IDLE);
    engine.galaxy = makeGalaxy([pirate]);

    const spy = vi.spyOn(questService, "acceptQuestFromTemplate");
    engine.acceptBoardQuest(makeBountyQuest(), "planet_issuer");

    expect(pirate.name).toBe(TARGET_SHIP_NAME);
    const passedTemplate = spy.mock.calls[0][0];
    expect(passedTemplate.targetObjectId).toBe("npc_pirate_1");
  });

  it("leaves targetObjectId null when no live pirate is in the target system", () => {
    const { engine, questService } = makeEngine();
    // Pirate in the wrong system + a dead pirate in the target system → no match.
    const wrongSystem = makePirate(
      "npc_pirate_elsewhere",
      ISSUER_SYSTEM_ID,
      NpcState.IDLE,
    );
    const deadInTarget = makePirate(
      "npc_pirate_dead",
      TARGET_SYSTEM_ID,
      NpcState.DEAD,
    );
    engine.galaxy = makeGalaxy([wrongSystem, deadInTarget]);

    const spy = vi.spyOn(questService, "acceptQuestFromTemplate");
    engine.acceptBoardQuest(makeBountyQuest(), "planet_issuer");

    expect(wrongSystem.name).toBe("pirate_npc_pirate_elsewhere");
    expect(deadInTarget.name).toBe("pirate_npc_pirate_dead");
    const passedTemplate = spy.mock.calls[0][0];
    expect(passedTemplate.targetObjectId).toBeNull();
  });

  it("skips a pirate already bound to another active bounty and binds a free one", () => {
    const { engine, questService } = makeEngine();
    const alreadyBound = makePirate(
      "npc_bound",
      TARGET_SYSTEM_ID,
      NpcState.IDLE,
    );
    const free = makePirate("npc_free", TARGET_SYSTEM_ID, NpcState.IDLE);
    engine.galaxy = makeGalaxy([alreadyBound, free]);
    // An existing active bounty already targets npc_bound.
    questService.activeQuests = [
      { targetObjectId: "npc_bound" } as unknown as Quest,
    ];

    const spy = vi.spyOn(questService, "acceptQuestFromTemplate");
    engine.acceptBoardQuest(makeBountyQuest(), "planet_issuer");

    // The free pirate is renamed; the already-bound one keeps its name so the
    // first quest's named target is not clobbered and one kill can't satisfy both.
    expect(free.name).toBe(TARGET_SHIP_NAME);
    expect(alreadyBound.name).toBe("pirate_npc_bound");
    const passedTemplate = spy.mock.calls[0][0];
    expect(passedTemplate.targetObjectId).toBe("npc_free");
  });

  it("does not bind or rename a pirate for non-BOUNTY quests", () => {
    const { engine, questService } = makeEngine();
    const pirate = makePirate("npc_pirate_1", TARGET_SYSTEM_ID, NpcState.IDLE);
    engine.galaxy = makeGalaxy([pirate]);

    const base = makeBountyQuest();
    const quest: GeneratedQuest = {
      ...base,
      template: { ...base.template, type: QuestType.DELIVERY },
    };

    const spy = vi.spyOn(questService, "acceptQuestFromTemplate");
    engine.acceptBoardQuest(quest, "planet_issuer");

    expect(pirate.name).toBe("pirate_npc_pirate_1");
    const passedTemplate = spy.mock.calls[0][0];
    expect(passedTemplate.targetObjectId).toBeNull();
  });

  it("does not bind a pirate when the quest has no target ship name", () => {
    const { engine, questService } = makeEngine();
    const pirate = makePirate("npc_pirate_1", TARGET_SYSTEM_ID, NpcState.IDLE);
    engine.galaxy = makeGalaxy([pirate]);

    const quest: GeneratedQuest = { ...makeBountyQuest(), targetNpcName: null };

    const spy = vi.spyOn(questService, "acceptQuestFromTemplate");
    engine.acceptBoardQuest(quest, "planet_issuer");

    expect(pirate.name).toBe("pirate_npc_pirate_1");
    const passedTemplate = spy.mock.calls[0][0];
    expect(passedTemplate.targetObjectId).toBeNull();
  });

  it("invalidates the same-day Info Center cache so the renamed ship is findable", () => {
    const { engine } = makeEngine();
    const pirate = makePirate("npc_pirate_1", TARGET_SYSTEM_ID, NpcState.IDLE);
    engine.galaxy = makeGalaxy([pirate]);

    // Player browses the Info Center first, populating the per-day cache with
    // the pirate's pre-rename name.
    const before = engine
      .getInfoRegistry()!
      .findShips({ name: TARGET_SHIP_NAME, originSystemId: ISSUER_SYSTEM_ID });
    expect(before).toHaveLength(0);

    // Accepting the bounty renames the pirate the same game-day (no day-tick).
    engine.acceptBoardQuest(makeBountyQuest(), "planet_issuer");
    expect(pirate.name).toBe(TARGET_SHIP_NAME);

    // Re-querying the Info Center the same day must surface the renamed ship —
    // the cache has to be rebuilt rather than serving the stale snapshot.
    const after = engine
      .getInfoRegistry()!
      .findShips({ name: TARGET_SHIP_NAME, originSystemId: ISSUER_SYSTEM_ID });
    expect(after.map((s) => s.id)).toContain("npc_pirate_1");
  });
});
