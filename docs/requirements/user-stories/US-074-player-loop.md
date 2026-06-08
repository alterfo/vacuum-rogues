# US-074: End-to-end player loop (start → win)

> Эпик: [EPIC-011](../epics/EPIC-011-player-loop.md) · Канон: SOURCE-OF-TRUTH §1–11

## User Story
**Как** новый игрок  
**Хочу** пройти полный цикл: старт → торговля → снаряжение → квест → полёт → победа  
**Чтобы** убедиться, что игра проходима от начала до конца

## Статус: Planned

## Полный маршрут

```
Старт → StarMapScene → SpaceFlightScene
  → Посадка → Торговля → Магазин → Принять квест → Взлёт
  → Полёт к рубежу (встреча с пиратом → бой → победа)
  → Гиперпрыжок → SpaceFlightScene целевой системы
  → Посадка → Сдать квест → Купить корпус → Взлёт
  → TextQuest (случайная встреча)
  → [WIN: ранг Ветеран + репутация 3 фракций > 50]
  → Win screen
```

## Acceptance Criteria

```gherkin
Scenario: Торговый цикл
  Given player.credits = 1000
  When player buys 'fuel' qty=10 at price=8
  Then player.credits = 920
  And cargo contains {item: 'fuel', qty: 10}
  When player sells 'fuel' qty=10 at price=12 in another system
  Then player.credits = 1040

Scenario: Квест принят и завершён
  Given quest DELIVERY accepted at planet A (reward=500, repDelta=10)
  When player lands on planet B (quest destination)
  Then quest.status = COMPLETED
  And player.credits += 500
  And player.reputation[quest.factionId] += 10

Scenario: Бой с пиратом — победа
  Given player.ship.hull.hp = 100, pirate.hull.hp = 60
  When combat resolves (player wins)
  Then pirate sprite removed
  And player receives loot
  And player.rank.points += KILL_REWARD

Scenario: Win condition
  Given player.rank >= VETERAN
  And reputation OUTLANDERS > 50, PROGRESSORS > 50, BASTIONS > 50
  When game.checkWinCondition() called
  Then returns true → transition to WIN_SCREEN
```

## Зависимости

- EPIC-002: `CombatScene` (полноценный бой)
- EPIC-008: `QuestDirector` (delivery flow)
- US-071/072: управление (играбельный полёт)
