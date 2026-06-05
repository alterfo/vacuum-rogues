# Galactic Horizon: Neural Onslaught - Development Plan (BDD)

**Статус проекта**: Phase 0 (Proof of Concept) → Phase 1 (MVP)
**Дата**: 2026-05-31
**Формат**: Behavior-Driven Development (BDD)

---

## Feature 1: Main Menu & Game Initialization

### Scenario 1.1: Starting New Game
```gherkin
Feature: Новая игра
  Как игрок
  Я хочу начать новую игру
  Чтобы создать персонажа и начать играть

Scenario: Успешное создание нового персонажа
  Given я нахожусь в главном меню
  When я нажимаю "Новая игра"
  Then я вижу экран выбора фракции
  And я могу выбрать одну из 5 фракций (Окраинники, Бастионы, Синдикат, Парадоксы, Прогрессоры)
  And я вижу описание бонусов фракций

Scenario: Анимированный фон главного меню
  Given я нахожусь в главном меню
  Then я вижу звездное небо с мерцающими звездами (300 звезд, 4 цвета)
  And я вижу 3 корабля, летающих по эллиптическим орбитам
  And я вижу 2 отдаленные планеты в фоне
  And анимация работает плавно (60 FPS)
```

### Scenario 1.2: Loading Saved Game
```gherkin
Feature: Загрузка сохранения
  Как игрок
  Я хочу продолжить сохраненную игру
  Чтобы не начинать заново

Scenario: Загрузка валидного сохранения
  Given у меня есть сохраненная игра
  When я нажимаю "Продолжить"
  Then игра загружает мою позицию в галактике
  And я вижу карту секторов с моей текущей системой
  And мои ресурсы (топливо, кредиты, HP) сохранены

Scenario: Обработка поврежденного сохранения
  Given мое сохранение повреждено (player.id = null)
  When я нажимаю "Продолжить"
  Then я вижу сообщение "Данные игрока повреждены. Начните новую игру."
  And меню остается функциональным (не ломается)
  And сообщение исчезает через 3 секунды
```

---

## Feature 2: Sector Map (Star Map)

### Scenario 2.1: Viewing Galaxy
```gherkin
Feature: Карта секторов
  Как игрок
  Я хочу видеть галактику и перемещаться между системами
  Чтобы исследовать космос и торговать

Scenario: Отображение карты галактики
  Given я нахожусь на карте секторов
  Then я вижу исследованные системы (звезды)
  And я вижу варп-линии между соседними системами
  And моя текущая система выделена зеленым цветом
  And я вижу топливный индикатор в левом верхнем углу
  And я вижу название системы при наведении

Scenario: Управление камерой на карте
  Given я нахожусь на карте секторов
  When я прокручиваю колесико мыши вверх/вниз
  Then карта увеличивается/уменьшается (zoom 0.5x-3.0x)
  When я перетаскиваю карту левой кнопкой мыши
  Then карта перемещается (pan)
  And масштабирование сохраняет центральную точку экрана
```

### Scenario 2.2: System Information
```gherkin
Feature: Информация о системе
  Как игрок
  Я хочу видеть детали системы
  Чтобы принять решение о прыжке

Scenario: Просмотр деталей системы
  Given я нахожусь на карте секторов
  When я кликаю на звездную систему
  Then я вижу панель информации справа
  And панель показывает название системы
  And панель показывает владельца (фракция)
  And панель показывает список планет с типами
  And панель показывает соседние системы ("Соседи (можно прыгнуть)")
  And панель показывает стоимость топлива для прыжка

Scenario: Двойной клик для входа в систему
  Given я нахожусь на карте секторов
  And я вижу свою текущую систему (зеленая)
  When я дважды кликаю на свою систему
  Then я вхожу в систему (переход на экран полета)
  And корабль появляется на краю системы
```

### Scenario 2.3: Warp Jump
```gherkin
Feature: Гипер-прыжок между системами
  Как игрок
  Я хочу перемещаться между системами
  Чтобы исследовать галактику

Scenario: Прыжок в соседнюю систему
  Given я нахожусь на карте секторов
  And я выбрал соседнюю систему с прямым соединением
  And у меня достаточно топлива (5 единиц)
  When я дважды кликаю на систему ИЛИ нажимаю "[ПРЫЖОК]"
  Then я вижу диалог подтверждения с расходом топлива
  When я нажимаю "Да"
  Then топливо уменьшается на 5
  And игра переходит на экран полета в новую систему
  And соседние системы открываются (explored = true)

Scenario: Гипер-прыжок в несоседнюю систему
  Given я нахожусь на карте секторов
  And я выбрал систему без прямого соединения
  And расстояние = 25 единиц (стоимость = 50 топлива)
  And у меня достаточно топлива
  When я дважды кликаю на систему ИЛИ нажимаю "[ГИПЕР-ПРЫЖОК]"
  Then я вижу диалог с предупреждением (желтый цвет)
  And расход топлива = max(10, distance * 2)
  When я подтверждаю прыжок
  Then топливо списывается
  And игра переходит в новую систему

Scenario: Недостаточно топлива
  Given у меня недостаточно топлива для прыжка
  When я дважды кликаю на удаленную систему
  Then я вижу сообщение "Недостаточно топлива"
  And кнопка прыжка неактивна
  And текст стоимости красный
```

### Scenario 2.4: Planet Naming
```gherkin
Feature: Названия планет
  Как игрок
  Я хочу видеть уникальные названия планет
  Чтобы легко их различать

Scenario: Генерация названий планет
  Given генерируется новая звездная система
  When создается планета
  Then планета получает уникальное русское/sci-fi имя из списка 180+ вариантов
  And имя не содержит цифр (кроме специальных случаев)
  And имя выбирается из категорий:
    | Категория | Примеры |
    | Греческие буквы | Альфа, Бета, Гамма |
    | Мифология | Аполлон, Зевс, Афина |
    | Звезды | Сириус, Вега, Антарес |
    | Sci-fi | Нексус, Терра, Нова |
    | Космическая программа | Восток, Союз, Мир |
```

