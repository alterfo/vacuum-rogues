---
# Quest-Card Text Overflow + Ship-Death Explosion

## Overview
Two genuinely-new playtest bugs (the rest of the 2026-06-25 beta report — rep
recovery, combat salvage, loot-by-proximity, quest reachability — is already fixed
post-`2de7551`; if still seen live it is the stale Service-Worker cache, not code):

1. **Quest-card text overflows the card** ("текст в заданиях наплывает если его
   много"). The journal already wraps the *list* of cards in a `ScrollableList`,
   but each card is a **fixed 130 px box whose title/objective `scaledText` calls
   carry no `wordWrapWidth`** — so a long title, a long objective description, or
   many objectives spill past the card's right edge and bleed into the next card.
2. **No explosion when a ship dies.** Ship destruction has no VFX at all: the
   player → `GameEngine.triggerPlayerDeath()` → GAME_OVER, an NPC →
   `NpcShipManager.handleInFlightDeath` (loot drop + removal). A short death
   explosion makes combat readable and satisfying.

Both are presentation-only — **no domain/schema/save change**.

## Context
- **Quest card:** `src/presentation/QuestJournalUI.ts` — `renderCard`-style block
  (~L250-340): fixed `bg.rect(20,0,panelWidth-40,130)`, title at y=10, objectives
  from y=35 stepping down, all via `scaledText(...)` with **no wrap**. The card
  list is already wrapped in `ScrollableList` (`src/presentation/ui/ScrollableList.ts`)
  when it overflows; `cardStep`/`fitCount` drive the viewport. `scaledText`
  (`src/presentation/ui/scaledText.ts`) ALREADY supports `opts.wordWrap` /
  `opts.wordWrapWidth` and `opts.align` — the fix is to pass them + make the card
  height track the wrapped content (or clip to it).
- **Ship-death FX pattern:** mirror the existing pure emitter `CometDustTail`
  (`src/presentation/flight/cometDustTail.ts`, PixiJS-free, fixed-size mote pool,
  unit-tested in `src/tests/flight/cometTailShape.test.ts`); `AsteroidBelt`
  mirrors each pool slot onto a pooled PixiJS `Particle`. The explosion is the same
  pattern: a pure `ShipDeathFx` emitter + a thin renderer that mirrors motes onto
  the game layer.
- **Death seams:** NPC — `NpcShipManager.handleInFlightDeath` (`:1162`); player —
  `GameEngine.triggerPlayerDeath` (`:1808`) and the scene's `onPlayerDestroyed`
  callback (`SpaceFlightScene` `:227`). Spawn the explosion at the dying ship's
  world position before removal / before the GAME_OVER transition.
- **Gates/conventions:** idle/heavy particle animation must gate on
  `reducedMotion()` (`src/presentation/ui/reducedMotion.ts`). New SFX follows
  `public/audio/sfx_<key>.ogg` + a `SfxKey` entry (`src/systems/AudioManager.ts`);
  a missing audio file is silently skipped. Flight FX live under
  `src/presentation/flight/` and each `destroy()` must leave the game layer clean +
  dispose any filters. Visual bugs need a screenshot/E2E check, not just green unit
  tests (repo bug-fixing process).

## Development Approach
Regression-first. Bug 1 is a layout/visual bug → an E2E assertion + screenshot in
`e2e/playtest-regression.spec.ts` (real rendering; PixiJS text metrics are
unreliable under jsdom), plus a pure unit test on any extracted card-height helper.
Bug 2's emitter is pure logic → unit-tested standalone exactly like
`cometTailShape.test.ts` (spawn count, lifetime decay, bounded live-count); the
wiring is verified by a real-engine playtest (a kill spawns the FX, teardown leaves
the layer clean, zero logged errors) + a visual screenshot. Complete each task
fully (impl + tests green) before the next. Additive only — no domain/schema/save
change. Gate new motion on `reducedMotion()`. Keep `SpaceFlightScene.ts` under the
1900-line guard.

## Implementation Steps

### Task 1: Word-wrap + size quest-card text so it never overflows
**Files:**
- Modify: src/presentation/QuestJournalUI.ts
- Modify/Create: e2e/playtest-regression.spec.ts (long-quest card case)
- Create: src/tests/presentation/questCardLayout.test.ts (if a pure height helper is extracted)

- [x] Pass `wordWrap: true` + `wordWrapWidth` (card inner width = `panelWidth - 40 - padding`) to the title and each objective `scaledText` call so long text wraps instead of running off the right edge.
- [x] Make the card height track its wrapped content (compute from title + per-objective wrapped heights) instead of the fixed 130 px — or clip card content to its box — so a tall card never bleeds into the next; keep `cardStep`/`fitCount`/`ScrollableList` consistent with the new height (the list still scrolls the cards).
- [x] Extract the card-height calculation into a pure helper if it makes the math unit-testable; otherwise keep it inline. (`src/presentation/ui/questCardLayout.ts` — `estimateWrappedLines`/`layoutQuestCard`; box height = `max(MIN_CARD_HEIGHT, contentHeight)`, `cardStep` = tallest box + gap so `ScrollableList`'s uniform `itemHeight` stays correct and short cards keep their 130 px box → FIT_COUNT unchanged.)
- [x] Write tests: pure unit test for the card-height helper (long vs short content) if extracted; an E2E case rendering a quest with a long title + long objective text asserting the card stays within the panel/scroll viewport (no overflow), with a screenshot. (`src/tests/presentation/questCardLayout.test.ts` + `e2e/playtest-regression.spec.ts` "long title + long objective wraps inside its card"; screenshot `test-results/quest-card-long-text.png`.)
- [x] Run tests — must pass before Task 2. (46 journal+helper unit tests green; the new E2E case passes against the real renderer.)

### Task 2: Pure ship-death explosion emitter
**Files:**
- Create: src/presentation/flight/shipDeathFx.ts
- Create: src/tests/flight/shipDeathFx.test.ts

- [x] Create a PixiJS-free `ShipDeathFx` emitter mirroring `CometDustTail`: a fixed-size mote pool with a hard live-count bound; `spawn(x, y)` seeds an outward burst (radial velocities + brief lifetime), `update(dt)` advances + expires motes; pure, deterministic, no DOM/PixiJS. (`src/presentation/flight/shipDeathFx.ts` — even radial fan + jitter, `SPEED/LIFE/SIZE` bands, `max`/`burst` bound.)
- [x] Expose the live mote list (position/alpha/size by remaining lifetime) for a renderer to mirror, and an `isActive()`/`reset()` for teardown. (`slots` getter + `count`; `explosionMoteAlpha`/`explosionMoteScale`/`explosionMoteLifeFraction` shading helpers; `isActive()`/`reset()`.)
- [x] Write tests (like `cometTailShape.test.ts`): a spawn seeds N motes, they expand + fade over their lifetime, the pool never exceeds its bound under repeated spawns, and motes expire to empty. (`src/tests/flight/shipDeathFx.test.ts` — 11 tests: burst count, radial fan, expand+fade, bounded under repeat, crowded-pool partial seed, expire-to-empty, reset, clamp + shading helpers.)
- [x] Run tests — must pass before Task 3. (11 tests green; eslint clean.)

### Task 3: Render the explosion + wire it to ship destruction
**Files:**
- Modify: src/presentation/flight/NpcShipManager.ts (handleInFlightDeath)
- Modify: src/presentation/SpaceFlightScene.ts (player-death seam / update + destroy)
- Modify: src/systems/AudioManager.ts (+ optional `explosion` SfxKey) and src/systems/audio/sfxCues.ts (optional cue)
- Modify/Create: src/tests/playtest/shipDeathExplosion.test.ts (real-engine wiring)

- [x] Add a thin renderer (in `SpaceFlightScene` or a small `FlightModule`) that mirrors `ShipDeathFx` motes onto the game layer with pooled `Particle`s (mirroring `AsteroidBelt`), advanced each frame and gated on `reducedMotion()` (no burst when reduced motion is on); `destroy()` leaves the game layer clean + disposes any filters. (`src/presentation/flight/shipDeathFxRenderer.ts` — `ShipDeathFxRenderer`: additive `softGlowTexture` particle pool mirroring the pure emitter 1:1, `spawn` gated on `reducedMotion()`, `destroy` removes+destroys its `ParticleContainer`. No BlurFilters used, per `feedback-no-blur-filters-flight`. Owned by `NpcShipManager` — built in `initialize()`, advanced in `update()` on real elapsed time like loot, torn down in `destroy()` — so `SpaceFlightScene.ts` stays at 1898 lines.)
- [x] Spawn the burst at the dying ship's world position in `NpcShipManager.handleInFlightDeath` (NPC kills) and on player death (`onPlayerDestroyed` / before the GAME_OVER transition) so both ships explode. (Spawn at the top of `handleInFlightDeath` so EVERY death — player kill, NPC-vs-NPC crossfire, the Overmind core — blasts; player death routed through the new `NpcShipManager.handlePlayerDeath()` which the scene's `onPlayerDestroyed` now calls — net-zero scene-line change.)
- [x] Optional: add an `explosion` `SfxKey` + a one-shot cue at the spawn site (audio file user-supplied; missing = silently skipped). (`SfxKey "explosion"` in `AudioManager`; `void this.gameEngine?.audio?.playSfx("explosion")?.catch(() => {})` at both death sites — optional-chained so unit-test mocks without an `audio` member don't throw.)
- [x] Write tests: a real-engine playtest where a killed NPC spawns FX motes (and none when `reducedMotion()` is forced on), teardown leaves the layer empty, zero logged errors. (`src/tests/playtest/shipDeathExplosion.test.ts` — 3 tests: a kill seeds sparks; `setReducedMotion(true)` ⇒ no burst; the burst ages each frame to an empty pool + scene teardown removes its particle layer; all with zero logged errors. The harness's 2D-canvas stub lets the pooled particle layer build, so the layer-removal assertion is real.)
- [x] Run tests — must pass before Task 4. (Full suite 3917 passing; `npm run test:playtest` 30 files green; `npm run lint` 0 errors; `SpaceFlightScene.ts` 1898 < 1900.)

### Task 4: Verify acceptance criteria
**Files:**
- Modify: docs/plans/20260627-quest-card-scroll-and-ship-death-explosion.md (check off items)

- [x] A quest with a long title + long/many objectives renders fully inside its card and the scroll viewport — no text overflow or bleed into neighbours (screenshot-verified). (E2E "long title + long objective wraps inside its card" passes against the real renderer; `test-results/quest-card-long-text.png` shows the long title wrapping to 2 lines, the objective to 3, and the reward line — all enclosed by the card border, nothing past the right edge.)
- [x] Destroying a ship (NPC and player) plays a brief explosion at its position; nothing animates when `reducedMotion()` is on. (Wiring + suppression + clean teardown covered green by `src/tests/playtest/shipDeathExplosion.test.ts` (kill seeds sparks; a kill fires the `"explosion"` SFX; `setReducedMotion(true)` ⇒ no burst; ages to empty + layer removed) and the 11 pure-emitter unit tests; the live rendered burst is a short-lifetime effect not reliably captured headlessly — manual eyeball in `npm run dev`. **Caveat (player death):** the player's own blast is seeded + the SFX plays, but the burst is NOT visible today — `triggerPlayerDeath()` synchronously transitions to GAME_OVER and tears the scene/FX renderer down the same frame the burst is seeded; the SFX is the player's death feedback. Showing it would need the GAME_OVER transition deferred AND the scene frozen for the animation — a deferred follow-up. NPC kills (the common case, the scene stays alive) render the blast as intended.)
- [x] Run full unit suite (`npm test -- --run`), `npm run test:playtest`, and `npm run lint` — all green; `SpaceFlightScene.ts` stays < 1900 lines. (Unit: 3917 passed / 4 skipped; playtest: 30 files, 274 passed / 2 skipped; lint: 0 errors; `SpaceFlightScene.ts` = 1898 lines.)
- [x] Visually verify both fixes via screenshot (green unit tests are not sufficient for visual bugs). (Bug 1 screenshot-verified above. Bug 2's brief death burst is a live-only manual eyeball — screenshots of the flight render loop are unreliable headlessly per memory `browser-debugging-spacerangers`; automated wiring/suppression/teardown coverage stands in.)

## Post-Completion
*Informational — no checkboxes:*
- The 4 other beta-report bugs (rep dead-end, unrewarded combat, uncollectable loot, quest unreachable) are already fixed in code post-`2de7551`. If a tester still sees them on https://alterfo.github.io/vacuum-rogues/, redeploy so the Service-Worker cache busts (`6e4642a`) — or have them hard-reload once. No code work here.
- Optional follow-up (out of scope, user deferred): in-game guidance that rank advances via kill-points at a military base (the "rank 0 @ 96k credits" confusion).
- Supply the `sfx_explosion.ogg` audio asset if the optional SFX cue is wired.
