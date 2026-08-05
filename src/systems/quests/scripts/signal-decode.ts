import type { QuestScript } from "../QuestScript";

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
    {
      id: "method",
      name: "Метод взлома",
      min: 0,
      max: 3,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "intercept",
  locations: [
    {
      id: "intercept",
      text: "Мёртвый канал вдруг ожил. Сквозь шипение космоса пробивается короткая пачка импульсов — сжатая, зашифрованная, и повторяется каждые одиннадцать секунд, будто кто-то там, в темноте, зовёт снова и снова. Это не маяк и не эхо: так шлют, когда счёт идёт на часы, а воздуха в отсеке всё меньше. Дешифратор заряжен не до конца — батарея просядет быстро, и вместе с ней просядет чей-то последний шанс.\nЗаряд дешифратора: {power} | Чёткость сигнала: {clarity}\n\nС чего начать взлом? Каждая ошибка — это минуты, которых у них нет.",
      transitions: [
        {
          id: "analyze_pattern",
          label:
            "Разобрать повтор — вычислить структуру пачки на бумаге (−2 заряда, +4 чёткости; экономно)",
          toLocation: "refine",
          effects: ["power -= 2", "clarity += 4", "method = 1"],
        },
        {
          id: "brute_force",
          label:
            "Лобовой перебор ключей — надёжно, но жрёт батарею (−5 заряда, +5 чёткости)",
          toLocation: "refine",
          effects: ["power -= 5", "clarity += 5", "method = 2"],
        },
        {
          id: "cross_ref",
          label:
            "Сверить с каталогом аварийных кодов — вдруг знакомая сигнатура (−3 заряда, +3 чёткости)",
          toLocation: "refine",
          effects: ["power -= 3", "clarity += 3", "method = 3"],
        },
      ],
    },
    {
      id: "refine",
      text: "Первый слой поддался — за шумом проступает ритм осмысленной речи, и в нём — человеческий голос, севший, испуганный. Ещё немного, и вы поймёте, кто и откуда кричит в пустоту, и хватит ли времени до них дойти. Индикатор заряда мигает предупреждающим янтарём: батарея на исходе.\nЗаряд дешифратора: {power} | Чёткость сигнала: {clarity}",
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
      text: "Дешифратор воет на запредельной частоте, корпус нагревается под ладонью, а на другом конце канала кто-то ещё дышит. Плата или выдержит рывок, или сгорит — и заберёт голос с собой...",
      transitions: [
        {
          id: "oc_good",
          label: "Разгон удержался — дожать сигнал",
          toLocation: "overclock_locked",
          condition: "roll >= 4",
          effects: ["clarity += 5"],
          autoExecute: true,
        },
        {
          id: "oc_bad",
          label: "Плата не выдержала — гасить перегрев",
          toLocation: "overclock_fried",
          effects: ["clarity += 1", "power -= 2"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "overclock_locked",
      text: "Разгон выдержал. На пике частоты шум разом отступает — и сквозь него, чисто, как удар колокола, проступает вся строка целиком. Вы успели.\nЧёткость сигнала: {clarity}",
      transitions: [
        {
          id: "ocl_read",
          label: "Свести расшифровку",
          toLocation: "interpret",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "overclock_fried",
      text: "Плата вспыхивает искрой, по отсеку тянет палёной изоляцией. Дешифратор проседает, откусив кусок заряда, и удерживает лишь обрывок того, что почти успел вытянуть. Голос в наушнике дрогнул — и стал тише.\nЗаряд дешифратора: {power} | Чёткость сигнала: {clarity}",
      transitions: [
        {
          id: "ocf_read",
          label: "Спасать то, что осталось",
          toLocation: "interpret",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "interpret",
      text: "Вы сводите всё, что удалось вытянуть, в единую расшифровку и вчитываетесь в проступающие строки — там, где были координаты и имена, теперь либо ответ, либо каша помех.\nЧёткость сигнала: {clarity}",
      transitions: [
        {
          id: "read_full",
          label: "...",
          toLocation: "decoded_gate",
          condition: "clarity >= 8",
          effects: ["credits += 3000", "rating += 20"],
          autoExecute: true,
        },
        {
          id: "read_part",
          label: "...",
          toLocation: "partial_gate",
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
      id: "decoded_gate",
      text: "Расшифровка полна. Вы откидываетесь от консоли и переводите дух.",
      transitions: [
        {
          id: "dg_brute",
          label: "...",
          toLocation: "ending_decoded_brute",
          condition: "method == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "dg_catalog",
          label: "...",
          toLocation: "ending_decoded_catalog",
          condition: "method == 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "dg_deduce",
          label: "...",
          toLocation: "ending_decoded",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "partial_gate",
      text: "Координаты есть, но сообщение осыпалось. Вы вглядываетесь в обрывки, надеясь, что пеленга хватит.",
      transitions: [
        {
          id: "pg_brute",
          label: "...",
          toLocation: "ending_partial_brute",
          condition: "method == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "pg_catalog",
          label: "...",
          toLocation: "ending_partial_catalog",
          condition: "method == 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "pg_deduce",
          label: "...",
          toLocation: "ending_partial",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_decoded",
      text: "Вы читали не ключ, а саму структуру — и она открылась чисто, без единого лишнего разряда. Строки складываются целиком: координаты дрейфующего спасательного модуля, число живых на борту, остаток воздуха — и имя. Спасатели уходят по вашему пеленгу немедленно; через сутки в порт приходит благодарность от семнадцати человек, которые уже прощались с жизнью. Ваш позывной теперь знают на всех аварийных частотах сектора.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_decoded_brute",
      text: "Изящества в этом не было: вы проломили шифр в лоб, спалив половину плат и почти весь заряд. Дешифратор дымится, но строки — целы. Координаты модуля, число живых, остаток воздуха, имя. Спасатели срываются немедленно; семнадцать человек, уже прощавшихся с жизнью, доживают до утра. Пусть грубо — но вы вытащили их из темноты.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_decoded_catalog",
      text: "Сигнатуру вы узнали ещё на первом слое — старый аварийный код спасательной гильдии, из тех, что помнят наизусть только ветераны частот. Дальше было делом техники. Строки складываются целиком: координаты, число живых, остаток воздуха, имя. Спасатели уходят по пеленгу немедленно; семнадцать человек возвращаются домой. Кто-то однажды не поленился внести этот код в каталог — и сегодня это спасло жизни.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_partial",
      text: "Вы вытянули структуру ровно настолько, чтобы снять координаты, — но само сообщение осыпалось в кашу помех, и кто зовёт, сколько их и сколько им осталось, так и осталось загадкой. Спасательный борт уходит вслепую, по одному лишь пеленгу. Успеют ли — вы так и не узнаете; но вы дали им хотя бы точку на карте.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_partial_brute",
      text: "Перебор выел батарею раньше, чем вы добрались до сути: из-под шифра выползли только координаты, а остальное сгорело вместе с платами. Кто там и сколько им дышать — вы не узнали. Спасательный борт уходит вслепую, по одному пеленгу. Грубая сила дала им точку на карте — и отняла всё остальное.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_partial_catalog",
      text: "Каталог дал вам сигнатуру и координаты, но самой записи — имён, числа живых — в старом коде уже не было, а дотянуть остальное заряда не хватило. Спасательный борт уходит по голому пеленгу. Знакомый код привёл их к нужной точке; остальное придётся искать на месте, вслепую.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_garbled",
      text: "Как вы ни бились, из-под шифра выполз лишь бессвязный обрывок — ни координат, ни имени, ни точки на карте. Через минуту канал замолчал совсем, будто источник иссяк. Где-то там, в темноте, кто-то ждал ответа, которого вы не смогли им дать — и перестал ждать.\nЧёткость сигнала: {clarity}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_signal_lost",
      text: "Индикатор заряда упал в ноль, и дешифратор погас с тихим щелчком прямо на середине слова. Пока вы лихорадочно перекидывали питание, повтор оборвался и не возобновился. Вы остались наедине с мёртвым каналом и мыслью, что стояли в одном шаге от разгадки — а кто-то там так и не дождался.\nЗаряд дешифратора: {power}",
      isFailure: true,
      transitions: [],
    },
  ],
};
