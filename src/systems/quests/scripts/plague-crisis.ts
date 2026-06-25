import type { QuestScript } from "../QuestScript";

// Design: A plague-stricken colony, racing against the vaccine's viability.
// A `time` budget drains with every choice; if it hits zero the colony is lost
// (a `critMin` redirect to ending_too_late — the time-pressure spine).
// Choice points:
//   1. The route — the fast asteroid-field shortcut (roll: clean or a costly
//      detour) vs the safe but slow long way around.
//   2. The distribution — triage the salvageable fast, treat EVERYONE (slow,
//      only viable if you arrived early), or hold back doses to profiteer.
// Outcomes:
//   - ending_treat_all (everyone saved in time — big reputation)         SUCCESS
//   - ending_triage    (most saved by triage)                            SUCCESS
//   - ending_profiteer (saved some, but you profited — reputation hit)   SUCCESS
//   - ending_too_late  (vaccine expired, colony devastated)              FAILURE
export const plagueCrisisScript: QuestScript = {
  id: "plague-crisis",
  title: "Эпидемия на колонии",
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
      id: "time",
      name: "Срок годности вакцины",
      min: -9999,
      max: 99,
      initial: 10,
      critMin: 1,
      critTarget: "ending_too_late",
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
  startLocation: "briefing",
  locations: [
    {
      id: "briefing",
      text: "Колония «Заря» гибнет от эпидемии. У вас на борту вакцина, но её срок годности тает.\nЗапас времени: {time}\n\nКаким курсом идти?",
      transitions: [
        {
          id: "fast_route",
          label: "Напрямик через астероидное поле (быстро, опасно)",
          toLocation: "fast_check",
          effects: ["roll = random(0,9)", "time -= 2"],
        },
        {
          id: "safe_route",
          label: "Безопасным курсом в обход (дольше)",
          toLocation: "arrival",
          effects: ["time -= 6"],
        },
      ],
    },
    {
      id: "fast_check",
      text: "Глыбы астероидов проносятся в опасной близости...",
      transitions: [
        {
          id: "fast_clear",
          label: "...",
          toLocation: "arrival",
          condition: "roll >= 3",
          effects: ["time -= 1"],
          autoExecute: true,
        },
        {
          id: "fast_hit",
          label: "...",
          toLocation: "arrival",
          effects: ["time -= 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "arrival",
      text: "Вы садитесь у госпиталя колонии. Запас времени вакцины: {time}. Палаты переполнены.\n\nКак распределить вакцину?",
      transitions: [
        {
          id: "triage",
          label: "Сортировка: спасать тех, кого ещё можно (быстро)",
          toLocation: "ending_triage",
          effects: ["time -= 2", "credits += 1500", "rating += 15"],
        },
        {
          id: "treat_all",
          label: "Лечить всех подряд (медленно, никого не бросая)",
          toLocation: "treat_all_outcome",
          effects: ["time -= 5"],
        },
        {
          id: "profiteer",
          label: "Придержать часть доз для перепродажи (−люди, +кредиты)",
          toLocation: "ending_profiteer",
          effects: ["time -= 2", "credits += 2500", "rating -= 25"],
        },
      ],
    },
    {
      id: "treat_all_outcome",
      text: "Бригады работают без передышки, прививая каждого...",
      transitions: [
        {
          id: "all_saved",
          label: "...",
          toLocation: "ending_treat_all",
          effects: ["credits += 2000", "rating += 30"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_treat_all",
      text: "Вы успели привить всю колонию до последнего часа годности вакцины. Ни одной потерянной жизни — о вас слагают легенды.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_triage",
      text: "Жёсткая сортировка спасла большинство. Кого-то спасти не удалось, но колония выжила.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_profiteer",
      text: "Часть доз ушла на сторону за хорошие деньги. Колония спасена лишь частично, и люди это запомнили.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_too_late",
      text: "Вакцина потеряла силу прежде, чем вы успели её применить. Колония «Заря» опустела. Вы опоздали.\nЗапас времени: {time}",
      isFailure: true,
      transitions: [],
    },
  ],
};
