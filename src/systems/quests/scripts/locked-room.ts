import type { QuestScript } from "../QuestScript";

// Design: A locked-room whodunit aboard the sealed research station «Гелиос».
// A scientist is dead in a bolted lab; only three others were aboard. The
// station's airlock realigns on a timer — when it opens the killer walks free,
// so a `time` budget bleeds with every step (a `critMin` redirect to
// ending_escaped — the deduction clock). The puzzle: gather enough physical
// evidence (`clues`) AND name the correct suspect. The evidence points at the
// station medic; a conviction needs BOTH the right accusation and clues >= 5.
// Choice points:
//   1. First examination — the body (+2), the airlock logs (+2), or a full
//      forensic sweep (+3, but slow).
//   2. Gather once more (+2, costs time) vs move to interrogation.
//   3. Press a suspect (roll: crack for +2 clues, or stonewall and waste time)
//      vs go straight to the accusation.
//   4. The accusation — medic (correct), engineer, or comms officer.
// Outcomes:
//   - ending_solved   (right suspect, clues >= 5 — airtight conviction)  SUCCESS
//   - ending_walks    (right suspect, too little proof — killer freed)   FAILURE
//   - ending_wrong    (innocent condemned)                               FAILURE
//   - ending_escaped  (airlock opened, killer slipped away)              FAILURE
export const lockedRoomScript: QuestScript = {
  id: "locked-room",
  title: "Убийство на «Гелиосе»",
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
      id: "clues",
      name: "Улики",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: true,
    },
    {
      id: "time",
      name: "До разгерметизации шлюза",
      min: -9999,
      max: 99,
      initial: 6,
      critMin: 1,
      critTarget: "ending_escaped",
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
  startLocation: "scene",
  locations: [
    {
      id: "scene",
      text: "Доктора Верна нашли в запертой изнутри лаборатории «Гелиоса» — с проломленным виском и без единого чужого следа на двери. На станции, кроме него, оставались трое: инженер, судовой медик и связистка. Через несколько часов шлюз завершит перекалибровку и откроется — и тогда убийца просто уйдёт в толпу прибывшей смены.\nДо разгерметизации шлюза: {time}\n\nС чего начать?",
      transitions: [
        {
          id: "examine_body",
          label:
            "Осмотреть тело — под ногтями чужая кровь, на халате борьба (−2 часа, +2 улики)",
          toLocation: "gather",
          effects: ["time -= 2", "clues += 2"],
        },
        {
          id: "check_logs",
          label:
            "Поднять журналы шлюзов и переборок за ту ночь (−2 часа, +2 улики)",
          toLocation: "gather",
          effects: ["time -= 2", "clues += 2"],
        },
        {
          id: "sweep_lab",
          label:
            "Полный криминалистический прогон лаборатории — долго, но тщательно (−3 часа, +3 улики)",
          toLocation: "gather",
          effects: ["time -= 3", "clues += 3"],
        },
      ],
    },
    {
      id: "gather",
      text: "Картина складывается. Кровь чужой группы — совпадает с медицинской картой одного из троих. Замок вскрыт не силой, а кодом доступа второго уровня.\nДо разгерметизации шлюза: {time} | Улики: {clues}\n\nЕщё раз пройтись по мелочам, пока время есть, — или пора собирать всех троих?",
      transitions: [
        {
          id: "gather_more",
          label:
            "Ещё круг по уликам — каждая мелочь на счету (−2 часа, +2 улики)",
          toLocation: "interrogation",
          effects: ["time -= 2", "clues += 2"],
        },
        {
          id: "go_interrogate",
          label: "Достаточно — собрать подозреваемых в кают-компании",
          toLocation: "interrogation",
          effects: [],
        },
      ],
    },
    {
      id: "interrogation",
      text: "Трое сидят напротив. Инженер сцепил руки, связистка бледна, медик спокоен — слишком спокоен. Кто-то из них лжёт.\nУлики: {clues}\n\nМожно ещё раз надавить — или назвать имя.",
      transitions: [
        {
          id: "press_suspect",
          label:
            "Надавить на медика — он потеет под воротником (−2 часа), может проговориться",
          toLocation: "press_check",
          effects: ["time -= 2", "roll = random(0,9)"],
        },
        {
          id: "go_accuse",
          label: "Хватит — назвать убийцу прямо сейчас",
          toLocation: "accusation",
          effects: [],
        },
      ],
    },
    {
      id: "press_check",
      text: "Медик выдерживает ваш взгляд ровно секунду дольше, чем следовало бы...",
      transitions: [
        {
          id: "press_crack",
          label: "...",
          toLocation: "accusation",
          condition: "roll >= 4",
          effects: ["clues += 2"],
          autoExecute: true,
        },
        {
          id: "press_stonewall",
          label: "...",
          toLocation: "accusation",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "accusation",
      text: "Время почти вышло. Шлюз загудел, начиная последний цикл. Пора называть имя — и лучше не ошибиться.\nУлики: {clues}",
      transitions: [
        {
          id: "accuse_medic",
          label:
            "«Это вы, судовой медик. Ваша кровь под ногтями Верна, ваш код на замке»",
          toLocation: "verdict_gate",
          effects: [],
        },
        {
          id: "accuse_engineer",
          label: "«Убийца — инженер. У него был мотив»",
          toLocation: "ending_wrong",
          effects: ["rating -= 25"],
        },
        {
          id: "accuse_comms",
          label: "«Это связистка. Она была последней, кто говорил с Верном»",
          toLocation: "ending_wrong",
          effects: ["rating -= 25"],
        },
      ],
    },
    {
      id: "verdict_gate",
      text: "Медик медленно поднимает глаза...",
      transitions: [
        {
          id: "convicted",
          label: "...",
          toLocation: "ending_solved",
          condition: "clues >= 5",
          effects: ["credits += 3000", "rating += 30"],
          autoExecute: true,
        },
        {
          id: "insufficient",
          label: "...",
          toLocation: "ending_walks",
          effects: ["rating -= 10"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_solved",
      text: "Вы выкладываете улику за уликой — кровь, код доступа, время смерти, несведённые концы его алиби. Медик оседает на стуле: отпираться больше нечем. Прибывшая смена уводит его в наручниках. Родные Верна жмут вам руку молча, но крепко — вы дали им правду.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_walks",
      text: "Вы назвали верное имя — но одних догадок мало. «И где доказательства?» — цедит медик, и он прав: улик не хватает даже на арест. Шлюз открывается, и он первым шагает в толпу новой смены, обернувшись к вам с тонкой улыбкой. Вы знаете, кто убил Верна. И ничего не можете сделать.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_wrong",
      text: "Вы назвали имя — и ошиблись. Пока невиновного уводят под конвоем, настоящий убийца растворяется в прибывшей смене. Позже, разбирая улики на трезвую голову, вы поймёте, кого упустили. Слишком поздно: осуждён не тот, а на вашем имени — пятно судебной ошибки.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_escaped",
      text: "Шлюз завершил перекалибровку и с шипением распахнулся прежде, чем вы успели свести концы. Толпа прибывшей смены хлынула внутрь, смешавшись с теми тремя, — и убийца ушёл вместе с ней, безымянный и свободный. Дело о «Гелиосе» так и осталось открытым.\nДо разгерметизации шлюза: {time}",
      isFailure: true,
      transitions: [],
    },
  ],
};
