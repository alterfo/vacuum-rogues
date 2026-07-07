# Overmind Endgame Arc

The OVERMIND is an escalating, spreading endgame arc: it captures systems over time culminating in win (break the core), loss (galaxy consumed), or New Game+. Pacing targets a **2–3 in-game-year campaign** (1 year = 360 days, hard ceiling 1080 days) per `docs/plans/20260706-three-year-campaign.md` — see that plan for the full design record and the (still-open) win-rate gate.

## The spread machine

`advanceOvermind(state, galaxy, day, config)` (`src/systems/overmind/overmindSpread.ts`) is deterministic by `(galaxy.id, day, systemId)` (ranked by `hashStr`, no RNG): past `graceDays` it captures `capturesPerTick` **frontier** systems every `spreadIntervalDays`, then re-derives `dormant → advancing ⇄ contained → won|lost` from the post-capture Overmind share. Returns `captured` ids for the caller — never mutates the galaxy. The fixed `OVERMIND_SPREAD_GRACE_DAYS`/`OVERMIND_SPREAD_INTERVAL_DAYS` levers were **removed** — spread cadence is now fully adaptive (below).

## Adaptive difficulty (keyed to player power, not fixed day phases)

`playerPowerIndex` (`src/systems/campaign/playerPower.ts`) is a pure `clamp01` weighted blend of normalized hull/weapon/credits/rank (`POWER_INDEX_WEIGHTS`/`POWER_INDEX_*_MIN`/`_MAX` in `balance.ts`), read from the canonical `ShipLoadout`/`GearCatalog`. Two guards make "gentle while weak, relentless once armed" safe:

- **Ratchet**: `campaignPeakPower` never decreases (`ratchetPeakPower`), persisted as an **optional additive** field on `SaveState`/`GalaxySchema` (absent ⇒ derive from current loadout on load — no migration, no version bump). Updated every EOD tick, not just on save.
- **Baseline creep**: after `ADAPTIVE_CREEP_START_DAY` (360), the spread interval is floored at `ADAPTIVE_CREEP_MIN_DAYS` (12) regardless of power — a permanently idle run still resolves well before day 1080, so the loss gate stays measurable.

`adaptiveSpreadIntervalDays(day, dayZero, peakPower)` (`src/systems/campaign/adaptivePacing.ts`) = `lerp(ADAPTIVE_SPREAD_SLOW_DAYS=45, ADAPTIVE_SPREAD_FAST_DAYS=10, clamp01(peakPower))`, gated by `ADAPTIVE_GRACE_DAYS=90` (no spread before grace). `DayTickController.advanceOvermindArc` builds the spread config from these each tick via the **optional** `updateCampaignPeakPower` dep (absent ⇒ 0 ⇒ slowest cadence — legacy DI sites stay byte-identical).

Combat scaling revives the previously-dead `OVERMIND_COMBAT_HP_MULT`/`OVERMIND_COMBAT_DAMAGE_MULT` levers: `hostileScaling(power, mode)` (`src/systems/campaign/hostileScaling.ts`) lerps `HOSTILE_SCALING_WEAK_MULT=0.9` → `1.5` for **held-system** combat (garrisons), composed with `DIFFICULTY_HOSTILE_SCALING` for HARD. `neutralScaling(power, mode)` extends the same gentling to **neutral-system** wandering packs (`NEUTRAL_SCALING_WEAK_MULT=0.4` → `1.0`, incoming damage only — offense unscaled). `overmindGarrisonPowerBonus` shifts the spawned garrison range up by up to `OVERMIND_GARRISON_POWER_MAX_BONUS=2`. `NEUTRAL_AGGRO_POWER_THRESHOLD` (= the battle-ready threshold) gates whether wandering neutral packs chase a ship at all — a weak ship isn't hunted; garrisons and already-engaged combatants are never shielded. All wired via **optional** DI deps (absent ⇒ neutral/legacy behavior, byte-identical).

Escalation is *felt*, not silent: `activeEscalationStages` (`src/systems/campaign/escalationNotices.ts`) derives `NOTICED`/`HARDENING`/`FINAL_PUSH` bands from ratcheted power + Overmind share and fires a one-shot `CAMPAIGN_ESCALATION` news event per stage (fire-once tracker keyed by galaxy id; a loaded mid-game save seeds silently, never spams retroactive news).

