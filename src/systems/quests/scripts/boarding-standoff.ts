import type { QuestScript } from "../QuestScript";

// Design: A negotiation-under-pressure puzzle. A raider boarding party has
// forced your airlock and you are badly outgunned. Two meters drive it: a
// `tension` gauge that, if it boils over (a `critMax` redirect to
// ending_firefight — the pressure spine), triggers a shoot-out you can't win;
// and a `leverage` gauge — your negotiating position — that decides how the
// standoff resolves if you keep the peace. The puzzle is to build leverage
// while keeping tension below the boiling point. Distinct from hostage-rescue
// (you are the VICTIM here) and first-contact (a rising-tension timer, not a
// slow trust build).
// Choice points:
//   1. Opening move — hands up (cool it), stall for information (+leverage,
//      +tension), or reach for a weapon (+tension).
//   2. The captain's demand — buy them off (credits, +leverage, cools it),
//      bluff a patrol (roll: lands for +leverage or backfires into +tension),
//      or flat refusal (+tension, +leverage).
//   3. The resolution — talk it down, or pull the trigger first.
// Outcomes (by `leverage` at the talk-down):
//   - ending_negotiated (>=4 — a fair deal, they leave paid off)        SUCCESS
//   - ending_bought_off (>=2 — grudging retreat, no reward)             SUCCESS
//   - ending_robbed     (<2 — stripped but spared)                      SUCCESS
//   - ending_bloodbath  (you drew first and lost the fight)             FAILURE
//   - ending_firefight  (tension boiled over into a shoot-out)          FAILURE
export const boardingStandoffScript: QuestScript = {
  id: "boarding-standoff",
  title: "Переговоры на абордаже",
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
      id: "tension",
      name: "Напряжение",
      min: -99,
      max: 99,
      initial: 3,
      critMax: 9,
      critTarget: "ending_firefight",
      showInUI: true,
    },
    {
      id: "leverage",
      name: "Позиция на переговорах",
      min: 0,
      max: 9,
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
  startLocation: "airlock",
  locations: [
    {
      id: "airlock",
      text: "Абордажный трап с лязгом впился в ваш шлюз. Шестеро — стволы вскинуты, у капитана в зеркальном забрале отражается ваша собственная бледная физиономия. Их шестеро, вы один.\nНапряжение: {tension}\n\nПервое движение решает всё.",
      transitions: [
        {
          id: "hands_up",
          label:
            "Поднять руки, говорить ровно и тихо — сбить накал (−1 напряжение)",
          toLocation: "parley",
          effects: ["tension -= 1"],
        },
        {
          id: "stall_talk",
          label:
            "Тянуть время, заговаривать зубы — узнать, чего они хотят (+1 напряжение, +2 к позиции)",
          toLocation: "parley",
          effects: ["tension += 1", "leverage += 2"],
        },
        {
          id: "draw_weapon",
          label: "Дёрнуться к оружию на поясе (+4 напряжения)",
          toLocation: "parley",
          effects: ["tension += 4"],
        },
      ],
    },
    {
      id: "parley",
      text: "Капитан поднимает забрало. «Груз. Или корабль. Выбирай быстро». Стволы не опускаются ни на сантиметр.\nНапряжение: {tension} | Позиция: {leverage}\n\nЧто вы ему предложите?",
      transitions: [
        {
          id: "offer_cargo",
          label:
            "Отдать груз без боя — дорого, но живым (−2000 кредитов, −2 напряжения, +2 к позиции)",
          toLocation: "resolve",
          effects: ["credits -= 2000", "tension -= 2", "leverage += 2"],
        },
        {
          id: "bluff_backup",
          label:
            "Блефовать: якобы патруль уже на подходе к системе (риск, бросок)",
          toLocation: "bluff_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "defiance",
          label:
            "Отказать наотрез — пусть видят характер (+3 напряжения, +1 к позиции)",
          toLocation: "resolve",
          effects: ["tension += 3", "leverage += 1"],
        },
      ],
    },
    {
      id: "bluff_check",
      text: "Капитан замирает, вслушиваясь в эфир, взвешивая, врёте вы или нет...",
      transitions: [
        {
          id: "bluff_lands",
          label: "...",
          toLocation: "resolve",
          condition: "roll >= 4",
          effects: ["leverage += 3", "tension -= 1"],
          autoExecute: true,
        },
        {
          id: "bluff_called",
          label: "...",
          toLocation: "resolve",
          effects: ["tension += 4"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "resolve",
      text: "Момент истины. Капитан переводит взгляд с вас на своих людей и обратно, прикидывая, стоите ли вы драки.\nНапряжение: {tension} | Позиция: {leverage}",
      transitions: [
        {
          id: "talk_down",
          label: "Предложить сделку и разойтись миром",
          toLocation: "resolution_gate",
          effects: [],
        },
        {
          id: "pull_trigger",
          label: "Ударить первым, пока есть хоть малый шанс",
          toLocation: "ending_bloodbath",
          effects: ["rating -= 20"],
        },
      ],
    },
    {
      id: "resolution_gate",
      text: "Капитан молчит, и в этой тишине решается ваша судьба...",
      transitions: [
        {
          id: "deal_struck",
          label: "...",
          toLocation: "ending_negotiated",
          condition: "leverage >= 4",
          effects: ["credits += 1000", "rating += 20"],
          autoExecute: true,
        },
        {
          id: "grudging_exit",
          label: "...",
          toLocation: "ending_bought_off",
          condition: "leverage >= 2",
          effects: ["rating += 5"],
          autoExecute: true,
        },
        {
          id: "forced_tribute",
          label: "...",
          toLocation: "ending_robbed",
          effects: ["credits -= 1000", "rating -= 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_negotiated",
      text: "Капитан хмыкает, опускает ствол — и его люди следом. «А ты не так прост». Вы ударили по рукам: они уходят с малой долей, а вам оставляют не только корабль, но и щедрую «премию за понятливость» из чужого хабара, чтобы не держали зла. Трап отстыковывается. Вы живы, при деньгах и с историей, которую не стыдно рассказать.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_bought_off",
      text: "Капитан цедит сквозь зубы: «Живи». Стволы неохотно уходят вверх. Сделка так себе — но абордажный трап отстыковывается, и это главное. Вы отделались испугом и парой уступок; корабль ваш, и вы дышите.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_robbed",
      text: "Позиции у вас не было, и капитан это понял. Раидеры вычищают трюм подчистую, забирают всё, что не приколочено, — но, как ни странно, оставляют вам жизнь и пустой корабль. «Скажи спасибо, что сегодня добрый день». Трап уходит. Вы разорены, но живы.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_bloodbath",
      text: "Вы рванули оружие первым — и это было последнее, что вы решили сами. Шесть стволов ответили разом, тесный шлюз захлебнулся вспышками. Ваш корабль потом найдут дрейфующим, с распахнутым люком и без единой живой души на борту.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_firefight",
      text: "Напряжение перехлестнуло через край — у кого-то не выдержали нервы, и шлюз мгновенно превратился в мясорубку из вспышек и рикошетов. В такой тесноте и при таком численном перевесе исход был предрешён. Вы не дожили до того, чтобы понять, чья именно рука дрогнула первой.\nНапряжение: {tension}",
      isFailure: true,
      transitions: [],
    },
  ],
};