---

## Feature 3: Space Flight (Planetary System) - TURN-BASED GAMEPLAY

**⚠️ ВАЖНО: Игра пошаговая!**
- Мир статичен во время планирования маршрута
- Планеты вращаются только когда корабль движется
- Дни капают только во время полета
- Скорость корабля: 0.1 pixels/ms (медленнее для стратегического планирования)

## Feature 3: Space Flight (Planetary System)

### Scenario 3.1: Ship Entry and Movement
```gherkin
Feature: Полет в планетарной системе
  Как игрок
  Я хочу управлять кораблем в системе
  Чтобы перемещаться между планетами

Scenario: Вход в систему из варп-прыжка
  Given я совершил варп-прыжок из системы снизу (entryVector = {x:0, y:1})
  When я появляюсь в новой системе
  Then корабль появляется на краю системы (600px от центра)
  And корабль появляется с нужной стороны (снизу, если вектор {0,1})
  And корабль направлен к центру системы
  And я вижу звезду в центре
  And я вижу планеты на орбитах
  And я вижу миникарту в правом нижнем углу

Scenario: Управление кораблем
  Given я нахожусь в системе
  When я кликаю левой кнопкой на точку в космосе
  Then корабль устанавливает курс к этой точке
  And на экране появляется индикатор цели (пульсирующий прицел)
  And корабль летит с физикой (ускорение, поворот, инерция)

Scenario: Камера (zoom/pan)
  Given я нахожусь в системе
  When я прокручиваю колесико мыши
  Then камера увеличивается/уменьшается (0.5x-2.0x)
  And центр экрана остается фиксированным при зуме
  When я нажимаю Shift+ЛКМ ИЛИ ПКМ ИЛИ СКМ и перетаскиваю
  Then камера панорамируется
  And я вижу индикатор камеры (Zoom: 1.0x, Pan: 0, 0)
```

### Scenario 3.2: Planet Interaction
```gherkin
Feature: Взаимодействие с планетами
  Как игрок
  Я хочу получать информацию о планетах и приземляться
  Чтобы торговать и ремонтировать корабль

Scenario: Просмотр информации о жилой планете
  Given я нахожусь в системе
  When я кликаю на жилую планету (TERRESTRIAL)
  Then я вижу панель информации о планете
  And панель показывает название планеты
  And панель показывает тип (Земной, Газовый гигант, и т.д.)
  And панель показывает фракцию жителей
  And панель показывает длительность перелета в днях
  And панель показывает кнопку "[Приземлиться]"

Scenario: Просмотр информации о нежилой планете
  Given я кликаю на нежилую планету (ICE, GAS_GIANT)
  Then я вижу панель информации
  And панель показывает "Дроны: 0" (вместо расы)
  And я НЕ вижу кнопку "Губернатор"
  And я вижу кнопку "[Приземлиться]"

Scenario: Установка курса на планету
  Given я вижу панель информации о планете
  When я кликаю на планету
  Then корабль устанавливает курс к планете
  And индикатор цели появляется на планете
  And корабль летит к планете
```

### Scenario 3.3: Turn-Based Time System
```gherkin
Feature: Пошаговое игровое время
  Как игрок
  Я хочу, чтобы время капало только во время полета
  Чтобы планировать свои действия стратегически

Scenario: Мир статичен во время планирования
  Given я нахожусь в системе
  And корабль не движется (скорость = 0)
  Then планеты НЕ вращаются на орбитах
  And дни НЕ капают
  And я могу планировать маршрут без давления времени
  When я кликаю на точку в космосе
  Then устанавливается курс
  And корабль начинает движение
  And планеты начинают вращаться
  And дни начинают капать

Scenario: Дни капают во время полета
  Given корабль движется к цели
  When корабль пролетает 500 пикселей
  Then день увеличивается на 1
  And UI обновляется ("День: X+1")
  And событие логируется в консоль
  When корабль останавливается у цели
  Then планеты перестают вращаться
  And дни перестают капать

Scenario: Замедленный полет для стратегии
  Given корабль начал движение
  Then максимальная скорость = 0.1 pixels/ms (в 3 раза медленнее старой 0.3)
  And у игрока есть время среагировать на события
  And полет от планеты к планете занимает заметное время
  And можно успеть заметить появление вражеского корабля

Scenario: Расчет длительности перелета
  Given я кликнул на планету на расстоянии 1000 пикселей
  Then панель информации показывает "Перелёт: 2 дн." (1000/500 = 2)
  When я приземляюсь на планету
  Then галактика симулирует 2 дня (на самом деле они уже прошли во время полета)
  And текущий день = начальный день + дни в пути + дни при посадке
```

---

## Feature 4: Planet Landing

### Scenario 4.1: Landing on Planet
```gherkin
Feature: Приземление на планету
  Как игрок
  Я хочу приземлиться на планету
  Чтобы получить доступ к услугам

Scenario: Приземление на жилую планету
  Given я нахожусь в космосе рядом с жилой планетой
  When я нажимаю "[Приземлиться]"
  Then игра симулирует X дней полета
  And мое топливо заправляется до максимума (100%)
  And я вижу экран планеты с изображением планеты
  And я вижу название планеты
  And я вижу тип и статус (Земной • Обитаемая)
  And я вижу меню с опциями:
    | Кнопка | Цвет | Действие |
    | Губернатор | Зеленый | Открыть диалог с губернатором |
    | Гараж | Синий | Ремонт корабля |
    | Маркет | Оранжевый | Торговля (пока заглушка) |
    | Исследования | Пурпурный | Исследования (пока заглушка) |
    | Взлёт | Красный | Вернуться в космос |

Scenario: Приземление на нежилую планету
  Given я приземлился на нежилую планету
  Then я вижу экран планеты
  And я НЕ вижу кнопку "Губернатор"
  And я вижу остальные кнопки (Гараж, Маркет, Исследования, Взлёт)
```

