# US-040: Масштабная система и камера-следование

> Эпик: [EPIC-004](../epics/EPIC-004-grand-system-radar-background.md) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок
**Хочу** большую звёздную систему, по которой камера следует за кораблём
**Чтобы** полёт ощущался масштабным, как в оригинале

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: Крупная система
  Given я вхожу в звёздную систему
  Then орбиты планет увеличены ×~4.5 (внешняя ~2500px, граница ~2800px)
  And система крупнее экрана; целиком видна на миникарте
  And есть видимое кольцо границы системы

Scenario: Камера следует за кораблём во время полёта
  Given мой корабль летит
  Then камера держит корабль в центре экрана
  Given корабль остановился
  Then камера не двигается сама — можно свободно панорамировать/зумить

Scenario: Зум под крупную систему
  Then минимальный зум уменьшен (0.25), чтобы отдалиться и осмотреть систему
  And масштаб миникарты пересчитан (0.03) — граница помещается в радар
```

## Technical Context (CLAUDE.md Rule 5 — синхронные изменения)
- `PlanetGenerator.ORBITAL_RADII = [600,1050,1500,1950,2500]`
- `SpaceFlightScene`: `SYSTEM_INNER/OUTER/BOUNDARY_RADIUS = 600/2500/2800`;
  спавн корабля на границе; `updateCamera`/`centerCameraOnShip` (следование во
  время движения, свободный pan/zoom на стоянке); `MIN_ZOOM = 0.25`
- `SystemMiniMap.mapScale = 0.03`
- Скорость корабля (`player.ship.speed` ~1.0 px/ms) и `DISTANCE_PER_DAY = 500`
  оставлены: кросс-системный перелёт ~2с / ~4 дня — в норме

## Затрагиваемые файлы
- `src/systems/PlanetGenerator.ts`
- `src/presentation/SpaceFlightScene.ts`
- `src/presentation/SystemMiniMap.ts`
- `e2e/space-flight-ui.spec.ts` (камера центрируется на корабле)

## Out of Scope
- Радар-доработки: рамка обзора, авто-масштаб (US-041)
- Красивый фон (US-042)
- Прыжок с края системы (US-023, см. ниже)
