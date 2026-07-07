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
  /** For BOUNTY quests: the name of the specific ship the player must destroy. */
  readonly targetNpcName: string | null;
  /** Colored metadata tags shown in the job board and journal (cargo, system, issuer planet, etc.). */
  readonly highlights: ReadonlyArray<{
    label: string;
    value: string;
    color: number;
  }>;
  /** Planet ID where this quest was posted. */
  readonly issuerPlanetId: string;
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
  /**
   * Content {@link questKey}s the board must NOT re-offer — typically the
   * player's active + pending-return quests, so a quest already taken never
   * reappears as a fresh offer ("задания не должны повторяться"). When present
   * (even empty `[]`), the board also dedupes **within itself** and back-fills
   * from later slots so it still reaches `count`. When `undefined`, the board is
   * produced exactly as before (no dedupe) — preserving the legacy output every
   * existing test relies on.
   */
  readonly excludeKeys?: readonly string[];
  /**
   * HOSTILE-HELD system IDs (Overmind- or pirate-controlled) that routine
   * quests must never TARGET (Task 6, three-year-campaign plan). An occupied
   * system has no functioning civilian port: a board that sells a starter-rank
   * courier run into a standing 9-ship garrison is selling a death sentence —
   * measured on the campaign harness, the agent (or an honest player) takes
   * the 1-jump delivery, flies straight into the den, and is annihilated
   * before it can flee. War content stays on its designed paths: DEFENSE
   * quests (via `overmindAdjacentSystems`) target the *frontier*, and finale
   * quests deliberately point INTO held space. Default `[]` (no exclusion)
   * keeps legacy boards byte-identical.
   */
  readonly hostileSystems?: readonly string[];
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

/** Nouns used to name escort convoy ships, e.g. "Транспорт «Аврора»". */
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

/** Names of wanted ships for BOUNTY quests. */
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
  "Виттар",
  "Назари",
  "Сейфул",
  "Боргес",
  "Чейни",
  "Адебайо",
  "Линдгрен",
  "Раш",
];

/** Per-type title pool, so the issuer's rank fits the job they post. */
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

/**
 * A stable identity for "the same quest" across board re-generation
 * ("задания не должны повторяться"). Two offers that send the player on the
 * same job to the same destination share a key, *regardless* of the
 * bucket-bearing board-slot id, the randomised reward/quantity, or the issuer —
 * so an offer the player has already taken (active) or that is already placed on
 * the board being built can be recognised and skipped.
 *
 * - Text-quests are keyed by their script (`targetObjectId`): the same script is
 *   a repeat wherever it is posted.
 * - Every other quest is keyed by type + target system + a destination signature
 *   built from its objectives (planet/system targets and cargo kind), excluding
 *   slot ids and randomised quantities. That makes the key identical on the next
 *   board refresh and lets it match an already-accepted copy (whose objective
 *   ids and reward differ, but whose destination signature does not).
 *
 * The objective signature uses only fields present on **both** a generated
 * quest's template and a restored {@link Quest} (objective `type` + `locationId`
 * + `targetSystemId` + `itemType`), so the same key can be computed for the
 * player's active quests when threading exclusions into the board generator.
 */
export function questKey(quest: GeneratedQuest): string {
  const t = quest.template;
  return questKeyFromParts({
    type: t.type,
    // The GeneratedQuest's resolved target system wins over the template's,
    // matching the historical behaviour (`quest.targetSystemId || t.targetSystemId`).
    targetSystemId: quest.targetSystemId || (t.targetSystemId ?? ""),
    targetObjectId: t.targetObjectId,
    id: t.id,
    objectives: t.objectives,
    chainId: t.chainId,
    chainPart: t.chainPart,
  });
}

/**
 * The minimal shape `questKey` needs — shared by a generated quest's template
 * and a restored {@link Quest} so the *same* key is computed for both. Lets the
 * board generator exclude the player's active/pending quests by content (not by
 * the slot id, which differs once a quest is accepted).
 */
export interface QuestKeyParts {
  readonly type: QuestType;
  readonly targetSystemId: string | null | undefined;
  readonly targetObjectId: string | null | undefined;
  /** Fallback identity for text-quests that carry no `targetObjectId`. */
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

/** Core key derivation, shared by {@link questKey} and {@link questKeyForQuest}. */
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

/**
 * The {@link questKey} of a restored {@link Quest} (or any object carrying the
 * same fields). Used at the board call site to exclude the player's active and
 * pending-return quests from re-generation ("задания не должны повторяться").
 */
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
  const boardSeed = `${seed}|board|${planetId}|${bucket}`;

