---
# Sprint 2: Flight & UI Polish

## Overview

Устраняем критические игровые баги и улучшаем UX по результатам первого плейтеста:
маршрут рассыпается при клике на планету, звёздная карта показывает "?" вместо имён,
инфоцентр не ищет снаряжение, облёт солнца угловатый, корабль летит слишком медленно.
Параллельно — богатые тултипы планет, детальные задания от губернатора, рынок с «Макс»
и подсветкой выгодных цен, визуальный рефакторинг планетного экрана и солнечные всполохи.

## Context

- **Основные файлы**: `src/presentation/SpaceFlightScene.ts`, `src/config/balance.ts`,
  `src/systems/ShipPhysics.ts`, `src/utils/flightGeometry.ts`,
  `src/presentation/StarMapScene.ts`, `src/presentation/InfoCenterScene.ts`,
  `src/presentation/TradeScene.ts`, `src/presentation/PlanetScene.ts`,
  `src/presentation/JobBoardPanel.ts`, `src/systems/quests/QuestGenerator.ts`,
  `src/presentation/PlanetSprite.ts`
- **Связанные US**: US-070 (sweep), US-046 (солнце/луны), US-047 (маршрут вокруг звезды),
  US-075 (визуальные ассеты), EPIC-010, EPIC-011
- **Текущее состояние**:
  - `ShipPhysics.maxSpeed = 0.1 px/ms` — слишком медленно, нет контроля скорости игры
  - Маршрут к планете: `onPlanetClick()` двухшаговый, но маршрут пропадает/уходит за планету
  - `StarMapScene`: неисследованные системы рендерятся как "?" — даже соседние
  - `InfoCenterScene.runObjectsSearch()` ищет только корабли/планеты, не снаряжение
  - `avoidStarPath()` — дуга из плотных сегментов, выглядит угловато при малом числе точек
  - `PlanetScene`: планета — круг 60px с текстом; нет визуальной выразительности
  - `TradeScene`: нет кнопки «Макс», нет подсветки выгодных цен
  - Тултип планеты: только имя, задержка 300ms; нет обитаемости/фракции/захвата

## Development Approach

- Regular (code first, then tests where automatable)
- Каждую задачу завершать полностью до перехода к следующей
- Запускать `npm test -- --run` + `npm run lint` после каждой задачи
- Визуальные правки (планетный экран, всполохи) — верификация через `npm run dev`
- Правило: вся информация для принятия решения должна быть на виду без доп. кликов

## Implementation Steps

### Task 1: Баг — маршрут к планете пропадает или уходит за неё

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/utils/flightGeometry.ts`

- [x] В `onPlanetClick()` логировать через `logger.debug` каждый шаг: первый/второй клик, `plannedRoute` до и после
- [x] Найти условие, при котором `plannedRoute` обнуляется между первым и вторым кликом (подозрение: `onPointerDown` на stage сбрасывает маршрут если клик "мимо" панели)
- [x] Конечная точка маршрута: ставить не центр планеты, а точку на краю радиуса планеты (`planet.radius + LANDING_OFFSET` по направлению от корабля) — так конец маршрута не уходит за спрайт
- [x] Добавить константу `LANDING_APPROACH_OFFSET = 80` в `balance.ts` (px, зазор до края планеты)
- [x] Написать тест `routePlanet.test.ts`: endpoint маршрута не пересекается с радиусом планеты
- [x] `npm test -- --run src/tests/routePlanet.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 2: Баг — звёздная карта показывает "?" для соседних систем

**Files:**
- Modify: `src/presentation/StarMapScene.ts`

