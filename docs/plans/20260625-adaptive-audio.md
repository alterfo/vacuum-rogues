---
# Adaptive Audio (Combat ↔ Ambient Music + More Cues)

## Overview
Cheap polish, big feel: make the music **react** to play — swap to a tense combat track
when a fight engages and back to ambient when it ends, with the existing cross-fade, and
add a few missing SFX cues (low-hull warning, jump, trade, level-up). The crossfade
machinery already exists, so this is mostly wiring + a couple of tracks.

## Context (from discovery)
- **AudioManager** (`src/systems/AudioManager.ts`): `TrackKey`/`SfxKey` enums,
  `playTrack(key)` with a **1 s cross-fade** (no-op if already playing, previous fades
  out), `currentTrackKey`. SFX via `playSfx`. Audio is optional (missing file = silent).
- **Combat hooks:** `CombatModule` raises engage/end signals (`onPlayerUnderAttack`,
  `endCombat` → `onCombatEnded`); the active-pause has clear enter/exit points.
- New audio files follow `public/audio/mus_<key>.ogg` / `sfx_<key>.ogg` + a `TrackKey`/
  `SfxKey` entry (per `adding-features.md`).

## Development Approach
- **Testing approach: TDD.** A pure **music-director** (game/combat state → desired
  `TrackKey`) is unit-tested against a fake AudioManager (assert the right `playTrack`
  calls on engage/disengage, with debounce so brief skirmishes don't flap). Audio files
  are added but the logic is what's tested.
- Additive; no domain/schema/save change.

## Implementation Steps

### Task 1: Music director (pure state → track)
**Files:**
- Create: `src/systems/audio/musicDirector.ts` (+ test)

- [x] `desiredTrack(ctx)` mapping `{inCombat, scene, lowHull}` → a `TrackKey`, with a
      short hysteresis so combat start/stop doesn't thrash the crossfade.
- [x] write tests: ambient↔combat transitions fire once on real changes; brief flaps
      debounce; scene tracks (planet/station) selected correctly.
- [x] run tests — green.

### Task 2: Wire the director to combat + scene events
**Files:**
- Modify: `SpaceFlightScene`/`CombatModule` hooks, `AudioManager` driver

- [x] Drive `desiredTrack` from the combat engage/end + scene-change signals → call
      `playTrack`; ensure end-of-fight returns to ambient.
- [x] write tests (with a fake AudioManager): engaging a fight switches the track, ending
      restores it.
- [x] run tests — green.

### Task 3: Missing SFX cues + tracks
**Files:**
- Modify: `AudioManager` (`TrackKey`/`SfxKey`), add audio assets

- [ ] Add SFX hooks for low-hull warning, hyperjump, buy/sell, level-up/rank; add a
      combat-music `TrackKey` (file dropped in `public/audio/`).
- [ ] write tests: the cues fire at the right events (against the fake manager).
- [ ] run tests — green.

### Task 4: Verify + docs
- [ ] full suite + `test:playtest` green; lint/build ok; document the music director +
      the new track/SFX keys.

## Post-Completion
**Manual:** enter a fight → tense track cross-fades in; win → ambient returns; the new
cues fire. (Music files are content the user supplies/generates.)
