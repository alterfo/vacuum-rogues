# Money System: АБС Core-Banking

All in-game credits live in a **double-entry general ledger** (`src/domain/banking/Ledger.ts`). `player.credits` is a **read projection** of the player's current-account GL balance (`cur:<playerId>`), rewritten by `bindCreditsProjection` on every `BalanceChanged` event — **not** a directly-mutated field.

## The cardinal rule

**NEVER write `player.credits ±= x` (or `npc.credits`) directly.** Move money through the bus:
- `adjustPlayerCredits(bank, player, signedDelta, counterpartyId, reason)` / `creditNpc(...)` / `transfer(...)` from `src/systems/banking/economy.ts`
- For player→NPC transfers (pirate tribute, merc hire): `payTribute(...)` / `payHire(...)`
- `player.credits` is **whole-number currency** (`PlayerSchema.credits` is `int()`). Any move onto a CURRENT account must be whole (`wholeCreditsToCurrent` in `bankSceneView.ts`).

## Where it lives

- `src/domain/banking/Ledger.ts` — ledger + snapshot (pure domain)
- `src/systems/banking/bus.ts` — typed command/event bus (`setHandler` throws on a second handler)
- `src/systems/banking/BankingService.ts` — command handler
- `src/systems/banking/economy.ts` — economy seam + GL counterparty ids
- `src/systems/banking/products.ts` — retail savings/loan products
- `src/systems/banking/loanDefault.ts` — pure loan-default state machine (penalty multiplier, default threshold, missed/serviced transitions)
- `GameEngine` owns `bankBus` + `bankingService` and exposes `.bank` (`{bus, service}`)

## EOD batch

`DayTickController.run()` (invoked by `GameEngine.advanceGalaxyDay()`) dispatches `RunEndOfDay`, which: (1) drives each loan's default machine (`processLoanDefaults`: detect overdue, seize whole credits current→loan, write off sub-credit residuals, missed → flip penalty rate, threshold misses → `defaulted`), (2) accrues interest (overdue at ×penalty rate), (3) cuts statements, (4) rolls business date. Idempotent per business date.

## Reputation on default

`BankingService` owns no reputation; when EOD trips a player loan into default it publishes a one-shot `LoanDefaulted` bus event, and `GameEngine` subscribes to apply the reputation hit (`BANK_FACTION_ID = BASTIONS`, −15, once per default crossing).

## Persistence

Ledger snapshot persists via `SaveState.banking` / `BankingSnapshotSchema`. The `loanDefaults` field is optional — old saves re-seed each outstanding loan lazily at the next EOD (no save-version bump). Old saves lacking `banking` entirely: `resetLedger()` is called first, then the player current account is re-seeded from `credits`.