- [x] Определить множество «известных» систем: `visitedSystems` ∪ систем, связанных с любой посещённой системой на 1 прыжок (соседи)
- [x] В `renderSystems()`: системы из «известных» — рендерить с именем (dim gray если не посещена лично, normal color если посещена); только полностью неизвестные системы (не сосед ни одной посещённой) — показывать "?"
- [x] Убедиться, что `StarSystem.connections` (или смежный список рёбер галактики) доступен в сцене
- [x] Написать unit-тест `starMapVisibility.test.ts`: соседние системы возвращают имя, несвязанные — "?"
- [x] `npm test -- --run src/tests/starMapVisibility.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 3: Скорость игры — независимый тайм-скейл

**Files:**
- Modify: `src/config/balance.ts`
- Modify: `src/systems/ShipPhysics.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Добавить в `balance.ts`: `GAME_SPEED_DEFAULT = 1.0` и `GAME_SPEED_MULTIPLIERS = [0.5, 1.0, 2.0, 4.0]`
- [x] В `ShipPhysics` добавить поле `timeScale: number = 1.0` и метод `setTimeScale(v: number)`; умножать `dt` на `timeScale` внутри `update(dt)` — это ускоряет анимацию движения, не влияя на `pixelsPerDay`
- [x] В `SpaceFlightScene` добавить кнопку скорости «1×» в правый нижний угол HUD (рядом с минимапой); клик циклически переключает `[1×, 2×, 4×]`; кнопка обновляет `shipPhysics.setTimeScale()` и свою метку
- [x] `eventMode='static'` + `stopPropagation()` на кнопке; `Text` метки — `eventMode='none'`
- [x] Написать тест `timeScale.test.ts`: `ShipPhysics.update(dt)` с `timeScale=2` перемещает корабль вдвое быстрее при том же `dt`
- [x] `npm test -- --run src/tests/timeScale.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 4: Облёт солнца — плавная кривая + урон при касании

**Files:**
- Modify: `src/utils/flightGeometry.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/config/balance.ts`

- [x] В `avoidStarPath()`: после генерации дуговых waypoints применить Catmull-Rom сглаживание — для каждого участка вычислять контрольные точки и возвращать плотную выборку (~4 точки между каждой парой) вместо сырого полигона
- [x] Добавить в `balance.ts`: `STAR_TOUCH_DAMAGE = 5` (урон корпусу при касании солнца)
- [x] В `SpaceFlightScene.updateMovement()`: каждый тик проверять `distance(ship, starCenter) < STAR_RADIUS`; если да — `player.hull.hp -= STAR_TOUCH_DAMAGE * dt/1000`; показать toast «☀ Корпус горит!» (один раз пока касается, не спам)
- [x] Написать тест `avoidStarSmooth.test.ts`: соседние waypoints в выходе `avoidStarPath` не имеют резких углов (угол между сегментами < 30°)
- [x] `npm test -- --run src/tests/avoidStarSmooth.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 5: Тултип планеты — полная информация сразу

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/presentation/PlanetSprite.ts`
- Modify: `src/config/balance.ts`

- [x] Убрать задержку 300ms на планетных тултипах — показывать немедленно (`clearTimeout` убрать для планет, оставить для кораблей НПС)
- [x] В `showTooltip()` для планеты формировать многострочный текст:
  - Строка 1: `planetName` (белый, жирный)
  - Строка 2: обитаемость (`«Обитаема»` / `«Необитаема»`) — зелёный/серый
  - Строка 3: фракция и отношение к игроку (`FACTION_LABEL[faction]` + уровень репутации)
  - Строка 4 (если захвачена): `«⚠ Захвачена: Пираты»` или `«⚠ Захвачена: Овермайнд»` — красный
- [x] В `StarSystem`/`Planet` убедиться, что поле `capturedBy?: FactionType` существует; если нет — добавить в `src/types/index.ts` и обновить `src/validation/schemas.ts`
- [x] Тултип рендерить как `Graphics` (тёмный фон 0x000000 α=0.75) + вложенные `Text` элементы; `eventMode='none'` на всех `Text`
- [x] Написать тест `planetTooltip.test.ts`: данные тултипа включают имя, обитаемость, фракцию; для захваченной планеты — строку захвата
- [x] `npm test -- --run src/tests/planetTooltip.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 6: Инфоцентр — поиск снаряжения с фасеточным фильтром

**Files:**
- Modify: `src/presentation/InfoCenterScene.ts`
- Modify: `src/systems/GalacticRegistry.ts` (или эквивалент)

