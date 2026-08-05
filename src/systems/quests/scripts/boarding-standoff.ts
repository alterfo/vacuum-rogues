import type { QuestScript } from "../QuestScript";

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
          label: "Поднять руки, говорить ровно и тихо — сбить накал",
          toLocation: "parley",
          effects: ["tension -= 1"],
        },
        {
          id: "stall_talk",
          label:
            "Тянуть время, заговаривать зубы — прощупать, чего они хотят (рискованно, но многое проясняет)",
          toLocation: "parley",
          effects: ["tension += 1", "leverage += 2"],
        },
        {
          id: "draw_weapon",
          label:
            "Дёрнуться к оружию на поясе — отчаянный, почти самоубийственный жест",
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
            "Отдать груз без боя — разорительно, зато без стрельбы: их напор спадёт",
          toLocation: "resolve_paid",
          effects: ["credits -= 2000", "tension -= 2", "leverage += 2"],
        },
        {
          id: "bluff_backup",
          label:
            "Блефовать: якобы патруль уже на подходе к системе — как повезёт",
          toLocation: "bluff_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "defiance",
          label:
            "Отказать наотрез — пусть видят характер: рискованно, но покажет силу",
          toLocation: "resolve_defiant",
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
      text: "Капитан ещё вслушивается в эфир, не разобрав до конца, блеф это был или чистая правда. Стволы замерли на полпути — и в этой заминке решится всё.\nНапряжение: {tension} | Позиция: {leverage}",
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
      id: "resolve_paid",
      text: "Ваш груз уже плывёт по трапу в чужой трюм. Капитан провожает контейнеры взглядом, прикидывая — довольно ли этого, или содрать с вас вдобавок и шкуру.\nНапряжение: {tension} | Позиция: {leverage}",
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
      id: "resolve_defiant",
      text: "Ваш отказ повис в тесном шлюзе. Капитан медленно ведёт взглядом с вас на своих людей и обратно: проглотить дерзость — или сделать из вас урок остальным.\nНапряжение: {tension} | Позиция: {leverage}",
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
      text: "Капитан хмыкает, опускает ствол — и его люди следом. «А ты не так прост». Ударили по рукам: они уходят с малой долей, а вам, чтобы не держали зла, отслюнявливают горсть монет с того же воза — не богатство, а жест, чтобы разойтись ровно. Трап отстыковывается. Вы живы, при корабле, и с историей, которую не стыдно рассказать.\nКредиты: {credits} | Репутация: {rating}",
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
