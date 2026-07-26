import type { QuestScript } from "../QuestScript";

// Design: Emergency reactor aboard the stranded Maelon station «Горнило». 4 control rods (A/B/C/D),
// each at level 0–5. The unique stable state satisfying all 4 conditions is A=3, B=4, C=4, D=2:
//   A + B = 7  ✓ (3+4)
//   C − D = 2  ✓ (4-2)
//   A × C = 12 ✓ (3×4)
//   B + D = 6  ✓ (4+2)
// Each rod adjustment costs 5 seconds from time_left=120. At time_left<1 the reactor explodes.
// Max Manhattan distance to solution from any random(0,5) start = 14 moves; budget = 24 moves.
//
// Two beats break the ±1-rod monotony (Task 30):
//   - A single `check_stable` sensor sweep resolves all four conditions in ONE auto-beat instead of a
//     four-node chain (four sequential auto-advances used to force up to ~3.2 s of unclickable wait per
//     turn — the pressure timer competed with itself). First mismatching rod (in A→B→C→D order) routes
//     back to the panel; if none mismatch, the unconditional fallback wins to `stable`.
//   - An emergency steam-vent (`coolant_vent`): a coarse panic button, not a precise nudge. Bounded to
//     `vents_left` uses so it can't farm time; each pull buys 15 s but kicks rod D loose to a random
//     position — a genuine gamble the precise ±1 loop never offers.
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
    {
      id: "vents_left",
      name: "Аварийных сбросов",
      min: 0,
      max: 2,
      initial: 2,
      showInUI: true,
    },
  ],
  startLocation: "init_reactor",
  locations: [
    // Init: player reads the alarm message, then manually advances to the control panel
    {
      id: "init_reactor",
      text: "СИРЕНА РАЗРЫВАЕТ УШИ.\n\nАварийные лампы заливают отсек станции «Горнило» багровым. Реактор потерял контроль: температура ползёт в красную зону, где-то с шипением стравливается хладагент. Голос станционной автоматики монотонно повторяет одно слово — «Критично. Критично. Критично».\n\nПанель управления стержнями оживает под ладонью. Секунды идут. Либо ты выведешь конфигурацию к стабильной — либо от станции останется облако раскалённого металла.",
      transitions: [
        {
          id: "begin",
          label: "→ Броситься к пульту",
          toLocation: "check_stable",
          effects: [],
        },
      ],
    },
    // Main control panel — the eight ±1 rod nudges plus the emergency steam-vent all lead through
    // the check sweep.
    {
      id: "reactor_control",
      text: "РЕАКТОР НЕСТАБИЛЕН. По ладони течёт пот, палец подрагивает над кнопками.\n\nТекущее положение стержней:\n  Стержень A: {rod_a} | Стержень B: {rod_b} | Стержень C: {rod_c} | Стержень D: {rod_d}\nДО ВЗРЫВА: {time_left} сек   (каждое движение стержня — минус 5 сек)\n\nНА ТАБЛО МИГАЮТ УСЛОВИЯ СТАБИЛЬНОСТИ — все четыре должны сойтись разом:\n  A + B = 7\n  C − D = 2\n  A × C = 12\n  B + D = 6\n\nСлева мигает клапан аварийного сброса пара: рывок за рычаг выигрывает секунды, но сшибает стержень D с позиции. Аварийных сбросов осталось: {vents_left}.\n\nТолько одна комбинация гасит цепную реакцию. Считай в уме, двигай стержни — и не промахнись со временем.",
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
        // A genuinely different beat: the emergency steam-vent. Coarse panic button, bounded to
        // `vents_left` pulls so it can't farm time; buys 15 s but scrambles rod D.
        {
          id: "vent_steam",
          label: "⚠ Аварийный сброс пара — +15 сек, но собьёт D",
          toLocation: "coolant_vent",
          condition: "vents_left > 0",
          effects: [
            "vents_left -= 1",
            "time_left += 15",
            "rod_d = random(0,5)",
          ],
        },
      ],
    },
    // The steam-vent aftermath beat — a distinct screen, then straight into the sensor sweep.
    {
      id: "coolant_vent",
      text: "Ты рвёшь рычаг аварийного сброса. С оглушительным шипением контур стравливает перегретый пар, стрелка манометра валится из красной зоны — на табло отыграно вспять пятнадцать секунд.\n\nНо отдача бьёт по D-линии: стержень D срывается с места и застревает в положении {rod_d}. На табло: {time_left} сек. Аварийных сбросов осталось: {vents_left}.",
      transitions: [
        {
          id: "vent_settle",
          label: "Датчики пересчитывают конфигурацию",
          toLocation: "check_stable",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    // Single-sweep victory check: all four rods must match the unique stable state (A=3 B=4 C=4 D=2).
    // Ordering is critical — the four mismatch guards are tried A→B→C→D, and the first that fires routes
    // back to the panel; only when none mismatch does the unconditional fallback win to `stable`. This
    // resolves all four conditions in ONE auto-beat (the old four-node chain forced up to ~3.2 s of
    // dead wait per turn).
    {
      id: "check_stable",
      text: "Датчики стройной цепочкой уходят на сверку — четыре условия, одно решение...",
      transitions: [
        {
          id: "check_a_fail",
          label: "Датчик A: вне нормы",
          toLocation: "reactor_control",
          condition: "rod_a != 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_b_fail",
          label: "Датчик B: вне нормы",
          toLocation: "reactor_control",
          condition: "rod_b != 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_c_fail",
          label: "Датчик C: вне нормы",
          toLocation: "reactor_control",
          condition: "rod_c != 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_d_fail",
          label: "Датчик D: вне нормы",
          toLocation: "reactor_control",
          condition: "rod_d != 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "check_all_ok",
          label: "Все датчики в допуске",
          toLocation: "stable",
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
