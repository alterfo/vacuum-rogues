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
import { ELITE_QUEST_MIN_RANK } from "@/config/balance";
import { ALL_QUEST_SCRIPTS } from "@/systems/quests/TextQuestRegistry";

/** Share of issued quests that are branching text-quests (the "cherry"). */
export const QUEST_TEXT_RATIO = 0.2;

/** Share of routine quests that are "elite" (require minReputation=50, ×2 reward). */
export const QUEST_ELITE_RATIO = 0.2;

/** Share of routine quests that belong to a quest chain (3 parts + finale). */
export const QUEST_CHAIN_RATIO = 0.15;

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
  /** Fraction of routine quests marked elite (minReputation=50, ×2 reward). Default QUEST_ELITE_RATIO. */
  readonly eliteRatio?: number;
  /** Fraction of routine quests that are part of a quest chain. Default QUEST_CHAIN_RATIO. */
  readonly chainRatio?: number;
  /** Chain IDs already fully completed by the player; those chains show a finale quest instead. */
  readonly completedQuestChains?: readonly string[];
  /** OVERMIND-controlled system IDs; used to build DEFENSE quest targets. */
  readonly overmindSystems?: readonly string[];
  /** System IDs adjacent to OVERMIND-controlled systems (non-OVERMIND). Triggers 1 DEFENSE quest when non-empty. */
  readonly overmindAdjacentSystems?: readonly string[];
  /**
   * When set, the planet is on a faction home system. Quest titles will include
   * a faction-specific prefix to give them a distinctive flavour.
   */
  readonly homeFactionId?: string | null;
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
/** Faction-themed quest title prefix for home system boards. */
const FACTION_HOME_PREFIX: Record<string, string> = {
  OUTLANDERS: "[ОКРАИНА]",
  BASTIONS: "[БАСТИОН]",
  SYNDICATE: "[СИНДИКАТ]",
  PARADOXES: "[ПАРАДОКС]",
  PROGRESSORS: "[ПРОГРЕССОРЫ]",
};

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
    eliteRatio = QUEST_ELITE_RATIO,
    chainRatio = QUEST_CHAIN_RATIO,
    completedQuestChains = [],
    overmindSystems = [],
    overmindAdjacentSystems = [],
    homeFactionId = null,
  } = opts;

  const factionPrefix = homeFactionId
    ? (FACTION_HOME_PREFIX[homeFactionId] ?? null)
    : null;

  const bucket = Math.floor(day / Math.max(1, refreshEveryDays));
  const boardSeed = `${seed}|board|${planetId}|${bucket}`;

  // Hyperjump distance from the origin to every reachable system.
  const jumpDist = jumpDistances(systems, originSystemId);
  // Systems we can actually send the player to (anything but the origin).
  const reachable = systems
    .filter((s) => s.id !== originSystemId && jumpDist.has(s.id))
    .sort((a, b) => a.id.localeCompare(b.id)); // stable order for determinism
  const origin = systems.find((s) => s.id === originSystemId) ?? null;

  // Chain ID is deterministic per planet+bucket so the same chain appears on refresh.
  const chainId = `chain-${planetId}-${bucket}`;
  // Track how many chain parts have been added to this board.
  let chainPartsOnBoard = 0;

  /** Apply faction home prefix to a quest's title when the board is a home system board. */
  const applyPrefix = (quest: GeneratedQuest): GeneratedQuest => {
    if (!factionPrefix) return quest;
    return {
      ...quest,
      template: {
        ...quest.template,
        title: `${factionPrefix} ${quest.template.title}`,
      },
    };
  };

  const out: GeneratedQuest[] = [];
  for (let i = 0; i < count; i++) {
    const rng = new SeededRNG(`${boardSeed}|${i}`);
    const isText = rng.next() < textRatio;

    if (isText || reachable.length === 0) {
      out.push(
        applyPrefix(
          isText
            ? buildTextQuest(rng, planetId, bucket, i, day, origin)
            : buildLocalDelivery(rng, planetId, bucket, i, day, origin),
        ),
      );
      continue;
    }

    const type = ROUTINE_TYPES[rng.nextInt(0, ROUTINE_TYPES.length - 1)];
    const target = reachable[rng.nextInt(0, reachable.length - 1)];
    const jumps = jumpDist.get(target.id) ?? 1;

    // Determine quest tier: chain → elite → normal
    const isChain = rng.next() < chainRatio && chainPartsOnBoard < 3;
    if (isChain) {
      if (completedQuestChains.includes(chainId) && chainPartsOnBoard === 0) {
        // Chain is complete: show the finale quest once per board.
        out.push(
          applyPrefix(
            buildFinaleQuest(
              rng,
              chainId,
              target,
              jumps,
              planetId,
              bucket,
              i,
              day,
            ),
          ),
        );
        // Increment so subsequent isChain rolls fall through to the else branch
        // (routine quest) instead of adding a duplicate finale.
        chainPartsOnBoard++;
      } else if (!completedQuestChains.includes(chainId)) {
        out.push(
          applyPrefix(
            buildChainQuest(
              rng,
              type,
              target,
              jumps,
              planetId,
              bucket,
              i,
              day,
              chainId,
              chainPartsOnBoard,
            ),
          ),
        );
        chainPartsOnBoard++;
      } else {
        // Chain finale already on board: emit normal quest instead.
        out.push(
          applyPrefix(
            buildRoutineQuest(
              rng,
              type,
              target,
              jumps,
              planetId,
              bucket,
              i,
              day,
            ),
          ),
        );
      }
      continue;
    }

    const isElite = rng.next() < eliteRatio;
    out.push(
      applyPrefix(
        buildRoutineQuest(
          rng,
          type,
          target,
          jumps,
          planetId,
          bucket,
          i,
          day,
          isElite,
        ),
      ),
    );
  }
  // Inject 1 DEFENSE quest when OVERMIND has adjacent systems the player can contest.
  if (overmindAdjacentSystems.length > 0) {
    const defRng = new SeededRNG(`${boardSeed}|defense`);
    const targetAdjacentId =
      overmindAdjacentSystems[
        defRng.nextInt(0, overmindAdjacentSystems.length - 1)
      ];
    // The OVERMIND system adjacent to the target (to be removed on completion).
    // Find the first OVERMIND system that is connected to the target.
    const targetSys = systems.find((s) => s.id === targetAdjacentId) ?? null;
    const adjacentOvermindId =
      targetSys?.connections
        .map((c) => c.toSystemId)
        .find((id) => overmindSystems.includes(id)) ?? null;

    if (targetSys) {
      const jumps =
        jumpDistances(systems, originSystemId).get(targetAdjacentId) ?? 1;
      const { credits, experience, deadline } = economics(
        QuestType.DEFENSE,
        jumps,
        defRng,
      );
      const defId = `${slotId(planetId, Math.floor(day / Math.max(1, refreshEveryDays)), out.length)}_defense`;
      out.push({
        template: {
          id: defId,
          title: `Оборона: ${targetSys.name} (${jumps} прыж.)`,
          description: `OVERMIND угрожает системе ${targetSys.name}. Прилетите туда, чтобы остановить экспансию.`,
          type: QuestType.DEFENSE,
          objectives: [
            {
              id: `${defId}_arrive`,
              description: `Прибыть в систему ${targetSys.name}`,
              type: "VISIT_LOCATION",
              targetAmount: 1,
              locationId: targetSys.id,
            },
          ],
          reward: { credits, experience, items: [] },
          dialogueAnchors: [],
          deadline,
          failurePenalty: {
            reputationLoss: 15,
            description: "OVERMIND захватил систему — сопротивление сломлено.",
          },
          targetSystemId: targetAdjacentId,
          targetObjectId: adjacentOvermindId,
          minReputation: 0,
        },
        targetSystemId: targetAdjacentId,
        targetPlanetId: pickTargetPlanet(targetSys),
        jumps,
      });
    }
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
    [QuestType.DEFENSE]: 1.8,
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
  isElite = false,
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
      description = pickDeliveryDesc(rng, cargo.label, target.name, credits);
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
      description = pickBountyDesc(rng, target.name, credits);
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
      description = pickEscortDesc(rng, target.name, credits);
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
      description = pickDiplomacyDesc(rng, target.name, credits);
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
      description = pickExplorationDesc(rng, target.name, credits);
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

  // Elite quests: ×2 reward, minReputation=50, minRank=3, title prefix.
  const finalReward = isElite
    ? {
        ...reward,
        credits: reward.credits * 2,
        experience: reward.experience * 2,
      }
    : reward;
  const finalTitle = isElite ? `[ЭЛИТА] ${title}` : title;
  const minReputation = isElite ? 50 : 0;
  const minRank = isElite ? ELITE_QUEST_MIN_RANK : 0;

  return {
    template: {
      id,
      title: finalTitle,
      description,
      type,
      objectives,
      reward: finalReward,
      dialogueAnchors: [],
      deadline,
      failurePenalty,
      targetSystemId: target.id,
      targetObjectId: null,
      minReputation,
      minRank,
    },
    targetSystemId: target.id,
    targetPlanetId,
    jumps,
  };
}

