import type { QuestScript } from "../QuestScript";

// Дизайн: Учёный-Фэянин просит доставить зонд через систему с 4 гравитационными
// объектами к финишной точке. Топлива — 100 ед. Прямой перелёт между соседними
// секторами стоит 26 ед. Гравитационный манёвр (диагональный прыжок через 2 сектора):
// бесплатно если «окно» открыто (=1), −40 ед. если закрыто (=0 — промахнулся).
// Нужно прибыть в C3 с ≥10 ед. топлива. Прямой маршрут (4 хода × 26 = 104) невозможен.
// Оптимальная стратегия зависит от seed — разные окна открыты при разных seed.
//
// Сетка 3×3:
//   A1 → A2 → A3
//    ↓    ↓    ↓
//   B1 → B2 → B3
//    ↓    ↓    ↓
//   C1 → C2 → C3 (финиш)
//
// Гравитационные объекты (диагональные прыжки):
//   Obj-1: A1 → B2  (window_1)
//   Obj-2: A2 → B3  (window_2)
//   Obj-3: B1 → C2  (window_3)
//   Obj-4: B2 → C3  (window_4)
export const gravitySlalomScript: QuestScript = {
  id: "gravity-slalom",
  title: "Гравитационный слалом",
  params: [
    {
      id: "fuel",
      name: "Топливо",
      min: 0,
      max: 100,
      initial: 100,
      critMin: 1,
      critTarget: "quest_failure_fuel",
      showInUI: true,
    },
    {
      id: "window_1",
      name: "Окно Obj-1 (A1→B2)",
      min: 0,
      max: 1,
      initial: "random",
      showInUI: true,
    },
    {
      id: "window_2",
      name: "Окно Obj-2 (A2→B3)",
      min: 0,
      max: 1,
      initial: "random",
      showInUI: true,
    },
    {
      id: "window_3",
      name: "Окно Obj-3 (B1→C2)",
      min: 0,
      max: 1,
      initial: "random",
      showInUI: true,
    },
    {
      id: "window_4",
      name: "Окно Obj-4 (B2→C3)",
      min: 0,
      max: 1,
      initial: "random",
      showInUI: true,
    },
  ],
  startLocation: "cell_a1",
  locations: [
    // --- Row A ---
    {
      id: "cell_a1",
      text: "Сектор A-1 — точка старта. Зонд готов.\nТопливо: {fuel} ед.\nОкно Obj-1 (A1→B2): {window_1}/1   Окно Obj-4 (B2→C3): {window_4}/1\n\nВыберите курс:",
      transitions: [
        {
          id: "a1_to_a2",
          label: "Прямой перелёт → A2 (−26 топлива)",
          toLocation: "cell_a2",
          effects: ["fuel -= 26"],
        },
        {
          id: "a1_to_b1",
          label: "Прямой перелёт ↓ B1 (−26 топлива)",
          toLocation: "cell_b1",
          effects: ["fuel -= 26"],
        },
        {
          id: "a1_grav1_open",
          label: "Гравитационный манёвр через Obj-1 → B2 (бесплатно!)",
          toLocation: "cell_b2",
          condition: "window_1 == 1",
          effects: [],
        },
        {
          id: "a1_grav1_closed",
          label:
            "Гравитационный манёвр через Obj-1 → B2 (−40 топлива, окно закрыто)",
          toLocation: "cell_b2",
          condition: "window_1 == 0",
          effects: ["fuel -= 40"],
        },
      ],
    },
    {
      id: "cell_a2",
      text: "Сектор A-2. Топливо: {fuel} ед.\nОкно Obj-2 (A2→B3): {window_2}/1\n\nВыберите курс:",
      transitions: [
        {
          id: "a2_to_a3",
          label: "Прямой перелёт → A3 (−26 топлива)",
          toLocation: "cell_a3",
          effects: ["fuel -= 26"],
        },
        {
          id: "a2_to_b2",
          label: "Прямой перелёт ↓ B2 (−26 топлива)",
          toLocation: "cell_b2",
          effects: ["fuel -= 26"],
        },
        {
          id: "a2_grav2_open",
          label: "Гравитационный манёвр через Obj-2 → B3 (бесплатно!)",
          toLocation: "cell_b3",
          condition: "window_2 == 1",
          effects: [],
        },
        {
          id: "a2_grav2_closed",
          label:
            "Гравитационный манёвр через Obj-2 → B3 (−40 топлива, окно закрыто)",
          toLocation: "cell_b3",
          condition: "window_2 == 0",
          effects: ["fuel -= 40"],
        },
      ],
    },
    {
      id: "cell_a3",
      text: "Сектор A-3. Топливо: {fuel} ед.\nВыберите курс:",
      transitions: [
        {
          id: "a3_to_b3",
          label: "Прямой перелёт ↓ B3 (−26 топлива)",
          toLocation: "cell_b3",
          effects: ["fuel -= 26"],
        },
      ],
    },
    // --- Row B ---
    {
      id: "cell_b1",
      text: "Сектор B-1. Топливо: {fuel} ед.\nОкно Obj-3 (B1→C2): {window_3}/1\n\nВыберите курс:",
      transitions: [
        {
          id: "b1_to_b2",
          label: "Прямой перелёт → B2 (−26 топлива)",
          toLocation: "cell_b2",
          effects: ["fuel -= 26"],
        },
        {
          id: "b1_to_c1",
          label: "Прямой перелёт ↓ C1 (−26 топлива)",
          toLocation: "cell_c1",
          effects: ["fuel -= 26"],
        },
        {
          id: "b1_grav3_open",
          label: "Гравитационный манёвр через Obj-3 → C2 (бесплатно!)",
          toLocation: "cell_c2",
          condition: "window_3 == 1",
          effects: [],
        },
        {
          id: "b1_grav3_closed",
          label:
            "Гравитационный манёвр через Obj-3 → C2 (−40 топлива, окно закрыто)",
          toLocation: "cell_c2",
          condition: "window_3 == 0",
          effects: ["fuel -= 40"],
        },
      ],
    },
    {
      id: "cell_b2",
      text: "Сектор B-2 — вблизи гравитационного объекта. Топливо: {fuel} ед.\nОкно Obj-4 (B2→C3): {window_4}/1\n\nВыберите курс:",
      transitions: [
        {
          id: "b2_to_b3",
          label: "Прямой перелёт → B3 (−26 топлива)",
          toLocation: "cell_b3",
          effects: ["fuel -= 26"],
        },
        {
          id: "b2_to_c2",
          label: "Прямой перелёт ↓ C2 (−26 топлива)",
          toLocation: "cell_c2",
          effects: ["fuel -= 26"],
        },
        {
          id: "b2_grav4_open",
          label: "Гравитационный манёвр через Obj-4 → C3 — ФИНИШ! (бесплатно!)",
          toLocation: "cell_c3",
          condition: "window_4 == 1",
          effects: [],
        },
        {
          id: "b2_grav4_closed",
          label:
            "Гравитационный манёвр через Obj-4 → C3 — ФИНИШ! (−40 топлива, окно закрыто)",
          toLocation: "cell_c3",
          condition: "window_4 == 0",
          effects: ["fuel -= 40"],
        },
      ],
    },
    {
      id: "cell_b3",
      text: "Сектор B-3. Топливо: {fuel} ед.\nВыберите курс:",
      transitions: [
        {
          id: "b3_to_c3",
          label: "Прямой перелёт ↓ C3 — ФИНИШ! (−26 топлива)",
          toLocation: "cell_c3",
          effects: ["fuel -= 26"],
        },
      ],
    },
    // --- Row C ---
    {
      id: "cell_c1",
      text: "Сектор C-1. Топливо: {fuel} ед.\nВыберите курс:",
      transitions: [
        {
          id: "c1_to_c2",
          label: "Прямой перелёт → C2 (−26 топлива)",
          toLocation: "cell_c2",
          effects: ["fuel -= 26"],
        },
      ],
    },
    {
      id: "cell_c2",
      text: "Сектор C-2. Топливо: {fuel} ед.\nВыберите курс:",
      transitions: [
        {
          id: "c2_to_c3",
          label: "Прямой перелёт → C3 — ФИНИШ! (−26 топлива)",
          toLocation: "cell_c3",
          effects: ["fuel -= 26"],
        },
      ],
    },
    // Arrival check — autoExecute checks fuel reserve
    {
      id: "cell_c3",
      text: "Финишная точка достигнута! Топливо на борту: {fuel} ед.\n(Минимальный запас для причаливания: 10 ед.)",
      transitions: [
        {
          id: "c3_success",
          label: "...",
          toLocation: "quest_success",
          condition: "fuel >= 10",
          effects: [],
          autoExecute: true,
        },
        {
          id: "c3_failure_reserve",
          label: "...",
          toLocation: "quest_failure_fuel_reserve",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    // Terminal locations
    {
      id: "quest_success",
      text: "Зонд успешно доставлен! Учёный в восторге.\nОстаток топлива: {fuel} ед.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_fuel",
      text: "Критический уровень топлива! Зонд потерян в гравитационном поле.",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_fuel_reserve",
      text: "Топлива недостаточно для маневрирования у финиша. Зонд разбился при посадке.",
      isFailure: true,
      transitions: [],
    },
  ],
};
