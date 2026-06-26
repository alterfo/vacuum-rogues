// Russian (default) UI dictionary. RU values are the verbatim in-game strings.
//
// Keys are namespaced `area.thing` (e.g. `common.back`, `settings.title`). Keep
// this in lockstep with `en.ts` — the parity test (`src/tests/i18n/parity.test.ts`)
// fails if the two key sets diverge. Add a new string here AND in `en.ts`.

import type { Dict } from "./i18n";

export const ru: Dict = {
  // --- common controls -----------------------------------------------------
  "common.back": "Назад",
  "common.close": "Закрыть",
  "common.cancel": "Отмена",
  "common.confirm": "Подтвердить",
  "common.ok": "ОК",
  "common.yes": "Да",
  "common.no": "Нет",
  "common.buy": "Купить",
  "common.sell": "Продать",
  "common.credits": "кредитов",
  "common.continue": "Продолжить",

  // --- settings panel ------------------------------------------------------
  "settings.title": "НАСТРОЙКИ",
  "settings.speed": "СКОРОСТЬ",
  "settings.font": "ШРИФТ",
  "settings.neuralAi": "НЕЙРОСЕТЬ (ИИ)",
  "settings.neuralOn": "Нейросеть ИИ включена (эксперимент)",
  "settings.neuralOff": "Нейросеть ИИ выключена",
  "settings.experimental": "экспериментально",
  "settings.language": "ЯЗЫК",
  "settings.on": "ВКЛ",
  "settings.off": "ВЫКЛ",
  // Language autonyms — each shown in its own script regardless of the active
  // language, so the values are intentionally identical in `ru.ts` and `en.ts`.
  "lang.ru": "Русский",
  "lang.en": "English",

  // --- shared labels -------------------------------------------------------
  "label.creditsLine": "Кредиты: {n}",

  // --- resources (market goods) --------------------------------------------
  "resource.FUEL": "Топливо",
  "resource.METALS": "Металлы",
  "resource.CRYSTALS": "Кристаллы",
  "resource.ORGANICS": "Органика",
  "resource.ARTIFACTS": "Артефакты",
  "resource.WEAPONS": "Оружие",
  "resource.MEDICINE": "Медикаменты",
  "resource.ELECTRONICS": "Электроника",
  "resource.LUXURY": "Роскошь",
  "resource.DATA_CORES": "Ядра данных",

  // --- factions (singular type) / alliances (plural) / NPC roles -----------
  "factionType.OUTLANDERS": "Окраинник",
  "factionType.BASTIONS": "Бастион",
  "factionType.SYNDICATE": "Синдикат",
  "factionType.PARADOXES": "Парадокс",
  "factionType.PROGRESSORS": "Прогрессор",
  "faction.OUTLANDERS": "Окраинники",
  "faction.BASTIONS": "Бастионы",
  "faction.SYNDICATE": "Синдикат",
  "faction.PARADOXES": "Парадоксы",
  "faction.PROGRESSORS": "Прогрессоры",
  "faction.INDEPENDENT": "Независимые",
  "faction.OVERMIND": "Предтечи",
  "role.RANGER": "Рейнджер",
  "role.TRADER": "Торговец",
  "role.PIRATE": "Пират",
  "role.PATROL": "Патруль",

  // --- main menu -----------------------------------------------------------
  "menu.title": "ВАКУУМНЫЕ ПРОЙДОХИ",
  "menu.intro":
    "Галактика на изломе: пробудились древние Предтечи, и их Сверхразум " +
    "обращает систему за системой в безмолвный механический рой. Вы — " +
    "вакуумный пройдоха: вольный пилот без флага и присяги, что живёт " +
    "торговлей, контрактами и точным выстрелом. Лавируйте между фракциями, " +
    "набивайте трюм и репутацию, решайте, кому помочь, а кого пощипать, — " +
    "и, быть может, именно ваш потрёпанный корабль решит, устоит ли " +
    "обитаемый космос.",
  "menu.newGame": "Новая игра",
  "menu.feedback": "Сообщить отзыв",
  "menu.replayTutorial": "Показать обучение заново",
  "menu.tutorialReset": "Обучение сброшено — подсказки появятся снова",
  "menu.engineUnavailable": "Ошибка: игровой движок недоступен",
  "menu.loading": "Загрузка...",
  "menu.noSaves": "Нет доступных сохранений",
  "menu.loadError": "Ошибка загрузки. Начните новую игру.",

  // --- trade / market ------------------------------------------------------
  "trade.title": "МАРКЕТ — {planet}",
  "trade.colResource": "Ресурс",
  "trade.colBuy": "Покупка",
  "trade.colSell": "Продажа",
  "trade.colHold": "В трюме",
  "trade.colQty": "Кол-во",
  "trade.leave": "Покинуть маркет",
  "trade.escHint": "[Esc] — выход",
  "trade.maxBtn": "М",
  "trade.bought": "Куплено",
  "trade.sold": "Продано",
  "trade.result": "{verb}: {qty}×{name} за {price} кр.",
  "trade.insufficientCredits": "Недостаточно кредитов",
  "trade.nothingToSell": "Нечего продавать",
  "trade.failed": "Сделка не удалась",

  // --- job board / quest types ---------------------------------------------
  "quest.type.DELIVERY": "Доставка",
  "quest.type.BOUNTY": "Охота",
  "quest.type.ESCORT": "Эскорт",
  "quest.type.DIPLOMACY": "Дипломатия",
  "quest.type.EXPLORATION": "Разведка",
  "quest.type.TEXT_ADVENTURE": "✦ История",
  "quest.type.DEFENSE": "⚔ Оборона",
  "jobBoard.title": "ДОСКА ЗАДАНИЙ",
  "jobBoard.maxQuests": "Максимум заданий: {max}/{max}",
  "jobBoard.activeQuests": "АКТИВНЫЕ ЗАДАНИЯ",
  "jobBoard.availableQuests": "ДОСТУПНЫЕ ЗАДАНИЯ",
  "jobBoard.noQuests": "Свободных заданий нет.",
  "jobBoard.noDeadline": "Без срока",
  "jobBoard.expired": "ПРОСРОЧЕНО",
  "jobBoard.daysLeft": "⏱ {days}д",
  "jobBoard.scrollHint": "колесо / стрелки",
  "jobBoard.accepted": "✓ Принято",
  "jobBoard.accept": "Принять",
  "jobBoard.requireRank": "Ранг {rank}+",
  "jobBoard.busy": "Занят",

  // --- comms / NPC contact panel -------------------------------------------
  "comms.option.trade": "Торговать",
  "comms.option.hire": "Нанять",
  "comms.option.ally": "Союз",
  "comms.option.attack": "Атаковать",
  "comms.option.pay-tribute": "Откупиться",
  "comms.option.flee": "Бежать",
  "comms.hail": "Связаться",
  "comms.scan": "Сканировать",
  "comms.factionLine": "Фракция: {name}",
  "comms.allianceLine": "Альянс: {name}",
  "comms.roleLine": "Роль: {name}",
  "comms.hullLine": "Корпус: {cur} / {max}",
  "comms.shieldsLine": "Щиты: {n}",
  "comms.damageLine": "Урон: {n}",
  "comms.speedLine": "Скорость: {n}",
  "comms.outOfRange": "Цель вне зоны радара",
  "comms.approach": "Приблизиться",
  "comms.noData": "Данные недоступны",
  "comms.equipment": "Снаряжение:\n{items}",
  "comms.cargo": "Груз: {cargo}",
  "comms.shielded": "Цель защищена полем —\nсканирование невозможно",
};