/** A chain quest (one part of a 3-part chain + finale). */
function buildChainQuest(
  rng: SeededRNG,
  type: QuestType,
  target: StarSystem,
  jumps: number,
  planetId: string,
  bucket: number,
  i: number,
  _day: number,
  chainId: string,
  chainPart: number,
): GeneratedQuest {
  const id = `${slotId(planetId, bucket, i)}_chain${chainPart}`;
  const targetPlanetId = pickTargetPlanet(target);
  const where = `${target.name} (${jumps} прыж.)`;
  const { credits, experience, deadline } = economics(type, jumps, rng);
  const reward = {
    credits,
    experience,
    items: [] as { type: ResourceType; amount: number }[],
  };
  const failurePenalty = penaltyFor(type, credits);
  const cargo = pickCargo(rng);
  const partLabel = `Часть ${chainPart + 1}/3`;
  return {
    template: {
      id,
      title: `[ЦЕПОЧКА ${partLabel}] Цепь курьеров: ${where}`,
      description: `${partLabel}: перевезите груз (${cargo.label}) в систему ${target.name}. Выполните все 3 части для крупного вознаграждения.`,
      type: QuestType.DELIVERY,
      objectives: [
        {
          id: `${id}_collect`,
          description: `Загрузить ${cargo.label}`,
          type: "COLLECT_ITEM",
          targetAmount: rng.nextInt(5, 12),
          itemType: cargo.resource,
        },
        {
          id: `${id}_deliver`,
          description: `Доставить в ${target.name}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: targetPlanetId ?? target.id,
        },
      ],
      reward,
      dialogueAnchors: [],
      deadline,
      failurePenalty,
      targetSystemId: target.id,
      targetObjectId: null,
      minReputation: 0,
      chainId,
      chainPart,
    },
    targetSystemId: target.id,
    targetPlanetId,
    jumps,
  };
}

/** The chain finale quest, appearing after all 3 parts are done. */
function buildFinaleQuest(
  rng: SeededRNG,
  chainId: string,
  target: StarSystem,
  jumps: number,
  planetId: string,
  bucket: number,
  i: number,
  _day: number,
): GeneratedQuest {
  const id = `${slotId(planetId, bucket, i)}_finale`;
  const targetPlanetId = pickTargetPlanet(target);
  const where = `${target.name} (${jumps} прыж.)`;
  const { credits, experience, deadline } = economics(
    QuestType.DELIVERY,
    jumps,
    rng,
  );
  const cargo = pickCargo(rng);
  return {
    template: {
      id,
      title: `[ФИНАЛ] Завершение цепочки: ${where}`,
      description: `Последняя миссия цепочки! Доставьте особый груз (${cargo.label}) в систему ${target.name}. Награда утроена.`,
      type: QuestType.DELIVERY,
      objectives: [
        {
          id: `${id}_collect`,
          description: `Загрузить ${cargo.label}`,
          type: "COLLECT_ITEM",
          targetAmount: rng.nextInt(10, 20),
          itemType: cargo.resource,
        },
        {
          id: `${id}_deliver`,
          description: `Доставить в ${target.name}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: targetPlanetId ?? target.id,
        },
      ],
      reward: {
        credits: credits * 3,
        experience: experience * 3,
        items: [],
      },
      dialogueAnchors: [],
      deadline,
      failurePenalty: penaltyFor(QuestType.DELIVERY, credits * 3),
      targetSystemId: target.id,
      targetObjectId: null,
      minReputation: 0,
      chainId,
      chainPart: 3, // 3 = finale
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

/** A branching text-quest stub backed by a real QuestScript. */
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

  // Pick a script deterministically for this board slot.
  const script =
    ALL_QUEST_SCRIPTS[rng.nextInt(0, ALL_QUEST_SCRIPTS.length - 1)];

  return {
    template: {
      id,
      title: `Особое задание: ${script.title}`,
      description: `Уникальное задание «${script.title}». Исход зависит от ваших решений.`,
      type: QuestType.TEXT_ADVENTURE,
      objectives: [
        {
          id: `${id}_resolve`,
          description: "Завершить задание",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: planetId,
        },
      ],
      reward: { credits, experience, items: [] },
      dialogueAnchors: [],
      deadline: 0,
      failurePenalty: null,
      targetObjectId: script.id,
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

function pickDeliveryDesc(
  rng: SeededRNG,
  cargoLabel: string,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Контейнер с «${cargoLabel}» (не спрашивай) нужно доставить на ${targetName}. Владелец клянётся, что ничего не пищит. Оплата: ${reward} ₢.`,
    `Срочная поставка ${cargoLabel} в систему ${targetName} — там ждут уже третий день. Клиент нервничает, курьеры разбегаются. Может, ты справишься? Вознаграждение: ${reward} ₢.`,
    `${targetName} остро нуждается в ${cargoLabel}. Местные говорят «срочно», но это у них вечно. Губернатор готов заплатить ${reward} ₢ за своевременную доставку.`,
    `Доставь ${cargoLabel} в ${targetName} — без вопросов, без лишнего шума. Упаковка нестандартная, но таможня уже предупреждена. ${reward} ₢ по прибытии.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickBountyDesc(
  rng: SeededRNG,
  targetName: string,
  reward: number,
): string {
  const gangs = [
    "«Зубные Феи»",
    "«Ржавые Кулаки»",
    "«Корсары Туманности»",
    "«Весёлые Вдовы»",
  ];
  const gang = gangs[rng.nextInt(0, gangs.length - 1)];
  const templates = [
    `Пиратская шайка ${gang} обнаглела и обложила данью торговцев в районе ${targetName}. Губернатор просит навести порядок. Вознаграждение щедрое — чтобы перебить страх. Итого: ${reward} ₢.`,
    `Цель находится в системе ${targetName}. Предупреждаем: стреляет первым, переговоров не ведёт. Зато мёртвой стоит ${reward} ₢ — живой не нужна никому.`,
    `Группа ${gang} атаковала конвой близ ${targetName}. Пострадавшие требуют справедливости. Администрация требует результата. Ты требуешь ${reward} ₢ — кажется, все довольны.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickEscortDesc(
  rng: SeededRNG,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Торговый конвой идёт в ${targetName}, но маршрут небезопасный. Охрана сбежала ещё вчера. Тебе предлагают ${reward} ₢ и искреннюю благодарность — последнее бесплатно.`,
    `Дипломатическая делегация направляется в ${targetName} и очень боится. Требуется сопровождение. Стрелять первым нельзя, но отвечать — обязательно. Оплата: ${reward} ₢.`,
    `Груз и пассажиры следуют в ${targetName}. Клиент нанял тебя, потому что предыдущий эскорт «не смог». Подробности он старается не уточнять. ${reward} ₢ при доставке.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickDiplomacyDesc(
  rng: SeededRNG,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Фракционные переговоры зашли в тупик. Нужен нейтральный курьер, чтобы доставить предложение в ${targetName} — лично, в руки. Бюрократы боятся перехвата. Ты получишь ${reward} ₢ за дискретность.`,
    `В ${targetName} ждут ответа на торговое предложение. Ответ — конверт. Конверт — у тебя. Не вскрывать, не читать, не нюхать. ${reward} ₢ по прибытии.`,
    `Дипломатический кризис между ${targetName} и здешней администрацией разгорается. Твоя задача — привезти мирный документ раньше, чем кто-то успеет выстрелить. ${reward} ₢ за мир.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickExplorationDesc(
  rng: SeededRNG,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Система ${targetName} числится в картах, но последние данные оттуда — трёхлетней давности. Учёные хотят свежий скан. Риски минимальные, оплата — ${reward} ₢. Говорят, там красиво.`,
    `Аномалия зафиксирована в районе ${targetName}. Нужен разведчик, который слетает и вернётся живым. Предыдущих двух мы не упоминаем. Вознаграждение: ${reward} ₢.`,
    `${targetName} не отвечает на стандартные сигналы. Скорее всего, сбой ретранслятора. Скорее всего. Слетай, проверь, привези данные. ${reward} ₢ — и никаких лишних вопросов.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}
