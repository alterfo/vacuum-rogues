import type { QuestScript } from "../QuestScript";

export const auctionScript: QuestScript = {
  id: "auction",
  title: "Аукцион",
  params: [
    {
      id: "budget",
      name: "Бюджет (кр)",
      min: 0,
      max: 800,
      initial: 800,
      showInUI: true,
    },
    {
      id: "profit",
      name: "Прибыль (кр)",
      min: -9999,
      max: 9999,
      initial: 0,
      showInUI: true,
    },
    {
      id: "lots_won",
      name: "Лотов куплено",
      min: 0,
      max: 8,
      initial: 0,
      showInUI: true,
    },
    {
      id: "current_lot",
      name: "Лот №",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: false,
    },
    {
      id: "lot_1_class",
      name: "Лот 1",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_2_class",
      name: "Лот 2",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_3_class",
      name: "Лот 3",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_4_class",
      name: "Лот 4",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_5_class",
      name: "Лот 5",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_6_class",
      name: "Лот 6",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_7_class",
      name: "Лот 7",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_8_class",
      name: "Лот 8",
      min: 2,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_class_current",
      name: "Класс лота",
      min: 0,
      max: 4,
      initial: 0,
      showInUI: false,
    },
    {
      id: "bid_result",
      name: "Вид ставки",
      min: 0,
      max: 2,
      initial: 0,
      showInUI: false,
    },
    {
      id: "bot_agg_budget",
      name: "Бот-агр. бюджет",
      min: 0,
      max: 600,
      initial: 600,
      showInUI: false,
    },
    {
      id: "random_bot_roll",
      name: "Случайный бот",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "prepare_lot_1",
  locations: [
    {
      id: "prepare_lot_1",
      text: "Молоток аукциониста бьёт по кафедре. «Лот первый — на подиум!» Прожекторы вспыхивают над помостом.",
      transitions: [
        {
          id: "init_lot_1",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_1_class + 0",
            "current_lot = 1",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_2",
      text: "Служители укатывают проданное во тьму. «Лот второй!» — и новый груз выкатывают под слепящий свет.",
      transitions: [
        {
          id: "init_lot_2",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_2_class + 0",
            "current_lot = 2",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_3",
      text: "В дымном воздухе плывёт гул голосов. «Лот третий, господа!» Аукционист обводит зал цепким взглядом.",
      transitions: [
        {
          id: "init_lot_3",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_3_class + 0",
            "current_lot = 3",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_4",
      text: "Ночь только разгорается. «Лот четвёртый!» — молоток замирает в поднятой руке, ожидая первую ставку.",
      transitions: [
        {
          id: "init_lot_4",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_4_class + 0",
            "current_lot = 4",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_5",
      text: "Половина торгов позади. «Лот пятый!» Кошельки в зале заметно похудели — самое время оценить соперников.",
      transitions: [
        {
          id: "init_lot_5",
          label: "...",
          toLocation: "rival_approach",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_5_class + 0",
            "current_lot = 5",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_6",
      text: "«Лот шестой!» Аукционист смахивает пот со лба. В зале остались только те, кому ещё есть чем платить.",
      transitions: [
        {
          id: "init_lot_6",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_6_class + 0",
            "current_lot = 6",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_7",
      text: "Торги идут к концу. «Лот седьмой!» Каждая монета теперь на счету — ошибок больше не простят.",
      transitions: [
        {
          id: "init_lot_7",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_7_class + 0",
            "current_lot = 7",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },
    {
      id: "prepare_lot_8",
      text: "«Последний лот, дамы и господа — восьмой!» Зал замирает. Это твой финальный шанс сорвать банк.",
      transitions: [
        {
          id: "init_lot_8",
          label: "...",
          toLocation: "lot_screen",
          autoExecute: true,
          effects: [
            "lot_class_current = lot_8_class + 0",
            "current_lot = 8",
            "random_bot_roll = random(0,1)",
          ],
        },
      ],
    },

    {
      id: "rival_approach",
      text:
        "Пока служители меняют лот, богач-спорщик наклоняется к твоему уху:\n" +
        "«Этот лот я хочу себе. Уступи его — и вот тебе 150 кр отступных, без торга и сбора.»\n" +
        "За его плечом маячит шальной покупатель — он тоже не прочь вступить в игру.",
      transitions: [
        {
          id: "take_bribe",
          label: "Взять 150 кр и уступить лот богачу",
          toLocation: "rival_bribe_taken",
          effects: ["profit += 150", "bid_result = 0"],
        },
        {
          id: "refuse_bid",
          label: "Отказать и всё же побороться за лот",
          toLocation: "lot_screen",
          effects: [],
        },
        {
          id: "skip_lot",
          label: "Молча уйти — ни ставки, ни денег богача",
          toLocation: "next_lot_dispatch",
          effects: ["bid_result = 0"],
        },
      ],
    },
    {
      id: "rival_bribe_taken",
      text: "Богач сдержанно кивает и суёт тебе пачку купюр. Лот уходит ему — а твой барыш подрос без единого риска.",
      transitions: [
        {
          id: "rb_next",
          label: "...",
          toLocation: "next_lot_dispatch",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    {
      id: "lot_screen",
      text:
        "Наследственный аукцион Мэлоков. Под прожекторами — лот {current_lot} из 8.\n" +
        "Груз укрыт мешковиной — истинную цену узнаешь, лишь когда молоток ударит в твою пользу.\n" +
        "В кошельке осталось {budget} кр, за ночь наторговано {profit} кр прибыли.\n" +
        "Слева хрипло дышит богатый спорщик, где-то в тени притаился шальной покупатель.\n" +
        "Аукционист поднимает молоток — твоё слово:",
      transitions: [
        {
          id: "skip_lot",
          label: "Молчать — не рисковать сбором на заведомо чужом лоте",
          toLocation: "next_lot_dispatch",
          effects: ["bid_result = 0"],
        },
        {
          id: "bid_low",
          label:
            "Кинуть 100 кр — дёшево, но проигранная ставка съест 50 кр сбора",
          toLocation: "bot_response",
          condition: "budget >= 100",
          effects: ["budget -= 100", "bid_result = 1"],
        },
        {
          id: "bid_high",
          label:
            "Бахнуть 250 кр — лот твой наверняка, но цену под тряпьём не видать",
          toLocation: "player_wins",
          condition: "budget >= 250",
          effects: ["budget -= 250", "bid_result = 2"],
        },
      ],
    },

    {
      id: "bot_response",
      text: "Твои 100 кр повисают в дыму. Аукционист выжидает — соперники переглядываются...",
      transitions: [
        {
          id: "bot_agg_outbids",
          label: "...",
          toLocation: "bot_agg_bids",
          condition: "bot_agg_budget >= 200",
          effects: [],
          autoExecute: true,
        },
        {
          id: "bot_agg_passed",
          label: "...",
          toLocation: "random_bot_check",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "bot_agg_bids",
      text: "«Двести!» — рявкает толстосум слева, не дав тебе и вздохнуть. Молоток падает: лот ушёл ему. Ставку в 100 кр возвращают, но 50 кр аукционного сбора за пустой торг дом удержит.",
      transitions: [
        {
          id: "bot_agg_wins",
          label: "Забрать назад свою ставку",
          toLocation: "next_lot_dispatch",
          effects: ["budget += 100", "bot_agg_budget -= 200", "profit -= 50"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "random_bot_check",
      text: "Богач молчит — денег у него не осталось. Но в тени кто-то поглаживает подбородок...",
      transitions: [
        {
          id: "random_bot_wins",
          label: "...",
          toLocation: "random_bot_bids",
          condition: "random_bot_roll == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "random_bot_passed",
          label: "...",
          toLocation: "player_wins",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "random_bot_bids",
      text: "Шальной покупатель вдруг вскидывает табличку и перебивает тебя! Молоток бьёт — лот не твой. Ставку возвращают, а 50 кр сбора за пустой торг тебе уже не вернуть.",
      transitions: [
        {
          id: "random_bot_claim",
          label: "Забрать назад свою ставку",
          toLocation: "next_lot_dispatch",
          effects: ["budget += 100", "profit -= 50"],
          autoExecute: true,
        },
      ],
    },

    {
      id: "player_wins",
      text: "«Продано!» — молоток бьёт в твою пользу. Лот {current_lot} твой, служители катят добычу к тебе.",
      transitions: [
        {
          id: "pw_c1",
          label: "...",
          toLocation: "pw_bid_c1",
          condition: "lot_class_current == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "pw_c2",
          label: "...",
          toLocation: "pw_bid_c2",
          condition: "lot_class_current == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "pw_c3",
          label: "...",
          toLocation: "pw_bid_c3",
          condition: "lot_class_current == 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "pw_c4",
          label: "...",
          toLocation: "pw_bid_c4",
          condition: "lot_class_current == 4",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "pw_bid_c1",
      text: "Под тряпьём — дешёвый хлам класса 1, от силы 100 кр. Барыш едва покроет ставку.",
      transitions: [
        {
          id: "pw_c1_b1",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 1",
          effects: ["lots_won += 1"],
          autoExecute: true,
        },
        {
          id: "pw_c1_b2",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 2",
          effects: ["profit -= 150", "lots_won += 1"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "pw_bid_c2",
      text: "Груз класса 2 — крепкий товар на 200 кр перекупщику. Прибавка честная.",
      transitions: [
        {
          id: "pw_c2_b1",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 1",
          effects: ["profit += 100", "lots_won += 1"],
          autoExecute: true,
        },
        {
          id: "pw_c2_b2",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 2",
          effects: ["profit -= 50", "lots_won += 1"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "pw_bid_c3",
      text: "Лакомый груз класса 3 — на рынке уйдёт за 300 кр. Есть чем поживиться.",
      transitions: [
        {
          id: "pw_c3_b1",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 1",
          effects: ["profit += 200", "lots_won += 1"],
          autoExecute: true,
        },
        {
          id: "pw_c3_b2",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 2",
          effects: ["profit += 50", "lots_won += 1"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "pw_bid_c4",
      text: "Жемчужина торгов — редкость класса 4, добрых 400 кр перекупщику. Ты сорвал куш.",
      transitions: [
        {
          id: "pw_c4_b1",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 1",
          effects: ["profit += 300", "lots_won += 1"],
          autoExecute: true,
        },
        {
          id: "pw_c4_b2",
          label: "...",
          toLocation: "pw_done",
          condition: "bid_result == 2",
          effects: ["profit += 150", "lots_won += 1"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "pw_done",
      text: "Добычу оттаскивают к твоим ногам. Аукционист уже тянется за следующим лотом.",
      transitions: [
        {
          id: "pw_next",
          label: "...",
          toLocation: "next_lot_dispatch",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    {
      id: "next_lot_dispatch",
      text: "Помост пустеет. Аукционист сверяется со списком — на очереди новый лот...",
      transitions: [
        {
          id: "nl_1",
          label: "...",
          toLocation: "prepare_lot_2",
          condition: "current_lot == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_2",
          label: "...",
          toLocation: "prepare_lot_3",
          condition: "current_lot == 2",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_3",
          label: "...",
          toLocation: "prepare_lot_4",
          condition: "current_lot == 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_4",
          label: "...",
          toLocation: "prepare_lot_5",
          condition: "current_lot == 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_5",
          label: "...",
          toLocation: "prepare_lot_6",
          condition: "current_lot == 5",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_6",
          label: "...",
          toLocation: "prepare_lot_7",
          condition: "current_lot == 6",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_7",
          label: "...",
          toLocation: "prepare_lot_8",
          condition: "current_lot == 7",
          effects: [],
          autoExecute: true,
        },
        {
          id: "nl_8",
          label: "...",
          toLocation: "final_verdict",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    {
      id: "final_verdict",
      text: "Последний молоток отгремел, зал пустеет. В твоих руках {lots_won} из 8 лотов, в книге барыша — {profit} кр. Устоял ли ты порог в 500?",
      transitions: [
        {
          id: "fv_win",
          label: "...",
          toLocation: "quest_success",
          condition: "profit >= 500",
          effects: [],
          autoExecute: true,
        },
        {
          id: "fv_lose",
          label: "...",
          toLocation: "quest_failure_profit",
          effects: [],
          autoExecute: true,
        },
      ],
    },

    {
      id: "quest_success",
      text:
        "Ты читал зал как открытую книгу — дал богачу выдохнуться и снимал сливки по дешёвке.\n" +
        "Гильдия сверяет твою книгу торгов: барыш {profit} кр — ты уложился в норму, и обещанную за вечер плату получишь сполна.\n" +
        "(Сам барыш остаётся в кассе аукциона — тебе причитается лишь оговорённый гонорар.)\n" +
        "Взято лотов: {lots_won}/8 | В кошельке ещё звенит: {budget} кр",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_profit",
      text:
        "Ты либо палил дорогими ставками, либо дрожал над каждой монетой — и упустил ночь.\n" +
        "Барыш всего {profit} кр, а гильдия ждала не меньше 500. Уговор сорван — гонорар за вечер ты не увидишь.\n" +
        "Взято лотов: {lots_won}/8 | Осталось на дне кошелька: {budget} кр",
      isFailure: true,
      transitions: [],
    },
  ],
};
