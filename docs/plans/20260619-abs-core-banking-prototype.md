---
# АБС Prototype: Double-Entry Core Banking over a Universal Bus (in-game)

## Overview
Turn the game's ad-hoc credit economy into a faithful-but-thin **core banking system**
("АБС") to demonstrate core-banking architecture "играючи." The bank is the authoritative
**double-entry general ledger**: every credit movement in the game (trade, quest reward,
fuel, repair, bribe, loot, gear sale) is re-routed through a **typed command/event bus**
("универсальная шина") as balanced postings, and the game's systems become **consumers**
on that bus. `player.credits` becomes a read projection of the player's current-account GL
balance, so net deltas are unchanged and the existing economy stays correct. The daily
galaxy tick becomes **end-of-day (EOD)**: interest accrual, fees, statements, business-date
roll. A "Galactic Bank" UI plus a live bus/GL visualization make the architecture visible.

Scope guardrail: model **generic, public core-banking concepts** (double-entry GL, value
dates, accruals, EOD batch, ESB) — NOT Equation's proprietary internals or any confidential
material. Few products (one savings, one loan). Out of scope: treasury, multi-entity,
regulatory reporting, ISO 20022.

## Context
- **The 23 consumer sites (credit writes to migrate):** `TradeSystem` (buy/sell L328/365),
  `QuestManager` (reward L192 / fine L423), `quests/TextQuestRuntime` (L61–63),
  `equipment/sellGear` (L35), `npc/NpcSimulator` (pirate loot L1033), `PlanetScene`
  (penalty/bribe/research ×5), `CombatScene` (loot L901), `StationScene` (repair/refuel/
  bribe/hull/micromodule ×6), `EquipmentShopScene` (×2). NPC accounts: `domain/NpcShip.credits`.
- **No event bus yet:** only DI ports/adapters (`src/core/ports`, `DIContainer`, services).
  The bus is NEW, built consistent with that pattern. `RumorDirector`/`RouteScanner` show
  the systems-layer style.
- **EOD hook:** `GameEngine.advanceGalaxyDay()` (the daily tick).
- **Persistence:** `src/validation/schemas.ts` + save flow — accounts + ledger must persist.
- **Money today:** `player.credits: number`, mutated directly at the 23 sites; read widely
  (HUD, trade caps, affordability checks).

## Development Approach
- **Testing approach: TDD.** The ledger invariants and the bus are pure and must be tested
  hard (a banking core lives or dies on "the books always balance").
- **Backward compatibility is the contract:** every migrated site must preserve the exact
  net `player.credits` delta — existing economy/quest tests assert those deltas and MUST
  stay green. If any reds, STOP (do not weaken) — the projection is wrong, fix it.
- Domain stays PixiJS/DOM-free; the bus + service live in `systems/`; consumers publish,
  never poke the ledger directly (the whole point of the shina).
- One concern per task; full suite green between tasks. Phase the 23-site migration.

## Testing Strategy
- Unit: a `JournalEntry`'s postings sum to zero (reject unbalanced); account balance =
  sum of postings; bus command → correct double-entry + `BalanceChanged` event; EOD accrual
  math; loan/deposit schedules.
- Integration: a buy/sell/reward routed through the bus changes `player.credits` by the
  same delta as before AND leaves the GL balanced; a full session keeps the GL balanced
  (sum of all postings == 0 at all times).
- E2E/regression: Galactic Bank screen opens, shows accounts + a statement; a trade shows
  up as a posting.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any economy test that reds). Keep in sync.

## Implementation Steps

### Task 1: Pure double-entry ledger domain
**Files:**
- Create: src/domain/banking/Ledger.ts (`Account`, `Posting`, `JournalEntry`, `Ledger`)
- Create: src/tests/banking/ledger.test.ts

- [x] `JournalEntry` rejects unbalanced postings (Σ amount ≠ 0); `Ledger.balanceOf(account)`
      = Σ its postings; account types (CURRENT/SAVINGS/LOAN/GL_INTERNAL), value dates
- [x] seed internal GL accounts (cash, interest income, interest expense, suspense, P&L)
- [x] write tests: balanced post succeeds, unbalanced rejected, derived balances, value date
- [x] run affected tests — must pass before next task

### Task 2: Typed command/event bus + BankingService (the core)
**Files:**
- Create: src/systems/banking/bus.ts (commands `Transfer`/`PostTransaction`/`OpenAccount`/
  `AccrueInterest`/`DisburseLoan`/`RunEndOfDay`; events `TransactionPosted`/`BalanceChanged`/
  `StatementCut`), src/systems/banking/BankingService.ts
- Create: src/tests/banking/bankingService.test.ts

- [x] `BankingService` handles each command → balanced postings → publishes events; a
      `Transfer(from,to,amount)` debits one current account and credits another
- [x] write tests: each command posts correct double-entry + emits `BalanceChanged`;
      multiple subscribers receive events
- [x] run affected tests — must pass before next task

