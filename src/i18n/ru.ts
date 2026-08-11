import type { Dict } from "./i18n";

export const ru: Dict = {
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
  "lang.ru": "Русский",
  "lang.en": "English",

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

  "label.creditsLine": "Кредиты: {n}",

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

  "rumor.panelHeader": "ТОРГОВЫЕ ВОЗМОЖНОСТИ",
  "rumor.panelEmpty": "Активных торговых маршрутов нет",
  "rumor.panelNoIntel": "Нет данных — разведайте новые системы",
  "rumor.line": "Везите {resource} из {from} в {to}: {margin}",
  "rumor.margin": "маржа ~{pct}%",
  "rumor.marginMasked": "маржа ~?%",
  "rumor.expired":
    "Везти {resource} из {from} в {to} больше невыгодно — акция закончилась.",

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
  "faction.OVERMIND": "Сверхразум",
  "role.RANGER": "Рейнджер",
  "role.TRADER": "Торговец",
  "role.PIRATE": "Пират",
  "role.PATROL": "Патруль",
  "role.OVERMIND": "Сверхразум",

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

  "landing.denial.overmind":
    "Система под контролем Овермайнда — посадка невозможна",
  "landing.denial.pirateRep":
    "Планета захвачена пиратами — нужна репутация. Откупайтесь от пиратов, чтобы её поднять",

  "customs.fineReason": "Таможенный штраф",
  "standing.recovery.faction":
    "Совет: выполняйте задания фракции, чтобы поднять репутацию",
  "standing.recovery.pirate":
    "Совет: откупайтесь от пиратов, чтобы поднять репутацию и вернуть доступ",

  "flight.liberationHint":
    "Система захвачена. Уничтожьте всех захватчиков, чтобы освободить её",
  "flight.systemLiberated": "Система {name} освобождена!",

  "flight.tributeReason": "Откуп пирату «{name}»",
  "flight.turn.finishingDay": "⏸ Завершаю день…",
  "flight.turn.waiting": "⏳ Ожидание… (мир движется)",
  "flight.tributePaid": "Откуп {amount} кр. — {name} отступает.",
  "flight.tributePaidRep":
    "Откуп {amount} кр. — {name} отступает. Репутация у пиратов растёт.",

  "flight.salvageTrophy": "Трофей: +{amount} ₡",
  "flight.salvageReason": "Трофей с уничтоженного корабля",

  "flight.lootPickup": "Подобрано: {item}",
  "flight.lootTractor": "Гравитяга подобрала: {item}",
  "flight.lootArtifact": "артефакт",
  "flight.lootModule": "модуль",

  "flight.incomingAttacker": "⚠ Приближается противник: {name}!",
  "flight.overmindCoreBroken":
    "Ядро Овермайнда уничтожено — рой обезглавлен! Освободите оставшиеся системы.",
  "flight.starMap": "Межзвёздная карта",
  "flight.inventoryTooltip": "Инвентарь",
  "flight.helpTooltip": "Помощь",

  "help.controlsHeader": "Управление:",
  "help.gotIt": "Понятно",

  "help.welcome.title": "Добро пожаловать, пройдоха!",
  "help.welcome.body1":
    "Вы — вольный пилот в живой галактике. Цель — разбогатеть и остановить" +
    " угрозу Овермайнда: торгуйте, берите задания, исследуйте системы и" +
    " крепите свой корабль, пока не будете готовы дать отпор.",
  "help.welcome.body2":
    "Начните с малого: слетайте к ближайшей планете, осмотритесь и возьмите" +
    " первое задание. Кнопка «?» вверху справа в любой момент откроет" +
    " подсказку для текущего экрана.",

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

  "help.PLANET.title": "Планета",
  "help.PLANET.body1":
    "Вы на поверхности планеты. Отсюда открыт доступ к местным заведениям:" +
    " рынку, верфи, правительству, банку и информационному центру.",
  "help.PLANET.body2":
    "Загляните на рынок за выгодной сделкой, в правительство — за заданием," +
    " а на верфь — чтобы улучшить корабль. Взлёт вернёт вас в космос.",
  "help.PLANET.control1": "Кнопки заведений — войти",
  "help.PLANET.control2": "Взлёт — вернуться в полёт",

  "help.TRADE.title": "Торговля",
  "help.TRADE.body1":
    "Покупайте дёшево, продавайте дорого. Цены меняются от планеты к" +
    " планете — везите товар туда, где он в дефиците, и получайте прибыль.",
  "help.TRADE.body2":
    "Следите за вместимостью трюма и за спросом: слухи в инфоцентре" +
    " подсказывают, где какой товар идёт в цене.",
  "help.TRADE.control1": "Купить / Продать — заключить сделку",
  "help.TRADE.control2": "Кол-во — задать объём",

  "help.STATION.title": "Космическая станция",
  "help.STATION.body1":
    "На станции можно дозаправиться, отремонтироваться, переоснастить" +
    " корабль в ангаре и закупиться оборудованием.",
  "help.STATION.body2":
    "В ангаре устанавливайте оружие и модули по слотам и следите за массой —" +
    " перегруженный корабль не взлетит.",
  "help.STATION.control1": "Ангар — оснащение корабля",
  "help.STATION.control2": "Услуги — топливо / ремонт",

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

  "help.GOVERNMENT.title": "Правительство",
  "help.GOVERNMENT.body1":
    "Местные власти выдают задания и платят за услуги. Берите подходящий" +
    " контракт, выполняйте его и возвращайтесь за наградой.",
  "help.GOVERNMENT.body2":
    "Выполнение заданий поднимает вашу репутацию у этой фракции и открывает" +
    " новые возможности.",
  "help.GOVERNMENT.control1": "Взять задание — принять контракт",
  "help.GOVERNMENT.control2": "Сдать — получить награду",

  "help.INFO_CENTER.title": "Информационный центр",
  "help.INFO_CENTER.body1":
    "Узел новостей галактики: цены, слухи о выгодных сделках, сведения о" +
    " системах и розыск. Используйте его, чтобы спланировать маршрут.",
  "help.INFO_CENTER.body2":
    "Слухи о ценах подсказывают, куда везти товар; данные о системах помогут" +
    " не залететь во враждебный сектор без подготовки.",
  "help.INFO_CENTER.control1": "Поиск — найти сведения",
  "help.INFO_CENTER.control2": "Слухи — узнать о ценах",

  "help.BANK.title": "Банк",
  "help.BANK.body1":
    "Банк хранит сбережения под процент и выдаёт кредиты под залог будущей" +
    " прибыли. Вклад растёт каждый день, кредит — копит проценты.",
  "help.BANK.body2":
    "Не пропускайте платежи по кредиту: просрочка повышает ставку, а дефолт" +
    " бьёт по репутации. Берите в долг с умом.",
  "help.BANK.control1": "Вклад — положить деньги",
  "help.BANK.control2": "Кредит — занять под процент",

  "help.INVENTORY.title": "Инвентарь и снаряжение",
  "help.INVENTORY.body1":
    "Здесь ваш груз и снаряжение корабля. Устанавливайте модули по слотам," +
    " переносите вещи в трюм и обратно, осматривайте артефакты.",
  "help.INVENTORY.body2":
    "Следите за слотами и массой — от снаряжения зависят боевая мощь," +
    " скорость и объём трюма.",
  "help.INVENTORY.control1": "Перетаскивание — установить / снять",
  "help.INVENTORY.control2": "Слоты — банки модулей",

  "help.TEXT_QUEST.title": "Текстовое приключение",
  "help.TEXT_QUEST.body1":
    "Перед вами история с выбором. Читайте текст и выбирайте вариант" +
    " действия — решения влияют на исход и награду.",
  "help.TEXT_QUEST.body2":
    "Иногда исход зависит от характеристик корабля или содержимого трюма," +
    " так что выбирайте обдуманно.",
  "help.TEXT_QUEST.control1": "Выбор варианта — продолжить историю",

  "help.quest-journal.title": "Журнал заданий",
  "help.quest-journal.body1":
    "Здесь собраны ваши активные задания: что нужно сделать, куда лететь и" +
    " какая обещана награда.",
  "help.quest-journal.body2":
    "Откройте задание, чтобы увидеть цель и пункт назначения — и проложите" +
    " маршрут по звёздной карте.",
  "help.quest-journal.control1": "ЛКМ по заданию — подробности",

  "help.combat.title": "Тактическое планирование боя",
  "help.combat.body1":
    "Бой ставит игру на паузу: наведите оружие на цель (кнопка оружия, затем" +
    " клик по врагу) и при желании задайте курс, форсаж или другое действие.",
  "help.combat.body2":
    "Кнопка «Ход» подтверждает план — назначенное оружие открывает огонь," +
    " враги отвечают, затем снова открывается планирование для нового хода.",
  "help.combat.control1": "Оружие → цель — назначить выстрел",
  "help.combat.control2": "«Ход» — подтвердить план и начать раунд",

  "combat.planning.enter": "⏸ Тактическое планирование — Ход для подтверждения",
  "combat.planning.executing": "▶ Выполнение хода…",
  "combat.planning.armWeapon": "«{name}»: выберите цель",
  "combat.planning.assigned": "«{weapon}» → {target}",
  "combat.planning.assignedFar":
    "«{weapon}» → {target} — вне досягаемости, огонь при сближении",
  "combat.planning.afterburner": "Форсаж",

  "combat.auto.on": "АВТОБОЙ: ВКЛ",
  "combat.auto.off": "АВТОБОЙ: ВЫКЛ",

  "combat.execution.afterburnerEngaged":
    "🔥 Форсаж! Ресурс двигателя: {integrity}%",
  "combat.execution.afterburnerSpent": "Двигатель изношен — форсаж недоступен",
  "combat.execution.shieldRestored": "Щиты восстановлены: +{amount}",
  "combat.execution.aoe": "💥 Импульсная бомба: целей поражено — {count}",
  "combat.execution.jammed": "Орудия цели заглушены: {name}",
  "combat.execution.bribed": "Откуп уплачен ({amount} кр.) — противник уходит",
  "combat.execution.surrendered": "{name} сдаётся: сбрасывает груз и уходит",
  "combat.execution.surrenderRefused": "{name} отклоняет требование сдаться",
  "combat.execution.allyJoined": "{name} присоединяется к бою на вашей стороне",
  "combat.execution.allyNone": "Никто не ответил на призыв о помощи",

  "combat.consumable.category": "Тактическое устройство",
  "combat.consumable.shieldCell.name": "Щитовая ячейка",
  "combat.consumable.shieldCell.desc":
    "Мгновенно восстанавливает щиты корабля.",
  "combat.consumable.pulseBomb.name": "Импульсная бомба",
  "combat.consumable.pulseBomb.desc":
    "Наносит урон всем врагам в радиусе взрыва.",
  "combat.consumable.jammer.name": "Глушитель",
  "combat.consumable.jammer.desc": "Отключает оружие цели на несколько секунд.",

  "combat.comms.category": "Связь",
  "combat.comms.bribe.name": "Откупиться",
  "combat.comms.bribe.desc": "Заплатить дань, чтобы враг вышел из боя.",
  "combat.comms.surrender.name": "Требовать сдаться",
  "combat.comms.surrender.desc":
    "Ослабленный враг может сдаться — бежать, бросив груз.",
  "combat.comms.callHelp.name": "Позвать на помощь",
  "combat.comms.callHelp.desc":
    "Ближайший союзный корабль вступит в бой на вашей стороне.",

  "help.refuel.title": "Дозаправка",
  "help.refuel.body1":
    "Посадка на планету или стыковка со станцией сразу и бесплатно" +
    " заполняет топливные баки до полного бака.",
  "help.refuel.body2":
    "Платная «Заправка» на станции нужна только если бак опустел в полёте —" +
    " после самой посадки или стыковки он уже полон.",

  "inventory.warehouseTitle": "СКЛАД",
  "inventory.warehouseEmpty": "Склад пуст",
  "inventory.install": "[Установить]",
  "inventory.uninstall": "[В трюм]",
  "inventory.jettison": "[Выбросить]",
  "inventory.jettisonConfirm": "Точно?",
  "inventory.overflowMore": "…и ещё {n}",

  "infoCenter.objectsPlaceholder": "Введите имя NPC, планеты или системы...",
  "infoCenter.objectsHintOtherTab":
    "Поиск кораблей, планет и систем — вкладка ОБЪЕКТЫ",

  "planet.starMapPurchased":
    "Карта куплена за {price} ₡ — открыто систем: {revealed}",
  "planet.starMapPurchasedNoneNew":
    "Карта куплена за {price} ₡ — новых систем не открыто",

  "gearTooltip.class.engine": "Двигатель",
  "gearTooltip.class.fuelTank": "Топливный бак",
  "gearTooltip.class.radar": "Радар",
  "gearTooltip.class.scanner": "Сканер",
  "gearTooltip.class.repairDroid": "Ремонтный дроид",
  "gearTooltip.class.grapple": "Захват",
  "gearTooltip.class.shield": "Щит",
  "gearTooltip.class.gravTractor": "Грав. трактор",
  "gearTooltip.ability.none": "нет",
  "gearTooltip.ability.emp": "ЭМИ",
  "gearTooltip.ability.homing": "самонаведение",
  "gearTooltip.ability.burst": "очередь",
  "gearTooltip.hullSlotsLine":
    "Оружие/снаряж.: {weapon}/{equipment}  Макс.масса: {mass}",
  "gearTooltip.weaponAbilityLine": "Способность: {ability}  Откат: {cooldown}",
  "gearTooltip.equipmentClassLine": "Класс: {class}  Мощность: {potency}",
  "gearTooltip.techMassLine": "Тех.уровень: T{tech}  Масса: {mass}",
};
