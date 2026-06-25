import type { QuestScript } from "../QuestScript";

// Design: First contact with an unknown alien vessel. Diplomacy with clear
// peace vs hostility outcomes, driven by an alien-`trust` meter.
// Choice points:
//   1. The opening — broadcast a peace greeting (+trust), run an active scan
//      (roll: curiosity or alarm), or raise shields (−trust, leads to a standoff).
//   2. The follow-up — reciprocate a gift (+trust), accept warily (small +trust),
//      or make demands (−trust); from a standoff: stand down (+trust), hold aim
//      or fire a warning shot (−trust, risks war).
// Peaceful endings are SUCCESS, hostile endings are FAILURE.
//   - ending_alliance      (high trust → alliance, big reward)           SUCCESS
//   - ending_trade_pact    (mid trust → trade pact)                      SUCCESS
//   - ending_wary_peace    (low trust → uneasy peace)                    SUCCESS
//   - ending_cold_standoff (they leave wary, no relations)               FAILURE
//   - ending_war           (provoked them into hostilities)              FAILURE
export const firstContactScript: QuestScript = {
  id: "first-contact",
  title: "Первый контакт",
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
      id: "trust",
      name: "Доверие",
      min: -9999,
      max: 99,
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
  startLocation: "encounter",
  locations: [
    {
      id: "encounter",
      text: "Из тени газового гиганта выходит корабль невиданной конструкции. Язык неизвестен, намерения неясны.\nДоверие: {trust}\n\nКак вы ответите?",
      transitions: [
        {
          id: "broadcast",
          label: "Передать мирное приветствие на всех частотах",
          toLocation: "greeting",
          effects: ["trust += 2"],
        },
        {
          id: "scan",
          label: "Активно просканировать чужой корабль (могут счесть угрозой)",
          toLocation: "scan_reaction",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "raise_shields",
          label: "Поднять щиты и взять их на прицел",
          toLocation: "standoff",
          effects: ["trust -= 3"],
        },
      ],
    },
    {
      id: "greeting",
      text: "Чужие отвечают переливом тонов и проецируют голограмму — они протягивают маленький артефакт в знак добрых намерений.",
      transitions: [
        {
          id: "reciprocate",
          label: "Ответить даром — передать им образец земной культуры",
          toLocation: "exchange",
          effects: ["trust += 4"],
        },
        {
          id: "accept_wary",
          label: "Принять дар, но ничего не предлагать взамен",
          toLocation: "exchange",
          effects: ["trust += 1"],
        },
        {
          id: "demand_tech",
          label: "Потребовать их технологии в обмен",
          toLocation: "exchange",
          effects: ["trust -= 4"],
        },
      ],
    },
    {
      id: "scan_reaction",
      text: "Луч сканера скользит по чужому корпусу...",
      transitions: [
        {
          id: "scan_curious",
          label: "...",
          toLocation: "greeting",
          condition: "roll >= 5",
          effects: [],
          autoExecute: true,
        },
        {
          id: "scan_alarmed",
          label: "...",
          toLocation: "standoff",
          effects: ["trust -= 4"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "standoff",
      text: "Оба корабля замирают, орудия наготове. Одно неверное движение — и начнётся война.\nДоверие: {trust}",
      transitions: [
        {
          id: "stand_down",
          label: "Опустить оружие и показать мирные намерения",
          toLocation: "exchange",
          effects: ["trust += 4"],
        },
        {
          id: "hold_aim",
          label: "Держать их на прицеле и требовать отойти",
          toLocation: "hostility_gate",
          effects: ["trust -= 2"],
        },
        {
          id: "fire_warning",
          label: "Дать предупредительный залп",
          toLocation: "hostility_gate",
          effects: ["trust -= 6"],
        },
      ],
    },
    {
      id: "exchange",
      text: "Обмен жестами и данными продолжается...",
      transitions: [
        {
          id: "resolve_peace",
          label: "...",
          toLocation: "resolution_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "resolution_gate",
      text: "Чужие совещаются и выносят решение...",
      transitions: [
        {
          id: "to_alliance",
          label: "...",
          toLocation: "ending_alliance",
          condition: "trust >= 6",
          effects: ["credits += 3000", "rating += 30"],
          autoExecute: true,
        },
        {
          id: "to_trade",
          label: "...",
          toLocation: "ending_trade_pact",
          condition: "trust >= 2",
          effects: ["credits += 1500", "rating += 15"],
          autoExecute: true,
        },
        {
          id: "to_wary",
          label: "...",
          toLocation: "ending_wary_peace",
          effects: ["rating += 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "hostility_gate",
      text: "Чужой корабль разворачивает орудийные порты...",
      transitions: [
        {
          id: "to_war",
          label: "...",
          toLocation: "ending_war",
          condition: "trust <= -6",
          effects: ["rating -= 30"],
          autoExecute: true,
        },
        {
          id: "to_cold",
          label: "...",
          toLocation: "ending_cold_standoff",
          effects: ["rating -= 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_alliance",
      text: "Чужие признают в вас союзника. Они делятся картами звёздных троп и дарами — начало большой дружбы.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_trade_pact",
      text: "Контакт перерос в торговое соглашение. Не союз, но крепкое начало взаимной выгоды.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_wary_peace",
      text: "Чужие уходят без вражды, но и без тепла. Войны нет — и то хлеб.\nРепутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_cold_standoff",
      text: "Чужие настороженно отступают в тень гиганта. Контакт сорван, отношения испорчены.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_war",
      text: "Чужие отвечают залпом на залп. Первый контакт обернулся первой войной — этот шрам надолго.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
  ],
};
