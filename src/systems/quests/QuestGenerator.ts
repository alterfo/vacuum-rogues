import type { StarSystem } from "@/domain/StarSystem";
import type { QuestTemplate } from "@/systems/QuestManager";
import { QuestType, ResourceType, EnemyType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { jumpDistances } from "@/systems/galaxy/jumpDistance";
import {
  ELITE_QUEST_MIN_RANK,
  QUEST_BASE_REWARD,
  QUEST_REWARD_PER_JUMP,
  QUEST_DEADLINE_BASE_DAYS,
  QUEST_DEADLINE_PER_JUMP_DAYS,
  QUEST_DEADLINE_BUFFER_MIN_DAYS,
  QUEST_DEADLINE_BUFFER_MAX_DAYS,
  RESOURCE_BASE_PRICES,
  LOCAL_DELIVERY_REWARD_MARGIN,
} from "@/config/balance";
import { ALL_QUEST_SCRIPTS } from "@/systems/quests/TextQuestRegistry";
import { questRewardEraMult } from "@/systems/campaign/rewardEra";

export const QUEST_TEXT_RATIO = 0.2;

export const QUEST_ELITE_RATIO = 0.2;

export const QUEST_CHAIN_RATIO = 0.15;

export const BOARD_REFRESH_DAYS = 5;

export interface GeneratedQuest {
  readonly template: QuestTemplate;
  readonly targetSystemId: string;
  readonly targetPlanetId: string | null;
  readonly jumps: number;
  readonly issuerName: string;
  readonly issuerTitle: string;
  readonly targetNpcName: string | null;
  readonly highlights: ReadonlyArray<{
    label: string;
    value: string;
    color: number;
  }>;
  readonly issuerPlanetId: string;
}

export interface BoardOptions {
  readonly systems: StarSystem[];
  readonly originSystemId: string;
  readonly planetId: string;
  readonly day: number;
  readonly seed: string;
  readonly count?: number; // default 5
  readonly refreshEveryDays?: number; // default BOARD_REFRESH_DAYS
  readonly textRatio?: number; // default QUEST_TEXT_RATIO
  readonly eliteRatio?: number;
  readonly chainRatio?: number;
  readonly completedQuestChains?: readonly string[];
  readonly excludeKeys?: readonly string[];
  readonly hostileSystems?: readonly string[];
  readonly overmindSystems?: readonly string[];
  readonly overmindAdjacentSystems?: readonly string[];
  readonly homeFactionId?: string | null;
}

const ROUTINE_TYPES: QuestType[] = [
  QuestType.DELIVERY,
  QuestType.BOUNTY,
  QuestType.ESCORT,
  QuestType.DIPLOMACY,
  QuestType.EXPLORATION,
];

const FACTION_HOME_PREFIX: Record<string, string> = {
  OUTLANDERS: "[ОКРАИНА]",
  BASTIONS: "[БАСТИОН]",
  SYNDICATE: "[СИНДИКАТ]",
  PARADOXES: "[ПАРАДОКС]",
  PROGRESSORS: "[ПРОГРЕССОРЫ]",
};

const CONVOY_SHIP_NOUNS = [
  "Аврора",
  "Альтаир",
  "Беркут",
  "Гармония",
  "Дельфин",
  "Заря",
  "Каравелла",
  "Комета",
  "Меркурий",
  "Орион",
  "Паллада",
  "Сириус",
  "Стрела",
  "Титан",
  "Феникс",
  "Циклон",
  "Вега",
  "Гелиос",
  "Странник",
  "Пилигрим",
  "Карго-7",
  "Антарес",
];

const BOUNTY_SHIP_NAMES = [
  "Стальная Тень",
  "Красный Клинок",
  "Ночной Призрак",
  "Ядовитый Зуб",
  "Железная Хватка",
  "Серебряный Вор",
  "Чёрная Молния",
  "Кровавый Рассвет",
  "Злой Рок",
  "Стальная Крыса",
  "Жёлтый Скорпион",
  "Туманный Волк",
  "Пепельный Коготь",
  "Осколок Бездны",
  "Ржавый Приговор",
  "Голодный Демон",
  "Стальной Ворон",
  "Проклятый Странник",
  "Тёмный Прилив",
  "Кроваво-Красная Звезда",
  "Угрюмый Кочевник",
  "Зубастая Пасть",
];

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
  "Виттар",
  "Назари",
  "Сейфул",
  "Боргес",
  "Чейни",
  "Адебайо",
  "Линдгрен",
  "Раш",
];

