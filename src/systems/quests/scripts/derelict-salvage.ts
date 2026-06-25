import type { QuestScript } from "../QuestScript";

// Design: Salvage mystery aboard the drifting freighter «Морвен».
// Two meaningful choice points:
//   1. How to board — dock carefully (full cargo) vs force a breach (damaged cargo).
//   2. What to do in the hold — seal the dangerous bio-container vs extract the
//      bio-sample for extra credits but at the risk of an outbreak.
//   3. Final disposition — report to authorities vs sell on the black market.
// Outcomes:
//   - ending_report          (clean report, +rep, official bounty)        SUCCESS
//   - ending_sample_seized   (reported with the sample → confiscated+fine) SUCCESS
//   - ending_blackmarket     (sold the haul, more credits, −rep)          SUCCESS
//   - ending_outbreak        (sold the bio-sample → spores escape)        FAILURE
export const derelictSalvageScript: QuestScript = {
  id: "derelict-salvage",
  title: "Дрейфующий сухогруз",
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
      id: "forced",
      name: "Грубый вход",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "sample",
      name: "Биообразец",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "sealed",
      name: "Загерметизировано",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "approach",
  locations: [
    {
      id: "approach",
      text: "Дрейфующий сухогруз «Морвен» молчит на всех частотах. Стыковочный узел цел, но можно войти и быстрее.\n\nКак подняться на борт?",
      transitions: [
        {
          id: "dock_careful",
          label: "Состыковаться через шлюз (аккуратно)",
          toLocation: "bridge",
          effects: [],
        },
        {
          id: "force_entry",
          label: "Прожечь переборку (быстро, грубо)",
          toLocation: "breach",
          effects: ["forced = 1"],
        },
      ],
    },
    {
      id: "bridge",
      text: "Мостик «Морвена». Бортжурнал обрывается на полуслове: «...оно вырвалось из стазиса, все в трюм...». Экипажа нигде нет.",
      transitions: [
        {
          id: "explore_hold_b",
          label: "Спуститься в трюм",
          toLocation: "hold_inspect",
          effects: [],
        },
        {
          id: "go_cargo_b",
          label: "Сразу к грузовому отсеку",
          toLocation: "cargo_gate",
          effects: [],
        },
      ],
    },
    {
      id: "breach",
      text: "Вы вваливаетесь внутрь сквозь оплавленную переборку. Корабль мёртв и тих. Воздух спёртый, времени в обрез.",
      transitions: [
        {
          id: "explore_hold_c",
          label: "Осмотреть трюм",
          toLocation: "hold_inspect",
          effects: [],
        },
        {
          id: "go_cargo_c",
          label: "К грузовому отсеку",
          toLocation: "cargo_gate",
          effects: [],
        },
      ],
    },
    {
      id: "hold_inspect",
      text: "В трюме — треснувший стазис-контейнер с биообразцом. Внутри что-то медленно шевелится. Споры пока спят, но трещина растёт.",
      transitions: [
        {
          id: "seal_it",
          label: "Загерметизировать контейнер",
          toLocation: "cargo_gate",
          effects: ["sealed = 1"],
        },
        {
          id: "take_sample",
          label: "Извлечь биообразец (ценный, но опасный)",
          toLocation: "cargo_gate",
          effects: ["sample = 1", "credits += 1000"],
        },
      ],
    },
    // Cargo condition depends on how we boarded.
    {
      id: "cargo_gate",
      text: "Путь к грузовому отсеку...",
      transitions: [
        {
          id: "cg_damaged",
          label: "...",
          toLocation: "cargo_damaged",
          condition: "forced == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "cg_full",
          label: "...",
          toLocation: "cargo_full",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "cargo_full",
      text: "Грузовой отсек цел. Контейнеры с редкими сплавами — отличная добыча.",
      transitions: [
        {
          id: "load_full",
          label: "Забрать груз",
          toLocation: "final_decision",
          effects: ["credits += 3000"],
        },
      ],
    },
    {
      id: "cargo_damaged",
      text: "Грубый вход повредил часть контейнеров. Уцелело меньше половины груза.",
      transitions: [
        {
          id: "load_damaged",
          label: "Забрать уцелевший груз",
          toLocation: "final_decision",
          effects: ["credits += 2000"],
        },
      ],
    },
    {
      id: "final_decision",
      text: "Добыча в трюме. Кредиты: {credits}.\n\nЧто делать с находкой?",
      transitions: [
        {
          id: "report",
          label: "Сдать властям (официальная премия)",
          toLocation: "report_gate",
          effects: [],
        },
        {
          id: "blackmarket",
          label: "Сбыть на чёрном рынке",
          toLocation: "blackmarket_gate",
          effects: [],
        },
      ],
    },
    {
      id: "report_gate",
      text: "Вы стыкуетесь со станцией флота...",
      transitions: [
        {
          id: "rg_seized",
          label: "...",
          toLocation: "ending_sample_seized",
          condition: "sample == 1",
          effects: ["credits -= 500"],
          autoExecute: true,
        },
        {
          id: "rg_clean",
          label: "...",
          toLocation: "ending_report",
          effects: ["credits += 1000", "rating += 40"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "blackmarket_gate",
      text: "Тёмный док на окраине системы...",
      transitions: [
        {
          id: "bg_outbreak",
          label: "...",
          toLocation: "ending_outbreak",
          condition: "sample == 1",
          effects: ["rating -= 60"],
          autoExecute: true,
        },
        {
          id: "bg_sold",
          label: "...",
          toLocation: "ending_blackmarket",
          effects: ["credits += 2500", "rating -= 30"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_report",
      text: "Флот благодарит вас за честность и находку. Официальная премия зачислена, репутация выросла.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_sample_seized",
      text: "Карантинная служба изымает биообразец и выписывает штраф за его транспортировку. Но в целом — дело закрыто.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_blackmarket",
      text: "Скупщик расплачивается без лишних вопросов. Денег больше, но за вами теперь дурная слава.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_outbreak",
      text: "Биообразец вырывается на свободу прямо на чёрном рынке. Вспышка заражения, карантин, ваше имя в розыске.\nКатастрофа. Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
  ],
};
