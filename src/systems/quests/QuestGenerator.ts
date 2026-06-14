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
  /** In-character name of whoever posted the job (e.g. "Маклай"). */
  readonly issuerName: string;
  /** Title that fits the job (e.g. "Губернатор", "Снабженец", "Шериф"). */
  readonly issuerTitle: string;
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

/** First-name pool for quest issuers (deterministic per quest slot). */
const ISSUER_NAMES = [
  "Маклай",
  "Зорба",
  "Хендрикс",
  "Валенса",
  "Тао",
  "Брунн",
  "Сольвейг",
  "Кадар",
  "Орлофф",
  "Мерсье",
  "Янг",
  "Дусет",
  "Ферран",
  "Гримо",
  "Лазар",
  "Окич",
];

/** Per-type title pool, so the issuer's rank fits the job they post. */
const ISSUER_TITLES: Partial<Record<QuestType, string[]>> = {
  [QuestType.DELIVERY]: ["Снабженец", "Торговец", "Завхоз"],
  [QuestType.BOUNTY]: ["Шериф", "Командор", "Маршал"],
  [QuestType.ESCORT]: ["Караванщик", "Капитан конвоя", "Старшина"],
  [QuestType.DIPLOMACY]: ["Посол", "Советник", "Атташе"],
  [QuestType.EXPLORATION]: ["Профессор", "Картограф", "Координатор"],
  [QuestType.DEFENSE]: ["Командующий", "Адмирал"],
  [QuestType.TEXT_ADVENTURE]: ["Незнакомец", "Информатор"],
};

/**
 * Pick a deterministic in-character issuer (name + fitting title) for a quest.
 * Consumes two RNG draws; call it at a stable point in each builder so the
 * board stays reproducible.
 */
function pickIssuer(
  rng: SeededRNG,
  type: QuestType,
): { name: string; title: string } {
  const name = ISSUER_NAMES[rng.nextInt(0, ISSUER_NAMES.length - 1)];
  const titles = ISSUER_TITLES[type] ?? ["Губернатор"];
  const title = titles[rng.nextInt(0, titles.length - 1)];
  return { name, title };
}

/**
 * Frame a generated quest as a first-person dialogue line from its issuer, so
 * the governor screen can "offer" the job in character (Task 7). Falls back to
 * a plain "Губернатор" speaker when no issuer metadata is present.
 */