const ISSUER_TITLES: Partial<Record<QuestType, string[]>> = {
  [QuestType.DELIVERY]: [
    "Снабженец",
    "Торговец",
    "Завхоз",
    "Логист",
    "Грузовой брокер",
    "Начальник склада",
    "Фактор",
  ],
  [QuestType.BOUNTY]: [
    "Шериф",
    "Командор",
    "Маршал",
    "Егерь",
    "Начальник охраны",
    "Дознаватель",
    "Ловчий",
  ],
  [QuestType.ESCORT]: [
    "Караванщик",
    "Капитан конвоя",
    "Старшина",
    "Обозный",
    "Начальник эскорта",
    "Конвойный мастер",
  ],
  [QuestType.DIPLOMACY]: [
    "Посол",
    "Советник",
    "Атташе",
    "Эмиссар",
    "Консул",
    "Переговорщик",
  ],
  [QuestType.EXPLORATION]: [
    "Профессор",
    "Картограф",
    "Координатор",
    "Астрогеолог",
    "Глава экспедиции",
    "Изыскатель",
  ],
  [QuestType.DEFENSE]: ["Командующий", "Адмирал", "Воевода", "Стратег"],
  [QuestType.TEXT_ADVENTURE]: [
    "Незнакомец",
    "Информатор",
    "Посредник",
    "Тёмная личность",
  ],
};

function pickIssuer(
  rng: SeededRNG,
  type: QuestType,
): { name: string; title: string } {
  const name = ISSUER_NAMES[rng.nextInt(0, ISSUER_NAMES.length - 1)];
  const titles = ISSUER_TITLES[type] ?? ["Губернатор"];
  const title = titles[rng.nextInt(0, titles.length - 1)];
  return { name, title };
}

export function governorOfferLine(quest: GeneratedQuest): string {
  const speaker =
    quest.issuerName && quest.issuerTitle
      ? `${quest.issuerTitle} ${quest.issuerName}`
      : "Губернатор";
  return `${speaker}: «${quest.template.description}»`;
}

export function questKey(quest: GeneratedQuest): string {
  const t = quest.template;
  return questKeyFromParts({
    type: t.type,
    targetSystemId: quest.targetSystemId || (t.targetSystemId ?? ""),
    targetObjectId: t.targetObjectId,
    id: t.id,
    objectives: t.objectives,
    chainId: t.chainId,
    chainPart: t.chainPart,
  });
}

export interface QuestKeyParts {
  readonly type: QuestType;
  readonly targetSystemId: string | null | undefined;
  readonly targetObjectId: string | null | undefined;
  readonly id: string;
  readonly objectives: ReadonlyArray<{
    type: string;
    locationId?: string;
    targetSystemId?: string;
    itemType?: string;
  }>;
  readonly chainId?: string | null;
  readonly chainPart?: number | null;
}

function questKeyFromParts(p: QuestKeyParts): string {
  if (p.type === QuestType.TEXT_ADVENTURE) {
    return `TEXT|${p.targetObjectId ?? p.id}`;
  }
  const objSig = p.objectives
    .map(
      (o) =>
        `${o.type}:${o.locationId ?? ""}:${o.targetSystemId ?? ""}:${o.itemType ?? ""}`,
    )
    .join(",");
  const chain = p.chainId ? `${p.chainId}#${p.chainPart ?? ""}` : "";
  const system = p.targetSystemId ?? "";
  return `${p.type}|${system}|${chain}|${objSig}`;
}

