# US-075: Качественные визуальные ассеты (туманности, солнца, планеты)

> Эпик: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · Канон: SOURCE-OF-TRUTH §3; ART_PROMPTS.md

## User Story
**Как** игрок  
**Хочу** видеть красивый космос с детализированными туманностями и уникальными планетами  
**Чтобы** погружение было сравнимо с оригинальной игрой

## Статус: Planned

## Acceptance Criteria

```gherkin
Scenario: Туманности без артефактов
  Given SpaceFlightScene открыта
  Then фон показывает ≥ 3 слоя туманности с разными цветами и alpha
  And нет прямоугольных артефактов при zoom
  And реализовано без BlurFilter (Graphics concentric rings ИЛИ GLSL shader)

Scenario: Уникальные солнца
  Then цвет/размер солнца детерминирован от system.seed
  And есть ≥ 5 визуальных типов: желтый, красный гигант, голубой, белый карлик, пульсар

Scenario: Различимые планеты
  Then планеты разных типов имеют разные визуальные стили
  And у планет с атмосферой есть halo/glow
  And планеты контрастны на фоне космоса (есть обводка или contrast ring)
```

## Подход к реализации

### Туманности (без BlurFilter)
```typescript
// Вместо BlurFilter — concentric rings с radial gradient
function drawNebula(g: Graphics, x: number, y: number, r: number, color: number, alpha: number) {
  for (let i = r; i > 0; i -= 4) {
    g.circle(x, y, i).fill({ color, alpha: alpha * (i / r) * 0.15 });
  }
}
```

### Типы солнц (по seed)
```typescript
const SUN_TYPES = [
  { color: 0xFFDD44, size: 1.0, glowColor: 0xFF8800 },  // Yellow
  { color: 0xFF4422, size: 1.6, glowColor: 0xFF2200 },  // Red Giant
  { color: 0x4488FF, size: 0.8, glowColor: 0x2244FF },  // Blue
  { color: 0xFFFFFF, size: 0.5, glowColor: 0xCCCCFF },  // White Dwarf
  { color: 0xFF00FF, size: 0.7, glowColor: 0x8800FF },  // Pulsar
] as const;
const sunType = SUN_TYPES[seed % SUN_TYPES.length];
```

### Ассеты из AI-генерации
Расширить `docs/design/ART_PROMPTS.md` промптами:
- Туманность (5 цветовых вариантов): top-down view, seamless tile, transparent background
- Планеты (8 типов): rocky, gas giant, ocean, desert, ice, jungle, volcanic, crystal
- Без брендовых или копирайтных образов

## Затронутые файлы
- `src/presentation/SpaceFlightScene.ts` — параллакс-фон (туманности)
- `src/presentation/SunSprite.ts` — типы солнц по seed
- `src/presentation/PlanetSprite.ts` — 8 типов планет
- `src/assets/space/` — новые спрайты из AI
- `docs/design/ART_PROMPTS.md` — расширенные промпты