### Scenario 4.2: Ship Repair (Garage)
```gherkin
Feature: Гараж (ремонт корабля)
  Как игрок
  Я хочу ремонтировать поврежденный корабль
  Чтобы восстановить HP корпуса

Scenario: Ремонт корпуса
  Given я нахожусь на планете
  And HP корпуса = 50 / 100
  And стоимость ремонта = (100 - 50) * 2 = 100 кредитов
  And у меня есть 200 кредитов
  When я нажимаю "Гараж"
  Then мои кредиты уменьшаются на 100
  And HP корпуса восстанавливается до 100
  And я вижу лог "Repaired for 100"

Scenario: Недостаточно кредитов для ремонта
  Given HP корпуса = 30 / 100
  And стоимость = 140 кредитов
  And у меня только 50 кредитов
  When я нажимаю "Гараж"
  Then ремонт НЕ происходит
  And кредиты НЕ списываются
  And корпус остается поврежденным
```

### Scenario 4.3: Refueling
```gherkin
Feature: Заправка топливом
  Как игрок
  Я хочу автоматически заправляться при посадке
  Чтобы не беспокоиться о топливе

Scenario: Автоматическая заправка
  Given мое топливо = 30 / 100
  When я приземляюсь на любую планету
  Then топливо автоматически заправляется до 100 / 100
  And заправка бесплатная

Scenario: Взлёт с полным баком
  Given я нахожусь на планете
  And топливо = 100 / 100
  When я нажимаю "Взлёт"
  Then я возвращаюсь в космос
  And топливо остается 100 / 100
  And я могу совершать варп-прыжки
```

### Scenario 4.4: Governor Dialogue
```gherkin
Feature: Общение с губернатором
  Как игрок
  Я хочу говорить с губернатором планеты
  Чтобы получать квесты и информацию

Scenario: Диалог с губернатором
  Given я нахожусь на жилой планете
  When я нажимаю "Губернатор"
  Then игра переходит на экран диалога (DialogueScene)
  And я вижу NPC губернатора (раса, имя)
  And я вижу шаблонные реплики диалога
  And я могу закрыть диалог и вернуться на экран планеты
```

---

## Feature 5: Quest System

### Scenario 5.1: Quest Journal
```gherkin
Feature: Журнал квестов
  Как игрок
  Я хочу видеть список активных квестов
  Чтобы отслеживать свои задачи

Scenario: Открытие журнала квестов
  Given я нахожусь в системе
  When я нажимаю клавишу [J]
  Then я вижу панель "ЖУРНАЛ КВЕСТОВ"
  And панель показывает список активных квестов
  And каждый квест показывает:
    | Поле | Описание |
    | Название | Краткое название квеста |
    | Статус | В процессе / Завершен |
    | Цель | Целевая планета (если есть) |
    | Награда | Кредиты за выполнение |
  When я нажимаю [X] ИЛИ [J]
  Then журнал закрывается

Scenario: Навигация к квестовой планете
  Given я открыл журнал квестов
  And у меня есть активный квест с целью "Планета Альфа"
  When я нажимаю "[→ Альфа]"
  Then корабль устанавливает курс к планете Альфа
  And журнал закрывается
  And индикатор цели появляется на планете
```

### Scenario 5.2: Quest Completion
```gherkin
Feature: Завершение квестов
  Как игрок
  Я хочу выполнять квесты и получать награды
  Чтобы зарабатывать кредиты

Scenario: Выполнение квеста доставки
  Given у меня есть активный квест "Доставить груз на Бету"
  When я приземляюсь на планету Бета
  And я говорю с губернатором
  Then квест помечается как выполненный
  And я получаю награду (например, 500 кредитов)
  And квест исчезает из журнала активных
  And я вижу сообщение "Квест выполнен! +500 кредитов"
```

---

## Feature 6: Combat System (Future)

### Scenario 6.1: Space Combat
```gherkin
Feature: Космический бой
  Как игрок
  Я хочу сражаться с враждебными кораблями
  Чтобы защититься и захватывать добычу

Scenario: Встреча с пиратом (Not Yet Implemented)
  Given я лечу в системе
  When появляется враждебный корабль
  Then я вижу красный корабль на экране
  And я вижу индикатор угрозы
  When пират атакует
  Then начинается боевой режим
  And я могу стрелять, маневрировать, использовать модули
```

---

## Feature 7: UI/UX Improvements

### Scenario 7.1: Minimap
```gherkin
Feature: Миникарта системы
  Как игрок
  Я хочу видеть миникарту
  Чтобы ориентироваться в системе

Scenario: Отображение миникарты
  Given я нахожусь в системе
  Then я вижу миникарту в правом нижнем углу (180x180px)
  And миникарта показывает звезду в центре
  And миникарта показывает орбиты планет
  And миникарта показывает позицию моего корабля (зеленая точка)
  And масштаб миникарты соответствует размеру системы (scale = 0.05)

Scenario: Обновление миникарты
  Given я перемещаюсь в системе
  Then позиция корабля на миникарте обновляется в реальном времени
  And миникарта остается видимой при zoom/pan камеры
```

---

## Feature 8: Living Galaxy — NPC Ranger Ships (NEXT)

**Цель**: Галактика живёт независимо от игрока. Другие рейнджеры, торговцы,
пираты и патрули летают между системами, берут квесты, торгуют и ведут бои.
Игрок видит тех, кто сейчас в его системе, и может с ними взаимодействовать.

