import type { QuestScript } from "../QuestScript";

// Design: A smuggling gauntlet from the smuggler's side. Run contraband past 3
// blockade checkpoints, then deliver to the buyer. At each checkpoint pick:
//   - bribe  : pay 150 cr, pass clean (safe, expensive)
//   - bluff  : free, but never risk-free — even a calm low-heat bluff can trip
//              a thorough scan (~10%), and higher heat sharply raises the catch
//              chance (30% in the medium band, certain once heat >= 6)
//   - dump   : jettison 2 units of cargo to cool off (less payout)
//   - officer_deal (checkpoint 2 only): a corrupt captain scrubs your ship from
//              the blockade net for 400 cr, wiping ALL accumulated heat — a
//              distinct heat-management play, useful only after you've run hot
// Heat rises when you bluff; bribing keeps it down. Final payout scales with how
// much cargo survives, and the delivery reads differently per payout tier
// (payout_full/high/mid beats → shared quest_success coda). Outcomes:
//   - quest_success         (delivered, paid)                 SUCCESS
//   - quest_failure_caught  (busted at a checkpoint)          FAILURE
//   - quest_failure_nocargo (arrived empty-handed)            FAILURE
export const smugglingRunScript: QuestScript = {
  id: "smuggling-run",
  title: "Контрабандный рейс",
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
      id: "heat",
      name: "Жар",
      min: -9999,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "cargo",
      name: "Груз",
      min: 0,
      max: 6,
      initial: 6,
      showInUI: true,
    },
    {
      id: "checkpoint",
      name: "Блокпост",
      min: 1,
      max: 4,
      initial: 1,
      critMax: 3,
      critTarget: "arrival",
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
  startLocation: "checkpoint_decision",
  locations: [
    {
      // Per-seed encounter pool (Task 14 resolver): each playthrough draws a
      // different patrol so the three checkpoints don't read identically. The
      // node is reused across checkpoints (critMax loop), so the variance is
      // per-run, not per-checkpoint — genuine per-checkpoint distinct nodes are
      // blocked by the locked tests that assert the loop returns here.
      id: "checkpoint_decision",
      text: [
        "Блокпост {checkpoint} из 3. Из темноты выныривает патрульный крейсер, и прожекторы бьют вам прямо в остекление рубки. В трюме — контрабанда, и таможенный луч уже ползёт по обшивке. По борту скрипит усталый голос: «Приготовьтесь к досмотру».\nЖар подозрения: {heat} | Груз в трюме: {cargo} ед. | На счету: {credits} кр.\n\nЛадони вспотели на штурвале. Как проходим?",
        "Блокпост {checkpoint} из 3. Из-за обломков старой станции лениво выползает таможенный корвет — инспектор на том конце связи зевает в микрофон, но его сканер уже деловито обнюхивает ваш трюм. «Малый ход, приготовьте декларацию».\nЖар подозрения: {heat} | Груз в трюме: {cargo} ед. | На счету: {credits} кр.\n\nСкучающий — значит непредсказуемый. Как проходим?",
        "Блокпост {checkpoint} из 3. Впереди частокол пикетных дронов, а за ними тяжёлой тенью висит канонерка блокады. Тут не зевают: лучи бьют слаженно, перекрёстно, и уйти в рывок уже не выйдет. «Стоп машина. Досмотр обязателен».\nЖар подозрения: {heat} | Груз в трюме: {cargo} ед. | На счету: {credits} кр.\n\nЗдесь ошибок не прощают. Как проходим?",
      ],
      transitions: [
        {
          id: "bribe",
          label: "Сунуть патрулю на лапу — тихо и надёжно (−150 кр)",
          toLocation: "after_checkpoint",
          effects: ["credits -= 150"],
        },
        {
          id: "bluff",
          label:
            "Держать морду кирпичом и блефовать (даром, но даже спокойный блеф иногда срывается, а с жаром шанс абордажа растёт)",
          toLocation: "bluff_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "dump",
          label:
            "Сбросить два контейнера за борт — чистый трюм, но и оплата тоньше (−2 ед., жар спадёт)",
          toLocation: "dump_done",
          condition: "cargo >= 2",
          effects: ["cargo -= 2", "heat -= 4"],
        },
        {
          // Differentiating beat, available only at the second checkpoint: the
          // patrol captain is on the take and, for a fatter fee than a plain
          // bribe, scrubs your ship's flags from the whole blockade net —
          // wiping accumulated heat, not just waving you past this ship.
          id: "officer_deal",
          label:
            "Капитан патруля явно на прикорме — купить у него чистый транспондер (−400 кр, весь жар с сети стирается)",
          toLocation: "corrupt_officer",
          condition: "checkpoint == 2",
          effects: ["credits -= 400", "heat = 0"],
        },
      ],
    },
    {
      id: "bluff_check",
      text: "Вы не моргаете под белым лучом сканера. Улыбка приклеена к лицу, а сердце колотится о рёбра...",
      transitions: [
        {
          id: "bluff_hot",
          label: "...",
          toLocation: "quest_failure_caught",
          condition: "heat >= 6",
          effects: [],
          autoExecute: true,
        },
        {
          id: "bluff_risky",
          label: "...",
          toLocation: "bluff_roll_check",
          condition: "heat >= 3",
          effects: [],
          autoExecute: true,
        },
        {
          // Even a calm, low-heat bluff isn't free: a thorough scan on a bad
          // beat (roll 0, ~10%) still trips the alarm. Rarer than the medium
          // band's 30% catch, but enough that bluffing is a gamble, not a
          // strictly-better-than-bribe freebie.
          id: "bluff_nervous",
          label: "...",
          toLocation: "quest_failure_caught",
          condition: "roll <= 0",
          effects: [],
          autoExecute: true,
        },
        {
          id: "bluff_safe",
          label: "...",
          toLocation: "after_checkpoint",
          effects: ["heat += 2"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "bluff_roll_check",
      text: "Таможенник тянет с ответом, щурясь на пляшущие показания сканера. Секунда растягивается в вечность...",
      transitions: [
        {
          id: "roll_caught",
          label: "...",
          toLocation: "quest_failure_caught",
          condition: "roll <= 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "roll_pass",
          label: "...",
          toLocation: "after_checkpoint",
          effects: ["heat += 3"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "dump_done",
      text: "Люк грузового отсека распахивается, и контейнеры уходят в пояс обломков — растворяются среди мусора, не оставив следа. Сканер скользит по опустевшему трюму и не находит ничего запретного. Патруль машет: проходи.",
      transitions: [
        {
          id: "dump_continue",
          label: "...",
          toLocation: "after_checkpoint",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "corrupt_officer",
      text: "Капитан лениво пересчитывает кредиты, не глядя на трюм, и что-то бормочет в свой терминал. Ваш борт мигает и пропадает из журналов блокады — свежий транспондер, чистая история, ни единой пометки. «Проходи, и чтоб я тебя больше в этих логах не видел». Жар с сети как рукой сняло.",
      transitions: [
        {
          id: "officer_pass",
          label: "...",
          toLocation: "after_checkpoint",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "after_checkpoint",
      text: "Прожекторы гаснут за кормой, крейсер отстаёт. Вы выдыхаете, вжимаете тягу на форсаж — и уходите к следующему рубежу.",
      transitions: [
        {
          id: "advance",
          label: "...",
          toLocation: "checkpoint_decision",
          effects: ["checkpoint += 1"],
          autoExecute: true,
        },
      ],
    },
    // Reached via checkpoint critMax (>3).
    {
      id: "arrival",
      text: "Три блокпоста позади. Впереди — тёмный причал точки сброса, где мигает сигнальный маяк заказчика. Его люди уже подгоняют разгрузочный кран, вглядываясь в ваш трюм: {cargo} ед. груза дошло.",
      transitions: [
        {
          id: "deliver",
          label: "...",
          // Reset checkpoint below critMax so the crit redirect stops firing
          // (otherwise it would bounce payout_gate back to arrival every step).
          toLocation: "payout_gate",
          effects: ["checkpoint = 0"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "payout_gate",
      text: "Заказчик пересчитывает уцелевшие контейнеры и отсчитывает кредиты — ровно по тому, что дошло до причала...",
      transitions: [
        {
          id: "pay_full",
          label: "...",
          toLocation: "payout_full",
          condition: "cargo >= 5",
          effects: ["credits += 3000"],
          autoExecute: true,
        },
        {
          id: "pay_high",
          label: "...",
          toLocation: "payout_high",
          condition: "cargo >= 3",
          effects: ["credits += 2000"],
          autoExecute: true,
        },
        {
          id: "pay_mid",
          label: "...",
          toLocation: "payout_mid",
          condition: "cargo >= 1",
          effects: ["credits += 1000"],
          autoExecute: true,
        },
        {
          id: "pay_none",
          label: "...",
          toLocation: "quest_failure_nocargo",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    // Payout-tier beats (Task 33 / pattern B): the delivery reads differently
    // depending on how much cargo survived, instead of one shared success line.
    // Each auto-executes into the shared `quest_success` coda so the locked
    // full- and mid-tier tests still land on `quest_success`.
    {
      id: "payout_full",
      text: "Весь груз до последнего контейнера уходит в трюм заказчика. Тот присвистывает — полный борт, ни единой потери — и отсчитывает по высшей ставке, накинув сверху за чистую работу. «Вот это я понимаю рейс».",
      transitions: [
        {
          id: "full_settle",
          label: "...",
          toLocation: "quest_success",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "payout_high",
      text: "Кран разгружает трюм, заказчик считает — не всё дошло, но большая часть на месте. Он поджимает губы на пустые стропы, однако платит по-честному за то, что доехало. «Могло быть и лучше. Но с этим я работаю».",
      transitions: [
        {
          id: "high_settle",
          label: "...",
          toLocation: "quest_success",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "payout_mid",
      text: "Заказчик заглядывает в полупустой трюм и мрачнеет: осталась горстка контейнеров там, где он ждал полный борт. Он всё же отсчитывает за уцелевшее — жидкая пачка, скорее за беспокойство, чем за товар. «В следующий раз вези больше, а не выкидывай на полдороге».",
      transitions: [
        {
          id: "mid_settle",
          label: "...",
          toLocation: "quest_success",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "quest_success",
      text: "Стропы разгружены, сделка закрыта, кредиты в перчатке. Точка сброса гаснет за кормой, и вы вжимаете тягу прочь от блокады.\nНа счету теперь: {credits} кр.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_caught",
      text: "Сканер пронзительно взвыл — луч выхватил запретный груз в трюме. «Глушите двигатели и готовьтесь к стыковке», — цедит таможенник, и абордажные захваты уже лязгают по обшивке. Контрабанда изъята, вы в наручниках. Рейс окончен.",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_nocargo",
      text: "Вы дотянули до причала целым и невредимым — вот только трюм гулко пуст. Весь груз сброшен за борт по дороге, и заказчику нечего грузить. «Ты притащил мне вакуум», — рычит он, разворачиваясь к трапу. Ни кредита, ни второго шанса — сделка сорвана.",
      isFailure: true,
      transitions: [],
    },
  ],
};
