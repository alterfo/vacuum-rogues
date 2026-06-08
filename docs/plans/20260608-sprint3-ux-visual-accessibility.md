---
# Sprint 3: UX, Visual & Accessibility

## Overview

Устраняем накопившиеся UX-проблемы после плейтеста: маршрут к планете по-прежнему
исчезает, текст мелкий и серый-на-чёрном нечитаем, фон планетарного экрана пустой
вместо эквиректангулярной панорамы, во время хода можно строить маршрут хотя не должно,
фон полёта статичен и скучен. Дизайн кнопок — плоский текст без визуального языка.

## Context

- **Ветка**: `feat/flight-sweep-and-systems`
- **Ключевые файлы**: `src/presentation/SpaceFlightScene.ts`,
  `src/presentation/PlanetScene.ts`, `src/presentation/textures.ts`,
  `src/config/balance.ts`, `src/systems/GameEngine.ts`, `src/main.ts`
- **Баги**: маршрут к планете — появляется и сразу исчезает (регрессия спринта 2);
  у планетных экранов нет фона-панорамы; серый текст на чёрном нечитаем
- **Дизайн-решения**:
  - Во время хода (`isTurnRunning=true`) клики на карте НЕ строят маршрут — только
    любуемся + пауза; маршрут строится только в паузе
  - Фон полёта должен быть «живым» — параллакс-слои с астероидами, кометами,
    фоновыми кораблями, летящими в разных направлениях (вдоль, поперёк, на камеру, от)
  - Настройка размера шрифта: S / M / L — влияет глобально через CSS переменную
    `--ui-font-scale`; сохраняется в localStorage

## Development Approach

- Regular (code first, tests where automatable)
- Каждую задачу завершать полностью (lint + tests) до следующей
- Визуал верифицировать через `npm run dev` в браузере

## Implementation Steps

### Task 1: Route bug — маршрут исчезает при клике на планету (regression fix)

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Добавить `logger.debug` перед каждым местом где `plannedRoute` или `routeTargetPlanetId` обнуляются: найти кто сбрасывает после первого клика
- [x] Подозрение: `onPointerDown` на stage вызывается после `onPlanetClick` (bubbling) и сбрасывает маршрут через `clearRoute()` — добавить проверку `if (this.routeTargetPlanetId !== null) return` в начало `clearRoute()` на первом клике
- [x] Второй подозрительный путь: `isTurnRunning` guard сбрасывает клик — проверить порядок проверок в `onPointerDown`
- [x] Убедиться что `routeTargetPlanetId` устанавливается ДО возможных сбросов в том же event loop тике — использовать `queueMicrotask` если нужно
- [x] Написать тест `routePersist.test.ts`: после первого клика на планету `routeTargetPlanetId` остаётся установленным (не сбрасывается до второго клика)
- [x] `npm test -- --run src/tests/routePersist.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 2: Ход vs. Пауза — маршрут только в паузе

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] В `onPointerDown` (глобальный обработчик stage): если `isTurnRunning === true` — полностью игнорировать клик (не строить маршрут, не открывать панели планет/NPC); показать мигающую подсказку «⏸ Поставь на паузу чтобы выбрать маршрут» один раз при первом попытке кликнуть во время хода
- [x] `onPlanetClick` и `onNpcClick` — добавить ранний `return` если `isTurnRunning`
- [x] Курсор во время хода: `app.canvas.style.cursor = 'default'` (не pointer при наведении на планеты); во время паузы — восстановить pointer
- [x] Тест `routeOnlyInPause.test.ts`: при `isTurnRunning=true` клик на планету не изменяет `plannedRoute`
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 3: Живой фон полёта — астероиды, кометы, фоновые корабли

**Files:**
- Create: `src/presentation/SpaceBackgroundLayer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Создать `SpaceBackgroundLayer` — отдельный `Container` ниже `gameLayer` (не масштабируется камерой, привязан к экрану)
- [x] Слой 1 — «дальний космос»: 8–12 астероидов (`Graphics` неправильный полигон, серо-коричневый), медленный drift вправо/влево, при выходе за экран — телепорт на противоположный край
- [x] Слой 2 — «кометы»: 2–3 объекта, периодически (random 15–40 сек) проносятся по диагонали через весь экран с хвостом (`Graphics` линия с убывающей alpha), скорость высокая
- [x] Слой 3 — «фоновые корабли»: 1–2 маленьких силуэта (`Graphics` capsule), летят прямо, медленно, в случайном направлении; при выходе — respawn с другой стороны
- [x] Слой 4 — «параллакс пыль»: мелкие точки разного размера движутся с разной скоростью создавая depth
- [x] «На камеру» эффект: один астероид раз в 60–90 сек медленно увеличивается (scale 0.3→1.5) проходя «сквозь» экран и исчезает; не мешает геймплею
- [x] Все объекты seed-детерминированы по `system.id` для консистентности
- [x] `destroy()` чистит все DisplayObjects и интервалы
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 4: Настройка размера шрифта + контраст

**Files:**
- Modify: `src/config/balance.ts`
- Modify: `src/systems/GameEngine.ts`
- Modify: `src/presentation/SpaceFlightScene.ts` (Settings UI)
- Create: `src/utils/fontScale.ts`

