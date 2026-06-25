import type { QuestScript } from "../QuestScript";

// Design: A smuggling gauntlet from the smuggler's side. Run contraband past 3
// blockade checkpoints, then deliver to the buyer. At each checkpoint pick:
//   - bribe  : pay 150 cr, pass clean (safe, expensive)
//   - bluff  : free, but risky — high heat or a bad roll gets you caught
//   - dump   : jettison 2 units of cargo to cool off (less payout)
// Heat rises when you bluff; bribing keeps it down. Final payout scales with how
// much cargo survives. Outcomes:
//   - quest_success         (delivered, paid)                 SUCCESS
//   - quest_failure_caught  (busted at a checkpoint)          FAILURE
//   - quest_failure_nocargo (arrived empty-handed)            FAILURE
export const smugglingRunScript: QuestScript = {
  id: "smuggling-run",
  title: "Контрабандный рейс",
  params: [
    {
      id: "credits",
      name: "Кредиты",
      min: -9999,
      max: 99999,
      initial: 0,
      showInUI: true,
    },
    {
      id: "heat",
      name: "Жар",
      min: -9999,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "cargo",
      name: "Груз",
      min: 0,
      max: 6,
      initial: 6,
      showInUI: true,
    },
    {
      id: "checkpoint",
      name: "Блокпост",
      min: 1,
      max: 4,
      initial: 1,
      critMax: 3,
      critTarget: "arrival",
      showInUI: true,
    },
    {
      id: "roll",
      name: "Бросок",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "checkpoint_decision",
  locations: [
    {
      id: "checkpoint_decision",
      text: "Блокпост {checkpoint}/3 на трассе. Патрульный сканер прогревается.\nЖар: {heat} | Груз: {cargo} | Кредиты: {credits}\n\nКак пройти?",
      transitions: [
        {
          id: "bribe",
          label: "Подкупить патруль (−150 кр)",
          toLocation: "after_checkpoint",
          effects: ["credits -= 150"],
        },
        {
          id: "bluff",
          label: "Блефовать (бесплатно, рискованно)",
          toLocation: "bluff_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "dump",
          label: "Сбросить часть груза (−2 ед., остудить жар)",
          toLocation: "dump_done",
          condition: "cargo >= 2",
          effects: ["cargo -= 2", "heat -= 4"],
        },
      ],
    },
    {
      id: "bluff_check",
      text: "Вы держитесь невозмутимо под лучом сканера...",
      transitions: [
        {
          id: "bluff_hot",
          label: "...",
          toLocation: "quest_failure_caught",
          condition: "heat >= 6",
          effects: [],
          autoExecute: true,
        },
        {
          id: "bluff_risky",
          label: "...",
          toLocation: "bluff_roll_check",
          condition: "heat >= 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "bluff_safe",
          label: "...",
          toLocation: "after_checkpoint",
          effects: ["heat += 2"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "bluff_roll_check",
      text: "Патрульный щурится на показания...",
      transitions: [
        {
          id: "roll_caught",
          label: "...",
          toLocation: "quest_failure_caught",
          condition: "roll <= 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "roll_pass",
          label: "...",
          toLocation: "after_checkpoint",
          effects: ["heat += 3"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "dump_done",
      text: "Вы сбрасываете контейнеры в пояс обломков. Сканер видит чистый трюм.",
      transitions: [
        {
          id: "dump_continue",
          label: "...",
          toLocation: "after_checkpoint",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "after_checkpoint",
      text: "Блокпост позади. Двигатели на форсаж.",
      transitions: [
        {
          id: "advance",
          label: "...",
          toLocation: "checkpoint_decision",
          effects: ["checkpoint += 1"],
          autoExecute: true,
        },
      ],
    },
    // Reached via checkpoint critMax (>3).
    {
      id: "arrival",
      text: "Точка сброса. Заказчик ждёт груз — {cargo} ед.",
      transitions: [
        {
          id: "deliver",
          label: "...",
          // Reset checkpoint below critMax so the crit redirect stops firing
          // (otherwise it would bounce payout_gate back to arrival every step).
          toLocation: "payout_gate",
          effects: ["checkpoint = 0"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "payout_gate",
      text: "Подсчёт оплаты...",
      transitions: [
        {
          id: "pay_full",
          label: "...",
          toLocation: "quest_success",
          condition: "cargo >= 5",
          effects: ["credits += 3000"],
          autoExecute: true,
        },
        {
          id: "pay_high",
          label: "...",
          toLocation: "quest_success",
          condition: "cargo >= 3",
          effects: ["credits += 2000"],
          autoExecute: true,
        },
        {
          id: "pay_mid",
          label: "...",
          toLocation: "quest_success",
          condition: "cargo >= 1",
          effects: ["credits += 1000"],
          autoExecute: true,
        },
        {
          id: "pay_none",
          label: "...",
          toLocation: "quest_failure_nocargo",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "quest_success",
      text: "Груз доставлен, заказчик расплатился. Чистая работа.\nИтоговые кредиты: {credits}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_caught",
      text: "Сканер поймал контрабанду. Патруль берёт вас на абордаж — рейс окончен.",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_nocargo",
      text: "Вы добрались до точки, но трюм пуст — сбросили весь груз. Заказчик в ярости, сделка сорвана.",
      isFailure: true,
      transitions: [],
    },
  ],
};