### Task 3: Economy seam — `player.credits` becomes a GL projection
**Files:**
- Modify: src/domain/Player.ts (credits read-through/projection updated by `BalanceChanged`),
  src/systems/GameEngine.ts (own the `BankingService`, open the player's current account)
- Create: src/systems/banking/economy.ts (`transfer(from,to,amount,reason)` facade)
- Create: src/tests/banking/economyProjection.test.ts

- [x] a transfer through the bus moves `player.credits` by exactly the signed delta; the
      projection stays in sync with the player current account's GL balance
- [x] write tests: projection equals GL balance after N operations; reads unaffected
- [x] run affected tests — must pass before next task

### Task 4: Migrate the 23 consumer sites onto the bus
**Files:**
- Modify: TradeSystem, QuestManager, TextQuestRuntime, equipment/sellGear, NpcSimulator,
  PlanetScene, CombatScene, StationScene, EquipmentShopScene (publish `Transfer`/
  `PostTransaction` instead of `player.credits ±= x`; counterparty = a GL/faction account)
- Create: src/tests/banking/consumerMigration.test.ts

**Migration order (blast-radius-driven — `player.credits` is CRITICAL, 23 direct writers
across 5 modules; reads stay untouched via the projection, only writes migrate). Go
safest → most coupled so each phase is gated by the green economy suite:**

- [x] **Phase A — Systems/Quests first (confidence 1.0, no UI coupling, covered by delta tests):**
      `TradeSystem.executeTrade` (L328/365), `QuestManager.grantReward` (L192) /
      `applyFailurePenalty` (L423), `quests/TextQuestRuntime.applyOutcome` (L61–63),
      `equipment/sellGear` (L35); then `npc/NpcSimulator` pirate loot (L1033, NPC account)
- [x] **Phase B — leaf scenes (single/few writes, low process membership):**
      `CombatScene` loot (L901), `EquipmentShopScene` (L479/909), `StationScene`
      (repair/refuel/bribe/hull/micromodule ×6: L638/659/706/928/1129/1304)
- [x] **Phase C — `PlanetScene` last (in 4 of 5 affected processes; mixes reads + 5 writes:
      penalty L764, bribe L789/1396, research L1502/1700)** — migrate only after the bus +
      projection are proven by A/B
- [x] every credit write goes through the bus; net `player.credits` delta unchanged at each
      site; the GL stays balanced (Σ all postings == 0)
- [x] ⚠️ existing economy/quest tests must stay green (they assert deltas) — if any reds,
      STOP: the migration changed a delta, fix rather than weaken the test
- [x] write tests: a representative buy/sell/reward/fine posts balanced and matches old delta
- [x] run affected tests + full economy suite — must pass before next task (gate between
      Phase A → B → C)

### Task 5: End-of-day batch on the daily tick
**Files:**
- Modify: src/systems/GameEngine.ts `advanceGalaxyDay` (dispatch `RunEndOfDay`),
  src/systems/banking/BankingService.ts (EOD: accrue interest, post fees, cut statements,
  roll business date)
- Create: src/tests/banking/endOfDay.test.ts

- [x] EOD accrues interest on savings/loans, posts balanced accrual entries, rolls the
      business date, emits `StatementCut`
- [x] write tests: interest math; books balanced after EOD; idempotent per business date
- [x] run affected tests — must pass before next task

### Task 6: Thin products — savings deposit + loan
**Files:**
- Create: src/systems/banking/products.ts (open savings, deposit/withdraw, daily accrual;
  disburse loan, repayment schedule)
- Create: src/tests/banking/products.test.ts

- [ ] savings: deposit credits, EOD interest capitalizes; loan: disburse to buy a hull,
      scheduled repayment + interest at EOD; all via balanced postings
- [ ] write tests: deposit grows with interest; loan amortizes; books balanced throughout
- [ ] run affected tests — must pass before next task

### Task 7: Galactic Bank UI + bus/GL visualization (the demo payoff)
**Files:**
- Create: src/presentation/BankScene.ts (accounts, statement/GL view, deposit/loan actions,
  a live "consumers on the shina → postings to the GL" panel); register the scene
- Modify: StationScene/PlanetScene to open the bank
- Create/Modify: e2e regression spec for the bank screen

- [ ] bank screen shows accounts + a balanced statement; deposit/loan work; the bus panel
      shows commands flowing from consumers → postings (readable contrast, scaled fonts)
- [ ] add e2e: open the bank, see a posting from a recent trade; screenshot it
- [ ] run affected tests + regression — must pass before next task

### Task 8: Persistence + verify acceptance criteria
**Files:**
- Modify: src/validation/schemas.ts + save flow (persist accounts + ledger; migration for
  old saves: open accounts and seed the player current account from existing `credits`)
- [ ] accounts + ledger persist and reload; old saves migrate (credits → opening balance)
- [ ] verify Overview: all credit moves flow through the bus as balanced postings; books
      always balance; EOD runs; bank UI + bus visualization work
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing economy/quest test assertions changed

## Technical Details
- **Invariant:** at every moment Σ(all postings.amount) == 0 and balanceOf(account) =
  Σ(its postings). A migrated operation = a single balanced `JournalEntry` whose net effect
  on the player current account equals the old `credits` delta; the counterparty is a GL/
  faction account (so money has a source/sink, as in a real core).
- **Projection:** `player.credits` is a cache of `ledger.balanceOf(playerCurrentAccount)`,
  refreshed on `BalanceChanged` — existing reads/tests untouched.
- **Generic only:** double-entry, value dates, accruals, EOD, ESB are public banking
  concepts; nothing here reproduces proprietary Equation design or employer-confidential detail.

## Post-Completion
**Manual verification:** play normally; open the Galactic Bank and confirm your trades/
rewards appear as balanced GL postings; deposit into savings and watch EOD interest accrue;
take a loan to buy a hull and watch it amortize; confirm the books always balance.
**Demo:** the bus panel is the teaching artifact — show colleagues a core + universal bus +
N consumers, end-to-end, built inside a game.
