# Shared Buses & Event Channels

Where one producer talks to many consumers without knowing them. The project has
exactly **one** general-purpose message bus (the banking ESB) and a handful of
narrower one-to-many channels (callbacks, projections, an append-only feed). This
doc is the inventory; the flows that ride these channels are in
[`DATA-FLOW.md`](./DATA-FLOW.md).

> **Anchors verified against `047438ef` (2026-07-31).** Symbol names are
> authoritative; line numbers drift. Cited symbols are guarded by
> `src/tests/architecture/docAnchorsExist.test.ts`.
> **🔒 test/lint · ⚙️ runtime · 📝 prose only.**

## 1. `BankBus` — the in-game АБС universal bus (the real ESB)

`src/systems/banking/bus.ts`. A **command/event** bus for all money movement. Game
systems never touch the ledger directly — they dispatch typed commands; the single
`BankingService` core handles them into balanced ledger postings and publishes
events back out.

Two deliberately **asymmetric** channels:

| Channel | Cardinality | Method | Who |
|---------|-------------|--------|-----|
| **Commands** | exactly one handler | `dispatch(cmd)` → `setHandler` | core = `BankingService` |
| Command *observers* | fan-out (watch only) | `observeCommands(fn)` | the Bank UI visualization panel |
| **Events** | fan-out | `publish(evt)` → `subscribe(fn)` | HUD, `player.credits` projection, `GameEngine` |

- ⚙️ `setHandler` throws `BANK_BUS_HANDLER_SET` if called twice — **one core per
  bus** is a runtime invariant, not just a convention.
- ⚙️ `dispatch` runs observers first (for the live panel), then the core; throws
  `BANK_BUS_NO_HANDLER` if no core is registered.

**Commands** (`BankCommand`): `Transfer`, `PostTransaction`, `OpenAccount`,
`AccrueInterest`, `DisburseLoan`, `RunEndOfDay`.
**Events** (`BankEvent`): `TransactionPosted`, `BalanceChanged`, `StatementCut`,
`LoanDefaulted`.

Wiring (`GameEngine.ts`):
- `this.bankBus = new BankBus()` (`:271`), `this.bankingService = new BankingService(this.bankBus)` (`:273`) — the service registers itself as the handler in its constructor (`BankingService.ts:97`).
- `GameEngine` subscribes to `LoanDefaulted` to apply the one-off bank-faction
  reputation sanction (`:499`) — the `BankingService` owns no reputation.
- `setupPlayerBanking()` (`:524`) binds `player.credits` as a **projection** of the
  player's current-account GL balance via `bindCreditsProjection` — a `subscribe`
  that mirrors `BalanceChanged` into the domain field. Idempotent; drops the prior
  binding (`bankProjectionUnsub`) before re-binding a freshly loaded player.
- The day tick dispatches `{ kind: "RunEndOfDay" }` once per galaxy day
  (`DayTickController.ts:122`).

**Rule:** never write `player.credits ±= x`. Go through
`adjustPlayerCredits`/`creditNpc`/`transfer` in `src/systems/banking/economy.ts`,
which dispatch onto this bus. (See `.claude/docs/systems/banking.md`.)

## 2. `player.credits` projection channel

A specialization of the bus above worth calling out on its own: `player.credits` is
**not** authoritative — it is a read-model projected from the ledger. Producer:
`BankingService` publishing `BalanceChanged`. Consumer: the projection installed by
`bindCreditsProjection` (`economy.ts:313`). Anything reading `player.credits` is
reading the tail of this channel.

## 3. `IExceptionHandler.onCriticalError` — the error channel

`src/core/ports/IExceptionHandler.ts`. A single optional callback, not a fan-out.
Producer: `GlobalExceptionHandler.handle()` invokes `onCriticalError?.(response)`
when it classifies an error as critical (`GlobalExceptionHandler.ts:26`). Consumer:
`GameEngine` sets it to `handleCriticalError` (`GameEngine.ts:491`), which drives the
`IOverlayPresenter` error modal. The `ExceptionHandlerAdapter` forwards the setter
through to the singleton so the port stays honest.

## 4. `GameEngine` single-slot callbacks — scene → engine notifications

`src/systems/GameEngine.ts`. Not a bus — a set of **single-slot** `?:(…)=>void`
fields a scene registers into and the engine invokes. One producer, one consumer
each, replaced (not appended) on registration.

| Field | Set by | Fired by | Purpose |
|-------|--------|----------|---------|
| `questExpiryCallback` (`:235`) | flight scene | day tick (`:872`) | expired-quest HUD toast |
| `questPendingReturnCallback` (`:237`) | flight scene | `QuestCompletion` | "return to claim" toast |
| `playerDeathCallback` (`:244`) | in-flight death path | `EndgameController` | game-over trigger |
| `combatStateProvider` (`setCombatStateProvider`, `:1845`) | `SpaceFlightScene` → `() => combatModule.isActive` | polled every frame in `gameLoop` → `updateMusic` | adaptive-music combat signal |

`combatStateProvider` is **pull** (polled per frame), the rest are **push**. All are
cleared to `null` on every `transitionTo` / `loadGame` so a stale scene's closure
never fires into the next scene.

## 5. Galaxy news feed — the append-only world-event stream

`src/domain/Galaxy.ts`. `newsFeed: NewsEvent[]` with `addNewsEvent(evt)` (`:277`),
trimmed to `NEWS_FEED_MAX`. Not pub/sub — a **shared append-only log** that many
producers write and the UI polls.

- **Producers:** `NpcSimulator.tick` (per-day NPC events), `GalaxySimulator.tickGlobalEvents`
  (PIRATE_SURGE / TRADE_BOOM / PLAGUE / DISCOVERY), `Galaxy.liberate` (SYSTEM_LIBERATED),
  and the Overmind arc — all pushed during the day tick (`DayTickController.run`,
  `:92`/`:101`).
- **Consumers:** hub/registry UI reads the feed; `GameEngine.infoRegistryCache` is
  invalidated each tick because the world (and thus the feed-derived registry) moved
  (`DayTickController.ts:113`).

## 6. Day-tick fan-out — the once-per-day orchestration point

`src/systems/DayTickController.ts`. Not a bus, but the single place a galaxy-day
advance fans out to every subsystem in a **fixed, dependency-ordered** sequence.
Because several steps read what the previous one wrote, the order is a contract, not
an implementation detail. See [`DATA-FLOW.md § Day tick`](./DATA-FLOW.md#day-tick-order).

## 7. `EscalationNoticeTracker` — fire-once campaign notices

`src/systems/campaign/escalationNotices.ts`. A `Set`-backed **fire-once** tracker
(not a channel you subscribe to): each escalation stage (`NOTICED` / `HARDENING` /
`FINAL_PUSH`) emits its notice exactly once per run. In-memory only, keyed by galaxy
id, so a new game resets it and a mid-game load seeds silently (no retroactive
spam). Driven from `DayTickController.emitEscalationNotices` (`:110`).

## What is *not* a bus

For contrast, so you don't go looking for a channel that isn't there:
- **Scene ↔ engine** is direct method calls (`transitionTo`), not events.
- **NPC / galaxy simulation** is pull-based ticking (`.tick(...)` returns events the
  caller appends to the feed), not push subscriptions.
- **Audio** crossfades are keyed off polled game state, not published events.
- **DI resolution** (`DIContainer`) is a registry lookup, not a message channel.
