import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuestManager } from "@/systems/QuestManager";
import type { QuestTemplate } from "@/systems/QuestManager";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { QuestType, ResourceType } from "@/types";
import { QuestSchema } from "@/validation/schemas";
import { QuestManagerAdapter } from "@/core/adapters";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
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

/**
 * Task 2: the accepted Quest must carry the concrete target planet (the «Местный
 * подряд» neighbour) so completion (Task 3) can require landing there. The field
 * is optional + nullable, so a quest/save made before it existed validates and
 * defaults to null (system-level completion preserved — no save-version bump).
 */

const NEIGHBOUR_ID = "ISO_p3";
const ISSUER_PLANET_ID = "ISO_p1";

function localDeliveryTemplate(targetPlanetId: string | null): QuestTemplate {
  return {
    id: "local_test",
    title: "Местный подряд",
    description: "test",
    type: QuestType.DELIVERY,
    objectives: [
      {
        id: "local_test_collect",
        description: "Загрузить груз",
        type: "COLLECT_ITEM",
        targetAmount: 5,
        itemType: ResourceType.METALS,
      },
    ],
    reward: { credits: 500, experience: 60, items: [] },
    dialogueAnchors: [],
    deadline: 0,
    failurePenalty: null,
    targetSystemId: "ISO",
    targetPlanetId,
  };
}

function localDeliveryGenerated(targetPlanetId: string | null): GeneratedQuest {
  // The GeneratedQuest carries targetPlanetId at the top level (QuestGenerator
  // sets it); the template does NOT — GameEngine.acceptBoardQuest threads it on.
  const template = localDeliveryTemplate(null);
  return {
    template,
    targetSystemId: "ISO",
    targetPlanetId,
    jumps: 0,
    issuerName: "Маклай",
    issuerTitle: "Снабженец",
    targetNpcName: null,
    highlights: [],
    issuerPlanetId: ISSUER_PLANET_ID,
  };
}

function makeEngine(): GameEngine {
  const diDeps: GameEngineDIDependencies = {
    saveService: new MockSaveService(),
    galaxyService: new MockGalaxyService(),
    playerService: new MockPlayerService(),
    onnxService: new MockOnnxService(),
    exceptionHandler: new MockExceptionHandler(),
    qualityProfile: new AdaptiveQualityProfile(),
    questService: new QuestManagerAdapter(),
  };
  return new GameEngine(diDeps);
}

describe("Quest carries targetPlanetId (Task 2)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("QuestManager.acceptQuestFromTemplate copies template.targetPlanetId onto the Quest", () => {
    const qm = new QuestManager();
    const quest = qm.acceptQuestFromTemplate(
      localDeliveryTemplate(NEIGHBOUR_ID),
      ISSUER_PLANET_ID,
      0,
    );
    expect(quest?.targetPlanetId).toBe(NEIGHBOUR_ID);
  });

  it("a template without targetPlanetId yields a null target planet (legacy back-compat)", () => {
    const qm = new QuestManager();
    const quest = qm.acceptQuestFromTemplate(
      localDeliveryTemplate(null),
      ISSUER_PLANET_ID,
      0,
    );
    expect(quest?.targetPlanetId).toBeNull();
  });

  it("GameEngine.acceptBoardQuest threads the generated targetPlanetId onto the accepted Quest", () => {
    const engine = makeEngine();
    const accepted = engine.acceptBoardQuest(
      localDeliveryGenerated(NEIGHBOUR_ID),
      ISSUER_PLANET_ID,
    );
    // The accepted Quest names the neighbour, even though its source template did
    // not carry it — acceptBoardQuest copies it from the GeneratedQuest.
    expect(accepted?.targetPlanetId).toBe(NEIGHBOUR_ID);
  });

  it("GameEngine.acceptBoardQuest leaves targetPlanetId null when the generated quest has none", () => {
    const engine = makeEngine();
    const accepted = engine.acceptBoardQuest(
      localDeliveryGenerated(null),
      ISSUER_PLANET_ID,
    );
    expect(accepted?.targetPlanetId).toBeNull();
  });

  it("QuestSchema validates a quest without targetPlanetId and defaults it to null", () => {
    const legacyQuest = {
      id: "local_test",
      title: "Местный подряд",
      type: "DELIVERY",
      objectives: [],
      isCompleted: false,
      isFailed: false,
      planetId: ISSUER_PLANET_ID,
      issuedDay: 0,
      deadline: 0,
      failurePenalty: null,
      // no targetPlanetId — a save made before the field existed
    };
    const parsed = QuestSchema.parse(legacyQuest);
    expect(parsed.targetPlanetId).toBeNull();
  });

  it("QuestSchema preserves a provided targetPlanetId", () => {
    const parsed = QuestSchema.parse({
      id: "local_test",
      title: "Местный подряд",
      type: "DELIVERY",
      objectives: [],
      isCompleted: false,
      isFailed: false,
      planetId: ISSUER_PLANET_ID,
      issuedDay: 0,
      deadline: 0,
      failurePenalty: null,
      targetPlanetId: NEIGHBOUR_ID,
    });
    expect(parsed.targetPlanetId).toBe(NEIGHBOUR_ID);
  });
});
