# Quest and Hub Polish Pass

## Overview

The 2026-07-25 jaded-player critical sweep (`docs/playtests/20260725-jaded-player-critical-sweep.md`,
169 findings across all 20 `QuestScript`s + 7 planet/station hub scenes) diagnosed the "game feels
boring / doesn't reach Space Rangers' bar" complaint as two compounding problems:

1. **Quest content is a static choice tree with no variance.** SOURCE-OF-TRUTH §8 named a generative
   ONNX narrator as the differentiator; that layer was removed (pure-TS `FallbackEngine` only). The 20
   scripts under `src/systems/quests/scripts/` now show one recurring pattern each: a dominant
   risk-free choice, endings blind to the path taken, silent random rolls with zero narrative payoff,
   and fictional rewards that don't match the real payout.
2. **The hub UI doesn't surface data the domain already has**, and swallows feedback on the most
   common interaction loops (buying gear, upgrading, repairing). The living-galaxy simulation is not
   the gap — the hub screen is.

This plan fixes both, plus one findings-adjacent UX bug the user spotted independently: quest screens
(especially `auction.ts`'s 8-lot auto-execute chain) render full text instantly and auto-advance on an
800 ms timer, so fast chains flash by unread.

**Explicit scope note:** the user chose to roll the quest-content pass out to **all 20 scripts in this
plan**, not a pilot subset — accepted with eyes open that this is the largest and highest-risk part of
the plan. Tasks are ordered so smaller, independent fixes land first and the quest-content rollout
(which shares a common primitive) comes after that primitive exists.

## Context (from discovery)

- Full backlog + citations: `docs/playtests/20260725-jaded-player-critical-sweep.md` — **read the
  relevant section before starting each task below**; this plan intentionally doesn't repeat every
  file:line citation to stay maintainable, and code may have shifted slightly since 2026-07-25.
- Quest engine: `src/systems/quests/QuestScript.ts` (types), `src/systems/quests/QuestVM.ts` (seeded
  interpreter — `SeededRNG`, `params`, `effects` mini-language: `name op= value`, `name = random(min,max)`,
  `critMin`/`critMax` auto-redirect), `src/presentation/TextQuestScene.ts` (rendering + input),
  `src/systems/quests/scripts/README.md` (authoring conventions, "prose quality bar").
- Quest structural-invariant tests already exist and must keep passing/extending, not weakening:
  `src/tests/quests/newQuestScripts.test.ts`, `src/tests/quests/questScriptGraph.test.ts` (reachability,
  placeholder-resolves-to-param, effect-targets-declared-param, meter-bounds, terminal invariants).
- Hub scenes: `src/presentation/StationScene.ts`, `PlanetScene.ts`, `PlanetInfoPanel.ts`,
  `EquipmentShopScene.ts`, `BankScene.ts`/`bankSceneView.ts`, `ui/HangarPanel.ts`.
- Accessibility seam to reuse for any new animation: `ui/reducedMotion.ts` (`isReducedMotionSet`) —
  gate the typewriter effect on it, per the project's existing convention (palette/reduced-motion/keymap
  seams, see `src/presentation/CLAUDE.md`).
- `text` on `QuestLocation` (`QuestScript.ts`) is currently a single `string` — the variance primitive
  (Task 14) extends this to `string | string[]`. **Numeric variance (thresholds/rewards) already has an
  engine primitive** — `random(min,max)` effects and `initial: "random"` params — most per-quest
  rebalance work should use what already exists rather than inventing new engine mechanics.

## Development Approach

- **Testing approach**: TDD — write the failing test first, then code to green, for every task.
- Complete each task fully (including its tests, green) before moving to the next.
- **CRITICAL**: never modify, weaken, or delete an existing test assertion. The structural-invariant
  tests and the per-quest branch tests in `newQuestScripts.test.ts`/`questScriptGraph.test.ts` are
  known-good — extend them (new `it(...)` blocks, new assertions inside existing loops over scripts)
  rather than touching what's there. If a content change makes an existing assertion fail, that's a
  signal to re-check the change, not to loosen the assertion — stop and flag it (⚠️) rather than editing
  the test.
- Catalog-only changes (quest script content, `text` field shape) need **no save migration** per
  `src/systems/quests/scripts/README.md` and root `CLAUDE.md`'s catalog-change rule — confirm this stays
  true (no new *persisted* runtime field is introduced) before implementing Task 14.
- Run `npm test -- --run` after every task; run `npm run lint` and `npm run test:e2e:regression` before
  the final acceptance task.

## Testing Strategy

- **Unit tests** (`src/tests/quests/**`, Vitest): `QuestVM`/`QuestScript` logic is pure — test it
  directly, no PixiJS mocking needed. Extend `newQuestScripts.test.ts`/`questScriptGraph.test.ts` loops
  rather than writing one-off per-quest files, to keep the structural-invariant coverage uniform.
- **Presentation unit tests** (`src/tests/presentation/**`): `TextQuestScene` seed-restart fix and
  typewriter reveal are scene-wiring concerns — follow the project's existing `TextQuestScene` test
  pattern (mocked PixiJS) if one exists, otherwise the real-engine playtest tier per root CLAUDE.md's
  bug-fixing tiers (this is wiring, not pure logic).