**Почему это раньше комбата**: бой ведётся против конкретного NPC. Сначала нужны
живые корабли-агенты в мире — тогда комбат становится действием над существующим
NPC (`Attack → CombatScene(encounter)`), а не абстрактным спавном.

**Принцип AI**: детерминированная стейт-машина + точки расширения под ONNX
(аналогично `CombatSystem.aiController`). Логика по умолчанию — RNG+правила;
ONNX-адаптер можно подключить позже без изменения симуляции.

### Scenario 8.1: Spawn NPC Ships at Galaxy Generation
```gherkin
Feature: Появление NPC в галактике
  Как игрок
  Я хочу, чтобы в галактике жили другие корабли
  Чтобы мир ощущался населённым

Scenario: Спавн начального населения
  Given генерируется новая галактика (N систем)
  When завершается генерация
  Then создаётся пул NPC-кораблей (≈1.5 на систему)
  And у каждого NPC есть: id, имя, раса, фракция, роль, статы корабля
  And каждый NPC размещён в стартовой системе (currentSystemId)
  And роли распределены: RANGER, TRADER, PIRATE, PATROL
  And спавн детерминирован от seed (воспроизводимость)
```

### Scenario 8.2: Autonomous Travel Between Systems
```gherkin
Feature: Автономные перелёты NPC
  Как игрок
  Я хочу, чтобы NPC сами перемещались по галактике
  Чтобы состав систем менялся со временем

Scenario: NPC выбирает цель и летит
  Given NPC в состоянии IDLE в системе
  When наступает игровой день (simulateDay)
  Then NPC выбирает цель по своей роли (стейт-машина)
  And переходит в состояние TRAVELING с destinationSystemId
  And перелёт занимает дни пропорционально расстоянию варп-пути
  When дни в пути истекают
  Then NPC появляется в целевой системе (currentSystemId обновлён)
  And переходит в состояние, соответствующее цели (TRADING/QUESTING/PATROLLING)

Scenario: Перелёты идут пока игрок играет
  Given игрок летает/торгует (дни капают)
  When проходит несколько дней
  Then позиции NPC по системам меняются
  And это видно при входе в разные системы
```

### Scenario 8.3: NPC Goals — Quests, Trade, Hunting
```gherkin
Feature: Цели NPC
  Как игрок
  Я хочу, чтобы NPC занимались делом
  Чтобы их поведение было осмысленным

Scenario: Рейнджер берёт и выполняет квест
  Given NPC роли RANGER в системе с доступным квестом из общего пула
  When срабатывает тик симуляции
  Then NPC резервирует квест (QUESTING) и летит к целевой системе
  When условие квеста выполнено
  Then NPC получает награду (кредиты/репутация)
  And квест помечается выполненным и убирается из пула

Scenario: Торговец возит товар
  Given NPC роли TRADER в системе с рынком
  When срабатывает тик
  Then NPC покупает дешёвый товар и везёт в систему со спросом
  And сделка слегка двигает supply/demand рынка (как у игрока)

Scenario: Пират охотится
  Given NPC роли PIRATE
  Then он патрулирует/перехватывает торговые маршруты
  And может инициировать офф-скрин бой с торговцем/рейнджером
```

### Scenario 8.4: Off-Screen Combat Resolution
```gherkin
Feature: Бои NPC вне экрана
  Как игрок
  Я хочу, чтобы NPC дрались между собой
  Чтобы мир был опасным и динамичным

Scenario: Абстрактное разрешение боя
  Given два враждебных NPC оказались в одной системе вне экрана игрока
  When срабатывает тик симуляции
  Then бой разрешается абстрактно (по статам + RNG, без гекс-боя)
  And проигравший уничтожается или бежит с потерями HP
  And событие логируется (для будущей ленты новостей)
  And реальный гекс-бой запускается ТОЛЬКО при участии игрока
```

### Scenario 8.5: NPC Ships Visible in Player's System
```gherkin
Feature: Видимые NPC в полёте
  Как игрок
  Я хочу видеть чужие корабли в своей системе
  Чтобы взаимодействовать с ними

Scenario: Отрисовка NPC в текущей системе
  Given я нахожусь в системе, где есть NPC
  Then я вижу их спрайты, летящие к планетам/варп-точкам
  And цвет корабля соответствует фракции
  And над кораблём есть индикатор намерения (нейтральный/враждебный/торговый)
  And NPC отображаются точками на миникарте
  And NPC двигаются только когда мир идёт (пошаговость соблюдена)

Scenario: Вход/выход NPC из системы
  Given NPC долетел до варп-точки моей системы
  Then его спрайт исчезает (он ушёл в другую систему)
  Given новый NPC прибыл в мою систему во время моего полёта
  Then его спрайт появляется у варп-точки
```

### Scenario 8.6: Contact Panel & Bridge to Combat
```gherkin
Feature: Контакт с NPC
  Как игрок
  Я хочу взаимодействовать с чужим кораблём
  Чтобы поприветствовать, торговать или атаковать

Scenario: Открытие панели контакта
  Given в системе есть NPC
  When я кликаю на корабль NPC
  Then открывается панель контакта
  And панель показывает имя, расу, фракцию, роль, состояние HP
  And доступны действия: [Связаться] [Торговать] [Атаковать]

Scenario: Атака запускает бой (мост к Feature 6)
  Given открыта панель контакта враждебного NPC
  When я нажимаю [Атаковать]
  Then формируется TacticalEncounter с этим NPC
  And игра переходит в CombatScene (когда комбат реализован)
  # До реализации комбата — заглушка-лог + возврат
```