export function questKeyForQuest(quest: QuestKeyParts): string {
  return questKeyFromParts(quest);
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
    excludeKeys,
    hostileSystems = [],
    overmindSystems = [],
    overmindAdjacentSystems = [],
    homeFactionId = null,
  } = opts;

  const factionPrefix = homeFactionId
    ? (FACTION_HOME_PREFIX[homeFactionId] ?? null)
    : null;

  const bucket = Math.floor(day / Math.max(1, refreshEveryDays));
  const eraDay = bucket * Math.max(1, refreshEveryDays);
  const boardSeed = `${seed}|board|${planetId}|${bucket}`;

  const jumpDist = jumpDistances(systems, originSystemId, { undirected: true });
  const hostileSet = new Set(hostileSystems);
  const reachable = systems
    .filter(
      (s) =>
        s.id !== originSystemId &&
        jumpDist.has(s.id) &&
        s.explored !== false &&
        !hostileSet.has(s.id),
    )
    .sort((a, b) => a.id.localeCompare(b.id)); // stable order for determinism
  const origin = systems.find((s) => s.id === originSystemId) ?? null;

  const chainId = `chain-${planetId}-${bucket}`;
  let chainPartsOnBoard = 0;

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

  const buildForSlot = (i: number): GeneratedQuest => {
    const rng = new SeededRNG(`${boardSeed}|${i}`);
    const isText = rng.next() < textRatio;

    if (isText || reachable.length === 0) {
      const originHasNeighbour =
        !origin || pickTargetPlanet(origin, planetId, true) !== null;
      return applyPrefix(
        isText || !originHasNeighbour
          ? buildTextQuest(rng, planetId, bucket, i, eraDay, origin)
          : buildLocalDelivery(
              rng,
              planetId,
              bucket,
              i,
              day,
              origin,
              originSystemId,
            ),
      );
    }

    const type = ROUTINE_TYPES[rng.nextInt(0, ROUTINE_TYPES.length - 1)];
    const target = reachable[rng.nextInt(0, reachable.length - 1)];
    const jumps = jumpDist.get(target.id) ?? 1;

    const isChain = rng.next() < chainRatio && chainPartsOnBoard < 3;
    if (isChain) {
      if (completedQuestChains.includes(chainId) && chainPartsOnBoard === 0) {
        const q = applyPrefix(
          buildFinaleQuest(
            rng,
            chainId,
            target,
            jumps,
            planetId,
            bucket,
            i,
            eraDay,
            origin,
          ),
        );
        chainPartsOnBoard++;
        return q;
      } else if (!completedQuestChains.includes(chainId)) {
        const q = applyPrefix(
          buildChainQuest(
            rng,
            type,
            target,
            jumps,
            planetId,
            bucket,
            i,
            eraDay,
            chainId,
            chainPartsOnBoard,
            origin,
          ),
        );
        chainPartsOnBoard++;
        return q;
      }
      return applyPrefix(
        buildRoutineQuest(
          rng,
          type,
          target,
          jumps,
          planetId,
          bucket,
          i,
          eraDay,
          origin,
        ),
      );
    }

    const isElite = rng.next() < eliteRatio;
    return applyPrefix(
      buildRoutineQuest(
        rng,
        type,
        target,
        jumps,
        planetId,
        bucket,
        i,
        eraDay,
        origin,
        isElite,
      ),
    );
  };

  const dedupe = excludeKeys !== undefined;
  const seen = new Set<string>(excludeKeys ?? []);
  const cap = dedupe ? count * 8 + 32 : count;
  const out: GeneratedQuest[] = [];
  for (let i = 0; out.length < count && i < cap; i++) {
    const chainPartsBefore = chainPartsOnBoard;
    const q = buildForSlot(i);
    if (dedupe) {
      const k = questKey(q);
      if (seen.has(k)) {
        chainPartsOnBoard = chainPartsBefore;
        continue;
      }
      seen.add(k);
    }
    out.push(q);
  }
  const exploredAdjacent = overmindAdjacentSystems.filter((id) => {
    const s = systems.find((sys) => sys.id === id);
    return s != null && s.explored !== false;
  });
  if (exploredAdjacent.length > 0) {
    const defRng = new SeededRNG(`${boardSeed}|defense`);
    const targetAdjacentId =
      exploredAdjacent[defRng.nextInt(0, exploredAdjacent.length - 1)];
    const targetSys = systems.find((s) => s.id === targetAdjacentId) ?? null;
    const adjacentOvermindId =
      targetSys?.connections
        .map((c) => c.toSystemId)
        .find((id) => overmindSystems.includes(id)) ?? null;

    if (targetSys) {
      const jumps =
        jumpDistances(systems, originSystemId, { undirected: true }).get(
          targetAdjacentId,
        ) ?? 1;
      const { credits, experience, deadline } = economics(
        QuestType.DEFENSE,
        jumps,
        defRng,
        Math.floor(day / Math.max(1, refreshEveryDays)) *
          Math.max(1, refreshEveryDays),
      );
      const defIssuer = pickIssuer(defRng, QuestType.DEFENSE);
      const defId = `${slotId(planetId, Math.floor(day / Math.max(1, refreshEveryDays)), out.length)}_defense`;
      const defenseQuest: GeneratedQuest = {
        template: {
          id: defId,
          title: `Оборона: ${targetSys.name} (${jumps} прыж.)`,
          description: pickDefenseDesc(
            defRng,
            defIssuer.title,
            defIssuer.name,
            targetSys.name,
            credits,
          ),
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
        targetNpcName: null,
        highlights: [
          { label: "Система", value: targetSys.name, color: 0x66ddff },
          {
            label: "Выдан",
            value: planetDisplayName(origin, planetId),
            color: 0xaaaaaa,
          },
        ],
        issuerPlanetId: planetId,
      };
      if (!dedupe || !seen.has(questKey(defenseQuest))) {
        out.push(defenseQuest);
      }
    }
  }

  return out;
}

