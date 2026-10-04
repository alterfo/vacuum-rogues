# Black hole arcade (vertical shooter, 50 levels)

Entered by flying into a black hole (`SpaceFlightScene.enterBlackHole` → `SceneType.BLACK_HOLE_ARCADE`). Truxton-style vertical scroller; the run is self-contained and the only thing that touches the main game is the credit payout at the end.

## Layers

- `src/systems/blackHoleArcade/` — pure, deterministic, no PixiJS. `tick(state, input, dtMs)` mutates `ArcadeRunState` in place (hot path, no allocation churn) and returns it.
  - `arcadeConfig.ts` field size (720×1080), caps, `ARCADE_DIFFICULTY` scaling.
  - `arcadeWeapons.ts` six weapons × five power levels: vulcan (fan), laser (piercing), homing, wave, plasma (blast), arc (instant chain lightning).
  - `arcadeEnemies.ts` 15 enemy types, move kinds, fire patterns (`aimed/spread/ring/spiral/rain/mines/burst`), 3-phase bosses (`bossPatterns`).
  - `arcadeLevels.ts` `buildArcadeLevel(1..50)` — seeded, deterministic spawn schedule; capsule carriers guarantee drops; cruiser every 5th level, boss every 10th.
  - `arcadePickups.ts` 16 pickup kinds (weapon colours, power, repairs, plating, armor coat, shield, bomb, wingman, magnet, chip) and drop tables.
  - `arcadeState.ts` the tick pipeline, damage model (shield → armor → hull, i-frames), bomb, level phases (`playing → levelClear → intermission → playing`, `lost`, `won`), `advanceLevel`.
  - `arcadeRewards.ts` payout; constants live in `src/config/balance.ts` (`BLACK_HOLE_ARCADE_REWARD_*`).
- `src/presentation/BlackHoleArcadeScene.ts` + `src/presentation/blackHoleArcade/` — rendering and input only: sprite pools (`spritePool.ts`), Canvas-2D procedural art (`arcadeArt.ts`), parallax background, particle FX, HUD, overlays. Enemy/player ship art reuses `ships/*` and `player_ships/*`.

## Rules

- **Mouse is instant.** `targetX/Y` snaps the ship; never add smoothing or a speed cap. Player collision is swept along the previous→current path so a flick cannot skip a bullet.
- **Never write `player.credits` directly.** The scene pays through `adjustPlayerCredits(engine.bank, …, GL_COUNTERPARTY.REWARDS, …)`, exactly once (`finishRun` is guarded by `ended`).
- Payout: levels cleared pay `base × growth^(n-1)`; `lost`/`retreat` pay half of that, `cashOut` and `won` pay all, `won` adds the victory bonus; chips always pay in full.
- Difficulty is config-only (`ARCADE_DIFFICULTY`, enemy/pattern tables). Tune there, not in the tick.
- The scene reads `startLevel` from its context; dev shortcut `http://localhost:5173/?arcade=N` (DEV builds only, `src/dev/arcadeShortcut.ts`) starts a fresh game and opens the arcade at level N.
- Nothing arcade-related is persisted; saves taken mid-run fall back to `SPACE_FLIGHT`.

## Direct access and practice mode

Besides flying into a black hole, the arcade opens from the main-menu button and from the URL (production too): `/?arcade`, `/?arcade=N` (start at level N, 1–50), `&game` starts a fresh game first (used by e2e to test payouts). Parsing/launching lives in `src/systems/arcadeLaunch.ts`. `main.ts` skips the soft mobile gate when the URL has `arcade`. With **no active player** the scene is a *practice run*: nothing is paid, labels say so, and it returns to `MAIN_MENU` instead of `SPACE_FLIGHT`. With a player (entered from a black hole or `&game`) rewards are paid as usual.

## Mobile / touch

Touch mode comes from `isTouchLayoutActive()` (single source of truth) or the first touch pointer. One finger drags **relatively** (`RelativeDrag`, gain 1.2, clamped without wind-up) so the finger never covers the ship; auto-fire is on. On-screen buttons (`arcadeButtons.ts`): sound (always visible, desktop too), pause and bomb (touch only; the bomb is lifted above the feedback button). Buttons mark their pointer id in `uiPointers` so a tap never starts a drag. The scene sets `touch-action: none`, locks overscroll, pauses on `visibilitychange`/`pagehide`/blur, vibrates on hull hits, bombs and boss kills, and shows a rotate hint on landscape phones. Layout: HUD is a compact 72 px top band; buttons overlay the field so the field uses the full width. Effects degrade automatically (`AdaptiveQuality`: 3 levels via `ARCADE_FX_QUALITY`; starts at level 1 on touch devices; never climbs back).

## Run difficulty from the pilot hull

`hullDifficulty(maxHull)` (arcadeEnemies.ts) gives 1.0 for hulls up to 55 and +0.07 per doubling, capped at 1.25. The scene reads `playerLoadout.derivedStats().maxHull` (falls back to `ship.maxHull`) at the start of every run and passes it as `createArcadeRun({ difficulty })`. `difficultyScale(level, run)` multiplies enemy HP by `run`, damage by `1 + (run-1)×0.6` and bullet speed by `1 + (run-1)×0.4` (hard cap 1.75). Tune in `ARCADE_HULL_DIFFICULTY` / `ARCADE_RUN_DIFFICULTY_*` (arcadeConfig.ts).

## Sound

`presentation/blackHoleArcade/arcadeSound.ts` — synthesized with the Web Audio API (no asset files, separate from `AudioManager`): per-weapon fire, hits, explosions, pickups, bomb, arc, player hit, fanfares, boss siren, plus a light procedural music loop (`calm` / `boss` / `off`, key by theme). The engine only emits `ArcadeEvent`s (including `fire`); the scene forwards them to `ArcadeSound.handle`. M or the HUD button toggles it; the choice persists in `localStorage` (`sr_arcade_sound`). While off, no AudioContext is even created. Voices are capped and rate limited; the context is created/resumed on the first input gesture.

## Boss motion

Bosses glide to `BOSS_HOVER_Y`, then sweep with an eased ramp (`holdMs`) and a span clamped to `FIELD_W/2 − radius − margin`. Do not drive the entry phase from `y < hover` alone: the hover bob goes above that line and re-triggers the entry branch (this was the visible jitter). `arcadeBossMotion.test.ts` pins per-frame step size and the field edges.

## Tests

- Engine: `src/tests/blackHoleArcade/` (weapons, enemies, levels, pickups, state, rewards, determinism, boss motion, sound with a fake AudioContext, simulated pilot in `arcadeBot.ts`).
- Real-engine scene playtest: `src/tests/playtest/blackHoleArcadeGameplay.test.ts`; flight-entry scaffold: `blackHoleArcadeScene.test.ts`.
- Browser: `e2e/black-hole-arcade.spec.ts` (needs `NO_PROXY=localhost,127.0.0.1` if a system HTTP proxy is set).
