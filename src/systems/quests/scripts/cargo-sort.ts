import type { QuestScript } from "../QuestScript";

// Дизайн: Диспетчер орбитального склада. 5 прибывающих транспортов (A-E),
// 3 разгрузочных дока. Время разгрузки транспорта random(1,4) часов. Один
// транспорт ломается (+2 часа, определяется random(0,4)). Распредели транспорты
// по докам так, чтобы ни один док не превысил 8 ч (порог смены).
// Победа: все 5 назначены и overtime (сверхурочные доки) == 0.
//
// Баланс: суммарная работа 10-20 ч против ёмкости 3×8=24 ч — узкий бюджет,
// требующий продуманной раскладки: небрежная свалка бортов в один док теперь
// реально проваливает смену (жадная эвристика "в самый пустой док" срывается на
// части сидов), но у каждого сида есть выигрышная раскладка.
//
// Финал ветвится по качеству исхода, а не одним общим текстом:
//   overtime == 0 → quest_success (запас) либо quest_success_tight (док впритык),
//   overtime == 1 → quest_failure_overtime (один сорванный док, поправимо),
//   overtime >= 2 → quest_failure_severe (обвал смены).
//
// Технически: QuestVM не поддерживает param += param, поэтому:
// 1. Инит: init_breakdown → один из break_ship==N → time_N += 2 → dispatch_hub
// 2. Назначение: select_X → assign_X_dockN → assign_to_dockN (роутинг через
//    pending_time = time_X + 0, затем 6 autoExecute по pending_time) → check_progress
// 3. Финал: check_dock1/2/3 → overload_dockN (overtime++) → final_verdict → margin_check
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
      name: "Док 1 (ч)",
      min: 0,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "dock2_load",
      name: "Док 2 (ч)",
      min: 0,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "dock3_load",
      name: "Док 3 (ч)",
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
    // Overloaded dock count (> 8h)
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
      text: "Грузовой узел «Перекрёсток-9». Смена только началась — и уже гарь в воздухе. По селектору хрипит аварийная сводка: один из бортов заглох на подходе, стыковка встанет дольше на два часа. Диспетчерская вгрызается в данные...",
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
        "ДИСПЕТЧЕРСКАЯ. Клаксоны воют, табло мигает красным. Пять бортов висят на орбите и жгут топливо, три дока ждут груз. Порог дока — 8 часов: перевалишь — уходит в сверхурочные, а это сорванные рейсы, разъярённые клиенты и твоя голова на плахе. Бюджет тесный — свалишь два тяжёлых борта в один док, и он лопнет. Распредели борта с умом.\n" +
        "Борта на разгрузку — A: {time_A}ч | B: {time_B}ч | C: {time_C}ч | D: {time_D}ч | E: {time_E}ч\n" +
        "Загрузка доков — Док 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч (порог 8ч)\n" +
        "Пришвартовано: {assigned_count}/5. Бригадир орёт с эстакады: «Кого заводим?!»",
      transitions: [
        {
          id: "go_select_A",
          label: "Завести борт A ({time_A}ч)",
          toLocation: "select_A",
          condition: "assigned_A == 0",
          effects: [],
        },
        {
          id: "go_select_B",
          label: "Завести борт B ({time_B}ч)",
          toLocation: "select_B",
          condition: "assigned_B == 0",
          effects: [],
        },
        {
          id: "go_select_C",
          label: "Завести борт C ({time_C}ч)",
          toLocation: "select_C",
          condition: "assigned_C == 0",
          effects: [],
        },
        {
          id: "go_select_D",
          label: "Завести борт D ({time_D}ч)",
          toLocation: "select_D",
          condition: "assigned_D == 0",
          effects: [],
        },
        {
          id: "go_select_E",
          label: "Завести борт E ({time_E}ч)",
          toLocation: "select_E",
          condition: "assigned_E == 0",
          effects: [],
        },
      ],
    },

    // Step 3: Select dock for each transport
    {
      id: "select_A",
      text: "Борт A тянет на швартовку — {time_A} ч под краном. Куда его, пока клиент не поседел? Считай остаток до порога в 8 ч.\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч",
      transitions: [
        {
          id: "assign_A_dock1",
          label: "В Док 1 (сейчас {dock1_load}ч)",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_A + 0",
            "assigned_A = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_A_dock2",
          label: "В Док 2 (сейчас {dock2_load}ч)",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_A + 0",
            "assigned_A = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_A_dock3",
          label: "В Док 3 (сейчас {dock3_load}ч)",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_A + 0",
            "assigned_A = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_A",
          label: "← Назад к сводке",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_B",
      text: "Борт B подан к причалу — {time_B} ч под краном. Бригадир тычет пальцем в табло: «Ну?!» Ищи док, где после B ещё останется место до 8 ч.\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч",
      transitions: [
        {
          id: "assign_B_dock1",
          label: "В Док 1 (сейчас {dock1_load}ч)",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_B + 0",
            "assigned_B = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_B_dock2",
          label: "В Док 2 (сейчас {dock2_load}ч)",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_B + 0",
            "assigned_B = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_B_dock3",
          label: "В Док 3 (сейчас {dock3_load}ч)",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_B + 0",
            "assigned_B = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_B",
          label: "← Назад к сводке",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_C",
      text: "Борт C заходит на стыковку — {time_C} ч работы захватам. Где ему хватит места, не пробив потолок в 8 ч?\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч",
      transitions: [
        {
          id: "assign_C_dock1",
          label: "В Док 1 (сейчас {dock1_load}ч)",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_C + 0",
            "assigned_C = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_C_dock2",
          label: "В Док 2 (сейчас {dock2_load}ч)",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_C + 0",
            "assigned_C = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_C_dock3",
          label: "В Док 3 (сейчас {dock3_load}ч)",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_C + 0",
            "assigned_C = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_C",
          label: "← Назад к сводке",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_D",
      text: "Борт D просится к причалу — {time_D} ч возни с грузом. Часы на стене щёлкают, клиенты на линии. В какой док он влезет без перегруза?\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч",
      transitions: [
        {
          id: "assign_D_dock1",
          label: "В Док 1 (сейчас {dock1_load}ч)",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_D + 0",
            "assigned_D = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_D_dock2",
          label: "В Док 2 (сейчас {dock2_load}ч)",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_D + 0",
            "assigned_D = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_D_dock3",
          label: "В Док 3 (сейчас {dock3_load}ч)",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_D + 0",
            "assigned_D = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_D",
          label: "← Назад к сводке",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },
    {
      id: "select_E",
      text: "Последний борт, E, зависает над стыком — {time_E} ч разгрузки. Одно неверное назначение сейчас — и док лопнет за 8 ч. Прикинь остатки и решай.\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч",
      transitions: [
        {
          id: "assign_E_dock1",
          label: "В Док 1 (сейчас {dock1_load}ч)",
          toLocation: "assign_to_dock1",
          effects: [
            "pending_time = time_E + 0",
            "assigned_E = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_E_dock2",
          label: "В Док 2 (сейчас {dock2_load}ч)",
          toLocation: "assign_to_dock2",
          effects: [
            "pending_time = time_E + 0",
            "assigned_E = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "assign_E_dock3",
          label: "В Док 3 (сейчас {dock3_load}ч)",
          toLocation: "assign_to_dock3",
          effects: [
            "pending_time = time_E + 0",
            "assigned_E = 1",
            "assigned_count += 1",
          ],
        },
        {
          id: "back_from_E",
          label: "← Назад к сводке",
          toLocation: "dispatch_hub",
          effects: [],
        },
      ],
    },

    // Step 4: Routing — add pending_time to the chosen dock (autoExecute by value match)
    {
      id: "assign_to_dock1",
      text: "Захваты Дока 1 подхватывают борт, лебёдки визжат...",
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
      text: "Док 2 разводит зажимы, борт тянут к причалу...",
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
      text: "Стыковочные фермы Дока 3 смыкаются на борту...",
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
      text: "Диспетчер сверяется с табло: кто ещё висит на орбите?",
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

    // Step 6: Check each dock for overload (> 8h)
    {
      id: "check_dock1",
      text: "Табло Дока 1 гаснет в расчётах: уложились в 8 или ушли в красное?",
      transitions: [
        {
          id: "dock1_ok",
          label: "...",
          toLocation: "check_dock2",
          condition: "dock1_load <= 8",
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
      text: "Док 1 пробил порог — сирена сверхурочных, бригадир хватается за голову!",
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
      text: "Черёд Дока 2: стрелка нагрузки замерла у отметки 8...",
      transitions: [
        {
          id: "dock2_ok",
          label: "...",
          toLocation: "check_dock3",
          condition: "dock2_load <= 8",
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
      text: "Док 2 захлебнулся — сверхурочные, ещё один сорванный рейс!",
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
      text: "Последняя сверка — Док 3. Весь узел замер, ждёт цифру...",
      transitions: [
        {
          id: "dock3_ok",
          label: "...",
          toLocation: "final_verdict",
          condition: "dock3_load <= 8",
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
      text: "Док 3 не выдержал — красный свет по всей эстакаде!",
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

    // Step 7: Final verdict — branch by outcome quality, not one shared line.
    // overtime == 0 → margin check (comfortable vs razor-thin win)
    // overtime == 1 → one dock over (salvageable)
    // overtime >= 2 → shift collapse
    {
      id: "final_verdict",
      text: "Клаксоны смолкают. Диспетчер выдыхает и смотрит на сводку смены — доков в перегрузе: {overtime}",
      transitions: [
        {
          id: "verdict_success",
          label: "...",
          toLocation: "margin_check1",
          condition: "overtime == 0",
          effects: [],
          autoExecute: true,
        },
        {
          id: "verdict_light",
          label: "...",
          toLocation: "quest_failure_overtime",
          condition: "overtime == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "verdict_severe",
          label: "...",
          toLocation: "quest_failure_severe",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    // Step 8: On a clean shift, was any dock at the very edge (== 8h)? If so it
    // was a nail-biter, not a comfortable win — give it its own ending.
    {
      id: "margin_check1",
      text: "Сводка чистая — но диспетчер щурится на самый нагруженный док...",
      transitions: [
        {
          id: "m1_tight",
          label: "...",
          toLocation: "quest_success_tight",
          condition: "dock1_load >= 8",
          effects: [],
          autoExecute: true,
        },
        {
          id: "m1_next",
          label: "...",
          toLocation: "margin_check2",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "margin_check2",
      text: "...проверяет второй...",
      transitions: [
        {
          id: "m2_tight",
          label: "...",
          toLocation: "quest_success_tight",
          condition: "dock2_load >= 8",
          effects: [],
          autoExecute: true,
        },
        {
          id: "m2_next",
          label: "...",
          toLocation: "margin_check3",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "margin_check3",
      text: "...и третий.",
      transitions: [
        {
          id: "m3_tight",
          label: "...",
          toLocation: "quest_success_tight",
          condition: "dock3_load >= 8",
          effects: [],
          autoExecute: true,
        },
        {
          id: "m3_comfortable",
          label: "...",
          toLocation: "quest_success",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    // Terminal locations — distinct text per outcome tier
    {
      id: "quest_success",
      text: "Ни одного перегруза, и ни один док даже не подошёл к порогу — раскладка выверена, запас держится. Бригадир одобрительно кивает: «Чисто сработано, диспетчер». Клиенты снимают трубки довольные.\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч (порог 8ч)",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_success_tight",
      text: "Успел — но впритык: один из доков замер ровно на восьми часах, ещё бы борт — и красный свет. Бригадир вытирает лоб: «На волоске прошли, диспетчер». Смена спасена, хоть и на нервах.\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч (порог 8ч)",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_overtime",
      text: "Один док ушёл в сверхурочные — рейс сорван, клиент на линии рвёт и мечет. Не катастрофа, но выговор обеспечен: собери раскладку аккуратнее в следующий раз.\nДоков в перегрузе: {overtime}\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч (порог 8ч)",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_severe",
      text: "Узел встал. Сразу несколько доков в красном, рейсы посыпались лавиной, диспетчерская тонет в звонках разъярённых клиентов. Контракт сорван — и твоя должность вместе с ним.\nДоков в перегрузе: {overtime}\nДок 1: {dock1_load}ч | Док 2: {dock2_load}ч | Док 3: {dock3_load}ч (порог 8ч)",
      isFailure: true,
      transitions: [],
    },
  ],
};
