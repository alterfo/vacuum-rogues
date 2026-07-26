import type { QuestScript } from "../QuestScript";

// Дизайн: Ты — таможенный инспектор. За 20 кораблей собери 5000 кр. штрафов
// в казну поста (это план/квота, а не твой карман — награда фиксирована на
// борде квестов: сохранённый пост + премия). Скан стоит 200. Контрабандист
// (suspicion >= 7 или 40% шанс при 4–6) = +1000 штрафа. Ложный досмотр =
// −500 рейтинга: рейтинг стартует со 100, так что ОДНА такая ошибка мгновенно
// завершает квест (rating < 0 → quest_failure_rating) — текст найденного
// «чистого» борта это честно проговаривает, второго шанса нет.
// Прибытие борта (inspect_decision) — пул капитанских виньеток: seed выбирает
// одну на прохождение, так что каждый заход к посту звучит по-новому.
// Следующий борт (next_ship_*) ветвится по исходу: пойманный контрабандист и
// пропущенный «на слово» борт провожаются разным текстом.
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
      // Variance pool (Task 14): resolved once per (seed, id) — each playthrough
      // draws a different captain, so the 20-ship loop stops reading as one
      // template. Every variant keeps the {shipNum}/{suspicion}/{money}/{rating}
      // HUD and the 5000-quota framing so the interpolation contract holds.
      text: [
        "Шлюз лязгает — к причальному воротнику подходит борт {shipNum} из двадцати. За смену выбейте из контрабандистов 5000 кредитов штрафов в казну поста, иначе вас снимут.\n\nПахнет озоном и горелой изоляцией. На комме сипит потный капитан-работяга, в третий раз повторяет, что везёт «только удобрения».\n\nПодозрительность: {suspicion}/10.  В кассе: {money} кр. при плане 5000.  Рейтинг: {rating}.\n\nСкан жрёт 200 кредитов и дарит дипломатический скандал, если трюм окажется чист. Чутьё против инструкции — решайте.",
        "Борт {shipNum} из двадцати замирает у воротника — холёный клипер с фамильным гербом на боку. Капитан в шёлковом кителе цедит через комм, что дружен с половиной вашего начальства, и «не советует» его задерживать.\n\nВ шлюзе пахнет озоном и чужими деньгами.\n\nПодозрительность: {suspicion}/10.  В кассе: {money} кр. из плановых 5000.  Рейтинг: {rating}.\n\nСкан — 200 кредитов и нота протеста на пустом трюме. Это блеф или настоящая угроза?",
        "К воротнику подтягивается борт {shipNum} из двадцати — обшарпанный армейский тягач. Капитан отвечает односложно, по-военному, и смотрит в камеру так, будто досмотр — личное оскорбление.\n\nОзон, ржавчина, застарелый пот.\n\nПодозрительность: {suspicion}/10.  Касса: {money} кр. из 5000.  Рейтинг: {rating}.\n\nСкан стоит 200 кредитов и скандал на чистом трюме. Инструкция молчит — решайте сами.",
        "Борт {shipNum} из двадцати притирается к воротнику — старый семейный грузовик, весь в заплатах. На комме плачет ребёнок, капитан устало просит пропустить побыстрее: «груз скоропортящийся, инспектор, войдите в положение».\n\nСквозь озон тянет чем-то домашним, кухонным.\n\nПодозрительность: {suspicion}/10.  В кассе: {money} кр. при плане 5000.  Рейтинг: {rating}.\n\nСкан — 200 кредитов и дипломатический скандал на пустом трюме. Жалость против плана штрафов.",
        "К воротнику скользит борт {shipNum} из двадцати — глянцевый корпоративный курьер без единой царапины. Капитан молча тычет в камеру пачкой дипломатических пропусков и ждёт, что вы махнёте рукой.\n\nВ шлюзе пахнет озоном и дорогим пластиком.\n\nПодозрительность: {suspicion}/10.  Касса: {money} кр. из плановых 5000.  Рейтинг: {rating}.\n\nСкан жрёт 200 кредитов и ноту протеста на чистом трюме. Пропуска — прикрытие или правда?",
      ],
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
          toLocation: "next_ship_waved",
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
          toLocation: "next_ship_caught",
          effects: ["money += 1000"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "found_clean",
      text: "Трюм пуст, документы в порядке. Вы задержали и перетрясли добропорядочного капитана — и его консул уже строчит ноту протеста. На этом посту одной такой ошибки хватает с головой: начальство не прощает международных скандалов. Минус 500 к рейтингу — и второго шанса не будет.",
      transitions: [
        {
          id: "accept_scandal",
          // Rating starts at 100; −500 always drops below 0, so this false
          // inspection is career-ending on the spot. Route straight to the
          // failure terminal (the crit redirect would land here anyway) so the
          // data matches the text — no fictional "work on" beat.
          label: "...",
          toLocation: "quest_failure_rating",
          effects: ["rating -= 500"],
          autoExecute: true,
        },
      ],
    },
    // Branched "next ship" beat (B fix): a caught smuggler and a waved-through
    // ship are provoded with different text. Both auto-advance identically
    // (shipNum += 1 → critMax fires check_final at ship 21; suspicion re-rolled).
    {
      id: "next_ship_caught",
      text: "Штраф оформлен, контейнеры опечатаны, капитан уполз в чёрное злой и на тысячу беднее. Вы провожаете его взглядом с законной ухмылкой — чутьё против инструкции, и сегодня чутьё выиграло. Мигает очередь: следующий борт уже тянется к шлюзу.",
      transitions: [
        {
          id: "advance_caught",
          label: "...",
          toLocation: "inspect_decision",
          effects: ["shipNum += 1", "suspicion = random(0,10)"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "next_ship_waved",
      text: "Причальный воротник отпускает корпус, двигатели уходят в чёрное. Пропустили — и теперь не узнаете, что было в трюме. Может, и правда одни удобрения. А может, вы только что упустили тысячу штрафа. Мигает очередь: следующий борт тянется к шлюзу. Смена не ждёт.",
      transitions: [
        {
          id: "advance_waved",
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
      text: "План закрыт с запасом. Собранные штрафы уходят в казну поста — до последнего кредита, не в ваш карман, — а вам начальник смены ставит печать в личное дело и суёт конверт с премией: редкая здесь похвала. Вы нюхом вычислили контрабанду и не спалили ни одного честного капитана зря. Пост за вами, и это дороже любой кассы.",
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
