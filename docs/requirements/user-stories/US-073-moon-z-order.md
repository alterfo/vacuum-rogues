# US-073: Спутники заходят за планету (z-depth)

> Эпик: EPIC-010 (Visual & Controls Polish) · Канон: SOURCE-OF-TRUTH §3; см. US-046

## User Story
**Как** игрок  
**Хочу** видеть луны, уходящие «за» планету при вращении  
**Чтобы** система выглядела объёмно

## Статус: Planned

## Acceptance Criteria

```gherkin
Scenario: Луна перед планетой (ближняя сторона орбиты)
  Given планета с луной в SpaceFlightScene
  When moonAngle ∈ [Math.PI, 2*Math.PI) — «нижняя» полуокружность (ближе к зрителю)
  Then z-index луны > z-index планеты (луна поверх планеты)

Scenario: Луна за планетой (дальняя сторона орбиты)
  When moonAngle ∈ [0, Math.PI) — «верхняя» полуокружность (дальше от зрителя)
  Then z-index луны < z-index планеты (луна перекрыта планетой)

Scenario: Нет артефактов при переходе
  Then z-порядок меняется точно в момент пересечения оси (нет «скачка» видимости)
```

## Реализация

Два слоя в `gameLayer`:
- `backMoonsLayer` — добавляется **до** `planetsLayer`
- `frontMoonsLayer` — добавляется **после** `planetsLayer`

В `PlanetSprite.update(dt)` на каждый тик:
```typescript
const isBehind = moonAngle % (2 * Math.PI) < Math.PI;
if (isBehind) {
  backMoonsLayer.addChild(moonSprite);
} else {
  frontMoonsLayer.addChild(moonSprite);
}
```

## Затронутые файлы
- `src/presentation/SpaceFlightScene.ts` — добавить `backMoonsLayer` / `frontMoonsLayer`
- `src/presentation/PlanetSprite.ts` (или аналог) — логика рассортировки лун по слоям