  // Hyperjump distance from the origin to every reachable system. Use the
  // UNDIRECTED warp metric so the advertised jump count matches the route the
  // nav/star-map actually flies (warp follows an edge either way; ~25% of links
  // are one-way) — never "1-2 advertised / 3-6 actual".
  const jumpDist = jumpDistances(systems, originSystemId, { undirected: true });
  // Systems we can actually send the player to (anything but the origin).
  // Unexplored ("?") systems are excluded — a quest must never point the
  // player at a system they have not yet charted (Task 2). `explored` is a
  // real boolean in production; the `!== false` guard keeps undefined-stub
  // systems in older tests reachable. Hostile-HELD systems are excluded too
  // (see `BoardOptions.hostileSystems`) — no civilian contract may target an
  // occupied system; every routine/chain/elite builder draws from this pool,
  // so the exclusion covers them all at the source.
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

  /**
   * Build the quest for board slot `i`, deterministic in `(boardSeed, i)`.
   * Mutates `chainPartsOnBoard` (closure) exactly as the legacy inline loop did,
   * so the slot's output is byte-identical whether or not dedupe is enabled.
   */
  const buildForSlot = (i: number): GeneratedQuest => {
    const rng = new SeededRNG(`${boardSeed}|${i}`);
    const isText = rng.next() < textRatio;

    if (isText || reachable.length === 0) {
      // A «Местный подряд» local delivery now goes to a *different* HABITABLE
      // planet in the same system, so it needs a real habitable neighbour. A
      // KNOWN origin without a second inhabited world (single-planet, or one
      // habitable planet + only barren ones) has nowhere meaningful to deliver —
      // emit a text quest instead of a dead-end contract to an uninhabited rock.
      // The guard uses the SAME predicate as the destination picker
      // (`pickTargetPlanet(..., habitableOnly=true)`) so the two always agree.
      // An unknown origin (null, only in tests) keeps the legacy local delivery
      // with a system-level (null target planet) completion.
      const originHasNeighbour =
        !origin || pickTargetPlanet(origin, planetId, true) !== null;
      return applyPrefix(
        isText || !originHasNeighbour
          ? buildTextQuest(rng, planetId, bucket, i, day, origin)
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

    // Determine quest tier: chain → elite → normal
    const isChain = rng.next() < chainRatio && chainPartsOnBoard < 3;
    if (isChain) {
      if (completedQuestChains.includes(chainId) && chainPartsOnBoard === 0) {
        // Chain is complete: show the finale quest once per board.
        const q = applyPrefix(
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
        );
        // Increment so subsequent isChain rolls fall through to the else branch
        // (routine quest) instead of adding a duplicate finale.
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
            day,
            chainId,
            chainPartsOnBoard,
          ),
        );
        chainPartsOnBoard++;
        return q;
      }
      // Chain finale already on board: emit normal quest instead.
      return applyPrefix(
        buildRoutineQuest(rng, type, target, jumps, planetId, bucket, i, day),
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
        day,
        isElite,
      ),
    );
  };

  // Dedupe is opt-in: only when the caller passes `excludeKeys` (the player's
  // active/pending quests). Then a candidate whose content key is excluded — or
  // already placed on this board — is skipped, and later slots back-fill so the
  // board still reaches `count`. With no `excludeKeys`, the loop runs the legacy
  // path (slots 0..count-1, no skipping) and the output is unchanged.
  const dedupe = excludeKeys !== undefined;
  const seen = new Set<string>(excludeKeys ?? []);
  // Cap back-fill attempts so an exhausted pool (more exclusions than distinct
  // quests reachable) can never spin forever; best-effort fill to `count`.
  const cap = dedupe ? count * 8 + 32 : count;
  const out: GeneratedQuest[] = [];
  for (let i = 0; out.length < count && i < cap; i++) {
    // `buildForSlot` advances `chainPartsOnBoard` for any chain quest it builds.
    // When dedupe then skips that quest (its key is excluded or already placed),
    // the counter must be rolled back — otherwise the next chain slot emits a
    // *later* chain part with no earlier part on the board (an orphaned
    // «часть 2/3»), and the `< 3` cap / finale logic counts a dropped quest.
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
  // Inject 1 DEFENSE quest when OVERMIND has adjacent systems the player can contest.
  // A defense target must be explored — the player cannot be sent to defend a
  // system they have not yet charted (Task 2).
  const exploredAdjacent = overmindAdjacentSystems.filter((id) => {
    const s = systems.find((sys) => sys.id === id);
    return s != null && s.explored !== false;
  });
  if (exploredAdjacent.length > 0) {
    const defRng = new SeededRNG(`${boardSeed}|defense`);
    const targetAdjacentId =
      exploredAdjacent[defRng.nextInt(0, exploredAdjacent.length - 1)];
    // The OVERMIND system adjacent to the target (to be removed on completion).
    // Find the first OVERMIND system that is connected to the target.
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
          { label: "Выдан", value: planetId, color: 0xaaaaaa },
        ],
        issuerPlanetId: planetId,
      };
      // Don't re-offer a DEFENSE quest the player already has active/pending.
      if (!dedupe || !seen.has(questKey(defenseQuest))) {
        out.push(defenseQuest);
      }
    }
  }

  return out;
}

