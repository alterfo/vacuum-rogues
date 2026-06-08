import type { QuestScript } from "../QuestScript";

// Дизайн: Диспетчер орбитального склада. 5 прибывающих транспортов (A-E),
// 3 разгрузочных дока. Доки не могут смешивать типы. Время разгрузки транспорта
// random(1,4) часов. Один транспорт ломается (+2 часа, определяется random(0,4)).
// Распредели транспорты по докам так, чтобы ни один дог не превысил 12 ч.
// Победа: все 5 назначены и overtime (сверхурочные доки) == 0.
//
// Технически: QuestVM не поддерживает param += param, поэтому:
// 1. Инит: init_breakdown → один из break_ship==N → time_N += 2 → dispatch_hub
// 2. Назначение: select_X → assign_X_dockN → assign_to_dockN (роутинг через
//    pending_time = time_X + 0, затем 6 autoExecute по pending_time) → check_progress
// 3. Финал: check_dock1/2/3 → overload_dockN (overtime++) → final_verdict
export const cargoSortScript: QuestScript = {
  id: "cargo-sort",
  title: "Сортировка грузов",
  params: [
    // Transport unload times: random(1,4); breakdown adds +2 in init_breakdown
    {
      id: "time_A",
      name: "Транспорт A (ч)",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: true,
    },
    {
      id: "time_B",
      name: "Транспорт B (ч)",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: true,
    },
    {
      id: "time_C",
      name: "Транспорт C (ч)",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: true,
    },
    {
      id: "time_D",
      name: "Транспорт D (ч)",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: true,
    },
    {
      id: "time_E",
      name: "Транспорт E (ч)",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: true,
    },
    // Which transport broke down (0=A, 1=B, 2=C, 3=D, 4=E) — applied in init_breakdown
    {
      id: "break_ship",
      name: "Поломка",
      min: 0,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    // Staging variable: holds time of current transport being assigned
    {
      id: "pending_time",
      name: "Ожидание",
      min: 0,
      max: 6,
      initial: 0,
      showInUI: false,
    },
    // Dock loads (accumulated hours)
    {
      id: "dock1_load",
      name: "Дог 1 (ч)",
      min: 0,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "dock2_load",
      name: "Дог 2 (ч)",
      min: 0,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "dock3_load",
      name: "Дог 3 (ч)",
      min: 0,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    // How many transports have been assigned so far
    {
      id: "assigned_count",
      name: "Назначено",
      min: 0,
      max: 5,
      initial: 0,
      showInUI: true,
    },
    // Overloaded dock count (> 12h)
    {
      id: "overtime",
      name: "Перегрузы",
      min: 0,
      max: 3,
      initial: 0,
      showInUI: true,
    },
    // Per-transport assignment flags
    {
      id: "assigned_A",
      name: "A назначен",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "assigned_B",
      name: "B назначен",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "assigned_C",
      name: "C назначен",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "assigned_D",
      name: "D назначен",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "assigned_E",
      name: "E назначен",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "init_breakdown",
  locations: [
    // Step 1: Apply breakdown (+2h) to the affected transport
    {
      id: "init_breakdown",
      text: "Получаем данные о транспортах...",
      transitions: [
        {
          id: "break_A",
          label: "...",
          toLocation: "dispatch_hub",
          condition: "break_ship == 0",
          effects: ["time_A += 2"],
          autoExecute: true,
        },
        {
          id: "break_B",
          label: "...",
          toLocation: "dispatch_hub",
          condition: "break_ship == 1",
          effects: ["time_B += 2"],
          autoExecute: true,
        },
        {
          id: "break_C",
          label: "...",
          toLocation: "dispatch_hub",
          condition: "break_ship == 2",
          effects: ["time_C += 2"],
          autoExecute: true,
        },
        {
          id: "break_D",
          label: "...",
          toLocation: "dispatch_hub",
          condition: "break_ship == 3",
          effects: ["time_D += 2"],
          autoExecute: true,
        },
        {
          id: "break_E",
          label: "...",
          toLocation: "dispatch_hub",
          condition: "break_ship == 4",
          effects: ["time_E += 2"],
          autoExecute: true,
        },
      ],
    },

    // Step 2: Main dispatch hub — player selects unassigned transports
    {
      id: "dispatch_hub",
      text:
        "Диспетчерская. Назначьте транспорты по докам.\n" +
        "Транспорт A: {time_A}ч | B: {time_B}ч | C: {time_C}ч | D: {time_D}ч | E: {time_E}ч\n" +
        "Дог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч\n" +
        "Назначено: {assigned_count}/5",
      transitions: [
        {
          id: "go_select_A",
          label: "Транспорт A ({time_A}ч)",
          toLocation: "select_A",
          condition: "assigned_A == 0",
          effects: [],
        },
        {
          id: "go_select_B",
          label: "Транспорт B ({time_B}ч)",
          toLocation: "select_B",
          condition: "assigned_B == 0",
          effects: [],
        },
        {
          id: "go_select_C",
          label: "Транспорт C ({time_C}ч)",
          toLocation: "select_C",
          condition: "assigned_C == 0",
          effects: [],
        },
        {
          id: "go_select_D",
          label: "Транспорт D ({time_D}ч)",
          toLocation: "select_D",
          condition: "assigned_D == 0",
          effects: [],
        },
        {
          id: "go_select_E",
          label: "Транспорт E ({time_E}ч)",
          toLocation: "select_E",
          condition: "assigned_E == 0",
          effects: [],
        },
      ],
    },

    // Step 3: Select dock for each transport
    {
      id: "select_A",
      text: "Транспорт A — {time_A} ч разгрузки.\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч\nКуда направить?",
      transitions: [
        {
          id: "assign_A_dock1",
          label: "→ Дог 1",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_A + 0",
            "assigned_A = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_A_dock2",
          label: "→ Дог 2",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_A + 0",
            "assigned_A = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_A_dock3",
          label: "→ Дог 3",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_A + 0",
            "assigned_A = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_A",
          label: "← Назад",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_B",
      text: "Транспорт B — {time_B} ч разгрузки.\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч\nКуда направить?",
      transitions: [
        {
          id: "assign_B_dock1",
          label: "→ Дог 1",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_B + 0",
            "assigned_B = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_B_dock2",
          label: "→ Дог 2",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_B + 0",
            "assigned_B = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_B_dock3",
          label: "→ Дог 3",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_B + 0",
            "assigned_B = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_B",
          label: "← Назад",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_C",
      text: "Транспорт C — {time_C} ч разгрузки.\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч\nКуда направить?",
      transitions: [
        {
          id: "assign_C_dock1",
          label: "→ Дог 1",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_C + 0",
            "assigned_C = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_C_dock2",
          label: "→ Дог 2",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_C + 0",
            "assigned_C = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_C_dock3",
          label: "→ Дог 3",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_C + 0",
            "assigned_C = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_C",
          label: "← Назад",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_D",
      text: "Транспорт D — {time_D} ч разгрузки.\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч\nКуда направить?",
      transitions: [
        {
          id: "assign_D_dock1",
          label: "→ Дог 1",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_D + 0",
            "assigned_D = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_D_dock2",
          label: "→ Дог 2",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_D + 0",
            "assigned_D = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_D_dock3",
          label: "→ Дог 3",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_D + 0",
            "assigned_D = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_D",
          label: "← Назад",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_E",
      text: "Транспорт E — {time_E} ч разгрузки.\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч\nКуда направить?",
      transitions: [
        {
          id: "assign_E_dock1",
          label: "→ Дог 1",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_E + 0",
            "assigned_E = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_E_dock2",
          label: "→ Дог 2",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_E + 0",
            "assigned_E = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_E_dock3",
          label: "→ Дог 3",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_E + 0",
            "assigned_E = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_E",
          label: "← Назад",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },

    // Step 4: Routing — add pending_time to the chosen dock (autoExecute by value match)
    {
      id: "assign_to_dock1",
      text: "Назначение в Дог 1...",
      transitions: [
        {
          id: "d1_t1",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 1",
          effects: ["dock1_load += 1"],
          autoExecute: true,
        },
        {
          id: "d1_t2",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 2",
          effects: ["dock1_load += 2"],
          autoExecute: true,
        },
        {
          id: "d1_t3",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 3",
          effects: ["dock1_load += 3"],
          autoExecute: true,
        },
        {
          id: "d1_t4",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 4",
          effects: ["dock1_load += 4"],
          autoExecute: true,
        },
        {
          id: "d1_t5",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 5",
          effects: ["dock1_load += 5"],
          autoExecute: true,
        },
        {
          id: "d1_t6",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 6",
          effects: ["dock1_load += 6"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "assign_to_dock2",
      text: "Назначение в Дог 2...",
      transitions: [
        {
          id: "d2_t1",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 1",
          effects: ["dock2_load += 1"],
          autoExecute: true,
        },
        {
          id: "d2_t2",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 2",
          effects: ["dock2_load += 2"],
          autoExecute: true,
        },
        {
          id: "d2_t3",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 3",
          effects: ["dock2_load += 3"],
          autoExecute: true,
        },
        {
          id: "d2_t4",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 4",
          effects: ["dock2_load += 4"],
          autoExecute: true,
        },
        {
          id: "d2_t5",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 5",
          effects: ["dock2_load += 5"],
          autoExecute: true,
        },
        {
          id: "d2_t6",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 6",
          effects: ["dock2_load += 6"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "assign_to_dock3",
      text: "Назначение в Дог 3...",
      transitions: [
        {
          id: "d3_t1",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 1",
          effects: ["dock3_load += 1"],
          autoExecute: true,
        },
        {
          id: "d3_t2",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 2",
          effects: ["dock3_load += 2"],
          autoExecute: true,
        },
        {
          id: "d3_t3",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 3",
          effects: ["dock3_load += 3"],
          autoExecute: true,
        },
        {
          id: "d3_t4",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 4",
          effects: ["dock3_load += 4"],
          autoExecute: true,
        },
        {
          id: "d3_t5",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 5",
          effects: ["dock3_load += 5"],
          autoExecute: true,
        },
        {
          id: "d3_t6",
          label: "...",
          toLocation: "check_progress",
          condition: "pending_time == 6",
          effects: ["dock3_load += 6"],
          autoExecute: true,
        },
      ],
    },

    // Step 5: Route back to hub or forward to dock-overload checks
    {
      id: "check_progress",
      text: "Проверка состояния...",
      transitions: [
        {
          id: "more_ships",
          label: "...",
          toLocation: "dispatch_hub",
          condition: "assigned_count < 5",
          effects: [],
          autoExecute: true,
        },
        {
          id: "all_assigned",
          label: "...",
          toLocation: "check_dock1",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    // Step 6: Check each dock for overload (> 12h)
    {
      id: "check_dock1",
      text: "Проверка Дога 1...",
      transitions: [
        {
          id: "dock1_ok",
          label: "...",
          toLocation: "check_dock2",
          condition: "dock1_load <= 12",
          effects: [],
          autoExecute: true,
        },
        {
          id: "dock1_over",
          label: "...",
          toLocation: "overload_dock1",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "overload_dock1",
      text: "Дог 1 перегружен!",
      transitions: [
        {
          id: "add_ot1",
          label: "...",
          toLocation: "check_dock2",
          effects: ["overtime += 1"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_dock2",
      text: "Проверка Дога 2...",
      transitions: [
        {
          id: "dock2_ok",
          label: "...",
          toLocation: "check_dock3",
          condition: "dock2_load <= 12",
          effects: [],
          autoExecute: true,
        },
        {
          id: "dock2_over",
          label: "...",
          toLocation: "overload_dock2",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "overload_dock2",
      text: "Дог 2 перегружен!",
      transitions: [
        {
          id: "add_ot2",
          label: "...",
          toLocation: "check_dock3",
          effects: ["overtime += 1"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_dock3",
      text: "Проверка Дога 3...",
      transitions: [
        {
          id: "dock3_ok",
          label: "...",
          toLocation: "final_verdict",
          condition: "dock3_load <= 12",
          effects: [],
          autoExecute: true,
        },
        {
          id: "dock3_over",
          label: "...",
          toLocation: "overload_dock3",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "overload_dock3",
      text: "Дог 3 перегружен!",
      transitions: [
        {
          id: "add_ot3",
          label: "...",
          toLocation: "final_verdict",
          effects: ["overtime += 1"],
          autoExecute: true,
        },
      ],
    },

    // Step 7: Final verdict
    {
      id: "final_verdict",
      text: "Итог смены. Перегрузы: {overtime}",
      transitions: [
        {
          id: "verdict_success",
          label: "...",
          toLocation: "quest_success",
          condition: "overtime == 0",
          effects: [],
          autoExecute: true,
        },
        {
          id: "verdict_failure",
          label: "...",
          toLocation: "quest_failure_overtime",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    // Terminal locations
    {
      id: "quest_success",
      text: "Отличная работа, диспетчер! Все грузы разгружены в срок.\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_overtime",
      text: "Доки перегружены! Контракт не выполнен.\nПерегрузы: {overtime} дока(ов)\nДог 1: {dock1_load}ч | Дог 2: {dock2_load}ч | Дог 3: {dock3_load}ч",
      isFailure: true,
      transitions: [],
    },
  ],
};
