# EPIC-011: End-to-End Player Loop

> Canon: SOURCE-OF-TRUTH §1–11 (full game loop)  
> Status: **Planned**

## Goal

Ensure the game is completable from start to win without dead-ends or broken loops:
trade → equipment → quest → flight → combat → upgrade → victory.

## User Stories

| ID | Title | Priority | UX Source | Status |
|----|-------|----------|-----------|--------|
| [US-074](../user-stories/US-074-player-loop.md) | End-to-end player loop | High | — | Planned |
| [US-080](../user-stories/US-080-combat-scene-rendering.md) | Combat scene — ships, HP bars, log | **Critical** | C3, H6 | Planned |
| [US-082](../user-stories/US-082-trade-quantity-selector.md) | Trade centre quantity selector | High | H8 | Planned |

## Win Condition

```typescript
function checkWinCondition(player: Player): boolean {
  return (
    player.rank >= Rank.RANK_VETERAN &&
    player.reputation[FactionType.OUTLANDERS] > 50 &&
    player.reputation[FactionType.PROGRESSORS] > 50 &&
    player.reputation[FactionType.BASTIONS] > 50
  );
}
```

## Dependencies

- EPIC-002 (Combat): full combat in `CombatScene` — covered by US-080
- EPIC-008 (Quests): quest director, delivery workflow — covered by US-074
- EPIC-010 (Controls): playable controls — covered by US-071/072