function pickTargetPlanet(
  system: StarSystem | null,
  excludeId: string | null = null,
  habitableOnly = false,
): string | null {
  if (!system || system.planets.length === 0) return null;
  let candidates = excludeId
    ? system.planets.filter((p) => p.id !== excludeId)
    : system.planets;
  if (habitableOnly) candidates = candidates.filter((p) => p.isHabitable);
  if (candidates.length === 0) return null;
  const habitable = candidates.find((p) => p.isHabitable);
  return (habitable ?? candidates[0]).id;
}

function slotId(planetId: string, bucket: number, i: number): string {
  return `gen_${planetId}_${bucket}_${i}`;
}

function planetDisplayName(
  system: StarSystem | null | undefined,
  planetId: string,
): string {
  return system?.planets.find((p) => p.id === planetId)?.name ?? planetId;
}

function economics(
  type: QuestType,
  jumps: number,
  rng: SeededRNG,
  day = 0,
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
  const baseCredits = Math.round(
    (QUEST_BASE_REWARD + jumps * QUEST_REWARD_PER_JUMP) *
      m *
      rng.nextFloat(0.9, 1.2),
  );
  const credits = Math.round(baseCredits * questRewardEraMult(day));
  const experience = Math.round(baseCredits * 0.4);
  const buffer = rng.nextInt(
    QUEST_DEADLINE_BUFFER_MIN_DAYS,
    QUEST_DEADLINE_BUFFER_MAX_DAYS,
  );
  const deadline =
    jumps > 0
      ? QUEST_DEADLINE_BASE_DAYS + jumps * QUEST_DEADLINE_PER_JUMP_DAYS + buffer
      : 0;
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
  day: number,
  origin: StarSystem | null,
  isElite = false,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const targetPlanetId = pickTargetPlanet(target);
  const where = `${target.name} (${jumps} прыж.)`;
  const { credits, experience, deadline } = economics(type, jumps, rng, day);
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
  let targetNpcName: string | null = null;
  let highlights: ReadonlyArray<{
    label: string;
    value: string;
    color: number;
  }> = [];

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
      highlights = [
        { label: "Груз", value: cargo.label, color: 0x88ccff },
        { label: "Система", value: target.name, color: 0x66ffcc },
        {
          label: "Выдан",
          value: planetDisplayName(origin, planetId),
          color: 0xaaaaaa,
        },
      ];
      break;
    }
    case QuestType.BOUNTY: {
      const shipName =
        BOUNTY_SHIP_NAMES[rng.nextInt(0, BOUNTY_SHIP_NAMES.length - 1)];
      targetNpcName = shipName;
      title = `Охота: ${where}`;
      description =
        pickBountyDesc(rng, issuer.name, shipName, target.name, credits) +
        `\nЦель: корабль «${shipName}», система ${target.name}`;
      objectives = [
        {
          id: `${id}_kill`,
          description: `Уничтожить корабль «${shipName}» в ${target.name}`,
          type: "DEFEAT_ENEMY",
          targetAmount: 1,
          enemyType: bountyEnemy(rng),
        },
      ];
      highlights = [
        { label: "Цель", value: `«${shipName}»`, color: 0xff6666 },
        { label: "Система", value: target.name, color: 0x66ffcc },
        {
          label: "Выдан",
          value: planetDisplayName(origin, planetId),
          color: 0xaaaaaa,
        },
      ];
      break;
    }
    case QuestType.ESCORT: {
      const convoiName = `Транспорт «${CONVOY_SHIP_NOUNS[rng.nextInt(0, CONVOY_SHIP_NOUNS.length - 1)]}»`;
      title = `Эскорт: ${where}`;
      description = pickEscortDesc(
        rng,
        issuer.name,
        convoiName,
        target.name,
        credits,
      );
      objectives = [
        {
          id: `${id}_escort`,
          description: `Довести ${convoiName} до системы ${target.name}`,
          type: "VISIT_SYSTEM",
          targetAmount: 1,
          targetSystemId: target.id,
        },
      ];
      highlights = [
        { label: "Конвой", value: convoiName, color: 0x88ff88 },
        { label: "Система", value: target.name, color: 0x66ffcc },
        {
          label: "Выдан",
          value: planetDisplayName(origin, planetId),
          color: 0xaaaaaa,
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
      highlights = [
        {
          label: "Планета",
          value: targetPlanetId
            ? planetDisplayName(target, targetPlanetId)
            : target.name,
          color: 0xffcc66,
        },
        {
          label: "Выдан",
          value: planetDisplayName(origin, planetId),
          color: 0xaaaaaa,
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
      highlights = [
        { label: "Система", value: target.name, color: 0x66ddff },
        {
          label: "Выдан",
          value: planetDisplayName(origin, planetId),
          color: 0xaaaaaa,
        },
      ];
      break;
    }
  }

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
    targetNpcName,
    highlights,
    issuerPlanetId: planetId,
  };
}

function buildChainQuest(
  rng: SeededRNG,
  type: QuestType,
  target: StarSystem,
  jumps: number,
  planetId: string,
  bucket: number,
  i: number,
  day: number,
  chainId: string,
  chainPart: number,
  origin: StarSystem | null,
): GeneratedQuest {
  const id = `${slotId(planetId, bucket, i)}_chain${chainPart}`;
  const targetPlanetId = pickTargetPlanet(target);
  const where = `${target.name} (${jumps} прыж.)`;
  const { credits, experience, deadline } = economics(type, jumps, rng, day);
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
    targetNpcName: null,
    highlights: [
      { label: "Груз", value: cargo.label, color: 0x88ccff },
      { label: "Система", value: target.name, color: 0x66ffcc },
      {
        label: "Выдан",
        value: planetDisplayName(origin, planetId),
        color: 0xaaaaaa,
      },
    ],
    issuerPlanetId: planetId,
  };
}

