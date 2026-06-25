import type { QuestScript } from "../QuestScript";

// Design: Pirates hold 4 hostages on station «Терновник». Pick an approach:
//   - pay_ransom : pay 2000 cr, then trust the pirates (a roll decides honor)
//   - stealth    : sneak in (roll-based) or work methodically (slow but sure)
//   - assault    : storm the station; outcome scales with the guard count.
//                  Sniping first removes 2 guards, guaranteeing a clean assault.
// `guards` is randomised 2–4, so the raw assault outcome varies by seed.
// Outcomes (credits = bounty, rating = reputation, hostages = survivors):
//   - ending_ransom_good        all freed, money gone, small rep      SUCCESS
//   - ending_ransom_betrayed    pirates renege, hostages die          FAILURE
//   - ending_stealth_clean      all freed quietly, big bounty + rep   SUCCESS
//   - ending_stealth_partial    spotted, grabbed 2, modest reward     SUCCESS
//   - ending_stealth_methodical all freed slowly, solid reward        SUCCESS
//   - ending_assault_clean      all freed, big bounty + rep           SUCCESS
//   - ending_assault_costly     2 lost, some bounty, rep hit          SUCCESS
//   - ending_assault_fail       assault collapses, hostages die       FAILURE
export const hostageRescueScript: QuestScript = {
  id: "hostage-rescue",
  title: "Спасение заложников",
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
      id: "hostages",
      name: "Заложники",
      min: 0,
      max: 4,
      initial: 4,
      showInUI: true,
    },
    {
      id: "guards",
      name: "Охрана",
      min: 2,
      max: 4,
      initial: "random",
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
  startLocation: "briefing",
  locations: [
    {
      id: "briefing",
      text: "Пираты захватили 4 заложников на станции «Терновник». Главарь требует выкуп, флот требует результата.\nЗаложники: {hostages} | Репутация: {rating}\n\nВаш план?",
      transitions: [
        {
          id: "pay_ransom",
          label: "Заплатить выкуп (−2000 кр)",
          toLocation: "ransom_path",
          effects: ["credits -= 2000"],
        },
        {
          id: "stealth",
          label: "Тихое проникновение",
          toLocation: "stealth_approach",
          effects: [],
        },
        {
          id: "assault",
          label: "Силовой штурм",
          toLocation: "assault_prep",
          effects: [],
        },
      ],
    },
    // ── RANSOM ─────────────────────────────────────────────────────────────
    {
      id: "ransom_path",
      text: "Вы переводите выкуп — 2000 кр. Главарь выходит на связь: «Договорились, рейнджер». Но пиратам нельзя верить.",
      transitions: [
        {
          id: "trust",
          label: "Ждать освобождения заложников",
          toLocation: "ransom_outcome",
          effects: ["roll = random(0,9)"],
        },
      ],
    },
    {
      id: "ransom_outcome",
      text: "Шлюз станции начинает открываться...",
      transitions: [
        {
          id: "honored",
          label: "...",
          toLocation: "ending_ransom_good",
          condition: "roll >= 4",
          effects: ["rating += 10"],
          autoExecute: true,
        },
        {
          id: "betrayed",
          label: "...",
          toLocation: "ending_ransom_betrayed",
          effects: ["hostages -= 4"],
          autoExecute: true,
        },
      ],
    },
    // ── STEALTH ────────────────────────────────────────────────────────────
    {
      id: "stealth_approach",
      text: "Вы проникаете через грузовой шлюз. Впереди пост охраны и коридор к камерам.",
      transitions: [
        {
          id: "sneak",
          label: "Прокрасться мимо охраны (рискованно)",
          toLocation: "stealth_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "methodical",
          label: "Действовать методично: отключить камеры, выводить по одному",
          toLocation: "ending_stealth_methodical",
          effects: ["credits += 1500", "rating += 20"],
        },
      ],
    },
    {
      id: "stealth_check",
      text: "Вы скользите вдоль переборки за спиной часового...",
      transitions: [
        {
          id: "sneak_clean",
          label: "...",
          toLocation: "ending_stealth_clean",
          condition: "roll >= 3",
          effects: ["rating += 30", "credits += 3000"],
          autoExecute: true,
        },
        {
          id: "sneak_spotted",
          label: "...",
          toLocation: "ending_stealth_partial",
          effects: ["hostages -= 2", "credits += 1000", "rating += 5"],
          autoExecute: true,
        },
      ],
    },
    // ── ASSAULT ────────────────────────────────────────────────────────────
    {
      id: "assault_prep",
      text: "Вы готовите штурм. Часовых на станции: {guards}. Это будет кроваво.",
      transitions: [
        {
          id: "breach_loud",
          label: "Идти на пролом",
          toLocation: "assault_check",
          effects: [],
        },
        {
          id: "snipe_first",
          label: "Сначала снять двоих снайпером",
          toLocation: "assault_snipe",
          effects: ["guards -= 2"],
        },
      ],
    },
    {
      id: "assault_snipe",
      text: "Снайпер бесшумно снимает двоих часовых. Осталось: {guards}.",
      transitions: [
        {
          id: "now_breach",
          label: "Теперь — на штурм",
          toLocation: "assault_check",
          effects: [],
        },
      ],
    },
    {
      id: "assault_check",
      text: "Двери вышибаются, начинается бой...",
      transitions: [
        {
          id: "asn_fail",
          label: "...",
          toLocation: "ending_assault_fail",
          condition: "guards >= 4",
          effects: ["hostages -= 4", "rating -= 30"],
          autoExecute: true,
        },
        {
          id: "asn_costly",
          label: "...",
          toLocation: "ending_assault_costly",
          condition: "guards >= 3",
          effects: ["hostages -= 2", "rating -= 10", "credits += 1500"],
          autoExecute: true,
        },
        {
          id: "asn_clean",
          label: "...",
          toLocation: "ending_assault_clean",
          effects: ["rating += 25", "credits += 3500"],
          autoExecute: true,
        },
      ],
    },
    // ── TERMINALS ──────────────────────────────────────────────────────────
    {
      id: "ending_ransom_good",
      text: "Пираты сдержали слово — все заложники освобождены. Денег нет, но люди живы, и репутация чуть выросла.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_ransom_betrayed",
      text: "Главарь забирает выкуп и подрывает шлюз. Заложники погибли, а вы остались ни с чем.\nЗаложники: {hostages} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_stealth_clean",
      text: "Вы вывели всех заложников, не подняв тревоги. Флот щедро вознаграждает чистую работу.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_stealth_partial",
      text: "Вас засекли. В перестрелке удалось вытащить лишь двоих и уйти. Награда скромная.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_stealth_methodical",
      text: "Медленно, но без единого выстрела вы вывели всех заложников. Надёжная работа.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_assault_clean",
      text: "Штурм прошёл молниеносно — охрана повержена, все заложники спасены. Крупная премия.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_assault_costly",
      text: "Бой был тяжёлым: двое заложников погибли в перестрелке. Задание выполнено, но цена велика.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_assault_fail",
      text: "Охраны оказалось слишком много. Штурм захлебнулся, заложники погибли. Провал.\nЗаложники: {hostages} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
  ],
};