**Combat is round-based with a disengage window** (`src/systems/combat/combatRounds.ts`): a round removes at most `GAME_BALANCE.combatRoundHullFraction` (0.34) of MAX hull, so hull can never drop full→zero in a single resolution step — both the live player and the headless agent get a reaction window (flee/fight) between rounds. Gated on `getCampaignPeakPower !== undefined && mode !== GOD` (GOD's hull floor already prevents the one-shot; legacy DI stays byte-identical flat combat).

## The overmind campaign quest chain

`src/systems/quests/campaignChain.ts` — a 6-step chain (distress → recon → requisition → liberation → counteroffensive → core) gated by a pure predicate over `(questLog.completedQuests, overmindShare, peakPower, arcStatus)`: strictly in order, milestone-banded (not day-banded), no new persisted state (completion reuses `QuestLog`). Offered via `GameEngine.getQuestBoard`.

## Critical invariants — do NOT revert these

- **`frontierSystems` treats the warp graph as UNDIRECTED.** ~25% of galaxy warp links are one-way (`ensureConnectivity` bridges), so a directed-only scan misses systems reachable via one-way outgoing edges — stalls the front for days.
- **Win requires GENUINE ENGAGEMENT**: `coreBroken`/`eradicated` are gated on `engaged = state.lastSpreadDay >= 0` (arc actually spread past grace). `peakThreat` is a *false* proxy: it captures the initial Overmind share (e.g. 2/30 ≈ 0.067) during the grace window — without the gate, early clearance of starting systems fired spurious ПОБЕДА. The in-flight **core-kill** win is a separate path (`handleInFlightDeath` → `showGameOutcomeScreen(true)`) and is unaffected.
- **Win also requires PLAYER participation**, not just NPC equilibrium churn: `coreBroken`/`eradicated` additionally require `(state.playerLiberations ?? 0) > 0` (optional additive field, `Galaxy.tryLiberate(id, "player")` at genuine player-driven liberation call sites). Found live: the NPC equilibrium clearing the *last* Overmind systems on its own fired a spurious win at day ~140 with a never-battle-ready player — fixed by requiring the player to have actually liberated (or core-killed) at least once.
- **The arc OWNS the front; equilibrium only churns pirates.** `DayTickController` (invoked from `GameEngine.advanceGalaxyDay()`) passes `stepOwnershipTick` a `freezeOvermind: true` when Overmind holds territory, so the equilibrium's ~25% ceiling can't cap the arc below its loss line or liberate the core spuriously.
- **The two starting OVERMIND systems must land as one warp-connected cluster.** `GalaxySimulator.generateGalaxy` picks the core (most distant from centre) and forces the second starter to be a warp-connected neighbour of it (excluding the player's home system) — an independently-chosen distant second seed grows as two disconnected blobs from day one (`frontierSystems` merges every Overmind system into one hash-ranked pool regardless of cluster), reading as the front "appearing from all sides" instead of one advancing line.

Regressions: `overmindNoSpuriousVictory.test.ts`, `overmindSpread.test.ts`, `playtest/overmindArc.test.ts`, `galaxy/overmindSpawnCoherence.test.ts`, `campaign/adaptivePacing.test.ts`, `campaign/hostileScaling.test.ts`, `campaign/escalationNotices.test.ts`, `campaign/campaignChain.test.ts`, `combat/combatRounds.test.ts`, `tryLiberateSource.test.ts`.

## Persistence

`Galaxy.overmindArc: OvermindSpreadState` persists via `GalaxySchema` (migration defaults old saves to `initialOvermindSpreadState()`). `playerLiberations` is an optional additive field on that same state (absent ⇒ 0, no migration). `campaignPeakPower` is a separate optional additive field on `SaveState` (absent ⇒ derived from loadout on load, no migration).

## Win/loss/NG+

Won/lost drives `showGameOutcomeScreen` (overlay over current scene, gated on `_outcomeShown` — not a terminal-scene transition). New-Game+ (`newGamePlus.ts`): capped credit slice + carried rank/faction + one-notch-harder difficulty (`nextCycleGameMode`: GOD→NORMAL→HARD→HARD). Tune carry in `balance.ts` (`NEW_GAME_PLUS_*`).

## ⚠️ Known-unmet gate: 99% win-rate (as of 2026-07-07)

The plan's 99%-win-rate acceptance gate (`≥ 297/300 sessions win, ≤ 1080 days, 0 deaths`) is **NOT met**: the 300-session measure (Task 19) landed at **2.0% win-rate** (6 win / 18 loss / 270 died / 6 timeout), death-dominated (90% of runs). Five rounds of escalation (neutral-system gentling, mid-combat reaction, neutral-aggro gating, near-edge flee-jump, round-based combat with a disengage window) each landed real, tested, live-player-beneficial improvements but the win-rate plateaued at ~16–24% throughout — the root bottleneck is the **arming-up path** (battle-ready reached in only ~14–16% of runs), not per-fight survivability. Full record: `docs/plans/20260706-three-year-campaign.md` Task 9/11/19 notes. This is a known, measured, open gap — not a regression to silently "fix" by loosening the gate.