### Scenario 8.7: Persistence
```gherkin
Feature: Сохранение состояния NPC
  Как игрок
  Я хочу, чтобы жизнь галактики сохранялась
  Чтобы загрузка возвращала тот же мир

Scenario: Сохранение и загрузка NPC
  Given в галактике живут NPC в разных состояниях
  When я сохраняю и загружаю игру
  Then все NPC восстановлены (позиция, состояние, цель, статы)
  And Zod-схема валидирует поле galaxy.npcShips
  And старые сохранения без npcShips мигрируются (пустой пул → респавн)
```

---

## Feature 8: Technical Design

### Domain Model
```
src/domain/NpcShip.ts            // новая сущность-агент
  id, name, race (FactionType), faction (Faction), role (NpcRole)
  hullHP, maxHull, shields, speed, damage           // боевые статы
  currentSystemId
  state (NpcState), goal (NpcGoal | null)
  destinationSystemId?, daysToArrival?              // состояние перелёта
  credits, reputation, cargo?, currentQuestId?

src/types/index.ts
  enum NpcRole { RANGER, TRADER, PIRATE, PATROL }
  enum NpcState { IDLE, TRAVELING, TRADING, QUESTING, PATROLLING, FIGHTING, DEAD }
  interface NpcGoal { kind; targetSystemId?; questId?; ... }
  // + поле npcShips в SaveState/Galaxy сериализации

src/domain/Galaxy.ts
  readonly npcShips: NpcShip[]   // новое поле
```

### AI: State Machine + ONNX Hooks
Аналогично `CombatSystem` (интерфейс `EnemyAIController` + дефолтная реализация):
```ts
// src/systems/npc/NpcBrain.ts
export interface NpcBrain {
  // вызывается на дневном тике для NPC в IDLE/по завершении цели
  decideGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): NpcGoal;
}

// Дефолт: детерминированная стейт-машина по роли (RNG+правила)
export class RuleBasedNpcBrain implements NpcBrain { ... }

// Точка расширения под ONNX (подключается позже, без правок симуляции)
export class OnnxNpcBrain implements NpcBrain {
  constructor(private registry: ONNXModelRegistry) {}
  // fallback на RuleBasedNpcBrain при недоступности модели
}
```
Стейт-машина (переходы):
```
IDLE ──decideGoal──▶ TRAVELING ──(arrive)──▶ {TRADING|QUESTING|PATROLLING}
   ▲                                                   │
   └──────────────(goal done / reward)─────────────────┘
любое ──(hostile contact)──▶ FIGHTING ──(resolve)──▶ {IDLE | DEAD}
```

### Simulation
```
src/systems/npc/NpcSimulator.ts
  spawnInitial(galaxy, rng)         // вызывается из GalaxySimulator.generateGalaxy
  tick(galaxy, brain, rng)          // вызывается из GalaxySimulator.simulateDay
    - advance TRAVELING (daysToArrival--)
    - on arrival: enter goal state
    - IDLE/done: brain.decideGoal(...)
    - resolve off-screen hostile encounters (abstract)
    - prune DEAD, опц. респавн для поддержания населения
```
`GalaxySimulator.simulateDay` получает вызов `npcSimulator.tick(...)` после
существующих апдейтов овермайнда/событий/рынков.

### Presentation
```
src/presentation/NpcShipSprite.ts       // спрайт + индикатор намерения/фракции
src/presentation/NpcContactPanel.ts      // панель контакта [Связаться/Торговать/Атаковать]
src/presentation/SpaceFlightScene.ts     // фильтр npcShips по currentSystemId,
                                          // движение к целям, клик-хендлер, миникарта
src/presentation/SystemMiniMap.ts        // точки NPC
```
Пошаговость: NPC-спрайты двигаются только когда `ship is moving` (как планеты).

### Persistence (жёсткое правило CLAUDE.md)
```
src/validation/schemas.ts                // Zod-схема NpcShip + galaxy.npcShips
src/data/MigrationPipeline.ts            // миграция старых сейвов (npcShips = [])
```

### Sliced Implementation Roadmap
1. **Срез 1 — Фундамент**: `NpcShip`, типы, `Galaxy.npcShips`, `NpcSimulator`
   (spawn + travel), `RuleBasedNpcBrain`, схема+миграция. Юнит-тесты симуляции.
2. **Срез 2 — Присутствие**: `NpcShipSprite`, рендер в `SpaceFlightScene`,
   миникарта, `NpcContactPanel` (инфо + действия). E2E на видимость/клик.
3. **Срез 3 — Поведение**: квест-пул, торговля (двигает рынки), офф-скрин бой,
   логирование событий.
4. **Срез 4 — Мост к комбату**: `Attack → TacticalEncounter → CombatScene`
   (стыкуется с Feature 6).

### Test Strategy (BDD → tests)
- Unit: спавн детерминирован от seed; перелёт тратит дни; стейт-переходы;
  абстрактный бой меняет HP/удаляет проигравшего; миграция старых сейвов.
- E2E: NPC виден в системе; клик открывает панель контакта; уход/приход NPC.

---

## Feature 9: Grand Star System, Radar Minimap & Prettier Background (NEXT)

**Цель**: приблизить внутрисистемный экран к оригинальным «Космическим
рейнджерам»: система **крупнее экрана** (камера следит за кораблём), миникарта
работает как **радар** (вся система + точки кораблей + рамка обзора + граница
системы), фон космоса — заметно красивее (параллакс, туманности, виньетка).

**Референс (оригинал SR1/SR2)**: вид сверху, камера следует за кораблём, система
крупнее вьюпорта; звезда в центре, планеты на орбитах-кольцах, по краю — рубеж
гиперпрыжка; в системе летают чужие корабли мелкими цветными маркерами; в углу —
радар со всей системой и точками объектов. (Источники: Wikipedia — top-down,
пошаговые «solar days»; Elite Games / SR Wiki — описания интерфейса.)

