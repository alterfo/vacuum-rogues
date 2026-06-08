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
      text: "Корабль {shipNum}/20 на шлюзе.\nПодозрительность: {suspicion}/10\nКредиты: {money} | Рейтинг: {rating}\n\nВаше решение?",
      transitions: [
        {
          id: "scan",
          label: "Сканировать (−200 кр)",
          toLocation: "scan_check_high",
          effects: ["money -= 200", "scan_roll = random(0,9)"],
        },
        {
          id: "pass",
          label: "Пропустить",
          toLocation: "next_ship",
          effects: [],
        },
      ],
    },
    // Staged smuggler check: first filter high suspicion (>=7 = certain smuggler)
    {
      id: "scan_check_high",
      text: "Сканирование...",
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
      text: "Анализ данных...",
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
      text: "Контрабанда обнаружена! Штраф выплачен. +1000 кр.",
      transitions: [
        {
          id: "collect_fine",
          label: "Далее",
          toLocation: "next_ship",
          effects: ["money += 1000"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "found_clean",
      text: "Корабль чист. Дипломатический скандал! −500 рейтинга.",
      transitions: [
        {
          id: "accept_scandal",
          label: "Принять",
          toLocation: "next_ship",
          effects: ["rating -= 500"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "next_ship",
      text: "Следующий корабль подходит к шлюзу...",
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
      text: "Смена окончена.\nЗаработано: {money} кр. Цель: 5000 кр.",
      transitions: [
        {
          id: "win",
          label: "Получить премию",
          toLocation: "quest_success",
          condition: "money >= 5000",
          effects: [],
          autoExecute: true,
        },
        {
          id: "lose",
          label: "Провал",
          toLocation: "quest_failure_credits",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "quest_success",
      text: "Отличная работа, инспектор! План выполнен. Ваша смена окончена.",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "quest_failure_credits",
      text: "Недостаточно кредитов. Вы не выполнили план смены.",
      isFailure: true,
      transitions: [],
    },
    {
      id: "quest_failure_rating",
      text: "Дипломатический скандал достиг критического уровня. Вы отстранены от должности.",
      isFailure: true,
      transitions: [],
    },
  ],
};