/**
 * Prefer a habitable planet in a system as a concrete target, else any, else null.
 * `excludeId` (the issuer planet) is skipped so an in-system courier run targets a
 * genuine *neighbour* — a different habitable planet if one exists, else any other
 * planet, else null (no neighbour ⇒ caller falls back to a non-delivery quest).
 *
 * `habitableOnly` (local delivery): restrict candidates to *habitable* planets, so
 * a «Местный подряд» never delivers to a barren/uninhabited dead-end. With it set,
 * a system whose only neighbour is barren returns null and the caller demotes the
 * slot to a text quest — the destination picker and the eligibility guard share
 * this exact predicate so they always agree.
 */
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
  const credits = Math.round(
    (QUEST_BASE_REWARD + jumps * QUEST_REWARD_PER_JUMP) *
      m *
      rng.nextFloat(0.9, 1.2),
  );
  const experience = Math.round(credits * 0.4);
  // Deadline = BASE + jumps × PER_JUMP + a small buffer, off the REAL (undirected)
  // jump count — bounded but always enough to make the trip for that distance.
  // 1-jump → 37-42 days, 2-jump → 53-58, 3-jump → 69-74 (see balance.ts).
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
        { label: "Выдан", value: planetId, color: 0xaaaaaa },
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
        { label: "Выдан", value: planetId, color: 0xaaaaaa },
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
        { label: "Выдан", value: planetId, color: 0xaaaaaa },
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
          value: targetPlanetId ?? target.name,
          color: 0xffcc66,
        },
        { label: "Выдан", value: planetId, color: 0xaaaaaa },
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
        { label: "Выдан", value: planetId, color: 0xaaaaaa },
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
    targetNpcName,
    highlights,
    issuerPlanetId: planetId,
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
    targetNpcName: null,
    highlights: [
      { label: "Груз", value: cargo.label, color: 0x88ccff },
      { label: "Система", value: target.name, color: 0x66ffcc },
      { label: "Выдан", value: planetId, color: 0xaaaaaa },
    ],
    issuerPlanetId: planetId,
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
    targetNpcName: null,
    highlights: [
      { label: "Груз", value: cargo.label, color: 0x88ccff },
      { label: "Система", value: target.name, color: 0x66ffcc },
      { label: "Выдан", value: planetId, color: 0xaaaaaa },
    ],
    issuerPlanetId: planetId,
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
  originSystemId: string,
): GeneratedQuest {
  const id = slotId(planetId, bucket, i);
  const issuer = pickIssuer(rng, QuestType.DELIVERY);
  const cargo = pickCargo(rng);
  // Target a genuine *habitable* neighbour — a different inhabited planet in the
  // same system than the issuing planet — so the contract is a real courier run,
  // not "buy here, deliver here" and never a dead-end to a barren world.
  // `excludeId = planetId` (the issuer) is skipped and `habitableOnly` keeps the
  // destination inhabited; null only when origin is unknown (tests), where
  // completion stays system-level. The slot is only reached when the matching
  // guard already confirmed such a habitable neighbour exists.
  const targetPlanetId = pickTargetPlanet(origin, planetId, true);
  // Always resolve to a real SYSTEM id. When `origin` is unknown we must fall
  // back to `originSystemId` (the board's system id) — never `planetId`, which
  // is a planet id and would make `checkDeliveryQuestCompletion` never match.
  const resolvedSystemId = origin?.id ?? originSystemId;
  // Human-readable name for where the goods go: the target planet's name, then
  // its id, then the origin system name — so the copy can name the destination.
  const targetPlanetName =
    origin?.planets.find((p) => p.id === targetPlanetId)?.name ??
    targetPlanetId ??
    origin?.name ??
    "месте выдачи";
  // Compute the cargo amount once so the objective and the reward stay in sync.
  const targetAmount = rng.nextInt(4, 10);
  // Anchor the payout to the goods' base cost so buying the cargo on the market
  // and delivering it always nets a profit (margin) rather than a loss.
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
      { label: "Выдан", value: planetId, color: 0xaaaaaa },
    ],
    issuerPlanetId: planetId,
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

  const planet = origin?.planets.find((p) => p.id === planetId);
  const planetName = planet?.name ?? planetId;

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
    highlights: [{ label: "Выдан", value: planetId, color: 0xaaaaaa }],
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

/**
 * Test-facing view onto the per-`QuestType` flavor-text pickers (Task 16). Each
 * renders one of ≥ 4 seeded phrasing variants with the given interpolation
 * inputs. Exported for `questBoardTextVariety.test.ts` (variant coverage /
 * broken-interpolation checks) — production quest generation calls the module
 * helpers directly, never through this record.
 */
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