**Текущее состояние**: `ORBITAL_RADII = [150..550]` (система влезает в экран),
зум 0.5–2.0, миникарта 180×180 со звездой/орбитами/планетами/кораблём без
границы, рамки обзора и точек NPC.

**Связь с Feature 8**: миникарта-радар сразу проектируется под точки NPC; большой
размер системы — пространство, в котором эти NPC летают. Делать согласованно.

### Scenario 9.1: Grand-Scale Star System (×4–5)
```gherkin
Feature: Масштабная звёздная система
  Как игрок
  Я хочу большую систему как в оригинале
  Чтобы полёт ощущался масштабным

Scenario: Увеличенный размер системы
  Given я вхожу в звёздную систему
  Then орбиты планет увеличены ×4–5 (внешняя ~2500px)
  And система крупнее экрана — целиком видна только на миникарте
  And у системы есть видимая граница (рубеж гиперпрыжка)
  And камера следует за кораблём во время полёта
  And зум позволяет отдалиться, но по умолчанию виден ~экран пространства

Scenario: Сохранение баланса пошагового времени (Rule 5)
  Given система стала ×4–5 крупнее
  Then перелёты между планетами по-прежнему осмысленны по дням
  And скорость корабля / пиксели-на-день пересчитаны
  And границы зума (MIN/MAX) обновлены под новый масштаб
  And масштаб миникарты пересчитан пропорционально
```

### Scenario 9.2: Radar-Style Minimap
```gherkin
Feature: Миникарта-радар
  Как игрок
  Я хочу радар как в оригинале
  Чтобы ориентироваться в большой системе

Scenario: Содержимое радара
  Given я нахожусь в системе
  Then миникарта показывает всю систему (авто-масштаб под границу)
  And в центре — звезда, вокруг — орбиты-кольца
  And планеты на своих текущих углах (цвет по типу)
  And мой корабль — треугольник с направлением
  And по краю — кольцо границы системы
  And прямоугольник показывает текущую видимую область камеры (вьюпорт)

Scenario: Точки NPC на радаре (мост к Feature 8)
  Given в системе есть NPC-корабли
  Then они отображаются точками, цвет = фракция/намерение
  # До Feature 8 — слой точек пустой, но API готов

Scenario: Радар стабилен при zoom/pan
  Given я двигаю/зумлю камеру
  Then миникарта остаётся на месте и читаемой
  And рамка вьюпорта корректно отражает зум/пан
```

### Scenario 9.3: Prettier Space Background
```gherkin
Feature: Красивый фон космоса
  Как игрок
  Я хочу атмосферный фон
  Чтобы космос выглядел живо и глубоко

Scenario: Параллакс и звёзды
  Given я нахожусь в системе
  Then фон состоит из 3–4 слоёв звёзд с мерцанием
  And дальние слои двигаются медленнее при пане (параллакс/глубина)
  And звёзды разного размера и цвета

Scenario: Туманности и детали
  Then в фоне есть многослойные туманности-градиенты
  And есть дальние галактики/космическая пыль
  And по краям экрана — лёгкий виньетинг
  And опционально — медленно дрейфующие астероиды
  And всё это не мешает кликам по космосу/планетам (eventMode='none')
```

---

## Feature 9: Technical Design

### Scale-Up (Rule 5 checklist)
```
src/systems/PlanetGenerator.ts
  ORBITAL_RADII = [600, 1050, 1500, 1950, 2500]   // ×~4–5
  SYSTEM_BOUNDARY_RADIUS ≈ 2900                    // рубеж гиперпрыжка

src/presentation/SpaceFlightScene.ts
  - камера следит за кораблём (центрирование gameLayer на ship, Rule 6)
  - граница системы: кольцо радиуса SYSTEM_BOUNDARY_RADIUS
  - MIN_ZOOM / MAX_ZOOM пересчитать (дать отдаление, чтобы увидеть больше)
  - пиксели-на-день / скорость: пересчитать так, чтобы перелёты остались
    осмысленными (≈3–8 дней между планетами), сохранив пошаговость
```
Чек-лист (CLAUDE.md Rule 5): [ ] world-координаты [ ] масштаб миникарты
[ ] границы зума [ ] абсолютные UI [ ] edge-кейсы (макс зум, край системы).

### Radar Minimap
```
src/presentation/SystemMiniMap.ts
  - autoScale = (innerRadius) / SYSTEM_BOUNDARY_RADIUS  // вместо фикс. 0.15
  - draw: boundary ring, orbits, star, planets(angle+type color),
          ship(triangle+heading), NPC dots (faction color), viewport rect
  - новый метод/параметры: camera {zoom, panX, panY, screenW, screenH}
    для проекции прямоугольника вьюпорта
  - npc-слой: принимать массив {x, y, factionColor} (пусто до Feature 8)
  - опционально: круглая маска радара вместо квадрата
```

### Prettier Background
```
src/presentation/SpaceFlightScene.ts (или вынести в StarfieldBackground.ts)
  - 3–4 параллакс-слоя звёзд (count↑, twinkle через alpha-осцилляцию)
  - слои двигаются на долю pan камеры (parallaxFactor по глубине)
  - туманности: несколько радиальных градиентов, мягкие, разный цвет
  - дальние галактики/пыль: пара крупных blur-спрайтов
  - виньетка: тёмная рамка по краям uiLayer (eventMode='none')
  - опц. астероиды: медленный дрейф
  - ВСЁ фоновое: eventMode='none' (Rule 3) — не блокировать клики
```

### Sliced Roadmap
1. **Срез A — Масштаб**: ORBITAL_RADII ×4–5, граница системы, камера-следование,
   пересчёт зума и пикселей-на-день. Проверка баланса полёта.
2. **Срез B — Радар**: авто-масштаб миникарты, граница, рамка вьюпорта, углы
   планет; NPC-слой как заглушка-API.
