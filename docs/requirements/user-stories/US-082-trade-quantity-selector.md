# US-082: Trade Centre — Quantity Selector

> Epic: [EPIC-011](../epics/EPIC-011-player-loop.md) · UX Review: H8  
> Status: **Planned**

## User Story

**As** a player  
**I want** to buy or sell multiple units of a commodity in one action  
**so that** I don't have to click 10 times to buy 10 units of fuel

## Problem

Current: all trades execute 1 unit at a time. Buying 10 Fuel requires 10 separate clicks. The hint "1 единица за нажатие" acknowledges this but does not fix it. Additionally, the sell button is always enabled even when the player holds zero units.

## Acceptance Criteria

```gherkin
Scenario: Quantity selector displayed
  Given TradeScene is open and a commodity is selected
  Then a quantity control is shown: [-] [qty] [+]
  And qty defaults to 1
  And [+] caps at min(available stock, available hold capacity, affordable amount)

Scenario: Buy qty units in one action
  Given qty = 5 and player has enough credits and hold space
  When the player clicks "Купить"
  Then player.credits decreases by price × 5
  And player.cargo gains 5 units of that commodity

Scenario: Sell button disabled at zero
  Given the player owns 0 units of the selected commodity
  Then the "Продать" button is dimmed and non-interactive

Scenario: Trade toast disappears on timer
  When a trade toast message is shown
  Then it auto-removes after 3 seconds (matching other scene toast patterns)
```

## Affected Files

- `src/presentation/TradeScene.ts` — add quantity controls, fix sell button guard, fix toast timer
- `src/systems/TradeSystem.ts` — `executeTrade(qty: number)` if not already parameterised