export function governorOfferLine(quest: GeneratedQuest): string {
  const speaker =
    quest.issuerName && quest.issuerTitle
      ? `${quest.issuerTitle} ${quest.issuerName}`
      : "Губернатор";
  return `${speaker}: «${quest.template.description}»`;
}

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
      const defIssuer = pickIssuer(defRng, QuestType.DEFENSE);
      const defId = `${slotId(planetId, Math.floor(day / Math.max(1, refreshEveryDays)), out.length)}_defense`;
      out.push({
        template: {
          id: defId,
          title: `Оборона: ${targetSys.name} (${jumps} прыж.)`,
          description: `${defIssuer.title} ${defIssuer.name} бьёт тревогу: OVERMIND угрожает системе ${targetSys.name}. Прилетите туда лично и остановите экспансию, пока ещё есть что оборонять.`,
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
        issuerName: defIssuer.name,
        issuerTitle: defIssuer.title,
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
  // Minimum 30 days for any jump quest; scales at 20 days/jump (≥45 for 2-hop).
  const buffer = rng.nextInt(5, 10);
  const deadline = jumps > 0 ? Math.max(30, jumps * 20 + buffer) : 0;
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
  const issuer = pickIssuer(rng, type);
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
      description = pickDeliveryDesc(
        rng,
        issuer.name,
        cargo.label,
        target.name,
        credits,
      );
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
      description = pickBountyDesc(rng, issuer.name, target.name, credits);
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
      description = pickEscortDesc(rng, issuer.name, target.name, credits);
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
      description = pickDiplomacyDesc(rng, issuer.name, target.name, credits);
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
      description = pickExplorationDesc(rng, issuer.name, target.name, credits);
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
    issuerName: issuer.name,
    issuerTitle: issuer.title,
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
  const issuer = pickIssuer(rng, QuestType.DELIVERY);
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
      description: `${partLabel}. ${issuer.title} ${issuer.name} ведёт большое дело по частям: перевезите груз (${cargo.label}) в систему ${target.name}. Выполните все 3 части — и за финал заплатят по-крупному.`,
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
    issuerName: issuer.name,
    issuerTitle: issuer.title,
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
  const issuer = pickIssuer(rng, QuestType.DELIVERY);
  const cargo = pickCargo(rng);
  return {
    template: {
      id,
      title: `[ФИНАЛ] Завершение цепочки: ${where}`,
      description: `Последняя миссия цепочки! ${issuer.title} ${issuer.name} лично проследит за грузом: доставьте особый контейнер (${cargo.label}) в систему ${target.name}. Награда утроена — заслужили.`,
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
    issuerName: issuer.name,
    issuerTitle: issuer.title,
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
  const issuer = pickIssuer(rng, QuestType.DELIVERY);
  const cargo = pickCargo(rng);
  const targetPlanetId = pickTargetPlanet(origin);
  return {
    template: {
      id,
      title: "Местный подряд",
      description: `${issuer.title} ${issuer.name} подкинул местный подряд: развезти «${cargo.label}» по орбитальным складам, не покидая систему. Платят немного, зато спокойно и без прыжков.`,
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
    issuerName: issuer.name,
    issuerTitle: issuer.title,
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
  const issuer = pickIssuer(rng, QuestType.TEXT_ADVENTURE);

  // Pick a script deterministically for this board slot.
  const script =
    ALL_QUEST_SCRIPTS[rng.nextInt(0, ALL_QUEST_SCRIPTS.length - 1)];

  return {
    template: {
      id,
      title: `Особое задание: ${script.title}`,
      description: `${issuer.title} ${issuer.name} вполголоса предлагает уникальное дело «${script.title}». Исход целиком зависит от ваших решений — гарантий никаких.`,
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
    issuerName: issuer.name,
    issuerTitle: issuer.title,
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
  issuer: string,
  cargoLabel: string,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `${issuer} грузит контейнер с «${cargoLabel}» (не спрашивай, что внутри) и просит доставить на ${targetName}. Клянётся, что ничего не пищит. Оплата: ${reward} ₢.`,
    `Срочная поставка ${cargoLabel} в систему ${targetName} — там ждут уже третий день. ${issuer} нервничает, прежние курьеры разбежались. Может, ты справишься? Вознаграждение: ${reward} ₢.`,
    `${targetName} остро нуждается в ${cargoLabel}. «Срочно!» — твердит ${issuer}, но у них тут вечно срочно. Готовы заплатить ${reward} ₢ за своевременную доставку.`,
    `${issuer} просит без лишнего шума: доставь ${cargoLabel} в ${targetName}. Упаковка нестандартная, но таможня уже предупреждена. ${reward} ₢ по прибытии.`,
    `${issuer} божится, что груз «${cargoLabel}» абсолютно легален и безопасен. Именно поэтому за рейс до ${targetName} платят целых ${reward} ₢. Совпадение? Решать тебе.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickBountyDesc(
  rng: SeededRNG,
  issuer: string,
  targetName: string,
  reward: number,
): string {
  const gangs = [
    "«Зубные Феи»",
    "«Ржавые Кулаки»",
    "«Корсары Туманности»",
    "«Весёлые Вдовы»",
    "«Сборщики Долгов»",
  ];
  const gang = gangs[rng.nextInt(0, gangs.length - 1)];
  const templates = [
    `Шайка ${gang} обнаглела и обложила данью торговцев у ${targetName}. ${issuer} просит навести порядок. Награда щедрая — чтобы перебить страх: ${reward} ₢.`,
    `Цель прячется в системе ${targetName}. ${issuer} предупреждает: стреляет первой, переговоров не ведёт. Зато мёртвой стоит ${reward} ₢ — живой не нужна никому.`,
    `${gang} атаковали конвой близ ${targetName}. Пострадавшие требуют справедливости, ${issuer} требует результата, а ты потребуешь ${reward} ₢. Кажется, все довольны.`,
    `${issuer} давно мечтает, чтобы ${gang} перестали существовать где-то у ${targetName}. Бюджет на мечту: ${reward} ₢. Вопросов о методах не будет.`,
    `Розыск: один очень нехороший тип засел в ${targetName}. ${issuer} клянётся, что он того заслужил. ${reward} ₢, и можешь не уточнять подробности.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickEscortDesc(
  rng: SeededRNG,
  issuer: string,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Торговый конвой идёт в ${targetName}, но маршрут небезопасен. Охрана ${issuer}а сбежала ещё вчера. Тебе предлагают ${reward} ₢ и искреннюю благодарность — последнее бесплатно.`,
    `${issuer} сопровождает делегацию в ${targetName} и очень боится. Стрелять первым нельзя, но отвечать — обязательно. Оплата: ${reward} ₢.`,
    `Груз и пассажиры ${issuer}а следуют в ${targetName}. Предыдущий эскорт «не смог», подробности тебе знать не положено. ${reward} ₢ при доставке.`,
    `${issuer} нанимает прикрытие до ${targetName}: караван жирный, пираты голодные, математика очевидная. За нервы и топливо — ${reward} ₢.`,
    `«Просто доведи нас до ${targetName} живыми», — просит ${issuer}. Звучит просто. Платят ${reward} ₢ — значит, не очень.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickDiplomacyDesc(
  rng: SeededRNG,
  issuer: string,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Переговоры зашли в тупик. ${issuer} ищет нейтрального курьера, чтобы доставить предложение в ${targetName} лично в руки. Бюрократы боятся перехвата. ${reward} ₢ за дискретность.`,
    `В ${targetName} ждут ответа на торговое предложение. Ответ — конверт, конверт — у ${issuer}а, скоро будет у тебя. Не вскрывать, не читать, не нюхать. ${reward} ₢ по прибытии.`,
    `Дипломатический кризис между ${targetName} и здешней администрацией разгорается. ${issuer} умоляет привезти мирный документ раньше, чем кто-то выстрелит. ${reward} ₢ за мир.`,
    `${issuer} клянётся, что это «просто формальность»: подпись, печать, рукопожатие в ${targetName}. Формальности за ${reward} ₢ обычно не такие уж формальные.`,
    `Тонкая миссия: ${issuer} просит передать слово чести в ${targetName}, не уронив ни слова и ни честь. ${reward} ₢ — и ни одной лишней реплики.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickExplorationDesc(
  rng: SeededRNG,
  issuer: string,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `Система ${targetName} есть в картах, но свежих данных оттуда нет уже три года. ${issuer} хочет новый скан. Риски минимальные, оплата — ${reward} ₢. Говорят, там красиво.`,
    `Аномалия зафиксирована близ ${targetName}. ${issuer} ищет разведчика, который слетает и вернётся живым. Про предыдущих двух мы не вспоминаем. Вознаграждение: ${reward} ₢.`,
    `${targetName} не отвечает на стандартные сигналы. ${issuer} уверен, что это сбой ретранслятора. Почти уверен. Слетай, проверь, привези данные. ${reward} ₢ без лишних вопросов.`,
    `${issuer} ставит на то, что в ${targetName} есть нечто, чего нет в каталогах. Сыграет ставка — ${reward} ₢ твои, а слава его. Честный делёж по галактическим меркам.`,
    `Скучный заказ от ${issuer}а: облететь ${targetName}, всё измерить, ничего не трогать. За скуку и аккуратность — ${reward} ₢. Постарайся вернуть зонд целым.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}
