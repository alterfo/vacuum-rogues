import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { OvermindStatus, ResourceType } from "@/types";
import { QuestType, ResourceType as Resource } from "@/types";
import {
  CAMPAIGN_CHAIN_LIBERATION_POWER,
  CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE,
  CAMPAIGN_CHAIN_STEP_REWARDS,
} from "@/config/balance";

export const CAMPAIGN_CHAIN_ID = "campaign-overmind";

export type CampaignTargetKind = "frontier" | "safe";

export interface CampaignChainInputs {
  readonly completedStepIds: readonly string[];
  readonly overmindShare: number;
  readonly peakPower: number;
  readonly arcStatus: OvermindStatus;
}

export interface CampaignChainConfig {
  readonly liberationPower: number;
  readonly coreAssaultShare: number;
}

function defaultConfig(): CampaignChainConfig {
  return {
    liberationPower: CAMPAIGN_CHAIN_LIBERATION_POWER,
    coreAssaultShare: CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE,
  };
}

export interface CampaignChainStep {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly targetKind: CampaignTargetKind;
  readonly reward: number;
  readonly cargo?: { readonly label: string; readonly resource: ResourceType };
  readonly describe: (targetName: string) => string;
  readonly milestone: (
    inputs: CampaignChainInputs,
    config: CampaignChainConfig,
  ) => boolean;
}

function overmindPresent(inputs: CampaignChainInputs): boolean {
  return (
    inputs.overmindShare > 0 ||
    inputs.arcStatus === "advancing" ||
    inputs.arcStatus === "contained"
  );
}

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

export const CAMPAIGN_CHAIN_STEP_IDS: ReadonlySet<string> = new Set(
  CAMPAIGN_CHAIN_STEPS.map((s) => s.id),
);

export function isCampaignChainStepId(id: string): boolean {
  return CAMPAIGN_CHAIN_STEP_IDS.has(id);
}

export function completedCampaignSteps(
  completedQuestIds: readonly string[],
): string[] {
  const completed = new Set(completedQuestIds);
  return CAMPAIGN_CHAIN_STEPS.filter((s) => completed.has(s.id)).map(
    (s) => s.id,
  );
}

export function nextCampaignChainStep(
  inputs: CampaignChainInputs,
  config: CampaignChainConfig = defaultConfig(),
): CampaignChainStep | null {
  if (inputs.arcStatus === "won" || inputs.arcStatus === "lost") return null;

  const completed = new Set(inputs.completedStepIds);
  const firstIncomplete = CAMPAIGN_CHAIN_STEPS.find(
    (s) => !completed.has(s.id),
  );
  if (!firstIncomplete) return null; // whole chain done

  const priorAllDone = CAMPAIGN_CHAIN_STEPS.filter(
    (s) => s.order < firstIncomplete.order,
  ).every((s) => completed.has(s.id));
  if (!priorAllDone) return null;

  return firstIncomplete.milestone(inputs, config) ? firstIncomplete : null;
}

export interface CampaignChainTarget {
  readonly systemId: string;
  readonly systemName: string;
  readonly planetId: string | null;
  readonly jumps: number;
}

export function buildCampaignChainQuest(
  step: CampaignChainStep,
  target: CampaignChainTarget,
  issuerPlanetId: string,
): GeneratedQuest {
  const id = step.id;
  const description = step.describe(target.systemName);
  const experience = Math.round(step.reward * 0.4);

  if (step.cargo) {
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
