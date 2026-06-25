import type { QuestScript } from "../QuestScript";

// Design: A vault heist on the Hyperion corporate station, with a betrayal branch.
// Two+ meaningful choice points:
//   1. How to get in — bribe an inside contact (costs cr, gains a partner),
//      hack the security grid (roll: clean or loud), or force the airlock (loud).
//   2. What to grab — the full haul (more loot, but louder/slower) vs the data
//      core only (lighter, quieter).
//   3. The exit — meet the partner to split the loot (they may BETRAY you on a
//      roll), double-cross the partner (keep everything, lose reputation), or just
//      slip out. A high alarm level gets you caught regardless.
// Outcomes:
//   - ending_clean         (escaped with the loot)                       SUCCESS
//   - ending_double_cross  (ditched the partner: more loot, −rep)        SUCCESS
//   - ending_betrayed      (partner took the loot and ran)               FAILURE
//   - ending_caught        (alarm too high, security caught you)         FAILURE
export const sabotageHeistScript: QuestScript = {
  id: "sabotage-heist",
  title: "Налёт на хранилище",
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
      id: "rating",
      name: "Репутация",
      min: -9999,
      max: 300,
      initial: 100,
      showInUI: true,
    },
    {
      id: "alarm",
      name: "Тревога",
      min: -9999,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "loot",
      name: "Добыча",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: true,
    },
    {
      id: "partner",
      name: "Напарник",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "crossed",
      name: "Предал напарника",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
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
  startLocation: "approach",
  locations: [
    {
      id: "approach",
      text: "Корпоративная станция «Гиперион». В хранилище — дата-ядро с секретами и кредитный резерв. Сигнализация на взводе.\n\nКак проникнуть внутрь?",
      transitions: [
        {
          id: "bribe_contact",
          label:
            "Подкупить своего человека внутри (−500 кр, появится напарник)",
          toLocation: "inside",
          effects: ["credits -= 500", "partner = 1"],
        },
        {
          id: "hack_grid",
          label: "Взломать сеть охраны (рискованно)",
          toLocation: "hack_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "force_airlock",
          label: "Вскрыть шлюз силой (шумно)",
          toLocation: "inside",
          effects: ["alarm += 4"],
        },
      ],
    },
    {
      id: "hack_check",
      text: "Ваш взлом пробивается через слои защиты...",
      transitions: [
        {
          id: "hack_clean",
          label: "...",
          toLocation: "inside",
          condition: "roll >= 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "hack_loud",
          label: "...",
          toLocation: "inside",
          effects: ["alarm += 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "inside",
      text: "Вы внутри хранилища. На стеллажах — дата-ядро и кейсы с кредитами.\nТревога: {alarm}\n\nЧто забрать?",
      transitions: [
        {
          id: "grab_all",
          label: "Забрать всё: дата-ядро и кредитный резерв (шумно, медленно)",
          toLocation: "escape_decision",
          effects: ["loot += 5", "alarm += 3"],
        },
        {
          id: "grab_core",
          label: "Взять только дата-ядро (легче и тише)",
          toLocation: "escape_decision",
          effects: ["loot += 3"],
        },
      ],
    },
    {
      id: "escape_decision",
      text: "Добыча у вас. Пора уходить.\nТревога: {alarm} | Добыча: {loot}\n\nКак выбираться?",
      transitions: [
        {
          id: "meet_partner",
          label: "Встретиться с напарником и поделить добычу",
          toLocation: "partner_meet",
          condition: "partner == 1",
          effects: [],
        },
        {
          id: "double_cross",
          label: "Кинуть напарника — забрать всё себе",
          toLocation: "escape_gate",
          condition: "partner == 1",
          effects: ["crossed = 1", "rating -= 20"],
        },
        {
          id: "slip_out",
          label: "Тихо уйти тем же путём",
          toLocation: "escape_gate",
          effects: [],
        },
      ],
    },
    {
      id: "partner_meet",
      text: "Напарник ждёт у грузового челнока с заведённым двигателем. «Всё чисто? Давай делить».",
      transitions: [
        {
          id: "trust_partner",
          label: "Передать добычу для дележа",
          toLocation: "trust_check",
          effects: ["roll = random(0,9)"],
        },
      ],
    },
    {
      id: "trust_check",
      text: "Напарник принимает кейсы и поворачивается к люку...",
      transitions: [
        {
          id: "betrayed",
          label: "...",
          toLocation: "ending_betrayed",
          condition: "roll <= 3",
          effects: ["loot = 0", "rating -= 10"],
          autoExecute: true,
        },
        {
          id: "honored",
          label: "...",
          toLocation: "escape_gate",
          effects: ["loot -= 1", "rating += 10"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "escape_gate",
      text: "Вы рвётесь к выходу...",
      transitions: [
        {
          id: "caught",
          label: "...",
          toLocation: "ending_caught",
          condition: "alarm >= 6",
          effects: [],
          autoExecute: true,
        },
        {
          id: "clear",
          label: "...",
          toLocation: "payout_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "payout_gate",
      text: "Скупщик оценивает добычу...",
      transitions: [
        {
          id: "pay_big",
          label: "...",
          toLocation: "disposition_gate",
          condition: "loot >= 5",
          effects: ["credits += 4000"],
          autoExecute: true,
        },
        {
          id: "pay_mid",
          label: "...",
          toLocation: "disposition_gate",
          condition: "loot >= 3",
          effects: ["credits += 2500"],
          autoExecute: true,
        },
        {
          id: "pay_small",
          label: "...",
          toLocation: "disposition_gate",
          effects: ["credits += 1000"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "disposition_gate",
      text: "Дело сделано...",
      transitions: [
        {
          id: "was_crossed",
          label: "...",
          toLocation: "ending_double_cross",
          condition: "crossed == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "clean_exit",
          label: "...",
          toLocation: "ending_clean",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_clean",
      text: "Вы растворяетесь в потоке кораблей с добычей на борту. Чистая работа.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_double_cross",
      text: "Напарник остался у пустого челнока, а вся добыча — у вас. Денег больше, но в преступном мире о вас теперь дурная молва.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_betrayed",
      text: "Напарник захлопывает люк челнока прямо перед вами и уходит со всей добычей. Вас провели.\nКредиты: {credits} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_caught",
      text: "Сигнализация воет на всю станцию. Охрана блокирует шлюзы и берёт вас с поличным. Налёт провален.\nТревога: {alarm}",
      isFailure: true,
      transitions: [],
    },
  ],
};
