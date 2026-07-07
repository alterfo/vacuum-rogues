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
      text: "Блокпост {checkpoint} из 3. Из темноты выныривает патрульный крейсер, и прожекторы бьют вам прямо в остекление рубки. В трюме — контрабанда, и таможенный луч уже ползёт по обшивке. По борту скрипит усталый голос: «Приготовьтесь к досмотру».\nЖар подозрения: {heat} | Груз в трюме: {cargo} ед. | На счету: {credits} кр.\n\nЛадони вспотели на штурвале. Как проходим?",
      transitions: [
        {
          id: "bribe",
          label: "Сунуть патрулю на лапу — тихо и надёжно (−150 кр)",
          toLocation: "after_checkpoint",
          effects: ["credits -= 150"],
        },
        {
          id: "bluff",
          label:
            "Держать морду кирпичом и блефовать (даром, но чем выше жар — тем ближе абордаж)",
          toLocation: "bluff_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "dump",
          label:
            "Сбросить два контейнера за борт — чистый трюм, но и оплата тоньше (−2 ед., жар спадёт)",
          toLocation: "dump_done",
          condition: "cargo >= 2",
          effects: ["cargo -= 2", "heat -= 4"],
        },
      ],
    },
    {
      id: "bluff_check",
      text: "Вы не моргаете под белым лучом сканера. Улыбка приклеена к лицу, а сердце колотится о рёбра...",
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
      text: "Таможенник тянет с ответом, щурясь на пляшущие показания сканера. Секунда растягивается в вечность...",
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
      text: "Люк грузового отсека распахивается, и контейнеры уходят в пояс обломков — растворяются среди мусора, не оставив следа. Сканер скользит по опустевшему трюму и не находит ничего запретного. Патруль машет: проходи.",
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
      text: "Прожекторы гаснут за кормой, крейсер отстаёт. Вы выдыхаете, вжимаете тягу на форсаж — и уходите к следующему рубежу.",
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
      text: "Три блокпоста позади. Впереди — тёмный причал точки сброса, где мигает сигнальный маяк заказчика. Его люди уже подгоняют разгрузочный кран, вглядываясь в ваш трюм: {cargo} ед. груза дошло.",
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
      text: "Заказчик пересчитывает уцелевшие контейнеры и отсчитывает кредиты — ровно по тому, что дошло до причала...",
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
      text: "Кран уносит последний контейнер в трюм заказчика, и вам в перчатку ложится пухлая пачка кредитов. Ни одной царапины от таможенных лучей — рейс прошёл чисто. Заказчик коротко кивает: с таким пилотом он будет иметь дело снова.\nНа счету теперь: {credits} кр.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_caught",
      text: "Сканер пронзительно взвыл — луч выхватил запретный груз в трюме. «Глушите двигатели и готовьтесь к стыковке», — цедит таможенник, и абордажные захваты уже лязгают по обшивке. Контрабанда изъята, вы в наручниках. Рейс окончен.",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_nocargo",
      text: "Вы дотянули до причала целым и невредимым — вот только трюм гулко пуст. Весь груз сброшен за борт по дороге, и заказчику нечего грузить. «Ты притащил мне вакуум», — рычит он, разворачиваясь к трапу. Ни кредита, ни второго шанса — сделка сорвана.",
      isFailure: true,
      transitions: [],
    },
  ],
};
