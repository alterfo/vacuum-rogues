import type { QuestScript } from "../QuestScript";

// Design: A courtroom-defense puzzle. You stand before a sector tribunal,
// accused of running the blockade that cost a freighter its cargo — and, the
// prosecutor claims, its crew. You build a `defense` case while the judge's
// `hostility` rises; push too hard and the bench holds you in contempt and
// convicts on the spot (a `critMax` redirect to ending_contempt — the
// patience-pressure spine). The verdict is an auto gate on `defense`. The puzzle
// is reading the room: aggression builds the strongest case but inflames the
// judge, while conceding minor points buys goodwill you can spend later.
// Choice points:
//   1. Plea — contrite (cools the bench), defiant (strong but inflames), or lay
//      your logs on the table up front (solid, neutral).
//   2. Cross-examination — discredit the hostile witness (roll: it lands or it
//      backfires), concede a point (cools the bench), or table the manifest.
//   3. Summation — a reasoned appeal, a plea for mercy (cools the bench), or a
//      theatrical grandstand (roll: brilliant or a contempt-baiting disaster).
//   4. Verdict — an auto gate on `defense`.
// Outcomes (by `defense` at verdict, unless held in contempt first):
//   - ending_acquitted (defense >= 8 — full acquittal, name cleared)   SUCCESS
//   - ending_lenient   (defense >= 4 — reduced to a fine)              SUCCESS
//   - ending_guilty    (defense < 4  — convicted, record stained)      FAILURE
//   - ending_contempt  (judge's patience broke — jailed for contempt)  FAILURE
export const tribunalScript: QuestScript = {
  id: "tribunal",
  title: "Трибунал",
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
      id: "defense",
      name: "Сила защиты",
      min: 0,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "hostility",
      name: "Гнев судьи",
      min: 0,
      max: 20,
      initial: 4,
      critMax: 9,
      critTarget: "ending_contempt",
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
  startLocation: "arraignment",
  locations: [
    {
      id: "arraignment",
      text: "Зал трибунала выстужен и тих. Секретарь зачитывает обвинение: прорыв блокады, потеря чужого груза, гибель экипажа сухогруза — и всё это, по словам прокурора, на вашей совести. Судья смотрит поверх очков, и от этого взгляда сводит скулы. Первое слово — за вами.\nСила защиты: {defense} | Гнев судьи: {hostility}",
      transitions: [
        {
          id: "plea_contrite",
          label:
            "Смиренно признать мелкие огрехи — сбить накал (−2 гнева, +1 к защите)",
          toLocation: "cross_exam",
          effects: ["hostility -= 2", "defense += 1"],
        },
        {
          id: "plea_defiant",
          label:
            "Атаковать законность самого обвинения — сильно, но дерзко (+3 к защите, +3 гнева)",
          toLocation: "cross_exam",
          effects: ["defense += 3", "hostility += 3"],
        },
        {
          id: "plea_evidence",
          label:
            "Сразу выложить бортовые журналы — сухие факты без вызова (+2 к защите)",
          toLocation: "cross_exam",
          effects: ["defense += 2"],
        },
      ],
    },
    {
      id: "cross_exam",
      text: "Прокурор выводит свидетеля — диспетчера, чьи показания топят вас глубже с каждым словом. Судья слушает, постукивая стилусом по столу.\nСила защиты: {defense} | Гнев судьи: {hostility}",
      transitions: [
        {
          id: "discredit_witness",
          label:
            "Вскрыть предвзятость свидетеля — рискованно перед судьёй (бросок: удар в цель или мимо)",
          toLocation: "witness_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "concede_point",
          label:
            "Уступить спорный пункт с достоинством — не злить бенч (−1 гнева)",
          toLocation: "summation",
          effects: ["hostility -= 1"],
        },
        {
          id: "table_manifest",
          label:
            "Приобщить к делу грузовой манифест — весомо, но прокурор взовьётся (+3 к защите, +1 гнева)",
          toLocation: "summation",
          effects: ["defense += 3", "hostility += 1"],
        },
      ],
    },
    {
      id: "witness_check",
      text: "Вы задаёте свидетелю один точный вопрос — и зал замирает, ожидая, чем он обернётся...",
      transitions: [
        {
          id: "discredit_ok",
          label: "...",
          toLocation: "summation",
          condition: "roll >= 4",
          effects: ["defense += 4", "hostility -= 1"],
          autoExecute: true,
        },
        {
          id: "discredit_bad",
          label: "...",
          toLocation: "summation",
          effects: ["hostility += 3"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "summation",
      text: "Слушание подходит к концу. Последнее слово защиты — и по лицу судьи не прочесть ничего.\nСила защиты: {defense} | Гнев судьи: {hostility}",
      transitions: [
        {
          id: "closing_appeal",
          label: "Спокойная апелляция к фактам и записям (+2 к защите)",
          toLocation: "verdict_gate",
          effects: ["defense += 2"],
        },
        {
          id: "closing_mercy",
          label: "Воззвать к милости суда — склонить голову (−2 гнева)",
          toLocation: "verdict_gate",
          effects: ["hostility -= 2"],
        },
        {
          id: "grandstand",
          label:
            "Театральная речь на весь зал — ва-банк (бросок: блеск или катастрофа)",
          toLocation: "grandstand_check",
          effects: ["roll = random(0,9)"],
        },
      ],
    },
    {
      id: "grandstand_check",
      text: "Ваш голос гремит под сводами зала, судья медленно опускает стилус...",
      transitions: [
        {
          id: "grand_ok",
          label: "...",
          toLocation: "verdict_gate",
          condition: "roll >= 5",
          effects: ["defense += 5"],
          autoExecute: true,
        },
        {
          id: "grand_bad",
          label: "...",
          toLocation: "verdict_gate",
          effects: ["hostility += 4"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "verdict_gate",
      text: "Судья удаляется на совещание — минута тянется как час — и возвращается с вердиктом.\nСила защиты: {defense}",
      transitions: [
        {
          id: "verdict_acquit",
          label: "...",
          toLocation: "ending_acquitted",
          condition: "defense >= 8",
          effects: ["credits += 3000", "rating += 25"],
          autoExecute: true,
        },
        {
          id: "verdict_lenient",
          label: "...",
          toLocation: "ending_lenient",
          condition: "defense >= 4",
          effects: ["credits += 500", "rating += 5"],
          autoExecute: true,
        },
        {
          id: "verdict_guilty",
          label: "...",
          toLocation: "ending_guilty",
          effects: ["rating -= 20"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_acquitted",
      text: "«Оправдан по всем пунктам». Молоток падает, и зал выдыхает. Прокурор сгребает бумаги, не глядя вам в глаза; диспетчер-свидетель тихо исчезает в коридоре. Вы выходите на солнце с чистым именем — и с компенсацией за напрасно потерянное время. О том, как вы разнесли обвинение в пыль, будут судачить в кают-компаниях ещё долго.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_lenient",
      text: "«Виновен в нарушении — но с учётом обстоятельств: штраф». Могло быть куда хуже. Вы платите, стискивая зубы, и уходите свободным человеком с пятном в деле, но без решётки за спиной. Защита выстояла ровно настолько, чтобы спасти вам свободу.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_guilty",
      text: "«Виновен». Слово падает в тишину, как приговор — потому что это он и есть. Ваша защита рассыпалась, и суд не нашёл причин щадить. Запись о судимости теперь тянется за вашим позывным по всем портам сектора, закрывая двери, которые прежде были открыты.\nСила защиты: {defense}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_contempt",
      text: "«Довольно!» Молоток бьёт по столу так, что вздрагивает весь зал. Судья, багровый от гнева, объявляет вас виновным в неуважении к суду — и заодно по основному обвинению, не дослушав. Конвой берёт вас под локти прежде, чем вы успеваете возразить. Вы перегнули палку — и заплатили за это свободой.\nГнев судьи: {hostility}",
      isFailure: true,
      transitions: [],
    },
  ],
};