function buildFinaleQuest(
  rng: SeededRNG,
  chainId: string,
  target: StarSystem,
  jumps: number,
  planetId: string,
  bucket: number,
  i: number,
  day: number,
  origin: StarSystem | null,
): GeneratedQuest {
  const id = `${slotId(planetId, bucket, i)}_finale`;
  const targetPlanetId = pickTargetPlanet(target);
  const where = `${target.name} (${jumps} прыж.)`;
  const { credits, experience, deadline } = economics(
    QuestType.DELIVERY,
    jumps,
    rng,
    day,
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
    targetNpcName: null,
    highlights: [
      { label: "Груз", value: cargo.label, color: 0x88ccff },
      { label: "Система", value: target.name, color: 0x66ffcc },
      {
        label: "Выдан",
        value: planetDisplayName(origin, planetId),
        color: 0xaaaaaa,
      },
    ],
    issuerPlanetId: planetId,
  };
}

function buildLocalDelivery(
  rng: SeededRNG,
  planetId: string,
  bucket: number,
  i: number,
  _day: number,
  origin: StarSystem | null,
  originSystemId: string,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const issuer = pickIssuer(rng, QuestType.DELIVERY);
  const cargo = pickCargo(rng);
  const targetPlanetId = pickTargetPlanet(origin, planetId, true);
  const resolvedSystemId = origin?.id ?? originSystemId;
  const targetPlanetName =
    origin?.planets.find((p) => p.id === targetPlanetId)?.name ??
    targetPlanetId ??
    origin?.name ??
    "месте выдачи";
  const targetAmount = rng.nextInt(4, 10);
  const goodsCost = RESOURCE_BASE_PRICES[cargo.resource] * targetAmount;
  const rewardCredits = Math.round(goodsCost * LOCAL_DELIVERY_REWARD_MARGIN);
  return {
    template: {
      id,
      title: "Местный подряд",
      description: `${issuer.title} ${issuer.name} предлагает местный подряд: закупить ${targetAmount} ед. «${cargo.label}» на рынке ${origin?.name ?? "системы"} и доставить на соседнюю планету ${targetPlanetName} в этой же системе (без прыжков). Оплата покрывает закупку и оставляет навар.`,
      type: QuestType.DELIVERY,
      objectives: [
        {
          id: `${id}_collect`,
          description: `Загрузить ${targetAmount} ед. ${cargo.label}`,
          type: "COLLECT_ITEM",
          targetAmount,
          itemType: cargo.resource,
        },
      ],
      reward: { credits: rewardCredits, experience: 60, items: [] },
      dialogueAnchors: [],
      deadline: 0,
      failurePenalty: null,
      targetSystemId: resolvedSystemId,
    },
    targetSystemId: resolvedSystemId,
    targetPlanetId,
    jumps: 0,
    issuerName: issuer.name,
    issuerTitle: issuer.title,
    targetNpcName: null,
    highlights: [
      { label: "Груз", value: cargo.label, color: 0x88ccff },
      ...(origin
        ? [{ label: "Система", value: origin.name, color: 0x66ffcc }]
        : []),
      {
        label: "Выдан",
        value: planetDisplayName(origin, planetId),
        color: 0xaaaaaa,
      },
    ],
    issuerPlanetId: planetId,
  };
}

