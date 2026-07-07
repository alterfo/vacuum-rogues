import type { QuestScript } from "../QuestScript";

// Design: Emergency reactor aboard a stranded Maelon freighter. 4 control rods (A/B/C/D),
// each at level 0–5. The unique stable state satisfying all 4 conditions is A=3, B=4, C=4, D=2:
//   A + B = 7  ✓ (3+4)
//   C − D = 2  ✓ (4-2)
//   A × C = 12 ✓ (3×4)
//   B + D = 6  ✓ (4+2)
// Each rod adjustment costs 5 seconds from time_left=120. At time_left<1 the reactor explodes.
// Max Manhattan distance to solution from any random(0,5) start = 14 moves; budget = 24 moves.
export const reactorScript: QuestScript = {
  id: "reactor",
  title: "Реактор",
  params: [
    {
      id: "rod_a",
      name: "Стержень A",
      min: 0,
      max: 5,
      initial: "random",
      showInUI: true,
    },
    {
      id: "rod_b",
      name: "Стержень B",
      min: 0,
      max: 5,
      initial: "random",
      showInUI: true,
    },
    {
      id: "rod_c",
      name: "Стержень C",
      min: 0,
      max: 5,
      initial: "random",
      showInUI: true,
    },
    {
      id: "rod_d",
      name: "Стержень D",
      min: 0,
      max: 5,
      initial: "random",
      showInUI: true,
    },
    {
      id: "time_left",
      name: "Время (сек)",
      min: 0,
      max: 120,
      initial: 120,
      critMin: 1,
      critTarget: "reactor_explosion",
      showInUI: true,
    },
  ],
  startLocation: "init_reactor",
  locations: [
    // Init: player reads the alarm message, then manually advances to the control panel
    {
      id: "init_reactor",
      text: "СИРЕНА РАЗРЫВАЕТ УШИ.\n\nАварийные лампы заливают отсек багровым. Реактор потерял контроль: температура ползёт в красную зону, где-то с шипением стравливается хладагент. Голос корабельной автоматики монотонно повторяет одно слово — «Критично. Критично. Критично».\n\nПанель управления стержнями оживает под ладонью. Секунды идут. Либо ты выведешь конфигурацию к стабильной — либо от станции останется облако раскалённого металла.",
      transitions: [
        {
          id: "begin",
          label: "→ Броситься к пульту",
          toLocation: "check_stable",
          effects: [],
        },
      ],
    },
    // Main control panel — all 8 rod adjustments lead to check_stable
    {
      id: "reactor_control",
      text: "РЕАКТОР НЕСТАБИЛЕН. По ладони течёт пот, палец подрагивает над кнопками.\n\nТекущее положение стержней:\n  Стержень A: {rod_a} | Стержень B: {rod_b} | Стержень C: {rod_c} | Стержень D: {rod_d}\nДО ВЗРЫВА: {time_left} сек   (каждое движение стержня — минус 5 сек)\n\nНА ТАБЛО МИГАЮТ УСЛОВИЯ СТАБИЛЬНОСТИ — все четыре должны сойтись разом:\n  A + B = 7\n  C − D = 2\n  A × C = 12\n  B + D = 6\n\nТолько одна комбинация гасит цепную реакцию. Считай в уме, двигай стержни — и не промахнись со временем.",
      transitions: [
        {
          id: "a_up",
          label: "A ↑ (+1)",
          toLocation: "check_stable",
          condition: "rod_a < 5",
          effects: ["rod_a += 1", "time_left -= 5"],
        },
        {
          id: "a_down",
          label: "A ↓ (−1)",
          toLocation: "check_stable",
          condition: "rod_a > 0",
          effects: ["rod_a -= 1", "time_left -= 5"],
        },
        {
          id: "b_up",
          label: "B ↑ (+1)",
          toLocation: "check_stable",
          condition: "rod_b < 5",
          effects: ["rod_b += 1", "time_left -= 5"],
        },
        {
          id: "b_down",
          label: "B ↓ (−1)",
          toLocation: "check_stable",
          condition: "rod_b > 0",
          effects: ["rod_b -= 1", "time_left -= 5"],
        },
        {
          id: "c_up",
          label: "C ↑ (+1)",
          toLocation: "check_stable",
          condition: "rod_c < 5",
          effects: ["rod_c += 1", "time_left -= 5"],
        },
        {
          id: "c_down",
          label: "C ↓ (−1)",
          toLocation: "check_stable",
          condition: "rod_c > 0",
          effects: ["rod_c -= 1", "time_left -= 5"],
        },
        {
          id: "d_up",
          label: "D ↑ (+1)",
          toLocation: "check_stable",
          condition: "rod_d < 5",
          effects: ["rod_d += 1", "time_left -= 5"],
        },
        {
          id: "d_down",
          label: "D ↓ (−1)",
          toLocation: "check_stable",
          condition: "rod_d > 0",
          effects: ["rod_d -= 1", "time_left -= 5"],
        },
      ],
    },
    // Victory check chain: all four rods must match the unique stable state (A=3 B=4 C=4 D=2).
    // Each step: if the rod matches, advance to the next check; otherwise return to control panel.
    // Ordering within each location is critical — conditional transition must precede the fallback.
    {
      id: "check_stable",
      text: "Датчик стержня A мигает — идёт сверка...",
      transitions: [
        {
          id: "check_a_ok",
          label: "...",
          toLocation: "check_b",
          condition: "rod_a == 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_a_fail",
          label: "...",
          toLocation: "reactor_control",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_b",
      text: "A в допуске — датчик B уходит на сверку...",
      transitions: [
        {
          id: "check_b_ok",
          label: "...",
          toLocation: "check_c",
          condition: "rod_b == 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_b_fail",
          label: "...",
          toLocation: "reactor_control",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_c",
      text: "B в допуске — очередь стержня C...",
      transitions: [
        {
          id: "check_c_ok",
          label: "...",
          toLocation: "check_d",
          condition: "rod_c == 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_c_fail",
          label: "...",
          toLocation: "reactor_control",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_d",
      text: "C в допуске — последняя сверка, стержень D...",
      transitions: [
        {
          id: "check_d_ok",
          label: "...",
          toLocation: "stable",
          condition: "rod_d == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_d_fail",
          label: "...",
          toLocation: "reactor_control",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "stable",
      text: "РЕАКТОР СТАБИЛИЗИРОВАН.\n\nСирена захлёбывается и смолкает. Багровые лампы гаснут, отсек заливает ровным белым светом. Гул турбин выравнивается в спокойное, глубокое дыхание — цепная реакция снова под контролем.\n\nФинальная конфигурация: A={rod_a}, B={rod_b}, C={rod_c}, D={rod_d}\nНа табло осталось: {time_left} сек — этого хватило.\n\nВсе четыре условия сошлись. Ты вытер пот с лба: станция будет жить.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "reactor_explosion",
      text: "ОТСЧЁТ ДОШЁЛ ДО НУЛЯ.\n\nПоследний сигнал сирены тонет в нарастающем вое перегретого ядра. Стержни не успели встать в стабильную конфигурацию — цепная реакция срывается в лавину. Ослепительная вспышка, удар — и станцию разрывает изнутри вместе с тобой.\n\nПанель погасла на середине хода. Последнее, что застыло на табло: A={rod_a}, B={rod_b}, C={rod_c}, D={rod_d}.",
      isFailure: true,
      transitions: [],
    },
  ],
};
