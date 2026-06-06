import type { TextQuest } from "@/types";

// ---------------------------------------------------------------------------
// Sample quest: "Тайный груз" — logical puzzle about a secret cargo manifest.
// Three nodes, two fail branches, one success branch.
// ---------------------------------------------------------------------------

const secretCargoQuest: TextQuest = {
  id: "text_quest_secret_cargo",
  title: "Тайный груз",
  startNodeId: "sc_intro",
  nodes: [
    {
      id: "sc_intro",
      textKey: "secret_cargo.intro",
      choices: [
        {
          label: "Взять груз — это мои деньги",
          conditions: [],
          nextNodeId: "sc_dilemma",
          outcome: null,
        },
        {
          label: "Отказаться — слишком рискованно",
          conditions: [],
          nextNodeId: "sc_refuse",
          outcome: null,
        },
      ],
    },
    {
      id: "sc_dilemma",
      textKey: "secret_cargo.dilemma",
      choices: [
        {
          label: "Вскрыть контейнер и проверить содержимое",
          conditions: [],
          nextNodeId: "sc_inspect",
          outcome: null,
        },
        {
          label: "Доставить не проверяя — так безопаснее",
          conditions: [],
          nextNodeId: "sc_deliver",
          outcome: null,
        },
      ],
    },
    {
      id: "sc_inspect",
      textKey: "secret_cargo.inspect",
      choices: [
        {
          label: "Сдать груз властям",
          conditions: [],
          nextNodeId: null,
          outcome: {
            creditsDelta: 0,
            reputationDelta: 15,
            factionId: "BASTIONS",
            journalEntry:
              "Сдал нелегальный груз властям. Репутация с Бастионами выросла.",
          },
        },
        {
          label: "Оставить себе и перепродать",
          conditions: [{ type: "credits", comparison: ">=", value: 200 }],
          nextNodeId: null,
          outcome: {
            creditsDelta: 500,
            reputationDelta: -10,
            factionId: "BASTIONS",
            itemGained: "ARTIFACTS",
            journalEntry: "Перепродал контрабанду. Прибыль: 500₡.",
          },
        },
      ],
    },
    {
      id: "sc_deliver",
      textKey: "secret_cargo.deliver",
      choices: [
        {
          label: "Забрать награду и уйти",
          conditions: [],
          nextNodeId: null,
          outcome: {
            creditsDelta: 800,
            reputationDelta: 0,
            journalEntry: "Доставил груз без вопросов. Получил 800₡.",
          },
        },
      ],
    },
    {
      id: "sc_refuse",
      textKey: "secret_cargo.refuse",
      choices: [
        {
          label: "Уйти",
          conditions: [],
          nextNodeId: null,
          outcome: {
            creditsDelta: 0,
            reputationDelta: 0,
            journalEntry: "Отказался от сомнительного предложения.",
          },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Sample quest: "Дрейфующий корабль" — atmospheric, branching moral choice.
// Four nodes with a moral dilemma at its core.
// ---------------------------------------------------------------------------

const driftingShipQuest: TextQuest = {
  id: "text_quest_drifting_ship",
  title: "Дрейфующий корабль",
  startNodeId: "ds_scan",
  nodes: [
    {
      id: "ds_scan",
      textKey: "drifting_ship.scan",
      choices: [
        {
          label: "Пристыковаться и осмотреть корабль",
          conditions: [],
          nextNodeId: "ds_board",
          outcome: null,
        },
        {
          label: "Передать координаты в службу спасения и лететь дальше",
          conditions: [],
          nextNodeId: "ds_report",
          outcome: null,
        },
      ],
    },
    {
      id: "ds_board",
      textKey: "drifting_ship.board",
      choices: [
        {
          label: "Спасти выжившего — взять на борт",
          conditions: [],
          nextNodeId: "ds_rescue",
          outcome: null,
        },
        {
          label: "Забрать груз с брошенного судна",
          conditions: [],
          nextNodeId: "ds_loot",
          outcome: null,
        },
      ],
    },
    {
      id: "ds_rescue",
      textKey: "drifting_ship.rescue",
      choices: [
        {
          label: "Доставить выжившего на ближайшую станцию",
          conditions: [],
          nextNodeId: null,
          outcome: {
            creditsDelta: 300,
            reputationDelta: 20,
            factionId: "OUTLANDERS",
            journalEntry:
              "Спас выжившего и доставил его на станцию. +20 к репутации Аутсайдеров.",
          },
        },
      ],
    },
    {
      id: "ds_loot",
      textKey: "drifting_ship.loot",
      choices: [
        {
          label: "Взять всё ценное и улететь",
          conditions: [],
          nextNodeId: null,
          outcome: {
            creditsDelta: 600,
            reputationDelta: -15,
            factionId: "OUTLANDERS",
            itemGained: "ELECTRONICS",
            journalEntry:
              "Мародёрствовал на дрейфующем корабле. Получил электронику и 600₡.",
          },
        },
      ],
    },
    {
      id: "ds_report",
      textKey: "drifting_ship.report",
      choices: [
        {
          label: "Продолжить маршрут",
          conditions: [],
          nextNodeId: null,
          outcome: {
            creditsDelta: 100,
            reputationDelta: 5,
            factionId: "BASTIONS",
            journalEntry:
              "Сообщил о дрейфующем корабле. Небольшое вознаграждение от патруля.",
          },
        },
      ],
    },
  ],
};

export const SAMPLE_TEXT_QUESTS: TextQuest[] = [
  secretCargoQuest,
  driftingShipQuest,
];

export function getTextQuestById(id: string): TextQuest | undefined {
  return SAMPLE_TEXT_QUESTS.find((q) => q.id === id);
}