3. **Срез C — Фон**: параллакс-звёзды, туманности, галактики, виньетка,
   (опц.) астероиды.

### Test Strategy
- Unit: autoScale миникарты от SYSTEM_BOUNDARY_RADIUS; проекция вьюпорта;
  пересчёт дней-перелёта при новом масштабе.
- E2E: камера центрируется на корабле; миникарта видна и стабильна при zoom/pan;
  клики по космосу/планетам не блокируются фоном.

---

## Acceptance Criteria Summary

### Phase 1 MVP Requirements
1. ✅ Main Menu with save/load (corrupted data handling)
2. ✅ Main Menu animated background (300 stars, 3 ships, 2 planets)
3. ✅ Sector Map with zoom/pan (0.5x-3.0x zoom)
4. ✅ Double-click to enter system
5. ✅ Warp jump with fuel consumption (5 for connected, distance*2 for unconnected)
6. ✅ Planet names generated from 180+ Russian/sci-fi name list
7. ✅ Clear connection labels ("Соседи (можно прыгнуть)")
8. ✅ Ship entry from wormhole edge (600px from center, based on entry vector)
9. ✅ Day counter display ("День: X") - updates in real-time during flight
10. ✅ Flight duration calculation and display ("Перелёт: X дн.")
11. ✅ Governor button hidden for uninhabitable planets
12. ✅ Drone count display for uninhabitable planets
13. ✅ Planet landing screen with menu (Governor/Garage/Market/Research/Takeoff)
14. ✅ Garage hull repair system (cost = damage * 2)
15. ✅ Auto-refuel on landing (full tank on takeoff)
16. ✅ Camera controls (Shift+click pan, wheel zoom, center-point preservation)
17. ✅ Quest journal with navigation
18. ✅ Minimap with real-time ship tracking
19. ✅ **NEW: Turn-based gameplay** - world pauses when ship not moving
20. ✅ **NEW: Days advance during flight** (500px = 1 day)
21. ✅ **NEW: Planets rotate only when ship moves**
22. ✅ **NEW: Slower ship speed** (0.1 px/ms for strategic gameplay)
23. ✅ **NEW: Guaranteed habitable planet** in every system (first planet always habitable)

### Phase 2 Features (Roadmap)
- ONNX-powered procedural planet name generation (with fallback)
- ONNX-powered dialogue generation
- Space combat system
- Trading/market implementation
- Research system
- Random events during flight
- Faction reputation system
- Ship upgrades and modules
- Multi-NPC dialogues
- Dynamic quest generation

### Дорожная карта эпиков (Feature 10–14)

Эпики и их нарезка ведутся в `docs/requirements/epics/`. Каждый «Feature N» здесь
= один эпик; порядок выбран так, чтобы каждый слой опирался на готовый предыдущий.

| Feature | Эпик | Что даёт | Зависит от |
|--------:|------|----------|-----------|
| 10 | [EPIC-005](docs/requirements/epics/EPIC-005-text-quests-onnx.md) — Текст-квесты на ONNX | Ветвящиеся новеллы (главный дифференциатор) | ONNX-инфра, QuestManager |
| 11 | [EPIC-006](docs/requirements/epics/EPIC-006-planet-station-services.md) — Услуги планет/станций | Хаб: ангар, торговля, инфоцентр, правительство | EPIC-001, EPIC-003 |
| 12 | [EPIC-007](docs/requirements/epics/EPIC-007-ship-fitting-equipment.md) — Снаряжение корабля | Корпус/слоты/оружие/микромодули, прогрессия мощи | EPIC-006, EPIC-002 |
| 13 | [EPIC-008](docs/requirements/epics/EPIC-008-quest-generation-and-missions.md) — Генератор квестов и миссии | Доска заданий, квесты по всей галактике, текст-квест 1/5 | QuestManager, EPIC-006, EPIC-003, EPIC-005 |
| 14 | [EPIC-009](docs/requirements/epics/EPIC-009-information-system.md) — Информационная система | Реестр «кто/что/где» + поиск снаряжения по параметрам | EPIC-003, EPIC-001, EPIC-007, EPIC-006 |

**Рекомендуемая последовательность** (с учётом зависимостей и ценности):

1. **Feature 11 (EPIC-006)** — хаб планеты: без «дома» между полётами остальное
   некуда повесить (ангар/торговля/инфоцентр/доска квестов — всё тут).
2. **Feature 12 (EPIC-007)** — снаряжение: даёт смысл деньгам и наградам, цель
   прогрессии (нужен магазин из Feature 11).
3. **Feature 13 (EPIC-008)** — генератор квестов: мотор сессии, гоняет по
   галактике; текст-квесты (Feature 10) подмешиваются с долей ~1/5.
4. **Feature 14 (EPIC-009)** — инфоцентр/поиск: делает большую галактику
   навигируемой («где лучший корпус/оружие», «куда улетел корабль»); опирается на
   ассортимент (F12), рынки и NPC.
5. **Feature 10 (EPIC-005)** — текст-квесты можно вести параллельно (движок графа
   и нарратор тестируются без UI), а подключить триггером в Feature 13.

> Бой (Feature 6 / EPIC-002) встаёт после EPIC-007: исход боя зависит от
> снаряжения и сканера. Охота (BOUNTY) из Feature 13 — основной потребитель боя.

---

## Testing Strategy

### E2E Test Coverage
```gherkin
Feature: E2E Test Suite
  Space Flight UI tests (25+ scenarios)
  - Camera zoom (min/max bounds, center preservation)
  - Camera pan (Shift+LMB, RMB, MMB)
  - Ship navigation (click-to-move, coordinate transformation)
  - Minimap visibility and updates
  - Quest journal open/close
  - UI buttons (stopPropagation, no event bubbling)

  Star Map tests
  - System selection
  - Warp jump confirmation
  - Fuel consumption
  - Double-click entry

  Planet Scene tests
  - Menu visibility for habitable/uninhabitable
  - Garage repair
  - Takeoff
```

