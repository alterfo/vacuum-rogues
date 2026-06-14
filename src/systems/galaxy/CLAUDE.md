# Galaxy System Conventions

## Galaxy Balance

Completed `20260611-overmind-equilibrium-balance`:
- `Galaxy` tracks two hostile factions separately: `overmindSystems: string[]` (loss-condition) and `pirateSystems: string[]` (difficulty/narrative). `addPirateSystem` / `addOvermindSystem` are mutually exclusive (each removes from the other list). **Never call `removeOvermindSystem`/`removePirateSystem` directly from outside `Galaxy`** — use `galaxy.tryLiberate(systemId)` which handles both types and emits the `SYSTEM_LIBERATED` news event.
- **Loss gate**: always call `galaxy.isOvermindVictory(GAME_BALANCE.OVERMIND_LOSS_GRACE_DAYS, GAME_BALANCE.OVERMIND_LOSS_MIN_SYSTEMS, galaxy.gameDays)`, never the bare `isOvermindMajority()`. The grace period and min-systems guard prevent instant-loss on small/fresh saves.
- **Self-balancing tick**: `OvermindBalance.ts` exports `stepOwnershipTick` — a pure function (no side effects, no GameEngine coupling). `GalaxyStatusIndicator.ts` exports `computeGalaxyThreat` — thresholds: safe <20%, caution 20–35%, warning 35–45% (`GAME_BALANCE.OVERMIND_WARNING_THRESHOLD`), critical ≥45%. Both modules are pure; keep them that way.
- **Hostile-system combat difficulty**: any code transitioning to `SceneType.COMBAT` from within an overmind/pirate system must set `isHostileSystem: true` in the `CombatContext`. `NpcShipManager.launchCombatWithNpc` derives this from `gameEngine.galaxy?.isHostileSystem(playerSystemId)`. `CombatScene` applies `OVERMIND_COMBAT_HP_MULT` / `OVERMIND_COMBAT_DAMAGE_MULT` when `isHostileSystem` is set.
- **`NewsEvent` type convention**: any new `NewsEvent.type` literal must also be added to `NEWS_TYPE_LABEL` and `NEWS_TYPE_COLOR` maps in `InfoCenterScene.ts`, and to the Zod enum in `schemas.ts`. Current types: `SYSTEM_LIBERATED`, `OVERMIND_EXPANSION`, `PIRATE_SURGE`, `NPC_QUEST_COMPLETE`, `PIRATE_ATTACK`, `MARKET_SHIFT` — see `src/types/index.ts` for the full union.

## DialogueSystem

**`startDialogue` deletes the previous session's timestamped key when re-indexing the NPC** — the map holds ≤ 2 entries per NPC (never grows unboundedly). Regression test: `src/tests/dialogueSystem.test.ts`.
