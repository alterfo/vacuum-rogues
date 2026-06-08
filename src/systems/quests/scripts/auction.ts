import type { QuestScript } from "../QuestScript";

// Design: Maelon scrap auction. 8 lots, budget 800cr.
// Each lot has a class (1–4, random). Value = class × 100.
// Player: skip | bid_low (100cr, risky) | bid_high (250cr, guaranteed win).
// Bot responses after bid_low:
//   - Aggressive bot (budget 600cr, bids +100): outbids until broke (3 lots max).
//   - Random bot (roll 0/1 per lot): 50% chance outbids bid_low.
// Win condition: profit >= 500 after all 8 lots.
// Strategy: let aggressive bot exhaust itself, then bid_low on remaining lots.
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
    // Lot classes (random 1–4); value = class × 100
    {
      id: "lot_1_class",
      name: "Лот 1",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_2_class",
      name: "Лот 2",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_3_class",
      name: "Лот 3",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_4_class",
      name: "Лот 4",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_5_class",
      name: "Лот 5",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_6_class",
      name: "Лот 6",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_7_class",
      name: "Лот 7",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    {
      id: "lot_8_class",
      name: "Лот 8",
      min: 1,
      max: 4,
      initial: "random",
      showInUI: false,
    },
    // Staging: class of current lot, bid level chosen by player (1=low, 2=high)
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
    // Aggressive bot budget (600 = 3 lots × 200cr per lot it wins)
    {
      id: "bot_agg_budget",
      name: "Бот-агр. бюджет",
      min: 0,
      max: 600,
      initial: 600,
      showInUI: false,
    },
    // Random bot roll (0 or 1) re-rolled each lot in prepare_lot_N
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
    // --- Lot preparation (copy class to staging, re-roll random bot) ---
    {
      id: "prepare_lot_1",
      text: "Объявляется лот 1...",
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
      text: "Объявляется лот 2...",
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
      text: "Объявляется лот 3...",
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
      text: "Объявляется лот 4...",
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
      text: "Объявляется лот 5...",
      transitions: [
        {
          id: "init_lot_5",
          label: "...",
          toLocation: "lot_screen",
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
      text: "Объявляется лот 6...",
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
      text: "Объявляется лот 7...",
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
      text: "Объявляется лот 8...",
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

    // --- Main auction screen (shared for all 8 lots) ---
    {
      id: "lot_screen",
      text:
        "Аукцион Мэлоков. Лот {current_lot}/8.\n" +
        "Класс: {lot_class_current} | Оценочная стоимость: {lot_class_current}00 кр\n" +
        "Ваш бюджет: {budget} кр | Текущая прибыль: {profit} кр\n" +
        "Три участника: агрессивный бот, осторожный, случайный.\n" +
        "Сделайте ставку:",
      transitions: [
        {
          id: "skip_lot",
          label: "Пропустить лот",
          toLocation: "next_lot_dispatch",
          effects: ["bid_result = 0"],
        },
        {
          id: "bid_low",
          label: "Ставка 100 кр (рискованно)",
          toLocation: "bot_response",
          condition: "budget >= 100",
          effects: ["budget -= 100", "bid_result = 1"],
        },
        {
          id: "bid_high",
          label: "Ставка 250 кр (надёжно)",
          toLocation: "player_wins",
          condition: "budget >= 250",
          effects: ["budget -= 250", "bid_result = 2"],
        },
      ],
    },

    // --- Bot response after bid_low ---
    // Aggressive bot outbids if it has budget left (≥200cr); otherwise random bot may snipe
    {
      id: "bot_response",
      text: "Боты реагируют на вашу ставку...",
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
    // Aggressive bot wins: refund player bid, deduct bot budget
    {
      id: "bot_agg_bids",
      text: "Агрессивный бот перебил вашу ставку!",
      transitions: [
        {
          id: "bot_agg_wins",
          label: "...",
          toLocation: "next_lot_dispatch",
          effects: ["budget += 100", "bot_agg_budget -= 200"],
          autoExecute: true,
        },
      ],
    },
    // Random bot check (after aggressive bot passed)
    {
      id: "random_bot_check",
      text: "Случайный бот рассматривает ставку...",
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
    // Random bot wins: refund player
    {
      id: "random_bot_bids",
      text: "Случайный бот сделал неожиданно высокую ставку!",
      transitions: [
        {
          id: "random_bot_claim",
          label: "...",
          toLocation: "next_lot_dispatch",
          effects: ["budget += 100"],
          autoExecute: true,
        },
      ],
    },

    // --- Player wins the lot: compute profit via 2-level staging ---
    // Level 1: dispatch by lot_class_current (1–4)
    {
      id: "player_wins",
      text: "Вы выиграли лот {current_lot}!",
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
    // Level 2 per class: dispatch by bid_result (1=100cr, 2=250cr)
    // Class 1 (value 100): profit deltas → bid_low: +0, bid_high: -150
    {
      id: "pw_bid_c1",
      text: "...",
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
    // Class 2 (value 200): bid_low: +100, bid_high: -50
    {
      id: "pw_bid_c2",
      text: "...",
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
    // Class 3 (value 300): bid_low: +200, bid_high: +50
    {
      id: "pw_bid_c3",
      text: "...",
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
    // Class 4 (value 400): bid_low: +300, bid_high: +150
    {
      id: "pw_bid_c4",
      text: "...",
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
      text: "...",
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

    // --- Next lot dispatcher (routes by current_lot 1–8) ---
    {
      id: "next_lot_dispatch",
      text: "Следующий лот...",
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

    // --- Final verdict ---
    {
      id: "final_verdict",
      text: "Аукцион завершён. Куплено лотов: {lots_won}/8 | Прибыль: {profit} кр",
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

    // --- Terminal locations ---
    {
      id: "quest_success",
      text:
        "Блестящая торговля! Прибыль {profit} кр — достаточно для апгрейда корабля.\n" +
        "Куплено лотов: {lots_won}/8 | Остаток бюджета: {budget} кр",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_profit",
      text:
        "Аукцион окончен. Прибыль {profit} кр — недостаточно (нужно ≥500 кр).\n" +
        "Куплено лотов: {lots_won}/8 | Остаток бюджета: {budget} кр",
      isFailure: true,
      transitions: [],
    },
  ],
};