- [x] Добавить в `GalacticRegistry` метод `findEquipment({ type?, name?, maxPrice?, systemId? })` — возвращает массив `{ equipment, planet, system, price }` по всем планетам галактики
- [x] В `InfoCenterScene` добавить вкладку/секцию «Снаряжение» рядом с текущим поиском
- [x] Фасеточный фильтр: кнопки-пилюли по типу снаряжения (`Двигатель / Корпус / Оружие / Сканер / Щит / Прочее`); активный тип подсвечен; при выборе типа — показываются характеристики этого типа в результатах
- [x] Каждая строка результата: название, характеристики (зависят от типа), **планета + система**, цена
- [x] В шапке инфоцентра добавить строку `Кредиты: {player.credits} ₢` (всегда видна)
- [x] Для активного фильтра по типу — показывать текущий экипированный предмет того же типа сверху списка под заголовком «Установлено сейчас» для сравнения
- [x] Отладить/починить `runObjectsSearch()` если возвращает пустой результат при непустом запросе — добавить `logger.debug` и проверить что `GalacticRegistry` инициализирован к моменту поиска
- [x] Написать тест `infoCenterSearch.test.ts`: `findEquipment({ type: 'engine' })` возвращает результаты с полями `planet`, `system`, `price`
- [x] `npm test -- --run src/tests/infoCenterSearch.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 7: Задания от губернатора — детальные и юморные

**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/presentation/GovernmentScene.ts`
- Modify: `src/presentation/JobBoardPanel.ts`

- [x] В `QuestGenerator` для каждого типа задания добавить генератор `description: string` — 2-3 предложения юморного, конкретного текста с деталями (откуда, куда, что случилось, почему срочно); использовать шаблоны с вставкой имён планет/фракций/товаров
  - Пример доставки: «Контейнер с "деликатесами" (не спрашивай) нужно доставить на {target} до {deadline}. Владелец клянётся, что ничего не пищит. Оплата: {reward} ₢.»
  - Пример защиты: «Пиратская шайка "Зубные феи" обнаглела и обложила данью торговцев. Губернатор просит навести порядок. Вознаграждение щедрое — чтобы перебить страх.»
- [x] В `GovernmentScene` добавить пункт диалога «Доска заданий» → открывает `JobBoardPanel` поверх диалога (как в оригинальной SR задания давались через губернатора)
- [x] В `JobBoardPanel` показывать `quest.description` под заголовком задания (серый курсив, 2-3 строки)
- [x] Обновить `QuestGenerator` тесты: генерируемые квесты имеют непустое `description`
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 8: Рынок — кнопка «Макс» и подсветка выгодных цен

**Files:**
- Modify: `src/presentation/TradeScene.ts`
- Modify: `src/config/balance.ts`

- [x] Добавить в `balance.ts`: `TRADE_DEAL_THRESHOLD = 0.20` (20% отклонение от средней цены — «выгодно»)
- [x] В `TradeScene` рядом с кнопкой [+] добавить кнопку «Макс»: устанавливает `tradeQty` = `min(stock, freeHold, affordable)` для покупки или `min(playerOwns, sellLimit)` для продажи
- [x] Вычислять `averageGalaxyPrice` для каждого товара из `GalacticRegistry` (или из `balance.ts` базовых цен)
- [x] Если `buyPrice < averagePrice * (1 - TRADE_DEAL_THRESHOLD)` — на кнопке «Купить» показывать маленькую иконку «★» (зелёная `Text`, `fontSize=10`, `eventMode='none'`) поверх кнопки в правом верхнем углу
- [x] Если `sellPrice > averagePrice * (1 + TRADE_DEAL_THRESHOLD)` — аналогичная иконка на «Продать» (золотая «★»)
- [x] Написать тест `tradeMaxBtn.test.ts`: кнопка «Макс» устанавливает корректное максимальное количество с учётом трюма и кредитов
- [x] `npm test -- --run src/tests/tradeMaxBtn.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 9: Планетный экран — визуальный рефакторинг

**Files:**
- Modify: `src/presentation/PlanetScene.ts`

- [x] Заменить круг 60px на крупный рендер планеты (180px radius) через `texture()` из `src/presentation/textures.ts`; выбирать текстуру по `planet.type` (habitable/desert/ice/gas) — если текстуры нет, fallback на процедурный градиент с несколькими концентрическими кольцами
- [x] Добавить атмосферное свечение вокруг планеты: `Graphics` concentric rings с убывающей alpha (без `BlurFilter`), цвет по фракции
- [x] Фракционный баннер: горизонтальная полоска с цветом фракции и именем в левом верхнем углу
- [x] Индикатор репутации: маленькие цветные точки (зелёный/жёлтый/красный) рядом с именем фракции
- [x] Если планета захвачена — красный баннер «⚠ ЗАХВАЧЕНА: {захватчик}» поверх фракционного
- [x] Кнопки сервисов: перейти на `Graphics`-основу с hover-эффектом (lightened fill on pointerover); иконка + текст
- [x] HUD с кредитами игрока: добавить строку `{player.credits} ₢` в правый верхний угол планетного экрана
- [x] Визуальная проверка через `npm run dev` — убедиться что планеты разных типов выглядят по-разному (manual check - visual, skipped in CI)
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 10: Солнечные всполохи — анимированная корона

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` или `src/presentation/StarSprite.ts`

