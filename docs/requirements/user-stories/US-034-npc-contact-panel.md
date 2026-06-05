# US-034: Панель контакта с NPC-кораблём

> Эпик: [EPIC-003](../epics/EPIC-003-living-galaxy.md) · Канон: SOURCE-OF-TRUTH §6

## User Story
**Как** игрок
**Хочу** кликнуть по чужому кораблю и взаимодействовать
**Чтобы** связаться, торговать или атаковать

## Статус: Done (действия — заглушки до Срезов 3–4)

## Acceptance Criteria

```gherkin
Scenario: Открытие панели контакта
  Given в системе есть NPC
  When я кликаю на корабль NPC
  Then открывается панель контакта
  And панель показывает имя, расу, фракцию, роль, состояние корпуса
  And доступны действия: [Связаться] [Торговать] [Атаковать] [Закрыть]
  And клик по кораблю НЕ прокладывает курс корабля игрока (stopPropagation)

Scenario: Закрытие панели
  When я нажимаю [Закрыть]
  Then панель контакта исчезает
  Given NPC покидает систему, пока панель открыта
  Then панель автоматически закрывается
```

## Technical Context
- **Panel**: `NpcContactPanel` — инфо + кнопки; текст `eventMode='none'`,
  кнопки `stopPropagation` (CLAUDE.md PixiJS Rules 2–3)
- **Scene**: `SpaceFlightScene.onNpcClick/closeNpcContactPanel`
- Действия пока логируются (мост к будущим срезам):
  - Связаться → приветствие (полноценный диалог — позже)
  - Торговать → заглушка (NPC-торговля — US-035)
  - Атаковать → заглушка (бой — US-036 / EPIC-002, Срез 4)

## Затрагиваемые файлы
- `src/presentation/NpcContactPanel.ts`
- `src/presentation/SpaceFlightScene.ts`

## Out of Scope
- Реальный диалог с корабельным NPC, NPC-торговля (US-035)
- Запуск тактического боя (US-036)
