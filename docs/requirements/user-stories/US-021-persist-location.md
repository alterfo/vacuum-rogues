# US-021: Сохранение текущей локации при перезагрузке

## User Story
**Как** игрок
**Хочу** оставаться в той же сцене после перезагрузки страницы
**Чтобы** не терять контекст игры

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: Перезагрузка в планетарной системе
  Given игрок находится в SpaceFlightScene системы "Alpha"
  When игрок перезагружает страницу
  Then игра загружается в SpaceFlightScene системы "Alpha"

Scenario: Перезагрузка на звездной карте
  Given игрок находится в StarMapScene
  When игрок перезагружает страницу
  Then игра загружается в StarMapScene

Scenario: Новая игра начинается в планетарной системе
  Given игрок начинает новую игру
  When выбирает расу и нажимает "Начать"
  Then игра начинается в SpaceFlightScene (не StarMap)
```

## Technical Context
- Сохранять currentSceneType в SaveState или localStorage
- При загрузке восстанавливать сцену
- MainMenu → RaceSelection → SpaceFlightScene (не StarMap)

## Затрагиваемые файлы
- `src/systems/GameEngine.ts` - логика восстановления сцены
- `src/data/SaveManager.ts` - сохранение текущей сцены
- `src/presentation/RaceSelectionScene.ts` - переход в SpaceFlightScene