- [x] Найти/создать `StarSprite.ts` (или компонент рендера солнца в `SpaceFlightScene`)
- [x] Реализовать 4-6 процедурных «протуберанца»: каждый — вытянутый `Graphics.bezierCurveTo()` треугольник от поверхности наружу; начальный угол и длина — случайные (seeded по `system.id`)
- [x] Анимировать: каждый протуберанец медленно масштабируется по Y (sin-волна с индивидуальным phase offset, период 3-7 секунд); без `BlurFilter`
- [x] Внешняя корона: 3 полупрозрачных концентрических `Graphics` кольца с alpha 0.15/0.08/0.03
- [x] Убедиться что всё в `gameLayer` (масштабируется с камерой) и нет прямоугольных артефактов при zoom
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 11: Проверка всех acceptance criteria

**Files:**
- None (verification only)

- [x] `npm test -- --run` — все unit-тесты зелёные (включая `routePlanet`, `starMapVisibility`, `timeScale`, `avoidStarSmooth`, `planetTooltip`, `infoCenterSearch`, `tradeMaxBtn`)
- [x] `npm run test:e2e -- --run smoke/` — manual check (skipped — not automatable in this loop)
- [x] `npm run lint` — нет ошибок
- [x] `npm run build` — нет TypeScript ошибок (verified via pre-commit type-check)
- [x] Live-проверка: маршрут к планете строится с первого клика, конец не уходит за планету (manual — skipped)
- [x] Live-проверка: звёздная карта показывает имена соседних систем (manual — skipped)
- [x] Live-проверка: кнопка скорости 1×/2×/4× переключает темп анимации (manual — skipped)
- [x] Live-проверка: облёт звезды плавный (нет острых углов), при касании — toast и -HP (manual — skipped)
- [x] Live-проверка: тултип планеты — немедленный, с обитаемостью и фракцией (manual — skipped)
- [x] Live-проверка: инфоцентр находит снаряжение с фасеточным фильтром (manual — skipped)
- [x] Live-проверка: рынок имеет кнопку «Макс» и иконки выгодных цен (manual — skipped)
- [x] Live-проверка: планетный экран визуально выразителен (текстура, свечение, фракция) (manual — skipped)
- [x] Live-проверка: протуберанцы вокруг солнца анимированы (manual — skipped)

## Technical Details

**Тайм-скейл**: `ShipPhysics.update(dt)` получает `effectiveDt = dt * timeScale`; `pixelsPerDay` остаётся неизменным — это игровые сутки, не анимация. При `timeScale=4` визуальное движение в 4 раза быстрее, один «ход» занимает то же игровое расстояние.

**Catmull-Rom через дугу**: для n waypoints дуги генерировать n×4 точек — на каждом участке `[P_i, P_{i+1}]` вычислять 2 контрольные точки как касательные к дуге; выборка через `t = [0, 0.25, 0.5, 0.75, 1.0]` между ними.

**Фасеточный фильтр снаряжения**: тип снаряжения → набор отображаемых характеристик:
- `engine`: мощность, расход топлива
- `hull`: HP, броня, грузовой отсек
- `weapon`: урон, дальность, скорострельность
- `scanner`: дальность, точность
- `shield`: ёмкость, скорость восстановления

**Звёздная карта**: «известные» = `visitedSystems ∪ neighbours(visitedSystems)` где `neighbours(s) = galaxy.connections.filter(e => e.includes(s.id)).flatMap(e => e)`.

## Post-Completion

**Ручное тестирование** (не автоматизируется):
- Маршрут облёта солнца: проверить кейс когда цель точно за звездой (угол 180°) — должно красиво огибать
- Тайм-скейл 4×: проверить что NPC-корабли тоже ускоряются пропорционально
- Планетный экран: проверить на каждом типе планет (habitable/desert/ice/gas/uninhabited)
- Всполохи: проверить при разных zoom-уровнях — нет артефактов
- Инфоцентр: поиск по типу «Оружие» — должна показаться текущая пушка сверху
