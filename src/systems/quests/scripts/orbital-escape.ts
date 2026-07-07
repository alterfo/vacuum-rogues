import type { QuestScript } from "../QuestScript";

// Design: An orbital-mechanics burn-scheduling puzzle. Your ship is caught in
// the decaying orbit of a gas giant; every maneuver bleeds `altitude`, and at
// zero you graze the cloud-tops and burn up (a `critMin` redirect to
// ending_burnup — the decay-pressure spine). You must raise the orbit above the
// escape line before that happens, spending a finite `fuel` budget. The puzzle
// is the Oberth effect: a hard burn timed at the low point of the orbit
// (periapsis) buys far more altitude per unit of fuel than a panicked
// full-throttle now — and stopping to think costs precious altitude to decay.
// Choice points:
//   1. First burn — wait for periapsis (efficient), full-throttle now
//      (wasteful), or scan first and lose altitude to decay while you compute.
//   2. Coast — a trimmed periapsis burn (needs fuel >= 3), dump cargo ballast
//      (roll: a good jettison or a jammed hatch), or ride it out (more decay).
//   3. Escape gate — an auto check on `altitude` decides the outcome.
// Outcomes (by `altitude` at the escape gate, unless it decayed to burn-up):
//   - ending_escaped  (altitude >= 10 — clean break, stable trajectory)  SUCCESS
//   - ending_grazing  (altitude >= 7  — you scrape free, hull scorched)   SUCCESS
//   - ending_stranded (altitude < 7   — trapped in a low orbit, hauled in) FAILURE
//   - ending_burnup   (altitude ran out — atmospheric entry)              FAILURE
export const orbitalEscapeScript: QuestScript = {
  id: "orbital-escape",
  title: "Срыв с орбиты",
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
      id: "altitude",
      name: "Высота орбиты",
      min: -9999,
      max: 99,
      initial: 5,
      critMin: 1,
      critTarget: "ending_burnup",
      showInUI: true,
    },
    {
      id: "fuel",
      name: "Топливо",
      min: -9999,
      max: 99,
      initial: 10,
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
  startLocation: "caught",
  locations: [
    {
      id: "caught",
      text: "Гравитация газового гиганта тянет корабль вниз, и каждый виток орбита оседает всё ниже. Внизу, под завихрениями бурь, вас ждёт огненная стена атмосферы. Двигатели ещё живы — вопрос в том, как потратить топливо, чтобы вырваться, а не сжечь его впустую.\nВысота орбиты: {altitude} | Топливо: {fuel}\n\nКак жечь первый импульс?",
      transitions: [
        {
          id: "burn_periapsis",
          label:
            "Дождаться низшей точки и вдарить на форсаже — эффект Оберта работает на вас (−4 топлива, +5 высоты)",
          toLocation: "coast",
          effects: ["altitude += 5", "fuel -= 4"],
        },
        {
          id: "burn_now",
          label:
            "Не ждать — полный ход прямо сейчас, пока не поздно (−6 топлива, +3 высоты)",
          toLocation: "coast",
          effects: ["altitude += 3", "fuel -= 6"],
        },
        {
          id: "steady_scan",
          label:
            "Сначала просчитать вектор по приборам — точность ценой времени (−2 высоты на снижение)",
          toLocation: "coast",
          effects: ["altitude -= 2"],
        },
      ],
    },
    {
      id: "coast",
      text: "Корабль по инерции ползёт к апогею. Вы выиграли высоту, но газовый гигант не отпускает — тяга атмосферы уже щупает корму. Ещё один манёвр решит всё.\nВысота орбиты: {altitude} | Топливо: {fuel}",
      transitions: [
        {
          id: "trim_burn",
          label:
            "Точный доводочный импульс в перигее (нужно топлива ≥3; −3 топлива, +4 высоты)",
          toLocation: "escape_gate",
          condition: "fuel >= 3",
          effects: ["altitude += 4", "fuel -= 3"],
        },
        {
          id: "dump_ballast",
          label:
            "Сбросить груз за борт — облегчить корабль без топлива (бросок: успеете ли раскрыть люк)",
          toLocation: "dump_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "hold_coast",
          label:
            "Ничего не жечь — довериться набранной высоте и молиться (−3 высоты на снижение)",
          toLocation: "escape_gate",
          effects: ["altitude -= 3"],
        },
      ],
    },
    {
      id: "dump_check",
      text: "Грузовой люк примерзает от перепада, сервоприводы визжат — контейнеры один за другим срываются в бездну...",
      transitions: [
        {
          id: "dump_good",
          label: "...",
          toLocation: "escape_gate",
          condition: "roll >= 4",
          effects: ["altitude += 3", "credits -= 800"],
          autoExecute: true,
        },
        {
          id: "dump_bad",
          label: "...",
          toLocation: "escape_gate",
          effects: ["altitude += 1", "credits -= 400"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "escape_gate",
      text: "Двигатели смолкли. Корабль либо оседлал траекторию к свободе, либо всё ещё падает — приборы вот-вот скажут, что именно.\nВысота орбиты: {altitude}",
      transitions: [
        {
          id: "gate_clean",
          label: "...",
          toLocation: "ending_escaped",
          condition: "altitude >= 10",
          effects: ["credits += 2500", "rating += 15"],
          autoExecute: true,
        },
        {
          id: "gate_graze",
          label: "...",
          toLocation: "ending_grazing",
          condition: "altitude >= 7",
          effects: ["credits += 1000", "rating += 5"],
          autoExecute: true,
        },
        {
          id: "gate_low",
          label: "...",
          toLocation: "ending_stranded",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_escaped",
      text: "Двигатели дожгли последний импульс, и газовый гигант отпустил — корабль лёг на широкую, спокойную траекторию прочь от бурь. Вы ещё минуту сидите неподвижно, слушая, как выравнивается собственное дыхание. Диспетчер орбитальной станции, следивший за вашей агонией по радару, коротко бросает в эфир: «Чисто сработано, пилот».\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_grazing",
      text: "Вы вырвались — но по касательной, содрав обшивку о верхние слои атмосферы. Корпус ещё дымится, датчики температуры зашкаливают, однако корабль цел и летит прочь от гиганта. Ремонт влетит в копейку, но вы живы, и это главное.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_stranded",
      text: "Высоты не хватило. Корабль замер на низкой, дохлой орбите — вырваться нечем, топливо на нуле. Через сутки вас снимает спасательный буксир, и всю дорогу до порта вы слушаете, во что обойдётся эвакуация. Живы — но задачу вы провалили.\nВысота орбиты: {altitude}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_burnup",
      text: "Орбита осела ниже критической черты прежде, чем вы успели вырваться. Корабль вошёл в атмосферу газового гиганта носом вперёд — обшивка вспыхнула, приборы захлебнулись помехами, и последнее, что показал альтиметр, был ноль. Вниз, в вечную бурю, без следа.\nВысота орбиты: {altitude}",
      isFailure: true,
      transitions: [],
    },
  ],
};
