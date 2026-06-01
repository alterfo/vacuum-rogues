# Space Rangers: Neural Onslaught - Development Plan (BDD)

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
  Then я вижу экран выбора расы
  And я могу выбрать одну из 5 рас (Human, Malaqar, Peleng, Faerian, Gaalian)
  And я вижу описание расовых бонусов

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
  And панель показывает расу жителей (Human, Malaqar, и т.д.)
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

## Technical Debt & Known Issues
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