---

## Visual & Playability Findings (UI inspection 2026-06-05)

### Исправлено в коммите 0a91130
| Проблема | Причина | Исправление |
|----------|---------|-------------|
| Квадратный край nebula виден при max zoom-out | Backdrop в world-space, масштабировался с gameLayer; 7840px × 0.25 zoom < ширина 4K экрана | Backdrop перенесён в screen-space (skyContainer), размер 2.4× max(W,H) — никогда не клипает |
| Параллакс без глубины | depth 0.015/0.04/0.08 — слишком мало: разброс 27–144px при панораме. Слои почти неразличимы | Новые значения 0.04/0.10/0.22 (5.5× ratio); убран Math.max(1,…) — слои сжимаются при zoom-out |
| Точки стоят на месте | Дальний слой depth=0.015 двигался на 27px при max pan — визуально воспринимается как статичный | Минимальный depth=0.04 → 72px при том же pan; заметно всем слоям |
| Полосы на фоне | BlurFilter на огромных nebula-объектах в world-space + camera zoom → oversized filter texture clamped by GPU | Все BlurFilter удалены с cloud/ember Graphics |
| NPC хаотично влетают/вылетают | arrivalState() возвращал IDLE → немедленный redeparture на следующий тик | Default → PATROLLING; DEPART_CHANCE=0.15 (~6–7 дней дружба) |

### Открытые визуальные задачи (следующие итерации)
- **Nebula gaps at max zoom-out**: Procedural clouds (world-space, ~1680px span при zoom=0.25) могут показывать разрывы между собой. Backdrop заполняет пустоты цветом, но структуры нет. Вариант: добавить 2–3 крупных диффузных "arm" blob поверх backdrop в screen-space.
- **Onboarding: планеты в линию** — при старте все планеты в одной линии (baseAngle=0 из `hashToAngle`). Геймплейная идея: "раз в миллион лет планеты выстраиваются — рождается герой, это ты" (US-073). Требует: интро-сцена + намеренный force-align на день 0.
- **NPC экономический ИИ** — полноценное buy/sell/quest AI у NPC. Текущая реализация — визуальный orbit. Roadmap: EPIC-003 слайсы 4–6.
- **Swarms blur-filter** — мелкие swarm-motes (r=1.2–3.2px) всё ещё имеют paddedBlur(1.5). Мелкий объект — риск низкий, но при проблемах — удалить фильтр.
- **Asteroid-count tuning** — 5 астероидов достаточно для движения, но при zoom-out они почти не видны. Рассмотреть увеличение count до 8–10 или размера.

---

## Technical Debt & Known Issues
0. **BUG — клик из модалки/диалога проваливается в карту** (см. US-024):
   - Клик внутри модалки звёздной карты и выход из диалога с губернатором
     «протекают» в обработчик карты → строится маршрут в `SpaceFlightScene`.
   - Этот клик планетарной/звёздной картой обрабатываться НЕ должен.
   - **Action**: `stopPropagation` на кнопках модалок/диалогов и/или гард в
     глобальном `onPointerDown` сцены от первого клика после закрытия модалки/
     перехода (CLAUDE.md PixiJS Rules 1–2). Подробности — US-024.

1. **ONNX Models**: Currently using fallback generators
   - Planet names: 180+ hardcoded Russian/sci-fi names
   - Dialogues: Template-based system
   - **Action**: Integrate language models when available

2. **Back Button Navigation**: Implemented per-screen
   - Each scene has "Back to X" or "Close" buttons
   - **Status**: Working as designed

3. **Performance**: Ensure 60 FPS on target hardware
   - Main menu: 300 stars + 3 ships + 2 planets
   - Space flight: Star field + nebulae + planets + ship
   - **Action**: Profile and optimize if needed

4. **Save Migration**: No migration system yet
   - Breaking changes to domain models require manual save wipe
   - **Action**: Implement MigrationPipeline in Phase 2

---

## Development Workflow
1. **Feature Development**: Create BDD scenarios first (Gherkin)
2. **Implementation**: Write code to satisfy scenarios
3. **E2E Tests**: Implement Playwright tests matching scenarios
4. **Code Review**: Check against CLAUDE.md rules
5. **Manual QA**: Test in browser
6. **Commit**: Use descriptive commit messages
7. **CI/CD**: GitHub Actions runs linting, unit tests, E2E tests

---

## Conclusion
✅ **Все критические баги исправлены**
✅ **Реализована пошаговая механика геймплея**
✅ **Гарантирована хотя бы одна жилая планета в каждой системе**

### Последние изменения (2026-05-31):
1. **PlanetGenerator.ts**: Первая планета всегда жилая (TERRESTRIAL/INDUSTRIAL/HABITAT)
2. **SpaceFlightScene.ts**:
   - Скорость корабля снижена с 0.3 до 0.1 px/ms
   - Дни капают во время полета (500px = 1 день)
   - Планеты вращаются только когда корабль движется
   - Реальное время отслеживается через distanceTraveled
3. **UI**: День обновляется в реальном времени во время полета

### Игровая механика:
- **Пошаговая стратегия**: Мир паузится когда корабль не движется
- **Время на реакцию**: Медленный полет дает время заметить события
- **Стратегическое планирование**: Можно спокойно выбирать маршрут без давления времени

**Next Steps**:
1. **E2E тестирование** пошаговой механики
2. **Тестирование** гарантированной жилой планеты (создать 100 систем, проверить)
3. Профилирование производительности
4. Сбор фидбека от пользователей
5. План Phase 2 features (combat, ONNX integration, trading)