- [x] Создать `src/utils/fontScale.ts`: `FONT_SIZES = { S: 0.85, M: 1.0, L: 1.25 }` и `currentFontScale()` / `setFontScale(size: 'S'|'M'|'L')` — читает/пишет `localStorage.getItem('fontScale')`
- [x] В `balance.ts` добавить `BASE_FONT_SIZES` — базовые размеры в px для каждого типа текста (UI label, body, title, tooltip). Все `fontSize` в компонентах умножать на `currentFontScale()`
- [x] Кнопка шестерёнки «⚙» в HUD `SpaceFlightScene` (левый нижний угол) открывает мини-панель настроек: кнопки `[A]` `[A]` `[A]` (S/M/L) с рамкой у активного; изменение сразу перестраивает HUD через `handleResize()`
- [x] Правило контраста — **запретить серый текст на чёрном**: аудит всех `style.fill = 0x888888` / `0x666666` / `0x445566` на тёмных фонах → заменить на минимум `0xaaaaaa` (или белый `0xffffff`); тёмный фон panels поднять до `0x111122` min
- [x] Конкретные места замены: `InfoCenterScene` dim results, `JobBoardPanel` description text, `StarMapScene` neighbour system labels (сейчас `0x445566` → `0x88aacc`), `SpaceFlightScene` mini-log
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 5: Эквиректангулярный фон планетарного экрана

**Files:**
- Modify: `src/presentation/PlanetScene.ts`
- Modify: `src/presentation/textures.ts`
- Modify: `src/assets/manifest.ts`

- [x] В `src/assets/manifest.ts` зарегистрировать glob `src/assets/panoramas/*.{jpg,png}` — файлы `bastions_01.jpg`, `outlanders_01.jpg`, `progressors_01.jpg`, `wilderness_01.jpg`, `pirate_01.jpg` (пока заглушки 1×1 px, позже ComfyUI)
- [x] В `textures.ts` добавить `panoramaUrl(key: string)` — возвращает URL из manifest или fallback gradient
- [x] В `PlanetScene.createUI()`: первым добавить в `uiContainer` полноэкранный `Sprite` из `panoramaUrl(planet.type + '_01')`, масштаб `cover` (заполнить весь экран сохраняя aspect ratio через `sprite.width/height`); если текстура не загружена — оставить градиентный фон
- [x] Поверх панорамы — полупрозрачный `Graphics` overlay `0x000011` alpha=0.55 чтобы интерфейс читался на любой картинке
- [x] Создать 5 заглушек (1×1 px PNG) в `src/assets/panoramas/` чтобы manifest работал сразу
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 6: Визуальный язык UI — кнопки с характером

**Files:**
- Create: `src/presentation/ui/UiButton.ts`
- Modify: `src/presentation/PlanetScene.ts`
- Modify: `src/presentation/SpaceFlightScene.ts` (HUD кнопки)

- [ ] Создать `UiButton` класс (`Container`): `Graphics` фон с rounded rect + левая цветная полоска (accent color по типу кнопки) + иконка (Unicode символ, 18px) + текст (14px); hover → lighten fill + cursor pointer; active → darken; `eventMode='static'`, `stopPropagation()` внутри
- [ ] Типы акцента: `primary` (cyan `0x00ffee`), `danger` (red `0xff4444`), `success` (green `0x44ff88`), `neutral` (gray `0x667788`)
- [ ] В `PlanetScene`: заменить текстовые кнопки сервисов на `UiButton` с иконками:
  - `⚙ Верфь`, `📦 Рынок`, `📋 Губернатор`, `🚀 Взлёт`, `🔍 Инфоцентр`, `⚔ Снаряжение`
- [ ] HUD `SpaceFlightScene`: кнопки «▶ ХОД» / «⏸ ПАУЗА», «1×/2×/4×», «⚙», «⊙» — перевести на `UiButton` с акцентом
- [ ] `UiButton` экспортирует `setLabel(text)` для обновления без пересоздания (используется кнопкой скорости и play/pause)
- [ ] `npm test -- --run` + `npm run lint` — без регрессий

### Task 7: Верификация всех acceptance criteria

**Files:**
- None (verification)

- [ ] `npm test -- --run` — все тесты зелёные
- [ ] `npm run test:e2e -- --run smoke/` — все 5 smoke-тестов проходят
- [ ] `npm run lint` — 0 ошибок
- [ ] `npm run build` — нет TypeScript ошибок
- [ ] Live: кликнуть на планету → маршрут появляется и НЕ исчезает
- [ ] Live: нажать «▶ ХОД» → клики на карте игнорируются, показывается подсказка
- [ ] Live: фон полёта — видны летящие астероиды и хотя бы одна комета за ~30 сек
- [ ] Live: планетарный экран — виден эквиректангулярный фон (или цветной градиент-заглушка)
- [ ] Live: переключить шрифт L → текст явно крупнее; нет серого на чёрном

## Technical Details

**Живой фон**: все объекты в `SpaceBackgroundLayer` обновляются в `update(dt)` сцены;
не используют `Ticker` напрямую — получают `dt` через scene. `destroy()` удаляет
`Container` из `stage`.

**Фонт-скейл**: при смене шрифта вся сцена уничтожается и пересоздаётся через
`gameEngine.transitionTo(SPACE_FLIGHT, ctx)` — самый простой способ применить новый
размер без патча каждого `Text` объекта. На `PlanetScene` — `goBack()` + повторный
вход.

**Панорама cover**: `sprite.width = app.screen.width; sprite.height = sprite.width / (sprite.texture.width / sprite.texture.height)` — если высота меньше экрана,
масштабировать по высоте.

## Post-Completion

- Сгенерировать реальные панорамы через ComfyUI (план `20260606-art-assets-generation.md` Tasks 5–6) и заменить 1px заглушки
- Добавить более сложные asteroid shapes (импорт SVG или текстуры)
- Рассмотреть WebGL shader для звёздного фона вместо Canvas Graphics
