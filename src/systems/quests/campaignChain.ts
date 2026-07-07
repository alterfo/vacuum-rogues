import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { OvermindStatus, ResourceType } from "@/types";
import { QuestType, ResourceType as Resource } from "@/types";
import {
  CAMPAIGN_CHAIN_LIBERATION_POWER,
  CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE,
  CAMPAIGN_CHAIN_STEP_REWARDS,
} from "@/config/balance";

/**
 * Overmind campaign quest chain — the scenario spine (three-year-campaign plan,
 * Task 12).
 *
 * A 5–6 step narrative arc that escorts the player from first contact with the
 * Overmind to the assault on its core. Unlike the procedural board quests, the
 * chain is a fixed, ordered sequence gated on **player milestones, not days** —
 * so it paces itself to the adaptive-difficulty campaign (a slow, careful run
 * and a fast, aggressive one both walk the same steps, in the same order, as
 * they hit the same power/front milestones).
 *
 * Design constraints (from the plan):
 * - **No new persisted field, no migration.** Step completion is read straight
 *   from the already-persisted `questLog.completedQuests` (the step's stable id
 *   lands there when the quest is completed). The "which step is next" decision
 *   is a *pure predicate* over (completed step ids, Overmind state, ratcheted
 *   power) — nothing about the chain is stored separately.
 * - **In order and only in order.** `nextCampaignChainStep` returns the FIRST
 *   incomplete step, and only if every earlier step is complete AND its own
 *   milestone band is crossed. A later step can never appear before an earlier
 *   one.
 * - **Catalog data.** Each step is built into a `GeneratedQuest` that reuses an
 *   existing `QuestType` completion path (EXPLORATION visits + one DELIVERY),
 *   so the quests are genuinely completable in real play with no new engine
 *   wiring and no save-shape change.
 *
 * Player-facing copy is Russian (project norm for board quests — the whole job
 * board is inline RU, so the chain needs no separate EN i18n keys).
 */

/** Stable chain id (all steps share it; used only for grouping/labels). */
export const CAMPAIGN_CHAIN_ID = "campaign-overmind";

/** Where a step points the player. */
export type CampaignTargetKind =
  /** An explored, non-hostile system on the Overmind border (the front). */
  | "frontier"
  /** An explored, non-hostile system in the safe rear (for the supply run). */
  | "safe";

/** The observable campaign state the step milestones are derived from. */
export interface CampaignChainInputs {
  /** Ids of campaign steps already completed (from `questLog.completedQuests`). */
  readonly completedStepIds: readonly string[];
  /** Overmind share of the galaxy ∈ [0,1] (occupied / total). */
  readonly overmindShare: number;
  /** Ratcheted campaign peak power ∈ [0,1] (never decreases within a run). */
  readonly peakPower: number;
  /** Current Overmind endgame-arc status. */
  readonly arcStatus: OvermindStatus;
}

/** Tunable milestone bands (defaults from `balance.ts` — never tune call sites). */
export interface CampaignChainConfig {
  /** Ratcheted power at/above which the arm-up-dependent steps unlock. */
  readonly liberationPower: number;
  /** Overmind share at/below which the final core-assault step unlocks. */
  readonly coreAssaultShare: number;
}

function defaultConfig(): CampaignChainConfig {
  return {
    liberationPower: CAMPAIGN_CHAIN_LIBERATION_POWER,
    coreAssaultShare: CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE,
  };
}

/** One step of the campaign chain. */
export interface CampaignChainStep {
  /** Stable, unique id — lands in `completedQuests` when the step is completed. */
  readonly id: string;
  /** 0-based position in the chain (unlock order). */
  readonly order: number;
  /** Board-card title (RU). */
  readonly title: string;
  /** Where the step points the player. */
  readonly targetKind: CampaignTargetKind;
  /** Base credit reward. */
  readonly reward: number;
  /**
   * Supply cargo for the requisition run (present only on the DELIVERY step);
   * when set the built quest is a DELIVERY (buy + haul), else an EXPLORATION
   * visit to the target.
   */
  readonly cargo?: { readonly label: string; readonly resource: ResourceType };
  /** Board-card description (RU); `{target}` ⇒ the resolved target system name. */
  readonly describe: (targetName: string) => string;
  /**
   * Milestone predicate — is this step's band crossed? Does NOT check ordering
   * or completion (that is handled centrally by `nextCampaignChainStep`).
   */
  readonly milestone: (
    inputs: CampaignChainInputs,
    config: CampaignChainConfig,
  ) => boolean;
}

/** True once the Overmind has visibly appeared (there is a front to react to). */
function overmindPresent(inputs: CampaignChainInputs): boolean {
  return (
    inputs.overmindShare > 0 ||
    inputs.arcStatus === "advancing" ||
    inputs.arcStatus === "contained"
  );
}

/**
 * The chain, in order. Milestones:
 * 1. distress      — the Overmind has appeared (a front exists).
 * 2. recon         — same band (a follow-up recon of the front).
 * 3. requisition   — same band (the supply run that funds the arm-up).
 * 4. liberation    — the player is battle-ready (armed for the war).
 * 5. counteroffensive — the front has been pushed back (`contained`).
 * 6. core assault  — the Overmind is a remnant (share ≤ core-assault band).
 */
