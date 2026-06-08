import type { QuestScript } from "../QuestScript";

// Design: Murder mystery on an orbital station.
// 4 suspects: mechanic (0), pilot (1), trader2 (2), guard (3).
// murderer = random(0,3) at quest start.
// Clues 0-4 are real physical evidence; clues 5-7 are planted to frame the mechanic.
// Player must interview all 4 suspects + examine >=5 clues before accusing.
// Wrong accusation costs 200 reputation; 3 wrong accusations = failure.
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
    // ── HUB ────────────────────────────────────────────────────────────────
    {
      id: "warehouse",
      text: "Склад станции. Тело торговца Льерны найдено здесь в 02:50.\nОпрошено: {interviews_done}/4 | Улик: {clues_examined}/8 | Репутация: {rating}\n\nЧто делать?",
      transitions: [
        {
          id: "go_interview_mechanic",
          label: "Допросить механика Карла",
          toLocation: "interview_mechanic",
          condition: "interviewed_0 == 0",
          effects: [],
        },
        {
          id: "go_interview_pilot",
          label: "Допросить пилота Вэй",
          toLocation: "interview_pilot",
          condition: "interviewed_1 == 0",
          effects: [],
        },
        {
          id: "go_interview_trader2",
          label: "Допросить торговца Рину",
          toLocation: "interview_trader2",
          condition: "interviewed_2 == 0",
          effects: [],
        },
        {
          id: "go_interview_guard",
          label: "Допросить охранника Ортегу",
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
          label: "Обвинить подозреваемого",
          toLocation: "accuse_gate_interviews",
          effects: [],
        },
      ],
    },

    // ── INTERVIEWS ─────────────────────────────────────────────────────────
    {
      id: "interview_mechanic",
      text: "Механик Карл Хенце, 42 года.\n«В ту ночь я чинил гиперпривод в ангаре. Карточку доступа потерял ещё вечером — искал везде. Да, мы с Льерной поспорили о долге, но убивать? Это безумие.»",
      transitions: [
        {
          id: "done_mechanic",
          label: "Записать показания",
          toLocation: "warehouse",
          effects: ["interviewed_0 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "interview_pilot",
      text: "Пилот Вэй Жанхуэй, 35 лет.\n«Я был в рубке управления — проверял навигационные журналы. Один, без свидетелей. Льерна хотел меня шантажировать насчёт старого рейса. Может, я и был зол, но я профессионал.»",
      transitions: [
        {
          id: "done_pilot",
          label: "Записать показания",
          toLocation: "warehouse",
          effects: ["interviewed_1 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "interview_trader2",
      text: "Торговец Рина Коваль, 28 лет.\n«Я была на связи с диспетчером дока с 01:30 до 03:00 — есть лог переговоров. Льерна перехватил мой контракт. Да, я его ненавидела. Но у меня железное алиби.»",
      transitions: [
        {
          id: "done_trader2",
          label: "Записать показания",
          toLocation: "warehouse",
          effects: ["interviewed_2 = 1", "interviews_done += 1"],
        },
      ],
    },
    {
      id: "interview_guard",
      text: "Охранник Ортега Сааведра, 51 год.\n«Я обходил посты по маршруту. В 02:15 я отключил камеру — мигала, технический сбой. Должен был занести в журнал, но забыл. Ключ от арсенала? Оставил в каюте механика неделю назад — он просил.»",
      transitions: [
        {
          id: "done_guard",
          label: "Записать показания",
          toLocation: "warehouse",
          effects: ["interviewed_3 = 1", "interviews_done += 1"],
        },
      ],
    },

    // ── EVIDENCE 0–4 (real clues) ──────────────────────────────────────────
    {
      id: "examine_evidence_0",
      text: "Улика 1 — Следы борьбы у шлюза Б-7.\nСинтетическое волокно зацепилось в петлях запора. Цвет: серо-зелёный. Тип ткани: технический комбинезон, стандарт ТС-400.",
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
      text: "Улика 2 — Характер травмы.\nУдар затупленным цилиндрическим предметом диаметром 3–4 см в основание черепа. Один удар, точный. Орудие не найдено.",
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
      text: "Улика 3 — Камера наблюдения.\nОтключена с 02:15 до 02:47. Охранник объяснил технический сбой. Однако диагностический лог показывает: отключение было программным.",
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
      text: "Улика 4 — Перчатки в мусоропроводе.\nТехнические перчатки со следами машинной смазки и крови. Краска от трубы у шлюза Б-7. Размер S.",
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
      text: "Улика 5 — Журнал переговоров.\nВ 02:00 Льерна установил голосовой сеанс с неизвестным абонентом на станции. Содержание зашифровано. Сеанс завершён в 02:08 — затем он направился к шлюзу Б-7.",
      transitions: [
        {
          id: "back_from_e4",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_4 = 1", "clues_examined += 1"],
        },
      ],
    },

    // ── EVIDENCE 5–7 (planted clues — point to mechanic, but contradicted) ──
    {
      id: "examine_evidence_5",
      text: "Улика 6 — Карточка доступа [ПОДОЗРИТЕЛЬНА].\nИнструментальная карточка механика зафиксирована у шлюза Б-7 в 02:30. ПРОТИВОРЕЧИЕ: Карл заявил, что потерял карточку накануне вечером — её могли подбросить.",
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
      text: "Улика 7 — Ключ от арсенала [ПОДОЗРИТЕЛЬНА].\nНайден в каюте механика. ПРОТИВОРЕЧИЕ: охранник Ортега заявил, что сам оставил ключ там неделю назад по просьбе механика — улика могла быть подброшена.",
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
      text: "Улика 8 — Анонимное сообщение [ПОДОЗРИТЕЛЬНА].\nПолучено анонимно: «Убийца — механик». ПРОТИВОРЕЧИЕ: лингвистический анализ стиля написания совпадает с речевыми паттернами пилота Вэй.",
      transitions: [
        {
          id: "back_from_e7",
          label: "Занести в досье",
          toLocation: "warehouse",
          effects: ["examined_7 = 1", "clues_examined += 1"],
        },
      ],
    },

    // ── ACCUSATION GATE ────────────────────────────────────────────────────
    {
      id: "accuse_gate_interviews",
      text: "Проверка готовности к обвинению...",
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
      text: "Проверка улик...",
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
      text: "Недостаточно данных. Необходимо опросить всех 4 подозреваемых.\nОпрошено: {interviews_done}/4.",
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
      text: "Недостаточно улик. Необходимо изучить минимум 5 улик.\nИзучено: {clues_examined}/8.",
      transitions: [
        {
          id: "back_from_gate_clues",
          label: "Продолжить расследование",
          toLocation: "warehouse",
          effects: [],
        },
      ],
    },

    // ── ACCUSATION ─────────────────────────────────────────────────────────
    {
      id: "accuse",
      text: "На основании собранных улик и допросов — кто убил торговца Льерну?\n\nВнимание: ложное обвинение стоит 200 репутации.",
      transitions: [
        {
          id: "accuse_mechanic",
          label: "Виновен механик Карл",
          toLocation: "check_mechanic_guilt",
          effects: [],
        },
        {
          id: "accuse_pilot",
          label: "Виновен пилот Вэй",
          toLocation: "check_pilot_guilt",
          effects: [],
        },
        {
          id: "accuse_trader2",
          label: "Виновна торговец Рина",
          toLocation: "check_trader2_guilt",
          effects: [],
        },
        {
          id: "accuse_guard",
          label: "Виновен охранник Ортега",
          toLocation: "check_guard_guilt",
          effects: [],
        },
      ],
    },

    // ── ACCUSATION CHECKS ──────────────────────────────────────────────────
    // Pattern: first auto-execute checks the matching murderer value;
    // fallback (no condition) goes to wrong_accusation.
    {
      id: "check_mechanic_guilt",
      text: "Оглашение приговора...",
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
      text: "Оглашение приговора...",
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
      text: "Оглашение приговора...",
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
      text: "Оглашение приговора...",
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

    // ── WRONG ACCUSATION ───────────────────────────────────────────────────
    {
      id: "wrong_accusation",
      text: "Обвиняемый предъявил неопровержимое алиби. Обвинение отклонено.\nШтраф: −200 репутации. Репутация: {rating}\n\nМожно обвинить другого подозреваемого, но будьте осторожны.",
      transitions: [
        {
          id: "retry_accusation",
          label: "Обвинить другого подозреваемого",
          toLocation: "accuse",
          effects: ["rating -= 200"],
        },
      ],
    },

    // ── TERMINAL ───────────────────────────────────────────────────────────
    {
      id: "quest_success",
      text: "Дело раскрыто! Убийца арестован и передан властям станции.\nВаша репутация детектива подтверждена. Благодарность от администрации станции.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_rating",
      text: "Ваша репутация разрушена. Серия ложных обвинений привела к отстранению от дела.\nАдминистрация станции запретила вам вести расследования.",
      isFailure: true,
      transitions: [],
    },
  ],
};