function buildTextQuest(
  rng: SeededRNG,
  planetId: string,
  bucket: number,
  i: number,
  day: number,
  origin: StarSystem | null,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const { credits, experience } = economics(
    QuestType.TEXT_ADVENTURE,
    0,
    rng,
    day,
  );
  const issuer = pickIssuer(rng, QuestType.TEXT_ADVENTURE);

  const script =
    ALL_QUEST_SCRIPTS[rng.nextInt(0, ALL_QUEST_SCRIPTS.length - 1)];

  const planetName = planetDisplayName(origin, planetId);

  return {
    template: {
      id,
      title: `Особое задание: ${script.title}`,
      description: `${issuer.title} ${issuer.name} вполголоса предлагает уникальное дело «${script.title}». Исход целиком зависит от ваших решений — гарантий никаких.`,
      type: QuestType.TEXT_ADVENTURE,
      objectives: [
        {
          id: `${id}_resolve`,
          description: `Завершить задание на ${planetName}`,
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
      targetSystemId: origin?.id ?? null,
    },
    targetSystemId: origin?.id ?? planetId,
    targetPlanetId: planetId,
    jumps: 0,
    issuerName: issuer.name,
    issuerTitle: issuer.title,
    targetNpcName: null,
    highlights: [{ label: "Выдан", value: planetName, color: 0xaaaaaa }],
    issuerPlanetId: planetId,
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
    `Контракт от ${issuer}а: ${cargoLabel} на ${targetName}, и желательно до того, как испортится. Холодильник в трюме — твоя забота. Платят ${reward} ₢, если довезёшь товарным.`,
    `${issuer} потерял двух подрядчиков на этом маршруте, но не груз — «${cargoLabel}» всё ещё ждёт отправки в ${targetName}. Берёшься — ${reward} ₢ твои, страховку оформишь сам.`,
    `Прямой рейс: забрать «${cargoLabel}», уйти в ${targetName}, не задавать вопросов. ${issuer} ценит молчаливых курьеров и платит им ${reward} ₢ — болтливым не платит вообще.`,
    `${issuer} выбивает квоту на ${targetName} и просит подвезти «${cargoLabel}» туда, пока окно открыто. Опоздаешь — закроется и квота, и твои ${reward} ₢.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickBountyDesc(
  rng: SeededRNG,
  issuer: string,
  shipName: string,
  targetName: string,
  reward: number,
): string {
  const gangs = [
    "«Зубные Феи»",
    "«Ржавые Кулаки»",
    "«Корсары Туманности»",
    "«Весёлые Вдовы»",
    "«Сборщики Долгов»",
    "«Пыльные Шакалы»",
    "«Картель Без Имени»",
    "«Гниль»",
  ];
  const gang = gangs[rng.nextInt(0, gangs.length - 1)];
  const templates = [
    `Шайка ${gang} обнаглела и обложила данью торговцев у ${targetName}. ${issuer} просит навести порядок — корабль «${shipName}» в розыске. Награда щедрая — чтобы перебить страх: ${reward} ₢.`,
    `Корабль «${shipName}» прячется в системе ${targetName}. ${issuer} предупреждает: стреляет первым, переговоров не ведёт. Зато мёртвым стоит ${reward} ₢ — живым не нужен никому.`,
    `${gang} атаковали конвой близ ${targetName}, флагман — корабль «${shipName}». Пострадавшие требуют справедливости, ${issuer} требует результата, а ты потребуешь ${reward} ₢.`,
    `${issuer} давно мечтает, чтобы корабль «${shipName}» где-то у ${targetName} перестал существовать. Бюджет на мечту: ${reward} ₢. Вопросов о методах не будет.`,
    `Розыск: корабль «${shipName}» засел в ${targetName}. ${issuer} клянётся, что команда того заслужила. ${reward} ₢, и можешь не уточнять подробности.`,
    `За кораблём «${shipName}» из ${gang} тянется список сожжённых станций до самой ${targetName}. ${issuer} закрыл на них дело — открой ты, по-своему. Гонорар: ${reward} ₢.`,
    `${issuer} собрал свидетелей, доказательства и крепкую ненависть к команде «${shipName}», что орудует у ${targetName}. Не хватает только исполнителя за ${reward} ₢.`,
    `Тихий контракт: корабль «${shipName}» возле ${targetName} мешает слишком многим. ${issuer} не уточняет, кому именно, но ${reward} ₢ говорят сами за себя.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickEscortDesc(
  rng: SeededRNG,
  issuer: string,
  convoiName: string,
  targetName: string,
  reward: number,
): string {
  const templates = [
    `${convoiName} идёт в ${targetName}, но маршрут небезопасен. Охрана ${issuer}а сбежала ещё вчера. Тебе предлагают ${reward} ₢ и искреннюю благодарность — последнее бесплатно.`,
    `${issuer} сопровождает ${convoiName} в ${targetName} и очень боится. Стрелять первым нельзя, но отвечать — обязательно. Оплата: ${reward} ₢.`,
    `${convoiName} следует в ${targetName} с грузом и пассажирами. Предыдущий эскорт «не смог», подробности тебе знать не положено. ${reward} ₢ при доставке.`,
    `${issuer} нанимает прикрытие для ${convoiName} до ${targetName}: конвой жирный, пираты голодные, математика очевидная. За нервы и топливо — ${reward} ₢.`,
    `«Просто доведи ${convoiName} до ${targetName} живыми», — просит ${issuer}. Звучит просто. Платят ${reward} ₢ — значит, не очень.`,
    `${convoiName} везёт в ${targetName} то, ради чего пираты выходят на охоту целыми крыльями. ${issuer} просит держаться рядом до последнего прыжка. Контракт: ${reward} ₢.`,
    `У ${convoiName} барахлит двигатель, а до ${targetName} ещё лететь. ${issuer} платит ${reward} ₢ за то, чтобы кто-то прикрыл хромающий борт, пока механики молятся.`,
    `${issuer} не доверяет диспетчерам и ведёт ${convoiName} в ${targetName} в обход коридоров. Тише — но опаснее. За сопровождение по тёмной стороне — ${reward} ₢.`,
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
    `${issuer} затеял тайный размен заложниками с ${targetName} и боится, что официальный канал кто-то слушает. Свези гарантийное письмо лично — ${reward} ₢, и ни строчки в журнал.`,
    `Старая вражда с ${targetName} вот-вот станет войной. ${issuer} нашёл лазейку для перемирия, но её нужно отвезти раньше слухов. За тихую дипломатию платят ${reward} ₢.`,
    `${issuer} просит лишь кивнуть нужным людям в ${targetName} и вручить им запечатанный ответ. Кивок стоит ${reward} ₢ — слова обошлись бы куда дороже.`,
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
    `Гравитационные карты ${targetName} «поплыли», и ${issuer} хочет понять почему, пока туда не сунулся кто-то жадный. Снять замеры и уйти — ${reward} ₢, без геройства.`,
    `${issuer} перехватил обрывок чужого сигнала из ${targetName} и теперь не спит. Слетай, запиши спектр, вернись — и ${reward} ₢ помогут ему снова уснуть.`,
    `Брошенная станция дрейфует где-то в ${targetName}. ${issuer} платит ${reward} ₢ за каталог: что цело, что светит, что лучше не трогать. Опись, а не находки.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

function pickDefenseDesc(
  rng: SeededRNG,
  issuerTitle: string,
  issuerName: string,
  targetName: string,
  reward: number,
): string {
  const who = `${issuerTitle} ${issuerName}`;
  const templates = [
    `${who} бьёт тревогу: OVERMIND угрожает системе ${targetName}. Прилетите туда лично и остановите экспансию, пока ещё есть что оборонять. Оплата: ${reward} ₢.`,
    `Фронт у ${targetName} трещит по швам. ${who} умоляет удержать рубеж лично — эвакуация не успевает, а OVERMIND не ждёт. За оборону системы платят ${reward} ₢.`,
    `${who} шлёт сигнал бедствия из ${targetName}: щупальца OVERMIND уже на подходе. Нужен кто-то, кто не сбежит при первом контакте. Ставка — ${reward} ₢ и репутация героя.`,
    `Гарнизон ${targetName} редеет, а ${who} не может гарантировать даже завтрашний день. Прикрой систему, пока не поздно, — контракт на ${reward} ₢ уже подписан твоим именем.`,
    `«${targetName} нельзя отдавать», — коротко говорит ${who}. OVERMIND в соседней системе, счёт идёт на дни. Прилетай, держи оборону, получи ${reward} ₢ — если будет кому платить.`,
    `${who} собирает последних добровольцев на защиту ${targetName}. Соседний узел уже заражён, и оттуда ползёт тьма. За то, чтобы фронт устоял, обещают ${reward} ₢.`,
  ];
  return templates[rng.nextInt(0, templates.length - 1)];
}

export const __questDescPickers = {
  delivery: (rng: SeededRNG) =>
    pickDeliveryDesc(rng, "Логист Вега", "медикаменты", "Гамма", 4200),
  bounty: (rng: SeededRNG) =>
    pickBountyDesc(rng, "Егерь Тор", "Скорпион", "Дельта", 6100),
  escort: (rng: SeededRNG) =>
    pickEscortDesc(rng, "Обозный Кит", "Транспорт «Мул»", "Эпсилон", 5300),
  diplomacy: (rng: SeededRNG) =>
    pickDiplomacyDesc(rng, "Эмиссар Лан", "Дзета", 3800),
  exploration: (rng: SeededRNG) =>
    pickExplorationDesc(rng, "Изыскатель Ро", "Эта", 2900),
  defense: (rng: SeededRNG) =>
    pickDefenseDesc(rng, "Комендант", "Оск", "Тета", 7400),
} as const;
