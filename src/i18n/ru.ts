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

  // --- accessibility panel (palette / reduced-motion / key remap) ----------
  "a11y.title": "ДОСТУПНОСТЬ",
  "a11y.palette": "ПАЛИТРА",
  "a11y.reducedMotion": "МЕНЬШЕ ДВИЖЕНИЯ",
  "a11y.controls": "УПРАВЛЕНИЕ",
  "a11y.reset": "Сбросить клавиши",
  "a11y.pressKey": "нажмите клавишу…",
  "a11y.keyTaken": "клавиша занята",
  "palette.default": "Обычная",
  "palette.deuteranopia": "Дейтеранопия",
  "palette.protanopia": "Протанопия",
  "palette.tritanopia": "Тританопия",
  "action.cancel": "Отмена",
  "action.runTurn": "Ход",
  "action.journal": "Журнал",
  "action.inventory": "Инвентарь",

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

  // --- trade-route rumors (Info Center "Торговые возможности" band) ---------
  "rumor.panelHeader": "ТОРГОВЫЕ ВОЗМОЖНОСТИ",
  "rumor.panelEmpty": "Активных торговых маршрутов нет",
  "rumor.panelNoIntel": "Нет данных — разведайте новые системы",
  "rumor.line": "Везите {resource} из {from} в {to}: {margin}",
  "rumor.margin": "маржа ~{pct}%",
  "rumor.marginMasked": "маржа ~?%",
  "rumor.expired":
    "Везти {resource} из {from} в {to} больше невыгодно — акция закончилась.",

  // --- Info Center news feed -----------------------------------------------
  "news.type.NPC_QUEST_COMPLETE": "[РЕЙНДЖЕР]",
  "news.type.PIRATE_ATTACK": "[АТАКА]",
  "news.type.MARKET_SHIFT": "[РЫНОК]",
  "news.type.OVERMIND_EXPANSION": "[УГРОЗА]",
  "news.type.PIRATE_SURGE": "[ПИРАТЫ]",
  "news.type.TRADE_BOOM": "[ТОРГОВЛЯ]",
  "news.type.PLAGUE": "[ЭПИДЕМИЯ]",
  "news.type.DISCOVERY": "[ОТКРЫТИЕ]",
  "news.type.SYSTEM_LIBERATED": "[ОСВОБОЖДЕНИЕ]",
  "news.type.SYSTEM_CAPTURED": "[ЗАХВАТ]",
  "news.type.LIBERATION_CAMPAIGN": "[ПОХОД]",
  "news.type.TRADE_OPPORTUNITY": "[МАРШРУТ]",
  "news.type.CAMPAIGN_ESCALATION": "[ЭСКАЛАЦИЯ]",
  "news.escalation.NOTICED":
    "OVERMIND заметил вас: разведчики докладывают, что фронт ускоряется, а гарнизоны усиливаются",
  "news.escalation.HARDENING":
    "Фронт OVERMIND крепнет: под его контролем уже более трети галактики — время на исходе",
  "news.escalation.FINAL_PUSH":
    "Фронт OVERMIND сдержан: путь к ядру открыт — решающий удар возможен",
  "news.fallbackDesc": "{label} в системе {system}",
  "news.distCurrentSystem": "текущая система",
  "news.distHere": "здесь",
  "news.distJumps": "{n} пр.",
  "news.pirateAlert": '[ТРЕВОГА] Пираты в системе "{system}" ({dist})',
  "news.deltaDown": " ▼{pct}% vs здесь",
  "news.deltaUp": " ▲{pct}% vs здесь",
  "news.marketBest":
    '[РЫНОК] {resource}: лучшая цена "{system}" — {price} ₡{delta} ({dist})',
  "news.traders": '[ТРАФИК] Торговцы активны в системе "{system}"',
  "news.patrol": '[ПАТРУЛЬ] Флот охраны обнаружен в системе "{system}"',
  "news.loreTag": "[НОВОСТИ] {text}",
  "news.lore1": "Совет Независимых обсуждает нейтральный договор с Бастионом",
  "news.lore2": "Прогрессоры объявили о новой серии кораблей класса «Омега»",
  "news.lore3": "Окраинники расширяют торговые маршруты в южный сектор",
  "news.lore4": "Синдикат отрицает атаки на транспортные конвои",
  "news.lore5": "Бастион увеличил военное производство на 40%",
  "news.lore6": "Парадоксы зафиксированы вблизи запретной зоны R-17",
  "news.lore7": "Рейнджеры сообщают об аномальной активности в туманности",

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
  "menu.saves": "Сохранения",
  "menu.settings": "Настройки",
  "menu.feedback": "Сообщить отзыв",
  "menu.replayTutorial": "Показать обучение заново",
  "menu.tutorialReset": "Обучение сброшено — подсказки появятся снова",
  "menu.engineUnavailable": "Ошибка: игровой движок недоступен",
  "menu.loading": "Загрузка...",
  "menu.noSaves": "Нет доступных сохранений",
  "menu.loadError": "Ошибка загрузки. Начните новую игру.",

  // --- new-game / faction selection ----------------------------------------
  "race.title": "ВЫБЕРИТЕ ФРАКЦИЮ",
  "race.back": "[ Назад ]",
  "race.start": "НАЧАТЬ ИГРУ",
  "race.difficulty": "СЛОЖНОСТЬ",
  "race.mode.GOD.title": "Бог",
  "race.mode.GOD.desc":
    "Корабль не гибнет — при нуле прочности глохнут оружие и гиперпрыжок до ремонта",
  "race.mode.NORMAL.title": "Средний",
  "race.mode.NORMAL.desc": "Стандартная сложность",
  "race.mode.HARD.title": "Сложный",
  "race.mode.HARD.desc": "Больше пиратов и Сверхразума, крупнее гарнизоны",
  "race.faction.OUTLANDERS.title": "ОКРАИННИКИ",
  "race.faction.OUTLANDERS.desc":
    "Колонисты окраин с надёжными кораблями и бонусом к торговле.",
  "race.faction.OUTLANDERS.bonus": "✦ Надёжность: сниженная стоимость ремонта",
  "race.faction.BASTIONS.title": "БАСТИОНЫ",
  "race.faction.BASTIONS.desc":
    "Воинственная империя с тяжёлыми кораблями и мощным оружием.",
  "race.faction.BASTIONS.bonus": "✦ Военные: +20% урон оружия",
  "race.faction.SYNDICATE.title": "СИНДИКАТ",
  "race.faction.SYNDICATE.desc":
    "Теневая организация контрабандистов с быстрыми кораблями.",
  "race.faction.SYNDICATE.bonus":
    "✦ Контрабанда: +30% прибыль от нелегальных товаров",
  "race.faction.PARADOXES.title": "ПАРАДОКСЫ",
  "race.faction.PARADOXES.desc":
    "Загадочная раса с непредсказуемыми технологиями и уникальными модулями.",
  "race.faction.PARADOXES.bonus": "✦ Непредсказуемость: случайные бонусы в бою",
  "race.faction.PROGRESSORS.title": "ПРОГРЕССОРЫ",
  "race.faction.PROGRESSORS.desc":
    "Технологически развитая раса исследователей с передовыми системами.",
  "race.faction.PROGRESSORS.bonus":
    "✦ Технологии: +15% эффективность оборудования",
  "race.stat.hull": "Корпус: {value}",
  "race.stat.shields": "Щиты: {value}",
  "race.stat.speed": "Скорость: {value}",
  "race.stat.evasion": "Уворот: {value}",

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
  "trade.cargoFull": "Недостаточно места в трюме",
  "trade.failed": "Сделка не удалась",

  // --- job board / quest types ---------------------------------------------
  "quest.type.DELIVERY": "Доставка",
  "quest.type.BOUNTY": "Охота",
  "quest.type.ESCORT": "Эскорт",
  "quest.type.DIPLOMACY": "Дипломатия",
  "quest.type.EXPLORATION": "Разведка",
  "quest.type.TEXT_ADVENTURE": "✦ История",
  "quest.type.DEFENSE": "⚔ Оборона",
  "journal.questCompleted": "✓ Квест #{questId} завершён",
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

  // --- captured-system landing denial (with recovery hint) -----------------
  "landing.denial.overmind":
    "Система под контролем Овермайнда — посадка невозможна",
  "landing.denial.pirateRep":
    "Планета захвачена пиратами — нужна репутация. Откупайтесь от пиратов, чтобы её поднять",

  // --- customs fine + standing-recovery hint (Task 7: no rep dead-end) ------
  "customs.fineReason": "Таможенный штраф",
  "standing.recovery.faction":
    "Совет: выполняйте задания фракции, чтобы поднять репутацию",
  "standing.recovery.pirate":
    "Совет: откупайтесь от пиратов, чтобы поднять репутацию и вернуть доступ",

  // --- player-driven liberation of a captured system -----------------------
  "flight.liberationHint":
    "Система захвачена. Уничтожьте всех захватчиков, чтобы освободить её",
  "flight.systemLiberated": "Система {name} освобождена!",

  // --- pirate shakedown tribute («Откупиться») ------------------------------
  "flight.tributeReason": "Откуп пирату «{name}»",
  "flight.tributePaid": "Откуп {amount} кр. — {name} отступает.",
  "flight.tributePaidRep":
    "Откуп {amount} кр. — {name} отступает. Репутация у пиратов растёт.",

  // --- combat salvage (Task 5: killing a credit-carrying NPC pays out) ------
  "flight.salvageTrophy": "Трофей: +{amount} ₡",
  "flight.salvageReason": "Трофей с уничтоженного корабля",

  // --- floating loot pickup (Task 6: collect drops by proximity) ------------
  "flight.lootPickup": "Подобрано: {item}",
  "flight.lootTractor": "Гравитяга подобрала: {item}",
  "flight.lootArtifact": "артефакт",
  "flight.lootModule": "модуль",

  // --- incoming-attacker warning (Task 5: threat indicator) -----------------
  "flight.incomingAttacker": "⚠ Приближается противник: {name}!",
  "flight.starMap": "Межзвёздная карта",

  // --- onboarding / contextual help (panel chrome) -------------------------
  "help.controlsHeader": "Управление:",
  "help.gotIt": "Понятно",

  // --- onboarding: welcome / goal intro ------------------------------------
  "help.welcome.title": "Добро пожаловать, пройдоха!",
  "help.welcome.body1":
    "Вы — вольный пилот в живой галактике. Цель — разбогатеть и остановить" +
    " угрозу Овермайнда: торгуйте, берите задания, исследуйте системы и" +
    " крепите свой корабль, пока не будете готовы дать отпор.",
  "help.welcome.body2":
    "Начните с малого: слетайте к ближайшей планете, осмотритесь и возьмите" +
    " первое задание. Кнопка «?» вверху справа в любой момент откроет" +
    " подсказку для текущего экрана.",

  // --- onboarding: faction selection / new game ----------------------------
  "help.RACE_SELECTION.title": "Новая игра",
  "help.RACE_SELECTION.body1":
    "Выберите фракцию и уровень сложности, прежде чем начать новый забег." +
    " Фракция задаёт стартовые бонусы, характеристики корабля и отношения" +
    " с другими.",
  "help.RACE_SELECTION.body2":
    "Сложность (Бог / Средний / Сложный) определяет, насколько сурова" +
    " галактика. Сделайте выбор и жмите «Начать игру».",
  "help.RACE_SELECTION.control1": "ЛКМ по карточке — выбрать фракцию",
  "help.RACE_SELECTION.control2": "Сложность, затем «Начать игру» — старт",

  // --- onboarding: space flight --------------------------------------------
  "help.SPACE_FLIGHT.title": "Космический полёт",
  "help.SPACE_FLIGHT.body1":
    "Вы пилотируете корабль внутри звёздной системы. Подлетайте к планетам" +
    " и станциям, чтобы сесть, и к другим кораблям, чтобы вступить в бой" +
    " или связаться.",
  "help.SPACE_FLIGHT.body2":
    "Чтобы перейти в соседнюю систему, откройте звёздную карту и совершите" +
    " гиперпрыжок.",
  "help.SPACE_FLIGHT.control1": "ЛКМ по точке — лететь туда",
  "help.SPACE_FLIGHT.control2":
    "ЛКМ по объекту — взаимодействие (посадка / захват / бой)",
  "help.SPACE_FLIGHT.control3": "Звёздная карта — гиперпрыжок между системами",

  // --- onboarding: star map ------------------------------------------------
  "help.STAR_MAP.title": "Звёздная карта",
  "help.STAR_MAP.body1":
    "Карта галактики показывает звёздные системы и связи между ними." +
    " Выберите доступную систему и совершите гиперпрыжок, чтобы туда" +
    " переместиться.",
  "help.STAR_MAP.body2":
    "Прыжок расходует топливо и продвигает игровое время — следите за" +
    " запасами и за тем, что происходит в галактике.",
  "help.STAR_MAP.control1": "ЛКМ по системе — выбрать цель",
  "help.STAR_MAP.control2": "Прыжок — переместиться в выбранную систему",

  // --- onboarding: planet --------------------------------------------------
  "help.PLANET.title": "Планета",
  "help.PLANET.body1":
    "Вы на поверхности планеты. Отсюда открыт доступ к местным заведениям:" +
    " рынку, верфи, правительству, банку и информационному центру.",
  "help.PLANET.body2":
    "Загляните на рынок за выгодной сделкой, в правительство — за заданием," +
    " а на верфь — чтобы улучшить корабль. Взлёт вернёт вас в космос.",
  "help.PLANET.control1": "Кнопки заведений — войти",
  "help.PLANET.control2": "Взлёт — вернуться в полёт",

  // --- onboarding: trade ---------------------------------------------------
  "help.TRADE.title": "Торговля",
  "help.TRADE.body1":
    "Покупайте дёшево, продавайте дорого. Цены меняются от планеты к" +
    " планете — везите товар туда, где он в дефиците, и получайте прибыль.",
  "help.TRADE.body2":
    "Следите за вместимостью трюма и за спросом: слухи в инфоцентре" +
    " подсказывают, где какой товар идёт в цене.",
  "help.TRADE.control1": "Купить / Продать — заключить сделку",
  "help.TRADE.control2": "Кол-во — задать объём",

  // --- onboarding: station -------------------------------------------------
  "help.STATION.title": "Космическая станция",
  "help.STATION.body1":
    "На станции можно дозаправиться, отремонтироваться, переоснастить" +
    " корабль в ангаре и закупиться оборудованием.",
  "help.STATION.body2":
    "В ангаре устанавливайте оружие и модули по слотам и следите за массой —" +
    " перегруженный корабль не взлетит.",
  "help.STATION.control1": "Ангар — оснащение корабля",
  "help.STATION.control2": "Услуги — топливо / ремонт",

  // --- onboarding: shipyard / equipment ------------------------------------
  "help.EQUIPMENT_SHOP.title": "Верфь и оборудование",
  "help.EQUIPMENT_SHOP.body1":
    "Здесь три вкладки: «Снаряжение» — оружие, двигатели и модули; «Корпус» —" +
    " новые корпуса со сдачей старого в зачёт; «Ангар» — установка купленного.",
  "help.EQUIPMENT_SHOP.body2":
    "Покупки попадают на склад — затем во вкладке «Ангар» расставьте их по" +
    " слотам, следя за массой: у каждого корпуса свои слоты и грузоподъёмность.",
  "help.EQUIPMENT_SHOP.control1": "Снаряжение — купить оружие и модули",
  "help.EQUIPMENT_SHOP.control2": "Корпус — сменить корпус со сдачей старого",
  "help.EQUIPMENT_SHOP.control3": "Ангар — установить купленное",

  // --- onboarding: government ----------------------------------------------
  "help.GOVERNMENT.title": "Правительство",
  "help.GOVERNMENT.body1":
    "Местные власти выдают задания и платят за услуги. Берите подходящий" +
    " контракт, выполняйте его и возвращайтесь за наградой.",
  "help.GOVERNMENT.body2":
    "Выполнение заданий поднимает вашу репутацию у этой фракции и открывает" +
    " новые возможности.",
  "help.GOVERNMENT.control1": "Взять задание — принять контракт",
  "help.GOVERNMENT.control2": "Сдать — получить награду",

  // --- onboarding: information center ---------------------------------------
  "help.INFO_CENTER.title": "Информационный центр",
  "help.INFO_CENTER.body1":
    "Узел новостей галактики: цены, слухи о выгодных сделках, сведения о" +
    " системах и розыск. Используйте его, чтобы спланировать маршрут.",
  "help.INFO_CENTER.body2":
    "Слухи о ценах подсказывают, куда везти товар; данные о системах помогут" +
    " не залететь во враждебный сектор без подготовки.",
  "help.INFO_CENTER.control1": "Поиск — найти сведения",
  "help.INFO_CENTER.control2": "Слухи — узнать о ценах",

  // --- onboarding: bank ----------------------------------------------------
  "help.BANK.title": "Банк",
  "help.BANK.body1":
    "Банк хранит сбережения под процент и выдаёт кредиты под залог будущей" +
    " прибыли. Вклад растёт каждый день, кредит — копит проценты.",
  "help.BANK.body2":
    "Не пропускайте платежи по кредиту: просрочка повышает ставку, а дефолт" +
    " бьёт по репутации. Берите в долг с умом.",
  "help.BANK.control1": "Вклад — положить деньги",
  "help.BANK.control2": "Кредит — занять под процент",

  // --- onboarding: inventory -----------------------------------------------
  "help.INVENTORY.title": "Инвентарь и снаряжение",
  "help.INVENTORY.body1":
    "Здесь ваш груз и снаряжение корабля. Устанавливайте модули по слотам," +
    " переносите вещи в трюм и обратно, осматривайте артефакты.",
  "help.INVENTORY.body2":
    "Следите за слотами и массой — от снаряжения зависят боевая мощь," +
    " скорость и объём трюма.",
  "help.INVENTORY.control1": "Перетаскивание — установить / снять",
  "help.INVENTORY.control2": "Слоты — банки модулей",

  // --- onboarding: text quest ----------------------------------------------
  "help.TEXT_QUEST.title": "Текстовое приключение",
  "help.TEXT_QUEST.body1":
    "Перед вами история с выбором. Читайте текст и выбирайте вариант" +
    " действия — решения влияют на исход и награду.",
  "help.TEXT_QUEST.body2":
    "Иногда исход зависит от характеристик корабля или содержимого трюма," +
    " так что выбирайте обдуманно.",
  "help.TEXT_QUEST.control1": "Выбор варианта — продолжить историю",

  // --- onboarding: quest journal -------------------------------------------
  "help.quest-journal.title": "Журнал заданий",
  "help.quest-journal.body1":
    "Здесь собраны ваши активные задания: что нужно сделать, куда лететь и" +
    " какая обещана награда.",
  "help.quest-journal.body2":
    "Откройте задание, чтобы увидеть цель и пункт назначения — и проложите" +
    " маршрут по звёздной карте.",
  "help.quest-journal.control1": "ЛКМ по заданию — подробности",

  // --- onboarding: combat --------------------------------------------------
  "help.combat.title": "Бой в реальном времени",
  "help.combat.body1":
    "Бой идёт прямо в полёте: ваше оружие стреляет автоматически по" +
    " ближайшему врагу в радиусе поражения, враги отвечают тем же.",
  "help.combat.body2":
    "Маневрируйте, чтобы держать дистанцию и не попасть под огонь. Активная" +
    " пауза позволяет прицельно выстрелить «Огонь!» по выбранной цели.",
  "help.combat.control1": "Движение — маневрировать в бою",
  "help.combat.control2": "«Огонь!» — прицельный выстрел на активной паузе",

  // --- onboarding: refuel ---------------------------------------------------
  "help.refuel.title": "Дозаправка",
  "help.refuel.body1":
    "Посадка на планету или стыковка со станцией сразу и бесплатно" +
    " заполняет топливные баки до полного бака.",
  "help.refuel.body2":
    "Платная «Заправка» на станции нужна только если бак опустел в полёте —" +
    " после самой посадки или стыковки он уже полон.",

  // --- inventory scene: warehouse / cargo actions (Bug 2) -------------------
  "inventory.warehouseTitle": "СКЛАД",
  "inventory.warehouseEmpty": "Склад пуст",
  "inventory.install": "[Установить]",
  "inventory.uninstall": "[В трюм]",
  "inventory.jettison": "[Выбросить]",
  "inventory.jettisonConfirm": "Точно?",
  "inventory.overflowMore": "…и ещё {n}",

  // --- info center: objects search (Bug 6) -----------------------------------
  "infoCenter.objectsPlaceholder": "Введите имя NPC, планеты или системы...",
  "infoCenter.objectsHintOtherTab":
    "Поиск кораблей, планет и систем — вкладка ОБЪЕКТЫ",

  // --- star-map purchase feedback (Bug 7) ------------------------------------
  "planet.starMapPurchased":
    "Карта куплена за {price} ₡ — открыто систем: {revealed}",
  "planet.starMapPurchasedNoneNew":
    "Карта куплена за {price} ₡ — новых систем не открыто",
};