export const CAMPAIGN_CHAIN_STEPS: readonly CampaignChainStep[] = [
  {
    id: `${CAMPAIGN_CHAIN_ID}-1-distress`,
    order: 0,
    title: "Кампания: Сигнал бедствия",
    targetKind: "frontier",
    reward: CAMPAIGN_CHAIN_STEP_REWARDS[0],
    describe: (target) =>
      `С окраинной колонии в системе ${target} рвётся сигнал бедствия: небо над ней ожило и движется само. Это Овермайнд — и он только начал. Пробейтесь к ${target}, пока там ещё есть кого спасать, и узнайте, с чем мы столкнулись.`,
    milestone: (inputs) => overmindPresent(inputs),
  },
  {
    id: `${CAMPAIGN_CHAIN_ID}-2-recon`,
    order: 1,
    title: "Кампания: Разведка фронта",
    targetKind: "frontier",
    reward: CAMPAIGN_CHAIN_STEP_REWARDS[1],
    describe: (target) =>
      `Мы не знаем, как быстро он растёт и где ударит следующим. Слепая оборона — это проигранная оборона. Пройдите вдоль кромки Овермайнда до ${target} и снимите всё: границы, плотность, направление. От этих данных зависят жизни целых систем.`,
    milestone: (inputs) => overmindPresent(inputs),
  },
  {
    id: `${CAMPAIGN_CHAIN_ID}-3-requisition`,
    order: 2,
    title: "Кампания: Реквизиция",
    targetKind: "safe",
    reward: CAMPAIGN_CHAIN_STEP_REWARDS[2],
    cargo: { label: "военные грузы", resource: Resource.METALS },
    describe: (target) =>
      `Голыми руками Овермайнд не остановить — ни нам, ни вам. Возьмите военный груз и доставьте его на тыловую базу в системе ${target}. Платят по-военному щедро: этих денег хватит, чтобы наконец вооружить ваш корабль как следует. Сделайте это — фронту нужен боец, а не курьер.`,
    milestone: (inputs) => overmindPresent(inputs),
  },
  {
    id: `${CAMPAIGN_CHAIN_ID}-4-liberation`,
    order: 3,
    title: "Кампания: Первое освобождение",
    targetKind: "frontier",
    reward: CAMPAIGN_CHAIN_STEP_REWARDS[3],
    describe: (target) =>
      `Теперь вы вооружены — и фронту это известно. В системе ${target} на самой кромке держится последний гарнизон, и он не продержится один. Прорвитесь туда и переломите бой. Одна отбитая система — и легенда о неудержимом Овермайнде даёт трещину.`,
    milestone: (inputs, config) => inputs.peakPower >= config.liberationPower,
  },
  {
    id: `${CAMPAIGN_CHAIN_ID}-5-counteroffensive`,
    order: 4,
    title: "Кампания: Контрнаступление",
    targetKind: "frontier",
    reward: CAMPAIGN_CHAIN_STEP_REWARDS[4],
    describe: (target) =>
      `Впервые за всю войну Овермайнд пятится. Нельзя дать ему выдохнуть. Возглавьте контрудар к системе ${target} и гоните его дальше — каждый отбитый прыжок сейчас стоит десяти завтра.`,
    milestone: (inputs, config) =>
      inputs.peakPower >= config.liberationPower &&
      inputs.arcStatus === "contained",
  },
  {
    id: `${CAMPAIGN_CHAIN_ID}-6-core`,
    order: 5,
    title: "Кампания: Штурм ядра",
    targetKind: "frontier",
    reward: CAMPAIGN_CHAIN_STEP_REWARDS[5],
    describe: (target) =>
      `От империи Овермайнда остались руины — и ядро. Отсюда, из системы ${target}, начинается последний прыжок. Соберите всё, что у вас есть, и идите добивать. Закончите то, ради чего всё это началось.`,
    milestone: (inputs, config) =>
      inputs.peakPower >= config.liberationPower &&
      inputs.overmindShare > 0 &&
      inputs.overmindShare <= config.coreAssaultShare,
  },
];

/** Set of every campaign step id (for fast membership tests). */
export const CAMPAIGN_CHAIN_STEP_IDS: ReadonlySet<string> = new Set(
  CAMPAIGN_CHAIN_STEPS.map((s) => s.id),
);

/** True when `id` is a campaign-chain step id. */
export function isCampaignChainStepId(id: string): boolean {
  return CAMPAIGN_CHAIN_STEP_IDS.has(id);
}

/** The completed step ids, in chain order (from a raw completed-quest list). */
export function completedCampaignSteps(
  completedQuestIds: readonly string[],
): string[] {
  const completed = new Set(completedQuestIds);
  return CAMPAIGN_CHAIN_STEPS.filter((s) => completed.has(s.id)).map(
    (s) => s.id,
  );
}

