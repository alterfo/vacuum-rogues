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
- [ ] `PlanetInfoPanel.ts` (~lines 52-72) / `PlanetScene.ts` `addInfoPanel()` (~1396-1497): the domain
      already has population, economy type, political system, and player attitude (customs logic already
      reads `politicalSystem`) — SOURCE-OF-TRUTH §11.1 requires showing all four on the info panel and
      none currently render. Add them.
- [ ] While touching this file: migrate to `scaledText` (currently ignores font-scale setting, per
      `src/presentation/CLAUDE.md`'s migration list) and add `wordWrap` to the planet-name label
      (currently can overflow its fixed 220px panel)
- [ ] write a test asserting the panel renders population/economy/politicalSystem/attitude text for a
      representative planet fixture
- [ ] run tests — must pass before Task 10

### Task 10: Robot-assistant voice at repair/refuel/diagnostic
- [ ] SOURCE-OF-TRUTH §11.4: hangar interactions should show a "System check: … Ship ready for launch"
      style robot-assistant voice — currently `StationScene.doRepair()`/`doRefuel()` (~741-793) and
      `HangarPanel.renderServiceCenter` (~1728-1807) are silent mechanical toasts only. Add short
      Russian robot-voice lines for repair, refuel, and hull-diagnostic actions.
- [ ] write tests asserting the new voice-line text appears on each of the three actions
- [ ] run tests — must pass before Task 11

### Task 11: Fix landing-denied button still clickable
- [ ] `PlanetInfoPanel.ts` (~82-99) computes `landingDenial()` for the hover tooltip but the click
      handler doesn't re-check it — clicking "Приземлиться" when landing should be denied still burns a
      game day (`PlanetManager.ts` ~509-566, `SpaceFlightScene.ts` ~937-946). Re-check the denial
      condition in the click handler and block/no-op when denied.
- [ ] write a unit test asserting a click on a denied landing does not advance the game day / does not
      attempt the landing
- [ ] add/extend an e2e regression case for this (visual/interaction bug, per root CLAUDE.md's tiering)
- [ ] run tests — must pass before Task 12

### Task 12: Remove dead "ЗАХВАЧЕНА" banner code path
- [ ] `PlanetScene.ts` (~1087-1109 vs ~1365-1367): the captured-system banner reads `planet.capturedBy`,
      which by the file's own comment is never written in production. Replace with the already-used
      `isPirateSystem`/`isHostileSystem` check so the banner actually fires when it should.
- [ ] write a test asserting the banner shows for a hostile/pirate-controlled system and not otherwise
- [ ] run tests — must pass before Task 13

### Task 13: Hide/restyle the BankScene debug bus panel
- [ ] `BankScene.ts` (~80-81, 436-465): the "ШИНА: команды → проводки" panel is, by its own code
      comment, a demo/debug artifact taking up half the screen. Either gate it behind `__DEBUG__` or
      restyle it as in-fiction bank-clerk log lines — pick one (recommend `__DEBUG__`-gating as the
      smaller, lower-risk change; note the alternative as a `➕` follow-up if deferred).
- [ ] write a test confirming the panel is absent/hidden outside `__DEBUG__` (or renders as clerk-log
      text, matching whichever option is implemented)
- [ ] run tests — must pass before Task 14

### Task 14: Variance primitive for QuestScript locations
This is the foundation the 20 per-quest tasks below build on — get it right once.
- [ ] `QuestScript.ts`: widen `QuestLocation.text` to `string | string[]`.
- [ ] `QuestVM.ts`: add a resolver (e.g. `currentLocationText()`) that, when `text` is an array, picks
      one variant **deterministically from `(seed, locationId)`** — not by consuming `this.rng`'s
      sequential stream, since that would desync every downstream `random(min,max)` roll that depends on
      call order. A simple stable hash of `` `${seed}:${locationId}` `` mod array length is sufficient.
- [ ] `TextQuestScene.ts`: switch `renderVmLocation` to call the new resolver instead of reading
      `loc.text` directly.
- [ ] Extend `questScriptGraph.test.ts`'s "every interpolation placeholder resolves to a declared param"
      invariant to check **every** string in a `text` array, not just a scalar — this is a required
      extension of an existing test loop, not a new file (see the "never weaken existing tests" rule —
      this only adds coverage).
- [ ] write a unit test for the deterministic-per-seed / varies-across-seeds resolver behavior
- [ ] run `npm run test:save-compat` once here to confirm the catalog-only assumption holds (no new
      persisted field introduced)
- [ ] run tests — must pass before Task 15

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

- [ ] **Task 15 — `auction.ts`**: fix `skip_lot` (give it a real reason to exist, or remove it and keep
      the low/high dilemma meaningful — G's "skip_lot" is genuinely dominated by `bid_low` today);
      de-couple the post-win "reveal" text from lot_screen already showing the exact value (either hide
      the value pre-bid, or drop the reveal framing); make the fictional "барыш" total actually
      influence something real, or rewrite the ending text so it stops promising a payout the mechanic
      doesn't grant; give at least 1-2 of the 8 lots a genuinely different decision shape (F). Write/
      extend tests; run tests.
- [ ] **Task 16 — `boarding-standoff.ts`**: remove or price the `stall_talk`+`offer_cargo` dominant
      combo; branch the `resolve` scene per actual outcome instead of one shared text; fix the "generous
      bonus" ending text that fires alongside a negative credit balance; replace exact-number choice
      labels with qualitative risk language (G). Write/extend tests; run tests.
- [ ] **Task 17 — `cargo-sort.ts`**: give the 3 docks distinct outcome text instead of one shared
      success/fail line; either implement the cargo-type mechanic the header comment describes or remove
      the comment (I); tighten the puzzle's time/capacity budget so it isn't nearly unlosable (section
      4). Write/extend tests; run tests.
- [ ] **Task 18 — `customs.ts`**: branch `next_ship` per actual outcome; make the "5000₡ goal" text
      actually gate the real reward, or rewrite it; fix the "a couple more inspections" text that
      contradicts an instant-fail-on-first-mistake reality (E); give at least a few of the 20 ships
      distinct captains/flavor (F, H). Write/extend tests; run tests.
- [ ] **Task 19 — `derelict-salvage.ts`**: make the boarding method (stealth/force/etc.) show up in at
      least one of the 4 endings (B); add a credit penalty to the catastrophic ending (C); either wire
      the `sealed` param into an actual branch or remove it (I). Write/extend tests; run tests.
- [ ] **Task 20 — `evacuation.ts`**: branch `second_run` per dock instead of one shared text (B); give
      `route_check`'s silent roll its own success/fail narrative line (D). Write/extend tests; run
      tests.
- [ ] **Task 21 — `first-contact.ts`**: fix `scan` being strictly worse than `broadcast` — give it a
      real (if different) upside (A); branch the shared "exchange" scene per generosity/extortion/
      capitulation outcome (B); either grant the star-maps/trophies `ending_alliance` promises, or
      rewrite the text (C). Write/extend tests; run tests.
- [ ] **Task 22 — `gravity-slalom.ts`**: fix the header comment's false claim of seed-dependent routing
      — either make the route actually vary by seed, or correct the comment (A, section 4); turn at
      least some of the single-button "press continue" cells into real choices (section 4); give the
      silent scientist at least one line through the quest's middle stretch (H). Write/extend tests; run
      tests.
- [ ] **Task 23 — `hostage-rescue.ts`**: rebalance `snipe_first` (currently removes all risk for free)
      and `pay_ransom` (currently a telegraphed trap with no real upside) so both carry a genuine
      tradeoff (A); give the antagonist at least one more beat before vanishing (H). Write/extend tests;
      run tests.
- [ ] **Task 24 — `investigation.ts`**: make the gathered clues actually branch toward identifying the
      real killer instead of a fixed deduction path (B); fix the reputation threshold that currently
      makes a correct elimination-based deduction mathematically unreachable even with perfect play (E);
      let the witness's own earlier confession be usable in the interrogation instead of contradicting
      the "dramatic reveal" of clue #3 (section 4). Write/extend tests; run tests.
- [ ] **Task 25 — `life-support.ts`**: make the deterministic run-up to the best ending's 50/50 roll
      carry real risk earlier, not just at the final roll (A); give `scrubber_check` — the quest's only
      real risk branch — its own success/fail text (D); stop `fix_scrubber`'s label from hiding the real
      failure penalty (G); split `tally_few`'s collapsed saved-2-to-5 range into distinct text per count
      or sub-range (B). Write/extend tests; run tests.
- [ ] **Task 26 — `locked-room.ts`**: give `press_check` and `verdict_gate` — the quest's two key
      dramatic beats — their own success/fail narrative text instead of a silent roll (D); give each
      suspect more than one adjective of characterization (H). Write/extend tests; run tests.
- [ ] **Task 27 — `orbital-escape.ts`**: rebalance so `trim_burn` isn't strictly dominant with the other
      options reduced to decoration (A); give `dump_check`'s roll its own narrative text (D); add at
      least one more line of NPC presence across the quest (H). Write/extend tests; run tests.
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
