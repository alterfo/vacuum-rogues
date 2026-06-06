/**
 * Deterministic quest generator (EPIC-008, US-081/US-082/US-083).
 *
 * Builds a planet's "job board" of quests from a stable seed (galaxy seed +
 * planet + a time bucket), so the same board is reproduced on reload and only
 * refreshes as days pass. Most quests deliberately target *other* systems to
 * draw the player across the galaxy; reward and deadline scale with the number
 * of hyperjumps to the target. Roughly one quest in five is a branching
 * text-quest (EPIC-005) — the rare "cherry on top".
 *
 * Pure logic: no PixiJS / DOM / ONNX. Fully deterministic and unit-testable.
 * The produced {@link QuestTemplate} plugs straight into {@link QuestManager}.
 */
import type { StarSystem } from "@/domain/StarSystem";
import type { QuestTemplate } from "@/systems/QuestManager";
import { QuestType, ResourceType, EnemyType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { jumpDistances } from "@/systems/galaxy/jumpDistance";

/** Share of issued quests that are branching text-quests (the "cherry"). */
export const QUEST_TEXT_RATIO = 0.2;

/** How many days a single board stays fixed before it refreshes. */
export const BOARD_REFRESH_DAYS = 5;

/** A generated quest plus the galaxy-reach metadata used by the UI/registry. */
export interface GeneratedQuest {
  readonly template: QuestTemplate;
  /** System the quest sends the player to (may equal the origin for text-quests). */
  readonly targetSystemId: string;
  /** A concrete target planet in that system, when the objective needs one. */
  readonly targetPlanetId: string | null;
  /** Hyperjumps from the issuing system to the target (0 = local). */
  readonly jumps: number;
}

export interface BoardOptions {
  readonly systems: StarSystem[];
  readonly originSystemId: string;
  readonly planetId: string;
  readonly day: number;
  /** Galaxy seed (stable for the save) — mixes into the board seed. */
  readonly seed: string;
  readonly count?: number; // default 5
  readonly refreshEveryDays?: number; // default BOARD_REFRESH_DAYS
  readonly textRatio?: number; // default QUEST_TEXT_RATIO
}

/** The routine (non-text) quest types, in pick order. */
const ROUTINE_TYPES: QuestType[] = [
  QuestType.DELIVERY,
  QuestType.BOUNTY,
  QuestType.ESCORT,
  QuestType.DIPLOMACY,
  QuestType.EXPLORATION,
];

/**
 * Generate the job board for a planet. Deterministic in
 * `(seed, planetId, day-bucket)`: identical inputs yield identical boards.
 */
export function generateQuestBoard(opts: BoardOptions): GeneratedQuest[] {
  const {
    systems,
    originSystemId,
    planetId,
    day,
    seed,
    count = 5,
    refreshEveryDays = BOARD_REFRESH_DAYS,
    textRatio = QUEST_TEXT_RATIO,
  } = opts;

  const bucket = Math.floor(day / Math.max(1, refreshEveryDays));
  const boardSeed = `${seed}|board|${planetId}|${bucket}`;

  // Hyperjump distance from the origin to every reachable system.
  const jumpDist = jumpDistances(systems, originSystemId);
  // Systems we can actually send the player to (anything but the origin).
  const reachable = systems
    .filter((s) => s.id !== originSystemId && jumpDist.has(s.id))
    .sort((a, b) => a.id.localeCompare(b.id)); // stable order for determinism
  const origin = systems.find((s) => s.id === originSystemId) ?? null;

  const out: GeneratedQuest[] = [];
  for (let i = 0; i < count; i++) {
    const rng = new SeededRNG(`${boardSeed}|${i}`);
    const isText = rng.next() < textRatio;

    if (isText || reachable.length === 0) {
      // Text-quests are read on the spot; with no reachable system, routine
      // quests fall back to local too.
      out.push(
        isText
          ? buildTextQuest(rng, planetId, bucket, i, day, origin)
          : buildLocalDelivery(rng, planetId, bucket, i, day, origin),
      );
      continue;
    }

    const type = ROUTINE_TYPES[rng.nextInt(0, ROUTINE_TYPES.length - 1)];
    const target = reachable[rng.nextInt(0, reachable.length - 1)];
    const jumps = jumpDist.get(target.id) ?? 1;
    out.push(
      buildRoutineQuest(rng, type, target, jumps, planetId, bucket, i, day),
    );
  }
  return out;
}

/** Prefer a habitable planet in a system as a concrete target, else any, else null. */
function pickTargetPlanet(system: StarSystem | null): string | null {
  if (!system || system.planets.length === 0) return null;
  const habitable = system.planets.find((p) => p.isHabitable);
  return (habitable ?? system.planets[0]).id;
}

/** Stable quest id for a board slot. */
function slotId(planetId: string, bucket: number, i: number): string {
  return `gen_${planetId}_${bucket}_${i}`;
}

/**
 * Reward + deadline scale with distance (jumps) and a per-type risk multiplier,
 * so far, dangerous jobs pay more and pressure the player to commit (US-083).
 */
function economics(
  type: QuestType,
  jumps: number,
  rng: SeededRNG,
): { credits: number; experience: number; deadline: number } {
  const risk: Record<string, number> = {
    [QuestType.DELIVERY]: 1.0,
    [QuestType.ESCORT]: 1.3,
    [QuestType.DIPLOMACY]: 1.2,
    [QuestType.EXPLORATION]: 1.1,
    [QuestType.BOUNTY]: 1.6,
    [QuestType.TEXT_ADVENTURE]: 1.4,
  };
  const m = risk[type] ?? 1;
  const base = 120;
  const perJump = 70;
  const credits = Math.round(
    (base + jumps * perJump) * m * rng.nextFloat(0.9, 1.2),
  );
  const experience = Math.round(credits * 0.4);
  // A generous travel budget: ~2 days per jump + a buffer, longer for relaxed types.
  const daysPerJump = 2;
  const buffer = rng.nextInt(2, 4);
  const deadline = jumps > 0 ? jumps * daysPerJump + buffer : 0;
  return { credits, experience, deadline };
}

function penaltyFor(
  type: QuestType,
  credits: number,
): QuestTemplate["failurePenalty"] {
  if (type === QuestType.EXPLORATION) {
    return {
      reputationLoss: 10,
      description: "Данные устарели — заказчик недоволен.",
    };
  }
  if (type === QuestType.BOUNTY) {
    return {
      reputationLoss: 20,
      creditsFine: Math.round(credits * 0.25),
      description: "Цель ускользнула и продолжила грабежи.",
    };
  }
  return {
    reputationLoss: 15,
    description: "Срок вышел — репутация пострадала.",
  };
}

function buildRoutineQuest(
  rng: SeededRNG,
  type: QuestType,
  target: StarSystem,
  jumps: number,
  planetId: string,
  bucket: number,
  i: number,
  _day: number,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const targetPlanetId = pickTargetPlanet(target);
  const where = `${target.name} (${jumps} прыж.)`;
  const { credits, experience, deadline } = economics(type, jumps, rng);
  const reward = {
    credits,
    experience,
    items: [] as { type: ResourceType; amount: number }[],
  };
  const failurePenalty = penaltyFor(type, credits);

  let title: string;
  let description: string;
  let objectives: QuestTemplate["objectives"];

  switch (type) {
    case QuestType.DELIVERY: {
      const cargo = pickCargo(rng);
      const qty = rng.nextInt(5, 15);
      title = `Доставка: ${where}`;
      description = `Отвезите груз (${cargo.label}) в систему ${target.name}.`;
      objectives = [
        {
          id: `${id}_collect`,
          description: `Загрузить ${cargo.label}`,
          type: "COLLECT_ITEM",
          targetAmount: qty,
          itemType: cargo.resource,
        },
        {
          id: `${id}_deliver`,
          description: `Доставить в ${target.name}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: targetPlanetId ?? target.id,
        },
      ];
      break;
    }
    case QuestType.BOUNTY: {
      title = `Охота: ${where}`;
      description = `Перехватите и уничтожьте цель в системе ${target.name}.`;
      objectives = [
        {
          id: `${id}_kill`,
          description: `Уничтожить цель в ${target.name}`,
          type: "DEFEAT_ENEMY",
          targetAmount: 1,
          enemyType: bountyEnemy(rng),
        },
      ];
      break;
    }
    case QuestType.ESCORT: {
      title = `Эскорт: ${where}`;
      description = `Сопроводите конвой до системы ${target.name}.`;
      objectives = [
        {
          id: `${id}_escort`,
          description: `Довести конвой до ${target.name}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: targetPlanetId ?? target.id,
        },
      ];
      break;
    }
    case QuestType.DIPLOMACY: {
      title = `Дипломатия: ${where}`;
      description = `Доставьте предложение фракции в систему ${target.name}.`;
      objectives = [
        {
          id: `${id}_envoy`,
          description: `Передать предложение в ${target.name}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: targetPlanetId ?? target.id,
        },
      ];
      break;
    }
    case QuestType.EXPLORATION:
    default: {
      title = `Разведка: ${where}`;
      description = `Достигните и просканируйте систему ${target.name}.`;
      objectives = [
        {
          id: `${id}_scan`,
          description: `Просканировать ${target.name}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: targetPlanetId ?? target.id,
        },
      ];
      break;
    }
  }

  return {
    template: {
      id,
      title,
      description,
      type,
      objectives,
      reward,
      dialogueAnchors: [],
      deadline,
      failurePenalty,
      targetSystemId: target.id,
      targetObjectId: null,
    },
    targetSystemId: target.id,
    targetPlanetId,
    jumps,
  };
}

/** A relaxed, local delivery used when nothing reachable exists. */
function buildLocalDelivery(
  rng: SeededRNG,
  planetId: string,
  bucket: number,
  i: number,
  _day: number,
  origin: StarSystem | null,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const cargo = pickCargo(rng);
  const targetPlanetId = pickTargetPlanet(origin);
  return {
    template: {
      id,
      title: "Местный подряд",
      description: `Местная доставка (${cargo.label}) в пределах системы.`,
      type: QuestType.DELIVERY,
      objectives: [
        {
          id: `${id}_collect`,
          description: `Загрузить ${cargo.label}`,
          type: "COLLECT_ITEM",
          targetAmount: rng.nextInt(4, 10),
          itemType: cargo.resource,
        },
      ],
      reward: { credits: rng.nextInt(120, 220), experience: 60, items: [] },
      dialogueAnchors: [],
      deadline: 0,
      failurePenalty: null,
    },
    targetSystemId: origin?.id ?? planetId,
    targetPlanetId,
    jumps: 0,
  };
}

/** A branching text-quest stub (its graph/scene come from EPIC-005). */
function buildTextQuest(
  rng: SeededRNG,
  planetId: string,
  bucket: number,
  i: number,
  _day: number,
  origin: StarSystem | null,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const { credits, experience } = economics(QuestType.TEXT_ADVENTURE, 0, rng);
  const hooks = [
    "Странный сигнал с дрейфующего корабля",
    "Таможенник просит об услуге",
    "Спор колонистов, который нужно рассудить",
    "Подозрительное предложение в баре",
  ];
  const hook = hooks[rng.nextInt(0, hooks.length - 1)];
  return {
    template: {
      id,
      title: `История: ${hook}`,
      description: `${hook}. Ветвящийся текст-квест — исход зависит от ваших решений.`,
      type: QuestType.TEXT_ADVENTURE,
      objectives: [
        {
          id: `${id}_resolve`,
          description: "Разрешить ситуацию",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: planetId,
        },
      ],
      reward: { credits, experience, items: [] },
      dialogueAnchors: [],
      deadline: 0,
      failurePenalty: null,
    },
    targetSystemId: origin?.id ?? planetId,
    targetPlanetId: planetId,
    jumps: 0,
  };
}

function pickCargo(rng: SeededRNG): { label: string; resource: ResourceType } {
  const options: { label: string; resource: ResourceType }[] = [
    { label: "медикаменты", resource: ResourceType.MEDICINE },
    { label: "минералы", resource: ResourceType.METALS },
    { label: "кристаллы", resource: ResourceType.CRYSTALS },
    { label: "органику", resource: ResourceType.ORGANICS },
    { label: "предметы роскоши", resource: ResourceType.LUXURY },
  ];
  return options[rng.nextInt(0, options.length - 1)];
}

function bountyEnemy(rng: SeededRNG): EnemyType {
  const pool = [EnemyType.SCOUT, EnemyType.FIGHTER, EnemyType.CRUISER];
  return pool[rng.nextInt(0, pool.length - 1)];
}