/**
 * The single campaign step the board should currently offer, or `null` when
 * none is available (chain complete, next milestone not yet reached, or the run
 * already decided). Pure: the same inputs always yield the same step.
 *
 * Guarantees **in order and only in order**: returns the first step that is not
 * yet completed, and only when every earlier step IS completed and its own
 * milestone band is crossed.
 */
export function nextCampaignChainStep(
  inputs: CampaignChainInputs,
  config: CampaignChainConfig = defaultConfig(),
): CampaignChainStep | null {
  // The run is already decided — the chain is moot (the outcome overlay owns it).
  if (inputs.arcStatus === "won" || inputs.arcStatus === "lost") return null;

  const completed = new Set(inputs.completedStepIds);
  const firstIncomplete = CAMPAIGN_CHAIN_STEPS.find(
    (s) => !completed.has(s.id),
  );
  if (!firstIncomplete) return null; // whole chain done

  // Safety: never skip. Every earlier step must be complete (it is, by
  // definition of "first incomplete", but this guards a corrupted-order save).
  const priorAllDone = CAMPAIGN_CHAIN_STEPS.filter(
    (s) => s.order < firstIncomplete.order,
  ).every((s) => completed.has(s.id));
  if (!priorAllDone) return null;

  return firstIncomplete.milestone(inputs, config) ? firstIncomplete : null;
}

/** A resolved target for a campaign step (the offer path picks the system). */
export interface CampaignChainTarget {
  readonly systemId: string;
  readonly systemName: string;
  /** A concrete planet in the system, when one is available. */
  readonly planetId: string | null;
  /** Hyperjumps from the issuing system (0 = local; display only). */
  readonly jumps: number;
}

/**
 * Build the board quest for a campaign step against a resolved target. Reuses an
 * existing `QuestType` completion path so it needs no new engine wiring:
 * - the requisition step (has `cargo`) is a DELIVERY (COLLECT + VISIT);
 * - every other step is an EXPLORATION visit to the target system.
 *
 * The template id is the STABLE step id, so completing the quest lands that id
 * in `questLog.completedQuests` (which the gating predicate reads back) and an
 * already-active/completed step is deduped by the board's own id filter.
 */
export function buildCampaignChainQuest(
  step: CampaignChainStep,
  target: CampaignChainTarget,
  issuerPlanetId: string,
): GeneratedQuest {
  const id = step.id;
  const description = step.describe(target.systemName);
  const experience = Math.round(step.reward * 0.4);

  if (step.cargo) {
    // Requisition run — a DELIVERY that buys and hauls the supply cargo.
    const qty = 10;
    return {
      template: {
        id,
        title: step.title,
        description,
        type: QuestType.DELIVERY,
        objectives: [
          {
            id: `${id}_collect`,
            description: `Загрузить ${step.cargo.label}`,
            type: "COLLECT_ITEM",
            targetAmount: qty,
            itemType: step.cargo.resource,
          },
          {
            id: `${id}_deliver`,
            description: `Доставить в ${target.systemName}`,
            type: "VISIT_LOCATION",
            targetAmount: 1,
            locationId: target.planetId ?? target.systemId,
          },
        ],
        reward: { credits: step.reward, experience, items: [] },
        dialogueAnchors: [],
        deadline: 0,
        failurePenalty: null,
        targetSystemId: target.systemId,
        targetPlanetId: target.planetId,
        targetObjectId: null,
        minReputation: 0,
        minRank: 0,
      },
      targetSystemId: target.systemId,
      targetPlanetId: target.planetId,
      jumps: target.jumps,
      issuerName: "Штаб сопротивления",
      issuerTitle: "Командование",
      targetNpcName: null,
      highlights: [
        { label: "Груз", value: step.cargo.label, color: 0x88ccff },
        { label: "Система", value: target.systemName, color: 0x66ffcc },
        { label: "Кампания", value: "Овермайнд", color: 0xff9966 },
      ],
      issuerPlanetId: issuerPlanetId,
    };
  }

  // A visit to the front — completes as an EXPLORATION quest on system entry.
  return {
    template: {
      id,
      title: step.title,
      description,
      type: QuestType.EXPLORATION,
      objectives: [
        {
          id: `${id}_reach`,
          description: `Прибыть в систему ${target.systemName}`,
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: target.planetId ?? target.systemId,
        },
      ],
      reward: { credits: step.reward, experience, items: [] },
      dialogueAnchors: [],
      deadline: 0,
      failurePenalty: null,
      targetSystemId: target.systemId,
      targetPlanetId: target.planetId,
      targetObjectId: null,
      minReputation: 0,
      minRank: 0,
    },
    targetSystemId: target.systemId,
    targetPlanetId: target.planetId,
    jumps: target.jumps,
    issuerName: "Штаб сопротивления",
    issuerTitle: "Командование",
    targetNpcName: null,
    highlights: [
      { label: "Система", value: target.systemName, color: 0x66ddff },
      { label: "Кампания", value: "Овермайнд", color: 0xff9966 },
    ],
    issuerPlanetId: issuerPlanetId,
  };
}
