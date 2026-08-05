import type { QuestScript } from "../QuestScript";

export const investigationScript: QuestScript = {
  id: "investigation",
  title: "Следствие",
  params: [
    {
      id: "murderer",
      name: "Убийца",
      min: 0,
      max: 3,
      initial: "random",
      showInUI: false,
    },
    {
      id: "interviewed_0",
      name: "Допрос Карл",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "interviewed_1",
      name: "Допрос Вэй",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "interviewed_2",
      name: "Допрос Рина",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "interviewed_3",
      name: "Допрос Ортега",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "interviews_done",
      name: "Опрошено",
      min: 0,
      max: 4,
      initial: 0,
      showInUI: true,
    },
    {
      id: "examined_0",
      name: "Улика 1",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_1",
      name: "Улика 2",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_2",
      name: "Улика 3",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_3",
      name: "Улика 4",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_4",
      name: "Улика 5",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_5",
      name: "Улика 6",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_6",
      name: "Улика 7",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "examined_7",
      name: "Улика 8",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "clues_examined",
      name: "Улик изучено",
      min: 0,
      max: 8,
      initial: 0,
      showInUI: true,
    },
    {
      id: "rating",
      name: "Репутация",
      min: -9999,
      max: 500,
      initial: 500,
      critMin: 0,
      critTarget: "quest_failure_rating",
      showInUI: true,
    },
  ],
  startLocation: "warehouse",
  locations: [
    {
      id: "warehouse",
      text: "Грузовой отсек станции «Кентавр-9». Двери загерметизированы изнутри — с 02:00 отсюда никто не выходил и не входил. Тело торговца Льерны лежит у шлюза Б-7, лицом вниз, руки раскинуты. Время смерти: 02:50. Убийца всё ещё на станции. Их четверо, и один из них лжёт.\nОпрошено: {interviews_done}/4 | Улик: {clues_examined}/8 | Репутация: {rating}\n\nС чего начнём?",
      transitions: [
        {
          id: "go_interview_mechanic",
          label: "Прижать механика Карла в ангаре",
          toLocation: "interview_mechanic",
          condition: "interviewed_0 == 0",
          effects: [],
        },
        {
          id: "go_interview_pilot",
          label: "Вызвать пилота Вэй на разговор",
          toLocation: "interview_pilot",
          condition: "interviewed_1 == 0",
          effects: [],
        },
        {
          id: "go_interview_trader2",
          label: "Расспросить торговца Рину",
          toLocation: "interview_trader2",
          condition: "interviewed_2 == 0",
          effects: [],
        },
        {
          id: "go_interview_guard",
          label: "Взять в оборот охранника Ортегу",
          toLocation: "interview_guard",
          condition: "interviewed_3 == 0",
          effects: [],
        },
        {
          id: "examine_clue_0",
          label: "Улика 1: следы борьбы",
          toLocation: "examine_evidence_0",
          condition: "examined_0 == 0",
          effects: [],
        },
        {
          id: "examine_clue_1",
          label: "Улика 2: характер травмы",
          toLocation: "examine_evidence_1",
          condition: "examined_1 == 0",
          effects: [],
        },
        {
          id: "examine_clue_2",
          label: "Улика 3: камера наблюдения",
          toLocation: "examine_evidence_2",
          condition: "examined_2 == 0",
          effects: [],
        },
        {
          id: "examine_clue_3",
          label: "Улика 4: перчатки",
          toLocation: "examine_evidence_3",
          condition: "examined_3 == 0",
          effects: [],
        },
        {
          id: "examine_clue_4",
          label: "Улика 5: журнал переговоров",
          toLocation: "examine_evidence_4",
          condition: "examined_4 == 0",
          effects: [],
        },
        {
          id: "examine_clue_5",
          label: "Улика 6: карточка доступа",
          toLocation: "examine_evidence_5",
          condition: "examined_5 == 0",
          effects: [],
        },
        {
          id: "examine_clue_6",
          label: "Улика 7: ключ от арсенала",
          toLocation: "examine_evidence_6",
          condition: "examined_6 == 0",
          effects: [],
        },
        {
          id: "examine_clue_7",
          label: "Улика 8: анонимное сообщение",
          toLocation: "examine_evidence_7",
          condition: "examined_7 == 0",
          effects: [],
        },
        {
          id: "go_accuse",
          label: "Назвать имя убийцы",
          toLocation: "accuse_gate_interviews",
          effects: [],
        },
      ],
    },

    {
      id: "interview_mechanic",
      text: "Механик Карл Хенце, 42 года. Руки в застарелой смазке, взгляд загнанный.\n«Всю ночь я провозился с гиперприводом в дальнем ангаре, один. Свидетелей нет, и я это понимаю, как это выглядит. Карточку доступа я потерял ещё с вечера — весь стеллаж перерыл, нету. Да, мы с Льерной сцепились из-за долга, он мне полторы тысячи задолжал. Но чтоб убить человека... За кого вы меня держите?»",
      transitions: [
        {
          id: "done_mechanic",
          label: "Занести показания в дело",
          toLocation: "warehouse",
          effects: ["interviewed_0 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "interview_pilot",
      text: "Пилот Вэй Жанхуэй, 35 лет. Говорит ровно, почти скучающе — но пальцы всё время постукивают по колену.\n«Я сидел в рубке, сверял навигационные журналы перед вылетом. Один. Свидетелей, само собой, нет — кто ходит в рубку ночью? Льерна... да, он копал под мой старый рейс, грозился всё выложить руководству. Неприятно, не спорю. Но у меня лицензия и репутация, я не мясник со шлюзовым ключом.»",
      transitions: [
        {
          id: "done_pilot",
          label: "Занести показания в дело",
          toLocation: "warehouse",
          effects: ["interviewed_1 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "interview_trader2",
      text: "Торговец Рина Коваль, 28 лет. Держится собранно, смотрит прямо в глаза.\n«С 01:30 до 03:00 я вела переговоры с диспетчером дока — согласовывала швартовку. Всё записано, каждая минута, поднимите лог связи и проверьте. Льерна перехватил у меня контракт на руду, оставил без сезонной выручки. Да, я его ненавидела, врать не стану. Но пока его убивали, мой голос звучал в эфире дока. Это не алиби — это протокол.»",
      transitions: [
        {
          id: "done_trader2",
          label: "Занести показания в дело",
          toLocation: "warehouse",
          effects: ["interviewed_2 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "interview_guard",
      text: "Охранник Ортега Сааведра, 51 год. Старый служака, отвечает не сразу — взвешивает каждое слово.\n«Обходил посты по маршруту, как каждую ночь. В 02:15 вырубил камеру у Б-7 — та мигала, я решил, сбой питания. Занести в журнал забыл, каюсь, устал под утро. Ключ от арсенала? Так я же сам его в каюту механика отнёс, неделю назад, Карл просил — ему инструмент из оружейки нужен был. А что, всплыл где-то этот ключ?»",
      transitions: [
        {
          id: "confront_key",
          label: "Предъявить Ортеге всплывший ключ от арсенала",
          toLocation: "guard_key_admission",
          condition: "examined_6 == 1",
          effects: [],
        },
        {
          id: "done_guard",
          label: "Занести показания в дело",
          toLocation: "warehouse",
          effects: ["interviewed_3 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "guard_key_admission",
      text: "Вы кладёте перед Ортегой протокол: ключ от арсенала найден в каюте Карла — та самая «улика», что кричит о вине механика. Старик даже не меняется в лице.\n«Так я ж вам сразу сказал — сам отнёс, неделю назад, при свидетелях. Полсмены видело, спросите кого угодно. Кто-то знал про это и подложил ключ как приманку — расчёт был, что вы клюнете на Карла и дальше копать не станете. Моё слово — вот оно, в вашем деле. Пользуйтесь.»\nПрежнее признание охранника теперь работает на вас: подброшенная улика №7 обезврежена его же показаниями, и рамка вокруг механика трещит.",
      transitions: [
        {
          id: "guard_back_to_interview",
          label: "Вернуться к допросу",
          toLocation: "interview_guard",
          effects: [],
        },
      ],
    },

    {
      id: "examine_evidence_0",
      text: "Улика 1 — Следы борьбы у шлюза Б-7.\nЗапорный механизм погнут — здесь кого-то прижали к переборке. В петлях застрял клочок синтетического волокна, серо-зелёного. Спектрометр даёт однозначный ответ: технический комбинезон, стандарт ТС-400. Такие носит только ремонтная бригада станции.",
      transitions: [
        {
          id: "back_from_e0",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_0 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "examine_evidence_1",
      text: "Улика 2 — Характер травмы.\nСмертельный удар нанесён сзади, в основание черепа. Орудие — гладкий цилиндрический предмет диаметром 3–4 см, вроде рукояти тяжёлого инструмента. Удар один и безошибочно точный: бил тот, кто знает, куда бить. Жертва не успела обернуться. Орудие не найдено.",
      transitions: [
        {
          id: "back_from_e1",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_1 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "examine_evidence_2",
      text: "Улика 3 — Камера наблюдения у Б-7.\nМёртвая зона с 02:15 до 02:47 — ровно окно убийства. Охранник списал на сбой питания. Но диагностический лог не врёт: камеру погасили командой на отключение, введённой вручную с охранного терминала. Сбоя не было. Кто-то знал, как ослепить станцию, и сделал это намеренно.",
      transitions: [
        {
          id: "back_from_e2",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_2 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "examine_evidence_3",
      text: "Улика 4 — Перчатки в мусоропроводе.\nПара технических перчаток, спешно сброшенных в утилизатор. На них — машинная смазка, кровь жертвы и налипшая серо-стальная краска, точь-в-точь как на трубе у Б-7. Убийца хватался за неё. Но вот загвоздка: размер S, маленькая кисть. Механик Карл — крупный мужчина, у него ладонь вдвое шире.",
      transitions: [
        {
          id: "back_from_e3",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_3 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "examine_evidence_4",
      text: "Улика 5 — Журнал переговоров.\nВ 02:00 Льерна принял голосовой вызов с внутреннего канала станции. Абонент скрыт, содержание зашифровано его личным ключом. Разговор длился восемь минут и оборвался в 02:08 — сразу после этого Льерна пошёл к шлюзу Б-7, где его и убили. Кто-то выманил его туда. Кто-то, кому он доверял настолько, чтобы прийти на встречу в глухой ночной час.\nЗапись зашифрована, но сам голос — нет. Его можно прогнать через голосовые слепки экипажа.",
      transitions: [
        {
          id: "deduce_voice",
          label: "Прогнать голос через биометрию экипажа",
          toLocation: "voice_analysis",
          effects: [],
        },
        {
          id: "back_from_e4",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_4 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "voice_analysis",
      text: "Станционный ИИ раскладывает восьмиминутную запись на форманты и прогоняет через голосовые слепки четверых. Это единственный человек, кого Льерна впустил к шлюзу Б-7 в свой последний час, — тот, кому он доверял. Полоса совпадения ползёт вверх...",
      transitions: [
        {
          id: "voice_is_mechanic",
          label: "...",
          toLocation: "voice_match_0",
          condition: "murderer == 0",
          effects: [],
          autoExecute: true,
        },
        {
          id: "voice_is_pilot",
          label: "...",
          toLocation: "voice_match_1",
          condition: "murderer == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "voice_is_trader2",
          label: "...",
          toLocation: "voice_match_2",
          condition: "murderer == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "voice_is_guard",
          label: "...",
          toLocation: "voice_match_3",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "voice_match_0",
      text: "Совпадение — 97%. Голос принадлежит механику Карлу Хенце. Это он звонком выманил Льерну к шлюзу и там же оборвал разговор — и жизнь. Подброшенные улики тыкали в Карла слишком услужливо, и в этом был его расчёт: чтобы вы приняли правду за подставу и оправдали настоящего убийцу. На сей раз клевета совпала с виновным.",
      transitions: [
        {
          id: "voice_logged_0",
          label: "Занести вывод в досье",
          toLocation: "warehouse",
          effects: ["examined_4 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "voice_match_1",
      text: "Совпадение — 96%. Голос принадлежит пилоту Вэй Жанхуэй. Тот же синтаксис, что в анонимке, тыкавшей в механика; та же маленькая кисть, что оставила перчатки размера S. Она выманила Льерну на встречу, убила и аккуратно навела следствие на Карла. «Лицензия и репутация» оказались лучшей маской.",
      transitions: [
        {
          id: "voice_logged_1",
          label: "Занести вывод в досье",
          toLocation: "warehouse",
          effects: ["examined_4 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "voice_match_2",
      text: "Совпадение — 95%. Голос принадлежит торговцу Рине Коваль. Её «железный протокол» алиби — восьмиминутная петля, пущенная в эфир дока, пока сама она была у Б-7; маленькая кисть под перчатки размера S совпадает. Контракт на руду стоил Льерне жизни, а ей — почти идеального прикрытия.",
      transitions: [
        {
          id: "voice_logged_2",
          label: "Занести вывод в досье",
          toLocation: "warehouse",
          effects: ["examined_4 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "voice_match_3",
      text: "Совпадение — 98%. Голос принадлежит охраннику Ортеге Сааведре. Только он мог погасить камеру у Б-7 командой с охранного терминала — и сделал это вручную, не сбоем. Ключ он «случайно» оставил у Карла заранее, камеру списал на питание. Обход по маршруту был безупречным прикрытием для того, кто знает станцию до последнего люка.",
      transitions: [
        {
          id: "voice_logged_3",
          label: "Занести вывод в досье",
          toLocation: "warehouse",
          effects: ["examined_4 = 1", "clues_examined += 1"],
        },
      ],
    },

    {
      id: "examine_evidence_5",
      text: "Улика 6 — Карточка доступа [ПОДОЗРИТЕЛЬНА].\nСлужебная карточка механика Карла отметилась на считывателе шлюза Б-7 в 02:30 — в самый разгар мёртвой зоны камеры. На первый взгляд — прямая улика против Карла. ПРОТИВОРЕЧИЕ: но Карл ещё вечером заявил, что потерял карточку, и любой на станции мог её подобрать и провести к шлюзу вместо себя. Карта прошла — но кто держал её в руке?",
      transitions: [
        {
          id: "back_from_e5",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_5 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "examine_evidence_6",
      text: "Улика 7 — Ключ от арсенала [ПОДОЗРИТЕЛЬНА].\nВ каюте механика найден ключ от станционного арсенала — не то место, где ему полагается быть. Ещё один камень в огород Карла. ПРОТИВОРЕЧИЕ: но охранник Ортега сам, не дрогнув, признал, что отнёс этот ключ в каюту неделю назад по просьбе механика. Ключ лежал там открыто и давно — его присутствие ничего не доказывает, кроме того, что кто-то хотел, чтобы вы на него посмотрели.",
      transitions: [
        {
          id: "back_from_e6",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_6 = 1", "clues_examined += 1"],
        },
      ],
    },
    {
      id: "examine_evidence_7",
      text: "Улика 8 — Анонимное сообщение [ПОДОЗРИТЕЛЬНА].\nВ следственный терминал кто-то сбросил анонимку в одну строку: «Убийца — механик. Не ищите дальше.» Слишком услужливо, слишком вовремя. ПРОТИВОРЕЧИЕ: лингвистический анализ синтаксиса и характерных оборотов даёт совпадение с речью пилота Вэй Жанхуэй. Тот, кто так настойчиво подталкивает вас к Карлу, сам старается остаться в тени.",
      transitions: [
        {
          id: "back_from_e7",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_7 = 1", "clues_examined += 1"],
        },
      ],
    },

    {
      id: "accuse_gate_interviews",
      text: "Вы взвешиваете, готовы ли назвать имя...",
      transitions: [
        {
          id: "gate_interviews_fail",
          label: "...",
          toLocation: "not_ready_interviews",
          condition: "interviews_done < 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "gate_interviews_pass",
          label: "...",
          toLocation: "accuse_gate_clues",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "accuse_gate_clues",
      text: "Вы ещё раз перебираете в памяти улики...",
      transitions: [
        {
          id: "gate_clues_fail",
          label: "...",
          toLocation: "not_ready_clues",
          condition: "clues_examined < 5",
          effects: [],
          autoExecute: true,
        },
        {
          id: "gate_clues_pass",
          label: "...",
          toLocation: "accuse",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "not_ready_interviews",
      text: "Рано. Обвинить человека, не выслушав всех четверых, — верный способ повесить убийство на невиновного и упустить настоящего. Сначала допросите каждого.\nОпрошено: {interviews_done}/4.",
      transitions: [
        {
          id: "back_from_gate_interviews",
          label: "Продолжить расследование",
          toLocation: "warehouse",
          effects: [],
        },
      ],
    },
    {
      id: "not_ready_clues",
      text: "Доказательств пока слишком мало, чтобы они сложились в картину. Пять улик — тот минимум, ниже которого обвинение развалится на первом же алиби. Осмотрите ещё.\nИзучено: {clues_examined}/8.",
      transitions: [
        {
          id: "back_from_gate_clues",
          label: "Продолжить расследование",
          toLocation: "warehouse",
          effects: [],
        },
      ],
    },

    {
      id: "accuse",
      text: "Четверо стоят перед вами в тесном грузовом отсеке. Улики собраны, показания записаны, противоречия обнажены. Теперь одно слово решит всё — и его уже не взять назад. Кто убил торговца Льерну?\n\nВнимание: ложное обвинение опозорит вас и стоит 200 репутации. Настоящий убийца будет смотреть, как вы ошибаетесь.",
      transitions: [
        {
          id: "accuse_mechanic",
          label: "«Убил ты, Карл. Механик.»",
          toLocation: "check_mechanic_guilt",
          effects: [],
        },
        {
          id: "accuse_pilot",
          label: "«Это ты, Вэй. Пилот.»",
          toLocation: "check_pilot_guilt",
          effects: [],
        },
        {
          id: "accuse_trader2",
          label: "«Твоих рук дело, Рина. Торговец.»",
          toLocation: "check_trader2_guilt",
          effects: [],
        },
        {
          id: "accuse_guard",
          label: "«Ты убийца, Ортега. Охранник.»",
          toLocation: "check_guard_guilt",
          effects: [],
        },
      ],
    },

    {
      id: "check_mechanic_guilt",
      text: "Вы называете имя. В отсеке повисает тишина...",
      transitions: [
        {
          id: "mechanic_correct",
          label: "...",
          toLocation: "quest_success",
          condition: "murderer == 0",
          effects: [],
          autoExecute: true,
        },
        {
          id: "mechanic_wrong",
          label: "...",
          toLocation: "wrong_accusation",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_pilot_guilt",
      text: "Вы называете имя. В отсеке повисает тишина...",
      transitions: [
        {
          id: "pilot_correct",
          label: "...",
          toLocation: "quest_success",
          condition: "murderer == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "pilot_wrong",
          label: "...",
          toLocation: "wrong_accusation",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_trader2_guilt",
      text: "Вы называете имя. В отсеке повисает тишина...",
      transitions: [
        {
          id: "trader2_correct",
          label: "...",
          toLocation: "quest_success",
          condition: "murderer == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "trader2_wrong",
          label: "...",
          toLocation: "wrong_accusation",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "check_guard_guilt",
      text: "Вы называете имя. В отсеке повисает тишина...",
      transitions: [
        {
          id: "guard_correct",
          label: "...",
          toLocation: "quest_success",
          condition: "murderer == 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "guard_wrong",
          label: "...",
          toLocation: "wrong_accusation",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    {
      id: "wrong_accusation",
      text: "Обвиняемый спокойно выкладывает своё алиби — и оно железное. По отсеку проходит ропот, кто-то усмехается. Вы указали не на того. Настоящий убийца по-прежнему среди этих четверых и теперь знает, что вы способны ошибиться.\nШтраф: −200 репутации. Репутация: {rating}\n\nМожно назвать другое имя — но следующая ошибка обойдётся ещё дороже.",
      transitions: [
        {
          id: "retry_accusation",
          label: "Назвать другое имя",
          toLocation: "accuse",
          effects: ["rating -= 200"],
        },
      ],
    },

    {
      id: "quest_success",
      text: "Улики сомкнулись, и убийце нечего возразить. Под тяжестью противоречий он ломается и сознаётся прямо в отсеке. Наручники щёлкают, его уводят к властям станции — Льерна отмщён, справедливость восстановлена.\nВы прочли то, что убийца так старательно прятал за подброшенными уликами. Администрация «Кентавра-9» благодарит вас, а ваше имя детектива теперь звучит по всему сектору.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_rating",
      text: "Одно ложное обвинение за другим — и терпение станции иссякло. Трое невиновных прошли через ваши подозрения, а настоящий убийца спокойно наблюдал за этим фарсом. Ваша репутация детектива рассыпалась в прах.\nАдминистрация «Кентавра-9» отстраняет вас от дела и навсегда закрывает вам доступ к расследованиям. Где-то на станции убийца улыбается.",
      isFailure: true,
      transitions: [],
    },
  ],
};
