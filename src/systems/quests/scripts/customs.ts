import type { QuestScript } from "../QuestScript";

// Дизайн: Ты — таможенный инспектор. За 20 кораблей заработай 5000 кр.
// Скан стоит 200. Контрабандист (suspicion >= 7 или 40% шанс при 4–6) = +1000.
// Ложный досмотр = −500 рейтинга. rating < 0 → мгновенный провал.
export const customsScript: QuestScript = {
  id: "customs",
  title: "Таможня",
  params: [
    {
      id: "money",
      name: "Кредиты",
      min: 0,
      max: 99999,
      initial: 0,
      showInUI: true,
    },
    {
      id: "rating",
      name: "Рейтинг",
      min: -9999,
      max: 100,
      initial: 100,
      critMin: 0,
      critTarget: "quest_failure_rating",
      showInUI: true,
    },
    {
      id: "shipNum",
      name: "Корабль №",
      min: 1,
      max: 21,
      initial: 1,
      critMax: 20,
      critTarget: "check_final",
      showInUI: true,
    },
    {
      id: "suspicion",
      name: "Подозрит.",
      min: 0,
      max: 10,
      initial: "random",
      showInUI: true,
    },
    {
      id: "scan_roll",
      name: "Бросок",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "inspect_decision",
  locations: [
    {
      id: "inspect_decision",
      text: "Шлюз лязгает, и к причальному воротнику подходит корабль {shipNum} из двадцати. За смену вы должны выбить из контрабандистов 5000 кредитов штрафов — иначе вас снимут с поста.\n\nВ воздухе шлюза пахнет озоном и горелой изоляцией. На комме сипит капитан, ждёт вашего слова.\n\nДатчики выставили подозрительность: {suspicion}/10.\nВ кассе: {money} кр.  Ваш рейтинг: {rating}.\n\nКаждый скан жрёт 200 кредитов и, если трюм окажется чист, дарит вам дипломатический скандал. Чутьё против инструкции — решайте.",
      transitions: [
        {
          id: "scan",
          label: "Продавить полный досмотр (−200 кр)",
          toLocation: "scan_check_high",
          effects: ["money -= 200", "scan_roll = random(0,9)"],
        },
        {
          id: "pass",
          label: "Махнуть рукой — пусть летит",
          toLocation: "next_ship",
          effects: [],
        },
      ],
    },
    // Staged smuggler check: first filter high suspicion (>=7 = certain smuggler)
    {
      id: "scan_check_high",
      text: "Захваты фиксируют корпус. Сканирующая арка ползёт вдоль обшивки, и на экране медленно проступают контуры трюма...",
      transitions: [
        {
          id: "high_confirmed",
          label: "...",
          toLocation: "found_smuggler",
          condition: "suspicion >= 7",
          effects: [],
          autoExecute: true,
        },
        {
          id: "high_not_confirmed",
          label: "...",
          toLocation: "scan_check_medium",
          condition: "suspicion < 7",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    // Second filter: suspicion < 4 always clean; suspicion 4-6 = 40% chance via roll
    // Ordering is critical: low-suspicion check must come before roll check
    {
      id: "scan_check_medium",
      text: "Явных пустот сканер не нашёл. Вы гоняете сигнатуры через таможенную базу, вслушиваясь в шумы за переборкой. Чисто? Или капитан слишком хорошо спрятал груз?",
      transitions: [
        {
          id: "medium_low_suspicion",
          label: "...",
          toLocation: "found_clean",
          condition: "suspicion < 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "medium_found",
          label: "...",
          toLocation: "found_smuggler",
          condition: "scan_roll <= 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "medium_clean",
          label: "...",
          toLocation: "found_clean",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "found_smuggler",
      text: "Есть! За фальшивой переборкой — контейнеры без пломб. Капитан сразу сдулся, торговаться не стал: штраф на бочку, лишь бы без протокола и конвоя. В кассу падает 1000 кредитов. Чутьё не подвело.",
      transitions: [
        {
          id: "collect_fine",
          label: "Оформить штраф и вызвать следующего",
          toLocation: "next_ship",
          effects: ["money += 1000"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "found_clean",
      text: "Трюм пуст, документы в порядке. Вы задержали и перетряхнули добропорядочного капитана — и теперь его консул строчит ноту протеста. Начальство в бешенстве: минус 500 к рейтингу. Ещё пара таких «досмотров», и вас вышвырнут с поста.",
      transitions: [
        {
          id: "accept_scandal",
          label: "Проглотить выговор и работать дальше",
          toLocation: "next_ship",
          effects: ["rating -= 500"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "next_ship",
      text: "Причальный воротник отпускает корпус, двигатели уходят в чёрное. Мигает очередь: следующий борт уже подтягивается к шлюзу. Смена не ждёт.",
      transitions: [
        {
          id: "advance_ship",
          label: "...",
          toLocation: "inspect_decision",
          effects: ["shipNum += 1", "suspicion = random(0,10)"],
          autoExecute: true,
        },
      ],
    },
    // Reached via critMax on shipNum (>20). Auto-check win/fail.
    {
      id: "check_final",
      text: "Двадцатый корабль растворился в звёздах. Смена окончена, шлюз затихает.\n\nВы сводите кассу под гул остывающих насосов: собрано {money} кр. при плане в 5000. Начальство ждёт цифру.",
      transitions: [
        {
          id: "win",
          label: "Сдать выручку начальству",
          toLocation: "quest_success",
          condition: "money >= 5000",
          effects: [],
          autoExecute: true,
        },
        {
          id: "lose",
          label: "Признать, что план не закрыт",
          toLocation: "quest_failure_credits",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "quest_success",
      text: "План закрыт с запасом. Начальник смены хмыкает, ставит печать и суёт вам конверт с премией — редкая на этом посту похвала. Вы нюхом вычислили контрабанду и не спалили ни одного честного капитана зря. Пост за вами.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_credits",
      text: "Кассы не хватает до плана. Вы были слишком осторожны — пропускали борта, боясь скандала, и упустили штрафы. Начальник молча вычёркивает вас из графика. Пост уйдёт тому, у кого крепче нервы.",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_rating",
      text: "Ноты протеста легли на стол посла стопкой. Вы трясли честные корабли один за другим, и терпение начальства лопнуло: значок на стол, пропуск сдать. Слишком рьяный инспектор опаснее любого контрабандиста — и вас отстраняют от должности.",
      isFailure: true,
      transitions: [],
    },
  ],
};
