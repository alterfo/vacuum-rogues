# Adaptive Audio

Plan: `docs/plans/20260625-adaptive-audio.md`. Combat music cross-fades in when a fight engages; ambient returns when it ends. Additive — no domain/schema/save change.

## Music director (pure)

`src/systems/audio/musicDirector.ts`. `MusicDirector.desiredTrack(ctx: {scene, inCombat, lowHull?, boss?, now})` → `TrackKey | null`. Single source of truth for track selection: combat (SPACE_FLIGHT/STAR_MAP only) wins → `combat_boss` if boss else `combat`; then `lowHull` → `tension_low`; else scene ambient (`sceneTrack(scene)`). Combat **hysteresis** (`COMBAT_HOLD_MS = 4000`): holds the combat track for 4 s after disengage. `reset()` clears it on new game/teardown.

## Music driver

`src/systems/audio/musicDriver.ts`. `MusicDriver.apply(sink, ctx)` calls `desiredTrack` and `playTrack`s it (no-op on null/unchanged). **Safe to call every frame.** Wired in `GameEngine.updateMusic(inCombat?)`: once per scene transition AND every frame from `gameLoop` with `setCombatStateProvider`. Re-evaluating each frame is what lets the held combat track revert once hysteresis elapses. `lowHull` = `hullHP < maxHull × MUSIC_TENSION_HULL_FRACTION`; `boss` = fighting inside `galaxy.overmindCoreSystemId`.

## SFX cues

`src/systems/audio/sfxCues.ts`. Discrete events: `"warp"` (`SpaceFlightScene.performWarp`), `"buy"`/`"sell"` (`TradeScene`), `"rankup"` (`StationScene.doRankPromotion`), `"explosion"` (every NPC death in `NpcShipManager`). Low-hull alarm is edge-triggered: `HullAlarm.update(sink, low)` fires `"alarm"` once per critical-hull episode, re-arms only when hull recovers. Driven from `GameEngine.updateMusic`.

## Adding tracks/SFX

Music files: `public/audio/mus_<key>.ogg` + `TrackKey` entry in `src/systems/AudioManager.ts`. SFX files: `public/audio/sfx_<key>.ogg` + `SfxKey` entry.

## Tests

`src/tests/audio/musicDirector.test.ts`, `musicDriver.test.ts`, `sfxCues.test.ts` — all against fake `MusicSink`/`SfxSink`.
