import type { QuestScript } from "../QuestScript";

// Design: A cryptanalysis puzzle. A coded burst claws its way out of the static
// on a dead channel — someone, or something, is calling. You have a finite
// decoder-array `power` budget; every analysis pass drains it and raises
// `clarity`. At zero power the array browns out and the signal is lost forever
// (a `critMin` redirect to ending_signal_lost — the resource-pressure spine).
// The puzzle is efficiency: pattern-deduction yields the most clarity per unit
// of power; brute-forcing the cipher works but bleeds the budget dry.
// Choice points:
//   1. First pass — deduce the repeating structure (efficient), brute-force the
//      cipher (wasteful), or cross-reference the distress catalogue (middling).
//   2. Second pass — a clean spectral filter (steady), an overclock gamble
//      (roll: a clean lock or an overheat that costs power), or lock what you
//      have and read it (free, no gain).
//   3. Interpret — an auto gate on `clarity` decides how much of the message
//      you recovered.
// Outcomes (by `clarity` at interpret, unless power ran out first):
//   - ending_decoded  (clarity >= 8 — coords AND message recovered)  SUCCESS
//   - ending_partial  (clarity >= 4 — coords, message garbled)       SUCCESS
//   - ending_garbled  (clarity < 4  — nothing usable, channel died)  FAILURE
//   - ending_signal_lost (power ran out mid-decode)                  FAILURE
export const signalDecodeScript: QuestScript = {
  id: "signal-decode",
  title: "Расшифровка сигнала",
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
      id: "power",
      name: "Заряд дешифратора",
      min: -9999,
      max: 99,
      initial: 8,
      critMin: 1,
      critTarget: "ending_signal_lost",
      showInUI: true,
    },
    {
      id: "clarity",
      name: "Чёткость сигнала",
      min: 0,
      max: 999,
      initial: 0,
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
  startLocation: "intercept",
  locations: [
    {
      id: "intercept",
      text: "Мёртвый канал вдруг ожил. Сквозь шипение космоса пробивается коротая пачка импульсов — сжатая, зашифрованная, и повторяется каждые одиннадцать секунд, будто кто-то там, в темноте, зовёт снова и снова. Дешифратор заряжен не до конца: батарея просядет быстро.\nЗаряд дешифратора: {power} | Чёткость сигнала: {clarity}\n\nС чего начать взлом?",
      transitions: [
        {
          id: "analyze_pattern",
          label:
            "Разобрать повтор — вычислить структуру пачки на бумаге (−2 заряда, +4 чёткости; экономно)",
          toLocation: "refine",
          effects: ["power -= 2", "clarity += 4"],
        },
        {
          id: "brute_force",
          label:
            "Влобовой перебор ключей — надёжно, но жрёт батарею (−5 заряда, +5 чёткости)",
          toLocation: "refine",
          effects: ["power -= 5", "clarity += 5"],
        },
        {
          id: "cross_ref",
          label:
            "Сверить с каталогом аварийных кодов — вдруг знакомая сигнатура (−3 заряда, +3 чёткости)",
          toLocation: "refine",
          effects: ["power -= 3", "clarity += 3"],
        },
      ],
    },
    {
      id: "refine",
      text: "Первый слой поддался — за шумом проступает ритм осмысленной речи. Ещё немного, и вы поймёте, кто и откуда кричит в пустоту. Индикатор заряда мигает предупреждающим янтарём.\nЗаряд дешифратора: {power} | Чёткость сигнала: {clarity}",
      transitions: [
        {
          id: "clean_filter",
          label:
            "Спектральный фильтр — аккуратно снять остаточный шум (−2 заряда, +4 чёткости)",
          toLocation: "interpret",
          effects: ["power -= 2", "clarity += 4"],
        },
        {
          id: "overclock",
          label:
            "Разогнать дешифратор до предела — рискованно, батарея может не выдержать (−1 заряд, бросок)",
          toLocation: "overclock_check",
          effects: ["power -= 1", "roll = random(0,9)"],
        },
        {
          id: "quick_lock",
          label:
            "Хватит рисковать — прочитать то, что уже вытянули, и не тратить заряд",
          toLocation: "interpret",
          effects: [],
        },
      ],
    },
    {
      id: "overclock_check",
      text: "Дешифратор воет на запредельной частоте, корпус нагревается под ладонью...",
      transitions: [
        {
          id: "oc_good",
          label: "...",
          toLocation: "interpret",
          condition: "roll >= 4",
          effects: ["clarity += 5"],
          autoExecute: true,
        },
        {
          id: "oc_bad",
          label: "...",
          toLocation: "interpret",
          effects: ["clarity += 1", "power -= 2"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "interpret",
      text: "Вы сводите всё, что удалось вытянуть, в единую расшифровку и вчитываетесь в проступающие строки.\nЧёткость сигнала: {clarity}",
      transitions: [
        {
          id: "read_full",
          label: "...",
          toLocation: "ending_decoded",
          condition: "clarity >= 8",
          effects: ["credits += 3000", "rating += 20"],
          autoExecute: true,
        },
        {
          id: "read_part",
          label: "...",
          toLocation: "ending_partial",
          condition: "clarity >= 4",
          effects: ["credits += 1200", "rating += 8"],
          autoExecute: true,
        },
        {
          id: "read_none",
          label: "...",
          toLocation: "ending_garbled",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_decoded",
      text: "Строки складываются целиком: координаты дрейфующего спасательного модуля, число живых на борту, остаток воздуха — и имя. Спасатели уходят по вашему пеленгу немедленно; через сутки в порт приходит благодарность от семнадцати человек, которые уже прощались с жизнью. Ваш позывной теперь знают на всех аварийных частотах сектора.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_partial",
      text: "Координаты вы вытянули, но само сообщение осыпалось в кашу помех — кто зовёт и сколько их, осталось загадкой. Спасательный борт уходит вслепую, по одному лишь пеленгу. Успеют ли — вы так и не узнаете; но вы дали им хотя бы точку на карте.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_garbled",
      text: "Как вы ни бились, из-под шифра выполз лишь бессвязный обрывок — ни координат, ни имени. Через минуту канал замолчал совсем, будто источник иссяк. Где-то там, в темноте, кто-то ждал ответа, которого вы не смогли им дать.\nЧёткость сигнала: {clarity}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_signal_lost",
      text: "Индикатор заряда упал в ноль, и дешифратор погас с тихим щелчком прямо на середине слова. Пока вы лихорадочно перекидывали питание, повтор оборвался и не возобновился. Вы остались наедине с мёртвым каналом и мыслью, что стояли в одном шаге от разгадки.\nЗаряд дешифратора: {power}",
      isFailure: true,
      transitions: [],
    },
  ],
};