- **E2E** (`e2e/playtest-regression.spec.ts`): add/extend a regression case for the typewriter reveal
  (visual/interaction bug — text-tier tests aren't sufficient evidence per root CLAUDE.md) and for the
  landing-button-denied-but-clickable fix (Task 11).
- **Save-compat gate**: `npm run test:save-compat` — should be a no-op for this plan (no persisted-field
  changes), but run it once after Task 14 to confirm the assumption holds.

## Progress Tracking

- Mark completed items `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix; document blockers with ⚠️.
- Update this plan if scope changes during implementation (expected for the 20 per-quest tasks — each
  quest's actual defect mix may differ slightly from the backlog snapshot).

## What Goes Where

- Implementation Steps below (`[ ]`) are all automatable by the agent.
- Post-Completion (no checkboxes) covers manual/visual verification only.

---

## Implementation Steps

### Task 1: Fix TextQuestScene restart seed-reuse exploit
- [x] `src/presentation/TextQuestScene.ts`: on restart (`~line 270`, the button built around `~line 258`),
      derive a fresh seed instead of reusing `this.vmSeed` verbatim (e.g. mix in an attempt counter:
      `` `${this.vmSeed}:${++this.restartAttempt}` ``) so a failed run does not replay with full
      foreknowledge of every random outcome. Done: added pure `deriveRestartSeed(base, attempt)` helper
      + `restartAttempt` counter; extracted the button handler into `restartVm()` which increments the
      counter and reseeds. Attempt 0 returns the base seed unchanged so the first run is unaffected.
- [x] Confirm/decide: should failing a text quest also carry a small mechanical cost (reputation or
      partial reward forfeiture) so retry isn't entirely free? ➕ Deferred — out of scope for this
      seed-exploit fix. The fresh-seed change already removes the *foreknowledge* exploit (the actual
      bug); adding a mechanical failure cost is a separate balance decision that would touch
      `handleVmFinished`'s failure branch and player reputation/credits (a persisted-state effect), and
      should be scoped/measured on its own rather than bundled into a UX bug fix. Tracked here as a ➕
      follow-up.
- [x] write a unit test asserting two consecutive `QuestVM` instances built via the restart path with
      the same base seed produce **different** `random(...)`/`initial: "random"` rolls
      (`src/tests/presentation/textQuestRestartSeed.test.ts`)
- [x] write a test asserting the original single-seed behavior is otherwise unaffected (same base seed,
      same attempt number ⇒ deterministic, for reproducibility/debugging)
- [x] run tests — must pass before Task 2 (full suite: 5953 passed / 13 skipped; tsc + lint green)

### Task 2: Progressive (typewriter) text reveal for quest narration
- [x] `src/presentation/TextQuestScene.ts`: `renderVmLocation` sets the narration instantly — replaced
      with an `update(dt)`-driven character-by-character reveal (`startReveal`/`update`/`finishReveal`,
      `REVEAL_MS_PER_CHAR = 16` capped at `REVEAL_MAX_MS = 2200`). Manual-choice nodes render their
      buttons immediately while the text types out; the description panel above is the skip zone.
- [x] Gate on `isReducedMotionSet()` (`ui/reducedMotion.ts`) — `startReveal` snaps to full text and runs
      its continuation synchronously under reduced motion (or empty text), matching the accessibility
      convention.
- [x] Click-to-complete affordance: a transparent `skipCatcher` `Graphics` over the description panel
      calls `completeReveal()` on `pointerdown` while `revealing`, snapping to full text.
- [x] The auto-execute chain no longer flashes past unread. Design: `scheduleAutoExecute` arms an 800 ms
      **minimum-beat** timer; in a live render loop (`revealing && revealElapsed > 0`) the timer callback
      **defers** the real advance to `onAutoRevealDone` (fired when the reveal finishes/skips), so long
      routing text is fully readable. In a headless/no-`update` context (`revealElapsed === 0`) it
      advances at 800 ms exactly as before — this preserves the existing `customsExit.test.ts`
      fake-timer regression (which drives the VM with no `update()` loop) rather than weakening it.
      `handleVmFinished` stays synchronous (ending prose reveals cosmetically; toast/return timing
      unchanged).
- [x] test for the reveal timing/skip behavior + auto-execute deferral (`textQuestReveal.test.ts`:
      types-over-ticks, click-to-skip, deferred-advance-while-typing, skip-advances-at-beat,
      headless-advances-at-beat)
- [x] test confirming reduced-motion shows full text with no delay (`textQuestReveal.test.ts`)
- [x] e2e regression case in `playtest-regression.spec.ts` (auction start lot: progressive partial
      reveal, no synchronous flash-advance while typing, full text on skip)
- [x] run tests — full unit suite 5972 passed / 0 failed; `tsc --noEmit` clean; `eslint src` 0 errors

### Task 3: Quick text/content fixes across quest scripts
- [x] `cargo-sort.ts` (~lines 81,88,96): "Дог" → "Док". Done: renamed the three dock params
      (`dock1/2/3_load`) to «Док N (ч)» and fixed the header-comment «дог» → «док».
- [x] `signal-decode.ts` (~line 74): "коротая" → "короткая"; (~lines 85-86): "Влобовой" → "Лобовой"/"В лобовую".
      Done: «короткая пачка импульсов» and «Лобовой перебор ключей».
- [x] ⚠️ `tribunal.ts` (~lines 206-213, 230-234): fix the credit-sign bug on the best ending (text says
      "you pay a fine, teeth gritted" but credits currently go **up** +500 — should be `credits -=`
      like every other quest's fine pattern). **DEFERRED — blocked by a known-good test.**
      `src/tests/quests/batch2QuestScripts.test.ts:223` asserts `expect(vm.getParam("credits")).toBe(500)`
      on exactly the lenient (fine) path — i.e. it locks in the buggy +500. Correcting the effect to
      `credits -= 500` reds that existing assertion. Per this plan's Development Approach ("if a content
      change makes an existing assertion fail… stop and flag it (⚠️) rather than editing the test") and
      the standing no-touch-existing-tests rule, this sign fix + its test update need the user's explicit
      go-ahead and are left for a follow-up rather than bundled here. All other Task 3 fixes landed.
- [x] `gravity-slalom.ts` (~line 284): remove the disapproving head-shake gesture from a line that's
      otherwise direct praise (tonal mismatch). Done: «качает головой» → «одобрительно кивает».
- [x] `reactor.ts` (~lines 145,152,165,172,186,193,207,214) and `derelict-salvage.ts` (~lines 140,148):
      remove literal `label: "..."` placeholder strings reaching the data (dead code today, but a
      regression risk if the renderer's fallback ever changes). Done: all `autoExecute` transitions in
      both files got short in-fiction labels instead of `"..."` (reactor: «Датчик X: в допуске/вне
      нормы»; derelict: «Груз повреждён прожигом»/«Груз цел»/«Сканеры находят образец»/«Досмотр чист»/
      «Контейнер не выдержал»/«Сделка закрыта»). Bumped their `cyrillicBaseline.json` entries (reactor
      15→23, derelict 32→38) — the sanctioned regenerate step for intentional new catalog literals.
- [x] `reactor.ts` (~line 3 vs 63,225,231): the file's header comment says "freighter," the in-game text
      says "station" — align comment and text, and give the location a name. Done: comment now reads
      "the stranded Maelon station «Горнило»" and `init_reactor` names the station «Горнило».
- [x] write/extend a test asserting these exact strings no longer appear in the affected scripts (simple
      string-absence assertions in `newQuestScripts.test.ts` or a small dedicated typo-regression test).
      Done: new `src/tests/quests/questTextFixes.test.ts` (string-absence + placeholder-label guards).
- [x] run tests — must pass before Task 4. Done: full unit suite 5964 passed / 13 skipped; `tsc --noEmit`
      clean; `eslint src` 0 errors; i18n ratchet green.

### Task 4: EquipmentShopScene cosmetic/feedback fixes
- [x] `sellHoldItem()` (`~line 1166`): plays the `"buy"` SFX on a sell — switch to the existing `"sell"`
      `SfxKey`. Done: now `playSfx("sell")`.
- [x] `buyHull()` (`~lines 596-630`): plays no SFX at all on the largest transaction in the game — add
      the purchase SFX. Done: added `playSfx("buy")` right before `this.rebuild()`.
- [x] Currency formatting inconsistency (`~lines 320-321` vs `531-545, 836-837, 1042`): pick one
      convention (space before ₡ or not) and apply it uniformly in this scene. Done: **no-space** is now
      uniform — the gear-row price format (`"200₡"`) is locked by `equipmentShopFontScaleLayout.test.ts`,
      so the three header credit-readouts were switched from `" ₡"` to `"₡"` to match every row-price /
      «Мало₡» label already in the scene (space-before would have red'd the locked test).
- [x] Weapons never get the "→ replaces X" stat comparison that other gear categories show
      (`installedOfSameClass()` ~lines 674-694) — extend it to weapons. Done: extracted pure exported
      `installedSameClass(installedIds, gear)` (matches weapons by `weaponClass`, equipment by
      `equipmentClass`) + `gearComparisonSuffix(gear, replacing)` (weapons compare by `damage`, engines
      by tech level, other gear by potency); `installedOfSameClass` now delegates and returns `Gear`.
- [x] write tests for the SFX key selection on buy vs sell (unit test on the scene's sound-selection
      logic, not a full render test). Done: `equipmentShopSfxAndCompare.test.ts` asserts sell→"sell",
      gear-buy→"buy", hull-buy→"buy".
- [x] write a test for the weapon comparison text now appearing. Done: same file — pure-helper tests plus
      a render test asserting a weapon row shows «vs <installed weapon>».
- [x] run tests — must pass before Task 5. Done: full unit suite 5970 passed / 13 skipped; `tsc --noEmit`
      clean; `eslint` 0 errors.

### Task 5: BankScene / PlanetInfoPanel cosmetic fixes
- [x] ⚠️ `bankSceneView.ts` (~line 144): translate the leftover English "Transfer" bus-log label to
      Russian (the only untranslated command type of six). **DEFERRED — blocked by a known-good test.**
      `src/tests/banking/bankSceneView.test.ts:195` asserts `describeCommand({kind:"Transfer",…})` ⇒
      exactly `"Transfer 250 ₡ — Продажа товара"` — i.e. it locks in the English label. Translating it
      (e.g. `Transfer` → `Перевод`) reds that existing assertion. Per this plan's Development Approach
      ("if a content change makes an existing assertion fail… stop and flag it (⚠️) rather than editing
      the test") and the standing no-touch-existing-tests rule, this label change + its test update need
      the user's explicit go-ahead — left for a follow-up (mirrors Task 3's tribunal sign-bug deferral).
      All other Task 5 fixes landed.
- [x] `BankScene.ts` (~lines 646, 660-663, 674, 681, 700-703): fix contradictory toast colors — "credit
      denied" and "credit granted" currently share a color, and "no debt to repay" shares a color with
      an unrelated action's "withdrawal succeeded". Done: added exported semantic `BANK_TOAST`
      (`success`/`info`/`warn`/`error`) in `bankSceneView.ts`; every `showToast` call site now maps to
      one — granted→`success`, denied→`warn`, no-debt-repay→`info`, withdraw/deposit/repay→`success`,
      insufficient-funds→`error` — so the two contradictory pairs are now distinct hues.
- [x] `BankScene.ts` (~lines 725-751): migrate `showToast` to the shared `scaledText` helper (currently
      the only text in the scene ignoring the S/M/L font-scale setting). Done: `showToast` now builds the
      toast via `scaledText(text, 15, color, { fontWeight:"bold", align:"center", rawColor:true })` —
      `rawColor` keeps the semantic `BANK_TOAST` hue exact (the salmon error tone sits under the
      readability floor). Removed the now-unused `Text` import.
- [x] `PlanetInfoPanel.ts` (~lines 60-63): fix the empty/unset `ownerFaction` fallback — it currently
      renders as "Окраинники" instead of the project's established "Независимая" via
      `factionDisplayLabel`. Done: fallback is now `factionDisplayLabel(this.ownerFaction ??
      Faction.INDEPENDENT)` → "Независимая"; removed the hardcoded "Окраинники" literal (Cyrillic
      ratchet regenerated 13→12).
- [x] write tests for the corrected toast colors (or a color-distinctness assertion) and translated
      label. Done: `bankSceneView.test.ts` adds a `BANK_TOAST` distinctness + must-differ-pairs block;
      new `bankSceneToast.test.ts` drives the real `BankScene` actions (granted vs denied, no-debt-repay
      vs withdraw-success) and pins each call site's colour. (Translated-label test deferred with the ⚠️
      item above.)
- [x] write a test for the faction fallback label. Done: new `planetInfoPanelFaction.test.ts` asserts the
      unset/`INDEPENDENT` owner renders "Независимая" (not "Окраинники") and a known owner still resolves.
- [x] run tests — must pass before Task 6. Done: full unit suite green (Cyrillic baseline regenerated for
      the intentional literal removal); `tsc --noEmit` clean; `npm run lint` exit 0.

### Task 6: Fix misleading launch-denial message
- [x] `StationScene.ts` (~lines 856-868) and `PlanetScene.ts` (~lines 1912-1913): the launch-denied
      message always blames "no engine installed," even when the real cause is an empty fuel tank —
      both scenes duplicate this bug, fix once and mirror the fix in both. Done: new pure
      `launchDenialReason(stats)` (`src/systems/equipment/launchDenial.ts`) recovers the real cause from
      the already-exposed derived fields — `speed === 0` ⟺ no engine, `fuelCapacity === 0` ⟺ no fuel tank
      (both exact by construction in `derivedStats`) — so no `DerivedStats` interface change / no
      migration. `StationScene.undock` and `PlanetScene.takeOff` now branch on it: engine →
      «Нет двигателя — …», fuel → «Нет топливного бака — …» (keeping each scene's own verb, отстыковка /
      взлёт). Cyrillic ratchet regenerated (+1 literal each: PlanetScene 73→74, StationScene 61→62).
- [x] write a test asserting the correct denial reason is reported for each of the actual failure causes
      (no engine vs no fuel tank) in both scenes. Done: `launchDenialReason.test.ts` — pins the pure
      resolver (null / engine / fuel / both-missing→engine) and drives real `PlanetScene.takeOff` /
      `StationScene.undock` for each cause, asserting the message names двигатель vs топливный бак and
      that launch is blocked (no `transitionTo`).
- [x] run tests — must pass before Task 7. Done: full unit suite 5998 passed / 0 failed; `tsc --noEmit`
      clean; new files lint clean. (Repo-wide `npm run lint` fails identically on HEAD — a pre-existing
      `no-explicit-any` backlog in test files, unrelated to this change.)

### Task 7: Wire up silent purchase/upgrade toast feedback
- [x] `StationScene.ts`: `renderShop()`, `renderMicromoduleShop()`, `renderResearch()` never called
      `addToastSlot()` — `this.toast` stayed `null` outside `renderMain()`, so buying a micromodule gave
      zero feedback. Done: `renderShop`/`renderMicromoduleShop` now mount a toast slot after their back
      button; `renderResearch` passes an `addToastSlot` callback to `ResearchUpgradePanel` (new 4th ctor
      param, mirroring the `HangarPanel` `addToastSlot` contract — the panel re-mounts the slot at the
      end of every self-render so a post-upgrade toast survives the re-render). Reordered the gear-buy
      (`buyItem`) and micromodule-buy handlers, and the panel's `doUpgrade`, to re-render FIRST then
      `showToast` — a message set before the re-render is wiped by it and never paints.
- [x] `EquipmentShopScene.ts`: the СНАРЯЖЕНИЕ and КОРПУС tabs didn't call `addToastSlot` (only
      `renderHangar()` did). Done: `render()`'s gear/hull path now mounts a toast slot; `buyItem`
      (gear) and `sellHoldItem` show «Куплено»/«Продано» after their in-place partial re-render (which
      leaves the render()-mounted slot intact), and `buyHull` shows «Установлен корпус» after `rebuild()`
      (reordered, since rebuild wipes the container). Cyrillic ratchet regenerated (EquipmentShopScene
      34→38 for the 4 new literals).
- [x] write tests asserting a toast is queued after a purchase/sale/upgrade action on each of the
      newly-wired tabs. Done: `src/tests/presentation/shopToastFeedback.test.ts` drives the real scenes
      (fake-pixi) and asserts a live toast (`this.toast` non-null, alpha 1, message) after: station
      gear-buy, station micromodule-buy (via rendered button handler), station research-upgrade, and
      equipment-shop gear-buy / gear-sell / hull-buy.
- [x] run tests — must pass before Task 8. Done: new suite 6 passed; full unit suite 5991 passed / 13
      skipped / 0 failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.

### Task 8: Add missing SFX in HangarPanel
- [x] `ui/HangarPanel.ts` currently has **zero** sound effects anywhere (repair, sell, install, jettison,
      loadout presets) — add appropriate existing `SfxKey`s to each action. Done: added an optional
      `playSfx?(key: SfxKey)` seam to `HangarPanelContext` (wired from both `StationScene` and
      `EquipmentShopScene` → `gameEngine.audio.playSfx`, no-op in headless tests) + a private `sfx(key)`
      helper. Actions now fire: sell → `"sell"`, repair (paid service) → `"buy"`, install →
      `"ui_click"`, jettison-confirm → `"ui_click"`, preset save/apply/clear → `"ui_click"`, and the
      drag-drop micromodule apply → `"ui_click"`.
- [x] Also fix (`renderFilledSlot`): `GearBridge.gearMicromoduleCategory` produces a misleading
      "[нет микромодулей]" label for gear that structurally can never take a micromodule — dead today,
      but a trap for a future `GearKind`; correct the label logic. Done: extracted a pure exported
      `micromoduleSlotControl(mmCategory, hasMatchingMm)` returning `{label, actionable}` with three
      distinct states — non-fittable (`mmCategory === null`) → «[микромодуль не ставится]» (NOT the
      "you own none" label), fittable-but-none-owned → «[нет микромодулей]», compatible-on-hand →
      «[установить микромодуль]». `renderFilledSlot` now delegates to it. Cyrillic ratchet regenerated
      (HangarPanel 65→66 for the one new literal).
- [x] write tests asserting the correct SFX key fires for each hangar action. Done:
      `hangarPanelSfxAndLabel.test.ts` drives the real panel (fake-pixi) and asserts sell→"sell",
      install→"ui_click", repair→"buy" (and NOT fired when unaffordable), jettison-confirm→"ui_click",
      and preset save/apply/clear→"ui_click".
- [x] write a test for the corrected micromodule-category label. Done: same file — pure-helper tests
      for all three states (plus render tests that a fitted weapon shows «нет микромодулей» with none
      owned and the actionable install label once a compatible module is owned).
- [x] run tests — must pass before Task 9. Done: new suite green; full unit suite 6017 passed / 0
      failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.

### Task 9: Surface population/economy/politics/attitude in PlanetInfoPanel
- [x] `PlanetInfoPanel.ts` (~lines 52-72) / `PlanetScene.ts` `addInfoPanel()` (~1396-1497): the domain
      already has population, economy type, political system, and player attitude (customs logic already
      reads `politicalSystem`) — SOURCE-OF-TRUTH §11.1 requires showing all four on the info panel and
      none currently render. Add them. Done: new shared pure module `src/presentation/ui/planetProfile.ts`
      (`ECONOMY_RU`/`POLITICAL_RU` labels, `deterministicPopulation`/`resolvePopulation`/`formatPopulation`)
      — the single source `GovernmentScene` was refactored onto (deleting its private copies) and both info
      surfaces now consume. `PlanetInfoPanel` gained «Население/Экономика/Строй/Отношение» lines (economy/
      politics/reputation threaded in through 3 new optional ctor params, wired from `PlanetManager` off the
      current `StarSystem` + `player.getReputation`); `PlanetScene.addInfoPanel` gained a compact
      «Население · Экономика · Строй» line (attitude was already its Отношение line) with `statY` bumped
      +20 to make room.
- [x] While touching this file: migrate to `scaledText` (currently ignores font-scale setting, per
      `src/presentation/CLAUDE.md`'s migration list) and add `wordWrap` to the planet-name label
      (currently can overflow its fixed 220px panel). Done: every `PlanetInfoPanel` line now builds via
      `scaledText`; the title uses `wordWrap`/`breakWords` at `PANEL_WIDTH - 20`, and the background rect is
      sized to the (now taller, habitable-vs-drone-variable) content stack instead of a fixed 200px.
- [x] write a test asserting the panel renders population/economy/politicalSystem/attitude text for a
      representative planet fixture. Done: `src/tests/presentation/planetInfoPanelProfile.test.ts` (fake-pixi,
      mirrors the existing faction test) — asserts the four lines render, live-population override
      (`2.4 млн`), graceful «—» fallback for unknown economy/politics, and that drone planets omit the
      social lines.
- [x] run tests — must pass before Task 10. Done: full unit suite 6008 passed / 13 skipped / 0 failed;
      `tsc --noEmit` clean; `eslint` on changed files 0 issues (repo-wide `npm run lint` fails identically on
      HEAD — pre-existing `no-explicit-any` test-file backlog, unrelated); Cyrillic ratchet regenerated for
      the intentional new UI labels (PlanetInfoPanel 15→16, PlanetScene 74→75, new planetProfile 10;
      GovernmentScene 36→28 as its literals moved to the shared module).

### Task 10: Robot-assistant voice at repair/refuel/diagnostic
- [x] SOURCE-OF-TRUTH §11.4: hangar interactions should show a "System check: … Ship ready for launch"
      style robot-assistant voice — currently `StationScene.doRepair()`/`doRefuel()` (~741-793) and
      `HangarPanel.renderServiceCenter` (~1728-1807) are silent mechanical toasts only. Add short
      Russian robot-voice lines for repair, refuel, and hull-diagnostic actions. Done: new pure module
      `src/systems/equipment/serviceVoice.ts` (`repairVoiceLine`/`refuelVoiceLine`/`diagnosticVoiceLine`,
      shared «⚙ Сервис-бот» speaker tag, each keeping the real ₡ cost inside the bot framing). Wired:
      `StationScene.doRepair`/`doRefuel` now speak the repair/refuel lines, and the hangar СЕРВИСНЫЙ
      ЦЕНТР repair button speaks the diagnostic line. Also fixed a latent order bug — `doRepair`/`doRefuel`
      set the toast BEFORE `render()`, which nulls+remounts the slot and wiped the message; reordered to
      render-first (mirrors Task 7's fix) so the voice line actually paints. Cyrillic ratchet regenerated
      (StationScene 62→60 and HangarPanel 66→65 as their inline toast literals moved into the shared
      module; serviceVoice.ts +4).
- [x] write tests asserting the new voice-line text appears on each of the three actions. Done:
      `src/tests/presentation/serviceVoice.test.ts` — pure-builder assertions plus real-scene drives:
      `StationScene.doRepair`/`doRefuel` (voice line lands on a live toast, alpha 1, survives the
      re-render) and the real `HangarPanel` service-center repair button (`showToast` called with the
      diagnostic line).
- [x] run tests — must pass before Task 11. Done: new suite 7 passed; full unit suite 6028 passed / 0
      failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.

### Task 11: Fix landing-denied button still clickable
- [x] `PlanetInfoPanel.ts` (~82-99) computes `landingDenial()` for the hover tooltip but the click
      handler doesn't re-check it — clicking "Приземлиться" when landing should be denied still burns a
      game day (`PlanetManager.ts` ~509-566, `SpaceFlightScene.ts` ~937-946). Re-check the denial
      condition in the click handler and block/no-op when denied. Done: code had drifted — the landing
      gate now lives in `PlanetManager.landingDenial` and `SpaceFlightScene.onLandOnPlanet` already
      blocks the *transition*, but the panel's «Приземлиться» button was still green/clickable and fell
      through to that downstream gate (message + `endTurn()`). Fix moved to the click surface itself:
      `PlanetInfoPanel` gained a trailing optional `landingDenialText?` ctor param — `PlanetManager.
      handlePlanetClick` resolves it once via the same `landingDenial(planet)` + shared
      `landingDenialMessage`, so a denied planet renders the button inert (dimmed grey, `cursor:default`,
      no hover) with a red reason line, and its `pointerdown` `stopPropagation()`s then no-ops instead of
      invoking `onLand`. Also hardened `landingDenial` to guard the per-system `isOvermindSystem`/
      `isPirateSystem` lookups by method presence (a partial unit-harness galaxy = "context unavailable",
      falls through to `planet.capturedBy` per the method's own doc — no crash). No new Cyrillic literal
      (reason text comes from `t()` via `landingDenialMessage`), so the ratchet stays green.
- [x] write a unit test asserting a click on a denied landing does not advance the game day / does not
      attempt the landing. Done: `src/tests/presentation/planetInfoPanelLandingDenied.test.ts` (fake-pixi
      records each node's handlers) — a real `pointerdown` on the land button invokes `onLand` when
      allowed and NO-OPs when denied (so no downstream land attempt / turn-end / wasted day), plus the
      reason line + non-interactive-cursor assertions.
- [x] add/extend an e2e regression case for this (visual/interaction bug, per root CLAUDE.md's tiering).
      Done: `playtest-regression.spec.ts` — forces the current system into Overmind capture, parks the
      ship on the first planet, opens the info panel, then fires a **real pointer** click at the land
      button's live global bounds and asserts the scene stays `SpaceFlightScene` (no PLANET transition)
      and `galaxy.gameDays` is unchanged.
- [x] run tests — must pass before Task 12. Done: `tsc --noEmit` (incl. e2e) clean; `eslint` on changed
      files 0 issues; full unit suite green (the lone `sessionCompetence` battle-ready milestone is a
      known stochastic campaign gate, unrelated to this presentation change — passed on rerun); the new
      e2e case passes under Playwright.

### Task 12: Remove dead "ЗАХВАЧЕНА" banner code path
- [x] `PlanetScene.ts` (~1087-1109 vs ~1365-1367): the captured-system banner read `planet.capturedBy`,
      which by the file's own comment is never written in production, so it never fired. Done: new shared
      pure resolver `capturedSystemOccupierName(galaxy, systemId)` in `src/utils/planetTooltip.ts` keys
      off the per-system galaxy capture state (`isOvermindSystem`/`isPirateSystem`, method-presence
      guarded for partial unit-harness galaxies) and returns the occupier name (Овермайнд / Пираты) or
      `null`. `createUI`'s banner now branches on that resolver against the current `system.id` instead of
      `planet.capturedBy`, reusing the same occupier names the hover tooltip shows so the two never
      disagree. No new Cyrillic literal (the `⚠ ЗАХВАЧЕНА:` prefix is unchanged; the occupier names are
      grandfathered in `planetTooltip.ts`), so the ratchet stays green.
- [x] write a test asserting the banner shows for a hostile/pirate-controlled system and not otherwise.
      Done: extended `src/tests/planetTooltip.test.ts` with a `capturedSystemOccupierName` block —
      Overmind-held → Овермайнд, pirate-held → Пираты, uncaptured → null, both-held → Overmind wins, and
      missing galaxy / systemId / capture-API → null (no crash).
- [x] run tests — must pass before Task 13. Done: `planetTooltip.test.ts` 22 passed; full unit suite
      6038 passed / 0 failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.

### Task 13: Hide/restyle the BankScene debug bus panel
- [x] `BankScene.ts` (~80-81, 436-465): the "ШИНА: команды → проводки" panel is, by its own code
      comment, a demo/debug artifact taking up half the screen. Either gate it behind `__DEBUG__` or
      restyle it as in-fiction bank-clerk log lines — pick one (recommend `__DEBUG__`-gating as the
      smaller, lower-risk change; note the alternative as a `➕` follow-up if deferred). Done:
      `__DEBUG__`-gated (the smaller, lower-risk option). New pure exported `showBankBusPanel(debug)` in
      `bankSceneView.ts` (returns `debug`); `renderStatementAndBus` now early-returns after the ВЫПИСКА
      statement section when `!showBankBusPanel(__DEBUG__)`, so dev/e2e keep the teaching panel and
      production ships without it. No i18n/Cyrillic change (the ШИНА literals just stop rendering in
      prod), no save/schema impact (presentation-only). ➕ Follow-up (deferred): the in-fiction
      bank-clerk-log restyle alternative — a larger content pass, out of scope for this gating fix.
- [x] write a test confirming the panel is absent/hidden outside `__DEBUG__` (or renders as clerk-log
      text, matching whichever option is implemented). Done: `bankSceneBusPanelGate.test.ts` — pure
      `showBankBusPanel(false)===false` / `(true)===true`, plus real-scene (fake-pixi) render tests with
      the gate override forced off (ШИНА header absent, ВЫПИСКА header still present) and on (ШИНА header
      present).
- [x] run tests — must pass before Task 14. Done: new suite 4 passed; full unit suite 6042 passed / 0
      failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.

### Task 14: Variance primitive for QuestScript locations
This is the foundation the 20 per-quest tasks below build on — get it right once.
- [x] `QuestScript.ts`: widen `QuestLocation.text` to `string | string[]`. Done: union type + doc comment
      explaining the variance-pool semantics.
- [x] `QuestVM.ts`: add a resolver (e.g. `currentLocationText()`) that, when `text` is an array, picks
      one variant **deterministically from `(seed, locationId)`** — not by consuming `this.rng`'s
      sequential stream, since that would desync every downstream `random(min,max)` roll that depends on
      call order. A simple stable hash of `` `${seed}:${locationId}` `` mod array length is sufficient.
      Done: added pure exported `questTextHash(key)` (Math.imul FNV-family, RNG-free) + pure
      `resolveLocationText(text, seed, locationId)`; VM stores `this.seed` and exposes
      `currentLocationText()`. `interpolate` widened to `string | string[]` (resolving a pool against the
      current location) so the existing `vm.interpolate(vm.currentLocation().text)` call sites keep
      compiling unchanged — the resolver never touches `this.rng`, verified by a pool-vs-scalar identical-
      roll test.
- [x] `TextQuestScene.ts`: switch `renderVmLocation` to call the new resolver instead of reading
      `loc.text` directly. Done: now `this.vm.interpolate(this.vm.currentLocationText())`.
- [x] Extend `questScriptGraph.test.ts`'s "every interpolation placeholder resolves to a declared param"
      invariant to check **every** string in a `text` array, not just a scalar — this is a required
      extension of an existing test loop, not a new file (see the "never weaken existing tests" rule —
      this only adds coverage). Done: added a `locationTexts(loc)` flattener consumed by
      `referencedPlaceholders`, so the existing invariant now iterates every pool variant (no assertion
      changed). `questTextFixes.test.ts`'s `allStrings` helper flattens pools too (coverage-broadening,
      forced by the union type).
- [x] write a unit test for the deterministic-per-seed / varies-across-seeds resolver behavior. Done:
      `src/tests/quests/questTextVariance.test.ts` — pure resolver (scalar verbatim, member-of-pool,
      deterministic per (seed,id), varies across seeds AND across location ids, empty/single pool),
      `questTextHash` determinism, and VM-level determinism + RNG-non-consumption (pool vs scalar roll
      identically).
- [x] run `npm run test:save-compat` once here to confirm the catalog-only assumption holds (no new
      persisted field introduced). Done: 22 passed — catalog-only, no migration needed.
- [x] run tests — must pass before Task 15. Done: quest suites 767 passed; full unit suite 6041 passed /
      13 skipped / 0 failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.

### Tasks 15–34: Per-quest variance and rebalance pass (one task per script)
For each quest below: open the relevant entries in
`docs/playtests/20260725-jaded-player-critical-sweep.md` section 3 (letters refer to that doc's
pattern groups: **A** dominant/risk-free choice, **B** path-blind endings, **C** fictional
reward/consequence, **D** silent random roll, **E** undisclosed instant-fail threshold, **F** repeated
micro-loop with no twist, **G** choice labels print exact numeric deltas, **H** no NPC
personality/humor, **I** dead flags/choices) plus section 4's per-quest notes, verify the citations
against current code (may have drifted since the snapshot), then fix. Each task: rebalance/branch the
named defects using **existing** `QuestVM` primitives (`random(min,max)` effects, distinct
`toLocation`/terminal ids per path, the Task 14 text-pool resolver where replay variety is the actual
fix) — do not invent new engine mechanics per-quest. Every task ends with extending that quest's
existing coverage in `newQuestScripts.test.ts`/`questScriptGraph.test.ts` (new assertions for the new
branches/endings, never removing/loosening what's there) and running the full quest test suite.

- [x] **Task 15 — `auction.ts`**: fix `skip_lot` (give it a real reason to exist, or remove it and keep
      the low/high dilemma meaningful — G's "skip_lot" is genuinely dominated by `bid_low` today);
      de-couple the post-win "reveal" text from lot_screen already showing the exact value (either hide
      the value pre-bid, or drop the reveal framing); make the fictional "барыш" total actually
      influence something real, or rewrite the ending text so it stops promising a payout the mechanic
      doesn't grant; give at least 1-2 of the 8 lots a genuinely different decision shape (F). Write/
      extend tests; run tests. Done: (1) skip_lot un-dominated by adding a 50cr **non-refundable auction
      fee** (`profit -= 50`) to both lost-bid_low branches (`bot_agg_bids`/`random_bot_bids`) — the stake
      is still fully refunded (existing budget-refund assertions untouched), but a bid_low against a
      solvent aggressive bot is now a guaranteed −50, so skip (0) strictly dominates it in that regime
      while bid_low stays the "pay to drain the bot" investment. (2) Reveal decoupled: `lot_screen` now
      hides the resale value under mesh-cloth («мешковиной») — the value first appears on the `pw_bid_c*`
      win screens, so bid_high is a genuine blind gamble (−50 class-2 … +150 class-4). (3) Ending text
      rewritten so the fixed **гонорар** is the reward and the барыш is an explicit scorecard held in the
      auction's till — no longer promises the profit total as pocketed cash. (4) Lot 5 given a different
      decision shape: a rival's **bribe** (`rival_approach`) — guaranteed +150 for standing down vs.
      bidding for a bigger haul vs. walking. Extended the Auction describe block with 10 new `it(...)`
      assertions (fee on each loss, no-fee on win, skip-non-domination, hidden-value / decoupled-reveal,
      lot-5 bribe shape, take_bribe/refuse_bid, ending-text). Cyrillic baseline regenerated (auction.ts
      53→61, catalog literals). Full unit suite 6064 passed / 0 failed; tsc + eslint clean. ➕ Note: net
      win-rate/feel of the reworked economy is a manual-playtest acceptance item (not test-gated); the
      50cr fee was chosen to keep bid_low viable while making skip strictly non-dominated.
- [x] **Task 16 — `boarding-standoff.ts`**: remove or price the `stall_talk`+`offer_cargo` dominant
      combo; branch the `resolve` scene per actual outcome instead of one shared text; fix the "generous
      bonus" ending text that fires alongside a negative credit balance; replace exact-number choice
      labels with qualitative risk language (G). Write/extend tests; run tests. Done: (1) **resolve scene
      branched per path (B)** — `offer_cargo` now routes to a new `resolve_paid` node («ваш груз уже плывёт
      по трапу…»), `defiance` to `resolve_defiant` («ваш отказ повис в тесном шлюзе…»), and the bluff
      outcomes keep the (reframed) `resolve` node, so the moment-of-truth reads differently per path; all
      three carry identical `talk_down`/`pull_trigger` transitions into the same leverage-keyed
      `resolution_gate`, so every existing behavioural assertion still lands on the node id it expects
      (only the bluff test pins `resolve`). (2) **Fictional-reward ending fixed (C)** — `ending_negotiated`
      text no longer promises a «щедрую премию» / «при деньгах» (which contradicted the −1000 balance on
      the cargo path); it now frames the +1000 as «горсть монет… не богатство, а жест», true whether the
      player ends net-positive (bluff path) or net-negative (cargo path). (3) **Qualitative labels (G)** —
      the `airlock` and `parley` choice labels dropped every «(+2 к позиции / −2000 кредитов)» numeric
      delta for qualitative risk language (labels now carry no digits at all). Extended the boarding
      describe block with 5 new `it(...)` blocks (branched-resolve distinctness, transition-set per
      variant, paid-path-still-negotiates, no-numeric-label guard, ending-text guard) — no existing
      assertion touched. Cyrillic baseline regenerated (boarding-standoff 24→30, catalog literals).
      ⚠️ **Repricing the dominant combo is DEFERRED (blocked by a known-good test).**
      `batch1QuestScripts.test.ts:277-287` hard-locks the exact `stall_talk`+`offer_cargo`→`ending_negotiated`
      outcome (`credits === -1000`, `rating === 120`, reaching the ending requires leverage ≥ 4 from those
      two effects). Any repricing of `offer_cargo`/`stall_talk`, or re-routing `offer_cargo` through a
      risk roll, reds that assertion — and offer_cargo→talk_down is executed back-to-back in the test, so a
      roll node cannot be inserted either. Per this plan's Development Approach and the standing
      no-touch-existing-tests rule this is flagged ⚠️ rather than forced (mirrors Task 3's tribunal and
      Task 5's Transfer deferrals). Note the combo is arguably already *priced*: it costs a guaranteed net
      −1000 credits and is EV-inferior to the bluff-after-stall line (which yields +1000 on a 60% land and
      only demotes to `bought_off` otherwise, never paying 2000) — so it reads as the risk-averse
      "pay-for-certainty" option, not a strictly dominant one. Removing its *risk-free* certainty is the
      one part that needs the user's go-ahead + a test update.
- [x] **Task 17 — `cargo-sort.ts`**: give the 3 docks distinct outcome text instead of one shared
      success/fail line; either implement the cargo-type mechanic the header comment describes or remove
      the comment (I); tighten the puzzle's time/capacity budget so it isn't nearly unlosable (section
      4). Write/extend tests; run tests. Done: (1) **Distinct-outcome endings (B)** — the single
      `quest_success`/`quest_failure_overtime` pair is replaced by a 4-way tier: `final_verdict` now
      branches `overtime == 0 → margin_check1/2/3` (chained `dockN_load >= 8` auto-routers) → either
      `quest_success` (comfortable — no dock near the porog) or the new `quest_success_tight` (a dock
      sitting exactly at 8h — a nail-biter), `overtime == 1 → quest_failure_overtime` (one dock over,
      salvageable), and `overtime >= 2 → quest_failure_severe` (shift collapse) — each terminal with its
      own prose. The two test-locked terminal ids stay reachable for their exact scenarios (`overtime==0`
      comfortable → `quest_success`; forced 1-dock overload → `quest_failure_overtime`). (2) **Cargo-type
      comment (I)** — removed the header comment's false «Доки не могут смешивать типы» claim (a mechanic
      that never existed in code); rewrote the comment to describe the real budget + the branched endings.
      (3) **Tightened budget (section 4)** — dock overload porog lowered 12h → 8h (both the fiction text on
      every screen and the three `check_dockN` conditions). Measured empirically: at 12h even a dumb
      lowest-dock greedy heuristic wins every seed 0-29 (max greedy dock load was only 9); at 8h greedy
      fails 2/30 seeds and any careless single-dock dump always fails, yet a brute-force optimal packing
      still reaches `overtime==0` on every seed (unwinnable=0/30) — losable-by-carelessness, always
      winnable-with-thought, and no locked test red'd (success test 7,7,4≤8; forced dock1=20>8→overtime;
      greedy seed-1 max 6≤8). Extended the Cargo Sort describe block with 7 new `it(...)` blocks (porog-9h
      overload, comfortable vs razor-thin distinct endings, light vs severe distinct failures, every-seed
      winnable brute-force, careless-dump-always-fails) — no existing assertion touched. Cyrillic baseline
      regenerated (cargo-sort 66→71 for the new terminal/margin literals). Full unit suite exit 0; `tsc
      --noEmit` clean; `eslint` on changed files 0 issues.
- [x] **Task 18 — `customs.ts`**: branch `next_ship` per actual outcome; make the "5000₡ goal" text
      actually gate the real reward, or rewrite it; fix the "a couple more inspections" text that
      contradicts an instant-fail-on-first-mistake reality (E); give at least a few of the 20 ships
      distinct captains/flavor (F, H). Write/extend tests; run tests. Done: (1) **Branched next-ship (B)**
      — the single shared `next_ship` node is replaced by `next_ship_caught` (a caught smuggler provoded
      with a smug, law-won beat) and `next_ship_waved` (the uneasy "you'll never know what was in the
      trunk" wave-through); `pass` → waved, `collect_fine` → caught, both auto-advance identically
      (`shipNum += 1` → critMax fires `check_final` at ship 21; suspicion re-rolled), so every existing
      behavioural assertion still lands on `inspect_decision`/`check_final` as before. (2) **Reward framing
      (C)** — `quest_success` now states the collected штрафы go "в казну поста… не в ваш карман" and the
      real reward is the kept post + a fixed premium (the quest-board reward), so the 5000 quota is no
      longer implied to be pocketed cash. (3) **Instant-fail honesty (E)** — `found_clean` dropped the
      misleading «Ещё пара таких досмотров» reprieve for "одной такой ошибки хватает… второго шанса не
      будет", and `accept_scandal` now routes straight to `quest_failure_rating` (rating 100 − 500 always
      < 0, so the crit would land there anyway) — data matches text. (4) **Captain flavor (F/H)** —
      `inspect_decision.text` is now a 5-variant captain-vignette pool (nervous freighter work-man, silk
      merchant prince, gruff ex-military, family hauler with a crying kid on comms, glossy corporate
      courier), each keeping the `{shipNum}/{suspicion}/{money}/{rating}` HUD + 5000-quota framing. ➕
      Engine note: the Task-14 resolver keys on `(seed, locationId)`, so a pool gives **per-playthrough**
      captain variety (each shift a different captain voice), not per-ship-within-run — genuine per-ship
      distinct nodes are blocked by the locked tests that assert the loop returns to `inspect_decision`;
      per-seed replay variety is the sanctioned Task-14 approach (matches Tasks 15–17 precedent). Extended
      the Customs describe block with 7 new `it(...)` blocks (caught/waved distinct beats + identical
      advance, no-«ещё пара» instant-fail routing, pool-with-HUD-placeholders, per-seed vignette variety,
      treasury-not-payout win text) — no existing assertion touched. Cyrillic baseline regenerated
      (customs 22→26). Full unit suite 6070 passed / 13 skipped / 0 failed; `tsc --noEmit` clean; `eslint`
      on changed files 0 issues.
- [x] **Task 19 — `derelict-salvage.ts`**: make the boarding method (stealth/force/etc.) show up in at
      least one of the 4 endings (B); add a credit penalty to the catastrophic ending (C); either wire
      the `sealed` param into an actual branch or remove it (I). Write/extend tests; run tests. Done:
      (1) **Boarding method surfaced (B)** — `report_gate` now branches its clean path on `forced`: a
      forced-breach boarding that still reports clean routes to a new `ending_report_forced` node whose
      text explicitly calls out the scorched, res-cut переборка and the colder officer reception, while
      careful dockers keep the original `ending_report` (rg_clean stays the fallback, so the locked
      seal+report test still lands 4000/140 on `ending_report`). (2) **Credit penalty on catastrophe (C)**
      — `bg_outbreak` now also fires `credits -= 3000` (a carantine dezact bill on top of the −60 rating)
      and the `ending_outbreak` prose was rewritten to say the whole haul burned with the dock; the
      existing outbreak test only pinned rating 40, so it stays green, and a new test pins credits 1000.
      (3) **`sealed` wired (I)** — the dead flag is now read: `blackmarket_gate` gained
      `bg_sold_sealed` (condition `sealed == 1`) → new `ending_blackmarket_sealed`, where an intact,
      unopened class-IV container fetches a fat +3500 premium at a steep −45 reputation cost (vs base
      +2500/−30). Sealing is no longer strictly worthless — it forks into the clean high-rep report or the
      dirty high-cash fence. `seal_it`/`take_sample` are mutually exclusive so the outbreak (sample) and
      sealed branches never collide; auto-execute ordering (outbreak → sealed → base) keeps every
      pre-existing behavioural assertion on its original node. Extended the Derelict Salvage describe
      block with 4 new `it(...)` blocks (outbreak credit penalty, forced-breach distinct ending + text,
      careful-report keeps original ending, sealed-fence premium) — no existing assertion touched.
      Cyrillic baseline regenerated (derelict-salvage 38→42 for the 2 new endings + 2 new labels). Full
      unit suite 6074 passed / 13 skipped / 0 failed; `tsc --noEmit` clean; `eslint` on changed files 0
      issues.
- [x] **Task 20 — `evacuation.ts`**: branch `second_run` per dock instead of one shared text (B); give
      `route_check`'s silent roll its own success/fail narrative line (D). Write/extend tests; run
      tests. Done: (1) **second_run branched per dock (B)** — the single shared `second_run` node is
      replaced by `second_run_med`/`second_run_hab`/`second_run_vip`, each with dock-specific prose (the
      med run leaves the hab crowd behind, the hab run leaves the stretcher cases, the VIP run leaves the
      common rings pounding on the bulkheads). Every dock transition retargets to its own node; each node
      keeps the identical `grab_more`(→route_back, −3h/+8) and `bug_out`(→liftoff) transitions, so every
      existing behavioural assertion still lands on the same transition ids/effects. (2) **route_check roll
      narrated (D)** — the two silent `"..."` autoExecute jumps straight to `liftoff` are replaced by
      distinct outcome scenes: `route_clear` → new `route_clear_scene` («ни царапины…») and `route_hit`
      → new `route_hit_scene` («сорванная секция вспарывает борт…»), each auto-advancing on to `liftoff`.
      The `time -= 4` stays on the `route_hit` transition, so a lethal hit still drops `time` to 0 and the
      `critMin` redirect fires `ending_collapse` before the scene shows (the collapse test is untouched);
      a non-lethal hit now reads its own beat. Extended the Evacuation describe block with 2 new `it(...)`
      blocks (per-dock second_run distinctness + choices intact; distinct clear/hit narrated outcomes,
      non-lethal hit routes through `route_hit_scene` at time 2, both funnel back to an ending) — no
      existing assertion touched. Cyrillic baseline regenerated (evacuation 22→34 for the 3 new dock
      scenes + 2 new route outcome scenes). Full unit suite 6089 passed / 0 failed; `tsc --noEmit` clean;
      `eslint` on changed files 0 issues.
- [x] **Task 21 — `first-contact.ts`**: fix `scan` being strictly worse than `broadcast` — give it a
      real (if different) upside (A); branch the shared "exchange" scene per generosity/extortion/
      capitulation outcome (B); either grant the star-maps/trophies `ending_alliance` promises, or
      rewrite the text (C). Write/extend tests; run tests. Done: (1) **Scan upside (A)** — a curious scan
      (`roll >= 5`) now grants `credits += 800` (sellable xeno-intel) and routes through a new
      `scan_intel` narrative beat before `greeting`, instead of the old bare no-op jump. It gives **no**
      trust (existing test still pins trust 0 on the curious path), so broadcast keeps the better
      diplomatic ceiling (broadcast+reciprocate → alliance; curious-scan+reciprocate only → trade_pact)
      while scan trades that ceiling for material intel at the real risk of the alarmed roll → standoff —
      a genuine tradeoff, not a strict downgrade. (2) **Branched exchange (B)** — the single shared
      `exchange` node is replaced by four distinct beats keyed to how the player arrived: `exchange_gift`
      (generous reciprocation), `exchange_take` (one-sided taking), `exchange_demand` (extortion under
      posturing), `exchange_standdown` (tense de-escalation from aimed guns); all four auto-execute
      `resolve_peace` into the same trust-keyed `resolution_gate`, so every existing behavioural
      assertion still lands on its original ending id/effect. (3) **Alliance-reward honesty (C)** —
      `ending_alliance` text no longer promises star-charts "no human expedition ever knew" + trophies as
      a separate untracked hold item; it now frames the star-map fragments and artifacts as **appraised
      into the +3000-credit payout already on the player's account** — grounding the fiction in the real
      mechanic. Extended the First Contact describe block with 5 new `it(...)` blocks (curious-scan
      intel windfall, scan-vs-broadcast ceiling tradeoff, four-distinct-exchange-beats, every-branch
      still resolves to a success ending, alliance-reward-grounded-in-payout) — no existing assertion
      touched. Cyrillic baseline regenerated (first-contact 26→30 for the new catalog literals). Full
      unit suite 6094 passed / 0 failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues.
- [x] **Task 22 — `gravity-slalom.ts`**: fix the header comment's false claim of seed-dependent routing
      — either make the route actually vary by seed, or correct the comment (A, section 4); turn at
      least some of the single-button "press continue" cells into real choices (section 4); give the
      silent scientist at least one line through the quest's middle stretch (H). Write/extend tests; run
      tests. Done: (1) **Header comment corrected AND route made to genuinely vary (A)** — the false
      «оптимальная стратегия зависит от seed» line was rewritten honestly: the four windows are
      seed-random so a route's *fuel cost* varies per run, but the double-diagonal A1→B2→C3 always
      reaches the finish (worst case 80 forsazh, remainder 20 ≥ 10 — this outcome is test-locked in
      `questScripts.test.ts`, so the economy could not be rebalanced to make it fail). Real per-run
      variance was instead added via the funnel-cell coast gambles below, and the comment now describes
      the actual mechanics. (2) **Funnel cells → real choices (section 4)** — the single-button dead-end
      cells `cell_a3` and `cell_c2` each gained a second option: an inertia-coast gamble (`a3_coast` /
      `c2_coast`) that rolls a hidden `coast_a3`/`coast_c2` param (`= random(0,1)`, `initial:0` so it
      does NOT consume the constructor RNG stream — the four window rolls keep their exact seed-determined
      values, verified by a new regression test) at the moment of choice. Win → near-free drift
      (a3 −6 / c2 −4), lose → costly overshoot (−40) vs the safe ровная тяга (−26): EV slightly favours
      the gamble but the variance can bust the fuel reserve, so it is a genuine bet. Each outcome routes
      to its own beat node (`a3_coast_win`/`_lose`, `c2_coast_win`/`_lose`) with distinct narration — no
      more silent roll. (3) **Scientist voice in the middle stretch (H)** — «Фэянин по связи» comms lines
      were woven into the mid cells `cell_a2`/`cell_b1`/`cell_b2`/`cell_b3`/`cell_c1` and into every
      coast-outcome beat (relief on a clean drift, gritted teeth on an overshoot), so the previously
      silent scientist is present throughout, not just intro + ending. Extended the Gravity Slalom
      describe block in `questScripts.test.ts` with 10 new `it(...)` blocks (hidden coast params exist /
      start 0 / not-shown, coast rolls don't consume constructor RNG, a3+c2 now offer ≥2 transitions,
      a3 win/lose fuel + distinct-beat, c2 win-reaches-finish + c2 lose-busts-reserve, distinct-narration
      guard, Фэянин-in-middle-stretch) — no existing assertion touched. Cyrillic baseline regenerated
      (gravity-slalom 38→48 for the new catalog literals). Full unit suite 6091 passed / 13 skipped / 0
      failed; `tsc --noEmit` clean; `eslint` on changed files 0 issues (repo-wide `npm run lint` fails
      identically on HEAD — pre-existing `no-explicit-any` test-file backlog, unrelated).
- [x] **Task 23 — `hostage-rescue.ts`**: rebalance `snipe_first` (currently removes all risk for free)
      and `pay_ransom` (currently a telegraphed trap with no real upside) so both carry a genuine
      tradeoff (A); give the antagonist at least one more beat before vanishing (H). Write/extend tests;
      run tests. Done: (1) **snipe_first no longer free (A)** — the guaranteed `guards -= 2` (which the
      locked `sniping first guarantees a clean assault` test requires, along with hostages 4 / clean
      ending, but does NOT check credits/rating) now costs `credits -= 2500` + `rating -= 20`. Since the
      player already SEES `{guards}` in `assault_prep`, this makes the decision honest: at low guard
      counts a raw breach nets strictly more (3500/+25 vs snipe's 1000/+5) so snipe stops dominating; at
      3 guards it's a genuine lives-vs-money dilemma (breach loses 2 hostages for +500 cr); at 4 it's an
      expensive-but-survivable rescue rather than a free risk-eraser. `assault_snipe` text now justifies
      the price (the hour on the nest lets the pirates strip the till + the flotilla pays skint for
      "executioner" work). (2) **pay_ransom gains a real upside (A)** — `ransom_path` keeps the naive
      `trust` line (locked outcomes untouched) and adds `mark_ransom` → new `ransom_marked` /
      `ransom_marked_outcome` nodes: a higher-variance gamble that on `roll >= 5` recovers the ransom AND
      pays a pirate-network-intel bounty (`credits += 4000`, net +2000, `rating += 25`,
      `ending_ransom_marked_good`), but on a loss the detected tag turns the exchange into a bloodbath
      (`hostages -= 4`, `rating -= 15`, `ending_ransom_marked_botched`) — a genuinely worse floor than
      naive trust's rating-neutral betrayal, so neither line dominates. (3) **Antagonist beat (H)** — the
      главарь, previously silent after the briefing on every non-ransom path, now taunts over comms in
      `assault_prep` («Слышу, как ты греешь движки, рейнджер…») and gets two more beats across the
      marked-ransom nodes/endings. Extended the Hostage Rescue describe block with 6 new `it(...)` blocks
      (snipe cost, snipe-nets-less-than-raw-clean, mark-vs-trust distinct branch, marked-good net-positive,
      marked-botched worse-floor-than-trust, antagonist-speaks-again) — no existing assertion touched.
      Cyrillic baseline regenerated (hostage-rescue 31→37 for the 2 new endings + 2 new nodes + 2 new
      labels). Full unit suite 6097 passed / 13 skipped / 0 failed; `tsc --noEmit` clean; `eslint` on
      changed files 0 issues.
- [x] **Task 24 — `investigation.ts`**: make the gathered clues actually branch toward identifying the
      real killer instead of a fixed deduction path (B); fix the reputation threshold that currently
      makes a correct elimination-based deduction mathematically unreachable even with perfect play (E);
      let the witness's own earlier confession be usable in the interrogation instead of contradicting
      the "dramatic reveal" of clue #3 (section 4). Write/extend tests; run tests. Done: (1) **Real
      deduction that branches on the murderer (B)** — the voice-log clue (Улика 5) gained a biometric
      analysis path: `examine_evidence_4` now offers `deduce_voice` → `voice_analysis`, which
      auto-executes on `murderer` (mirroring the accuse-check pattern: `murderer == 0/1/2` + an
      unconditioned `== 3` fallback) into one of four `voice_match_N` nodes that NAME the killer and tie
      the verdict back to the physical clues (the S-size gloves, the anonymous note's syntax, the
      looped-dock alibi, the manual camera shutdown). Each match logs the 5th clue (`examined_4 = 1`,
      `clues_examined += 1`) — single-count-safe because logging hides `examine_clue_4`, so the analysis
      screen can never be re-entered; the direct `back_from_e4` log stays for the solver path. Deduction
      is no longer decorative: the assembled evidence now points at the actual killer. (2) **Rating
      threshold (E)** — resolved *by* (1) rather than by touching the locked 200-per-wrong / initial-500 /
      critMin-0 budget (all three are hard-pinned by `three wrong accusations cause rating failure` and
      cannot change): with the voice deduction real, perfect play identifies the killer from the clues and
      accuses correctly on the FIRST attempt, so no wrong guess is ever forced and rating stays 500. The
      previously-unreachable "correct elimination even with perfect play" is now reachable via deduction,
      not blind elimination. A new test drives this end-to-end for seeds 0–19 (reads the killer from the
      `voice_match_N` node id, NOT the murderer param, then accuses — asserting success + rating 500).
      (3) **Guard's confession usable in the interrogation (§4)** — `interview_guard` gained a
      `confront_key` transition (condition `examined_6 == 1`) → new `guard_key_admission` node where
      Ортега's prior "I carried the key to Karl's cabin, half the shift saw it" testimony is presented as
      actionable evidence that neutralises the planted arsenal-key clue (Улика 7); the confront does NOT
      finalise the interview (`interviewed_3` untouched) so the player still records the statement via
      `done_guard`. Extended the Investigation describe block with 5 new `it(...)` blocks (branch-on-
      murderer + names the killer, single-log, first-try-deduction-win-zero-rating-loss ×20 seeds,
      confront-hidden-before-vs-shown-after-key-clue, confront-surfaces-confession-without-ending-
      interview) — no existing assertion touched. Cyrillic baseline regenerated (investigation 74→87 for
      the new deduction/confront catalog literals). Full unit suite 6115 passed / 0 failed; `tsc --noEmit`
      clean; `eslint` on changed files 0 issues. ➕ Note: net feel of the reworked deduction (whether the
      voice analysis gives away the mystery too readily) is a manual-playtest acceptance item — the
      analysis is an opt-in deep-dive the solver/casual player can skip, so it reads as a reward for
      thorough investigation rather than an auto-solve.
- [x] **Task 25 — `life-support.ts`**: make the deterministic run-up to the best ending's 50/50 roll
      carry real risk earlier, not just at the final roll (A); give `scrubber_check` — the quest's only
      real risk branch — its own success/fail text (D); stop `fix_scrubber`'s label from hiding the real
      failure penalty (G); split `tally_few`'s collapsed saved-2-to-5 range into distinct text per count
      or sub-range (B). Write/extend tests; run tests. Done: (1) **Early risk (A)** — added a fourth
      first-choice `air_medbay`, a genuine gamble (cracked-bulkhead medbay): `-2` air + a `roll` router
      (`medbay_check` → `medbay_held`/`medbay_blown`, mirroring the scrubber gate's conditioned +
      unconditioned-fallback shape) — a good roll saves four for almost no air, a bad one blows the patch
      (`saved += 1`, extra `-2` air). Risk now starts at move 1, not only the late scrubber flip. The three
      locked first-choices (`air_bridge`/`air_hold`/`air_eng`) and their exact downstream oxygen/saved
      values are untouched. (2) **Scrubber roll narrated (D)** — `scrub_ok`/`scrub_fail` (previously silent
      `"..."` jumps straight to `final_seal`) now route through distinct beat nodes `scrubber_restored`
      («турбина ожила, стрелка резерва поползла вверх») / `scrubber_dead` («давится, глохнет намертво,
      стравила литр в закоротивший контур»), each auto-advancing on to `final_seal` — so `advanceAuto`
      still lands the two locked tests on `final_seal` at oxygen 8 / 4 exactly, but the player now reads the
      result. Gave `scrub_ok`/`scrub_fail`/`medbay_*` real in-fiction labels instead of `"..."`. (3) **Label
      honesty (G)** — `fix_scrubber` label now reads «продувка стоит воздуха (−1); оживёт — +5, заклинит —
      ещё −2», disclosing the failure penalty it previously hid. (4) **Ending split (B)** — the medbay
      gamble makes `saved` values 1/4/5 reachable in the former «few» (<6) band, so `tally` gained a
      `tally_some` tier (`saved >= 4`, +900cr) → new `ending_few_more` («не горстка, но и не большинство»)
      distinct from `ending_few` (0-3). The locked `saved==2 → ending_few` test still lands (2 < 4).
      Extended the Life-support describe block with 9 new `it(...)` blocks (lucky/blown medbay + one-branch
      router, restored/dead distinct beats + no-`...` prose, label-discloses-penalty, few_more reachable +
      distinct-prose) — no existing assertion touched. Cyrillic baseline regenerated (life-support 22→37 for
      the new catalog literals). Full unit suite 6124 passed / 0 failed; `tsc --noEmit` clean; `eslint` on
      changed files 0 issues. ➕ Note: net win-rate/feel of the medbay gamble's numbers is a manual-playtest
      acceptance item (not test-gated); +4-for-2-air on a win is intentionally juicy but genuinely risked by
      the 1-soul-for-4-air loss, so it reads as a bet, not a strictly dominant free lunch.
- [x] **Task 26 — `locked-room.ts`**: give `press_check` and `verdict_gate` — the quest's two key
      dramatic beats — their own success/fail narrative text instead of a silent roll (D); give each
      suspect more than one adjective of characterization (H). Write/extend tests; run tests. Done:
      (1) **press_check narrated (D)** — the two silent `"..."` autoExecute jumps straight to
      `accusation` now route through distinct beat nodes: `press_crack` → new `press_cracked` (the medic
      breaks and half-confesses — pays off the +2 clue gain in fiction) and `press_stonewall` → new
      `press_stonewalled` (the ровная-маска dead end, wasted minutes), each auto-advancing on to
      `accusation`. The `clues += 2` stays on the crack transition, so the locked airtight-conviction
      test still reaches `accusation` with clues 5 (advanceAuto traverses the new auto beat). (2)
      **verdict_gate narrated (D)** — `convicted` → new `verdict_broken` («...Как вы узнали про код
      доступа?» — the tell that seals it) and `insufficient` → new `verdict_smirk` (the guessing-not-proof
      usмешка), each auto-advancing to its epilogue ending (`ending_solved`/`ending_walks`). The
      credits/rating effects stay on the gate transitions, so both locked verdict tests still land their
      exact numbers on the same terminal (advanceAuto runs through the new beat). (3) **Suspect
      characterization (H)** — `interrogation` text expanded so each of the three has 2+ traits: the
      грузный engineer with мозолистые руки and white-knuckled fingers, the худая/бледная comms officer
      teребящая нашивку and flinching at the airlock, the medic sitting ровно with a слишком-спокойный
      composure. Extended the Locked-room describe block with 4 new `it(...)` blocks (crack confession
      beat, stonewall distinct dead-end, verdict success/fail distinct beats, per-suspect 2-trait guard)
      — no existing assertion touched. Cyrillic baseline regenerated (locked-room 26→30 for the 4 new
      beat-node texts). Full unit suite 6128 passed / 0 failed; `tsc --noEmit` clean; `eslint` on changed
      files 0 issues.
- [x] **Task 27 — `orbital-escape.ts`**: rebalance so `trim_burn` isn't strictly dominant with the other
      options reduced to decoration (A); give `dump_check`'s roll its own narrative text (D); add at
      least one more line of NPC presence across the quest (H). Write/extend tests; run tests. Done:
      (1) **trim_burn de-dominated (A)** — its always-on `fuel >= 3` gate is raised to `fuel >= 5`, a
      *conserved fuel reserve*, so the efficient `burn_periapsis` line (leaves fuel 6) keeps the precise
      trim on the table while the wasteful `burn_now` line (leaves fuel 4) **locks it out** — turning the
      three "flavours of first burn" into a real branch (efficiency earns the Oberth trim; waste forces the
      messy fuel-free endgame) instead of decoration. trim's frozen +4/−3 numbers are untouched (locked by
      `an efficient periapsis burn + a trim burn breaks clean`, which runs at fuel 6 ≥ 5), and no locked
      test does `burn_now → trim_burn`. To give trim a genuine competitor on the fuel-poor line (where its
      frozen numbers otherwise can't be risked), added a new fuel-free **plasma-vent gamble** to `coast`
      (`plasma_vent` → `vent_check`, `roll = random(0,9)`): a held coil (`roll >= 5`) shoves +5 altitude
      free, a shorted coil knocks −3 back toward the storms — so the stranded player weighs a paid, safer
      ballast dump against a free high-variance vent. (2) **dump roll narrated (D)** — the two silent
      `label: "..."` autoExecute jumps straight to `escape_gate` now route through distinct beat nodes
      `dump_freed` (containers tear free, ship interviews) / `dump_jammed` (створка clinks half-open, weak
      shove), each auto-advancing on to `escape_gate`; the vent gamble likewise narrates `vent_surge` /
      `vent_misfire`. All effects stay on the original transitions, so `advanceAuto` still lands the two
      locked dump tests (`a good ballast dump…`, `is deterministic … ballast path`) on their exact
      terminal/altitude/credits — `advanceAuto` simply traverses the new auto beat. (3) **NPC presence (H)**
      — the orbital-control dispatcher (previously only heard at `ending_escaped`) now hails the player mid-
      quest on the `coast` screen and barks at a shorted vent, so the desperate stretch isn't run in
      silence. Extended the Orbital-escape describe block with 6 new `it(...)` blocks (fuel-gated trim
      availability + fuel-free options remain, distinct dump success/fail beats, clean-vent fuel-free
      escape, shorted-vent downside, dispatcher-on-comms, deterministic plasma path) — no existing
      assertion touched. Cyrillic baseline regenerated (orbital-escape 20→30 for the new beat/gamble
      catalog literals). Full unit suite 6121 passed / 13 skipped / 0 failed; `tsc --noEmit` clean; `eslint`
      on changed files 0 issues. ➕ Note: trim staying optimal *after* the efficient burn is intended — it's
      the earned Oberth payoff for fuel discipline, gated behind a real prerequisite, not a flat free
      choice; net feel of the reworked economy is a manual-playtest acceptance item (not test-gated).
- [ ] **Task 28 — `plague-crisis.ts`**: rebalance `fast_route` vs `safe_route` so the fast path isn't
      strictly dominant (A); give `fast_check`'s "precise maneuver" an actual player decision point
      instead of a silent auto-roll (D). Leave the plague/quarantine premise overlap alone per the
      existing README caveat — this task is about this quest's own internal balance, not merging it with
      `quarantine.ts`. Write/extend tests; run tests.
- [ ] **Task 29 — `quarantine.ts`**: give the darkest choice ("vent to space") its own dedicated ending
      instead of falling through to a generic one (B); surface the panic/containment critical thresholds
      to the player somehow (tooltip/UI hint or in-fiction warning) so a "good" combo of choices doesn't
      lead to a hidden failure (E); give `help_check`'s roll its own text (D). Write/extend tests; run
      tests.
- [ ] **Task 30 — `reactor.ts`**: turn the 8 identical ±1-rod buttons into a loop with at least 1-2
      genuinely different beats (F); reduce or restructure the up-to-3.2s forced unclickable wait per
      turn so the pressure timer doesn't compete with itself (section 4) — note this task depends on
      Task 3 already having fixed this file's cosmetic issues (placeholder labels, freighter/station
      naming). Write/extend tests; run tests.
- [ ] **Task 31 — `sabotage-heist.ts`**: give `hack_check`'s roll its own text (D); give the partner a
      name and more presence before the betrayal roll (H); fix `slip_out` so bringing the partner
      actually changes the outcome (currently identical to going without one, wasting the 500₡ team cost)
      (I). Write/extend tests; run tests.
- [ ] **Task 32 — `signal-decode.ts`**: branch endings by decode method used, not just outcome (B); give
      `overclock_check`'s roll its own text (D); add tension/stakes language matching the "people may
      die" premise instead of dry technobabble throughout (H) — note this depends on Task 3's typo fixes
      to this same file. Write/extend tests; run tests.
- [ ] **Task 33 — `smuggling-run.ts`**: rebalance `bluff` so it isn't free at low heat (A); branch the
      success text by payout tier instead of one shared line for all three (B); give the 3 checkpoints at
      least one differentiating beat (F). Write/extend tests; run tests.
- [ ] **Task 34 — `tribunal.ts`**: rebalance the maximally-aggressive path so it isn't simultaneously the
      safest and the highest-reward option (A); replace exact-numeric choice labels with qualitative
      language (G) — note this depends on Task 3's sign-bug fix to this same file. Write/extend tests;
      run tests.

### Task 35: Verify acceptance criteria
- [ ] verify every item from Overview/Context is addressed (spot-check a sample of the per-quest tasks
      against the original backlog doc for genuine resolution, not just checkbox-completion)
- [ ] run full unit test suite (`npm test -- --run`)
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run letsplay:ci`
- [ ] run `npm run test:save-compat`
- [ ] run `npm run lint` — all issues fixed
- [ ] run `gitnexus detect_changes({scope: "compare", base_ref: "master"})` and confirm the affected
      scope matches this plan's intent (no unexpected blast radius)

### Task 36: [Final] Update documentation
- [ ] `src/systems/quests/scripts/README.md`: document the new text-pool variance convention (Task 14)
      alongside the existing "prose quality bar" section
- [ ] append a short note to `docs/playtests/20260725-jaded-player-critical-sweep.md` (or a new dated
      follow-up note) marking which findings this plan resolved vs. deferred
- [ ] update `.claude/docs/systems/` subsystem docs if this plan's changes touch documented conventions
      (e.g. hub UX, quest engine)

*Note: ralphex automatically moves this plan to `docs/plans/completed/` once all tasks are checked.*

## Technical Details

- **Seed derivation (Task 1)**: don't reuse `Date.now()`/pure randomness for the retry seed if it can be
  avoided — keep it derivable from the original seed + attempt count so a specific failing run stays
  debuggable/reproducible from logs.
- **Text-pool resolver (Task 14)** must not consume `QuestVM`'s `SeededRNG` stream — it needs its own
  stable hash so adding/removing text variants later doesn't shift unrelated numeric rolls for
  already-shipped quests (would be a silent rebalance nobody asked for).
- **Per-quest tasks (15–34) should prefer existing `QuestVM` syntax** (`random(min,max)` effects,
  additional `toLocation`/terminal ids, the Task 14 resolver) over adding new effect operators or
  condition syntax — the mini-language in `QuestVM.applyEffect`/`evaluate` is regex-based and already
  covers assignment, compound ops, and random rolls; extending it should be a last resort, flagged with
  ⚠️ if a task genuinely needs it.
- **No save/schema/migration impact expected anywhere in this plan** — everything here is catalog data
  (quest scripts) or presentation-layer behavior/UI. Task 14's `run test:save-compat` check is the one
  point where this assumption gets verified rather than assumed.

## Post-Completion

**Manual verification:**
- Play through a handful of the reworked quests (at least `auction.ts`, `tribunal.ts`,
  `boarding-standoff.ts` — the ones with the most-cited dominant-choice problems) end-to-end in the dev
  build to confirm the rebalanced choices feel meaningfully different, not just numerically different.
- Confirm the typewriter effect reads well at each font-scale (S/M/L) setting and doesn't fight with
  `scaledText`/`lineStepFor` layout.
- Confirm the robot-assistant voice lines (Task 10) land in the right tone — this is a subjective call
  the automated tests can't fully verify.

**Out of scope / explicitly deferred** (per the 2026-07-25 verdict, not addressed by this plan):
- Overmind spread-cadence pacing (LOSS-dominant around day ~428) — separately tracked, unrelated to the
  "boring quests" diagnosis.
- Re-introducing a generative narrator (ONNX or otherwise) — the variance primitive here is a
  lower-cost partial substitute, not a replacement for that removed feature.
