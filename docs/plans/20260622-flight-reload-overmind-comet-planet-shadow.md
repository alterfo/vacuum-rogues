---
# Playtest Fixes: Reload Spawn, Overmind Combat, Comet Tail, Planet Sun-Shadow

## Overview
Four playtest defects, each isolated to one subsystem:
1. **Reload drops the ship at the system edge.** The in-flight ship position is
   only held in the transient `GameEngine.lastFlightShipPos` (unsaved), so a
   browser reload → `loadGame("auto")` has no position to restore and
   `applyEntrySpawn` falls through to the default edge spawn. Persist the flight
   position in the save and restore it on load.
2. **The Overmind can neither be attacked nor attack.** The in-range contact
   panel sources its buttons from `commsOptionsFor`, which returns nothing for the
   Overmind "gibberish" context, and "Атаковать" is only added on the
   *beyond-radar* branch — so an in-range Overmind hail has no attack button. And
   Overmind sprites only orbit (never flagged aggressive toward the player,
   `overmindCombatTargets` targets other NPCs only), so they never close to weapon
   range or fire. Make hostile/Overmind contacts always offer "Атаковать" in
   range, and make Overmind ships pursue + engage the player.
3. **The comet tail looks poor.** `CometDustTail` is a thin, sparse fade-out mote
   stream with no bright coma (head glow), no color gradient, low emission. Give
   it a real comet read: a bright coma at the head and a denser, tapered,
   colour-graded tail — within the existing pooled-particle / no-BlurFilter / FPS
   bound.
4. **Planets have no sun shadow.** `PlanetRotationFilter` does limb-darkening +
   rim-light but has no light direction, so the disc is evenly lit. Add a
   star-direction terminator (day/night) shaded from the system's star.

## Context
Files/components (confirmed by exploration):
- **Reload spawn:** `src/presentation/SpaceFlightScene.ts` — `applyEntrySpawn`
  (~L1017) honours `ctx.preserveShipPos` → teleport, else `fromPlanetId` arc, else
  `applyReentrySpawn` → station/`landedPlanetId`, else **default edge spawn**.
  `GameEngine.lastFlightShipPos` is transient/unsaved (`NpcShipManager.ts:1404`,
  `rememberFlightPos`). Save plumbing: `GameEngine.loadGame("auto")` (~L967);
  `SaveState` + `src/validation/schemas.ts` (lockstep rule); `MigrationPipeline`.
- **Overmind combat:** `src/presentation/NpcContactPanel.ts` — `buildActionButtons`
  (~L148): `showStanding=false` for `context==="overmind"`; in-range buttons come
  only from `commsOptionsFor(npc, context)`; "Атаковать" is hard-added **only** in
  the beyond-radar `else` (~L261). `src/presentation/flight/NpcShipManager.ts` —
  `onAttackNpc` (~L1353, follow-to-intercept then `launchCombatWithNpc` in range);
  aggressor auto-engage (`sprite.aggressive && physics` → close to `WEAPON_RANGE`
  → combat, ~L243-292); `updateOvermindCombat` / `overmindCombatTargets` (~L326-365,
  Overmind-vs-NPC only); `escalateHostility`, `setAggressive`, garrison-aggro
  re-eval (~L754-766). Hostility matrix: `src/systems/npc/factionHostility.ts`.
- **Comet tail:** `src/presentation/flight/cometDustTail.ts` (pure emitter:
  `TAIL_SPEED`, `LIFE_*`, `SPREAD`, `EMIT_RATE`, `moteAlpha`, `moteScale`);
  rendered by `AsteroidBelt` mirroring each pool slot 1:1 onto a pooled PixiJS
  `Particle` (blendMode "add"). Rules: **no BlurFilter in the flight scene**
  (memory `feedback-no-blur-filters-flight`); keep the **hard live-mote bound**
  (FPS guard `project-system-map-baseline-fps`).
- **Planet shadow:** `src/presentation/filters/PlanetRotationFilter.ts` — GLSL
  filter with `uOffset` (rotation) + `uRim` (rim light), limb-darkening, disc clip;
  no light-direction uniform. `src/presentation/PlanetSprite.ts` (map-backed sphere
  path vs pre-shaded cut-out disc path); `src/presentation/flight/PlanetManager.ts`
  drives per-frame planet update and knows the star centre (`StarRenderer.centerX/Y`).

Standing rules that bound this work:
- **Do NOT modify/weaken existing test assertions** — add new tests only.
- Any `src/types`/`src/domain` change updates `src/validation/schemas.ts` in
  lockstep; prefer an **optional additive** save field (no save-version bump; old
  saves simply fall back to the current edge spawn).
- `SpaceFlightScene.ts` must stay **< 1900 lines** (`moduleContracts.test.ts`) —
  keep new logic in modules/helpers, not the scene.
- Visual fixes (comet, planet shadow) require **screenshot verification**, not just
  green text tests (project bug-fixing rule #3).
- Run `gitnexus impact` on each edited symbol first; warn on HIGH/CRITICAL.

## Development Approach
- **TDD for logic** (save round-trip, attack-button presence, Overmind aggression
  gating, emitter shape): red test first, then fix. **Screenshot-verify** the two
  visual fixes.
- **Isolated/clean:** keep pure logic pure (the comet emitter stays PixiJS-free;
  hostility/contact decisions stay in their existing pure helpers). No module
  imports another — the scene mediates.
- Complete each task (code + new tests green) before the next; full suite + lint at
  the end.

## Implementation Steps

### Task 1: Persist + restore the in-flight ship position across reload
**Files:**
- Modify: `src/types/index.ts` (or the SaveState type home) — add optional flight pos
- Modify: `src/validation/schemas.ts` (lockstep; optional field)
- Modify: `src/data/MigrationPipeline.ts` (only if a default is needed)
- Modify: `src/systems/GameEngine.ts` (write pos into save, read into entry ctx)
- Modify: `src/presentation/SpaceFlightScene.ts` (consume `preserveShipPos` on load)
- Create/Modify tests under `src/tests/`

- [x] `gitnexus impact` on `applyEntrySpawn` and the SaveState serializer; confirm blast radius.
- [x] Add an **optional** `flightShipPos?: {x,y}` (+ `currentSystemId` guard) to the
      save state and its Zod schema; default absent so pre-existing saves validate
      unchanged (no save-version bump). Implemented as `{x,y,systemId}` so the
      restore is system-guarded; field added to `SaveState` + `SaveStateSchema`.
- [x] On save, persist the live flight position (from `lastFlightShipPos` / ship
      physics) when the active scene is SPACE_FLIGHT; ignore otherwise. Captured
      into a sticky, system-tagged `GameEngine.flightShipPos` whenever
      `lastFlightShipPos` is set (always a live flight position) so a later
      non-flight autosave (which consumes `lastFlightShipPos` to null) does not
      clear the last good position.
- [x] On `loadGame`, when entering SPACE_FLIGHT and the saved `flightShipPos`
      belongs to the loaded `currentSystemId`, pass it as `ctx.preserveShipPos` so
      `applyEntrySpawn` teleports the ship there instead of edge-spawning.
- [x] write tests: save→load round-trip restores the flight position; a save
      without the field still loads and falls back to the current edge spawn
      (success + back-compat + system-mismatch cases) —
      `src/tests/core/GameEngine.flight-position.test.ts`.
- [x] run touched tests — green (flight-position, persist-location, loadout,
      save/migration, banking persistence, moduleContracts; tsc + eslint clean).

### Task 2: Overmind can be attacked and will attack the player
**Files:**
- Modify: `src/presentation/NpcContactPanel.ts` (always offer in-range "Атаковать")
- Modify: `src/presentation/flight/NpcShipManager.ts` (Overmind aggression vs player)
- Modify: `src/systems/npc/factionHostility.ts` only if the matrix must mark Overmind→player
- Create/Modify tests under `src/tests/`

- [x] `gitnexus impact` on `buildActionButtons` and the NPC aggro update; confirm scope.
      `checkGarrisonAggro` impact = LOW (direct callers: `applyGarrisonAggro` +
      `garrisonCombat.test.ts`); `buildActionButtons` is a private renderer (read
      directly). No HIGH/CRITICAL.
- [x] In `buildActionButtons`, always append an in-range **"Атаковать"** for a
      hostile/Overmind contact (so the gibberish/no-comms path can never strip the
      only meaningful action). Keep the neutral panel's existing button set intact.
      Guarded on `hostileContact && !hasAttack`, so only the Overmind (empty
      `commsOptionsFor`) gains the missing button; neutral/hostile-other/shakedown
      are untouched (they already list attack).
- [x] Make Overmind sprites **aggressive toward the player**: flag them so the
      existing aggressor path (`sprite.aggressive` → close to `WEAPON_RANGE` →
      `addCombatant`/fire) engages, mirroring garrison aggressors. Reuse the
      hostility matrix as the single source of truth; do not fork engagement logic.
      `checkGarrisonAggro` now flags a live (`isAggressive()`) Overmind via
      `isHostile("overmind","player",…)` regardless of the captured-system flag —
      so a capture fleet besieging a still-neutral system hunts the player. A
      passive (non-hostile) Overmind stub stays in orbit (existing test green).
- [x] Verify the player's "Атаковать" → intercept → in-range `launchCombatWithNpc`
      path works against an Overmind target (no early-out for the Overmind role).
      Covered by the "player's Атаковать engages an in-range Overmind" test.
- [x] write tests: in-range Overmind contact exposes an "Атаковать" action; an
      Overmind sprite within weapon range is added as a combatant and fires at the
      player (and the player's attack engages it). Add to existing combat/contact
      test suites without altering their assertions. New files
      `overmindContactPanel.test.ts` (panel, mocked pixi) +
      `overmindCombat.test.ts` (aggro + real CombatModule arena); no existing
      assertion touched.
- [x] run touched tests — green (9 new + garrisonCombat/combatEngagement/
      npcShipManager/npcHostility/modalKeys/factionHostility/crossFactionCombat/
      overmindAggression/moduleContracts/combatEscape = 136 green; tsc + eslint clean).

### Task 3: Make the comet tail read like a comet (coma + tapered graded tail)
**Files:**
- Modify: `src/presentation/flight/cometDustTail.ts` (emitter shape/params, pure)
- Modify: `src/presentation/flight/AsteroidBelt.ts` (render: coma head glow, per-mote
  colour/scale gradient, additive — NO BlurFilter)
- Modify/Create tests under `src/tests/` (emitter), screenshot for the visual

- [x] `gitnexus impact` on `CometDustTail` + its `AsteroidBelt` renderer. Blast
      radius LOW and confined: `cometDustTail.ts` (pure) is imported only by
      `AsteroidBelt.ts` (flight modules never import each other) + the
      `cometParticleTail` test; `syncTail` is private to the renderer. Index just
      hadn't re-analyzed the 2026-06-20 symbols; no HIGH/CRITICAL.
- [x] Strengthen the emitter for a denser, longer, tapered stream: `EMIT_RATE`
      0.03→0.05 (~50/s), `TAIL_SPEED` 0.16→0.2, life band 1500–3000→1600–3400
      (mid-band kept <3000 so the recycle test stays green), `SPREAD` 0.45→0.32
      (directed, not a fan), `moteScale` falloff 0.5→0.6 (deeper taper). Pool
      ceiling 64→96 — saturates a dense trail while staying within the
      ParticleContainer/additive-overdraw FPS budget (2 comets ≤192 batched).
- [x] Added a bright two-layer **coma** (icy halo + warm-white compact core
      `softGlowTexture` sprites, additive) at the nucleus, and a head→tail
      **colour/alpha/scale gradient** — per-mote tint lerps a warm-white coma
      (`TAIL_HEAD_TINT`) to a cool-blue tail tip (`TAIL_TIP_TINT`) via the pure
      `lerpHex`/`moteLifeFraction`, scale/alpha already taper. **No BlurFilter**
      — soft edges are the baked `softGlowTexture`/`dustParticleTexture` gradients.
- [x] write/extend emitter tests for the new shape — new additive file
      `cometTailShape.test.ts` (dense-pool saturation ≤ max; monotone scale taper
      head→tip; `moteLifeFraction` 0→1 + recycled-slot guard; `lerpHex`
      endpoints/midpoint/clamp + warm→cool channel grade); existing
      `cometParticleTail` assertions untouched.
- [x] run emitter tests — green (42: cometParticleTail + cometTailShape +
      asteroidBelt + moduleContracts; tsc + eslint clean). **Screenshot**
      captured via a deterministic Playwright harness (comet driven into the
      inner system, world frozen) → `e2e/screenshots/comet-tail-task3.png`:
      confirms a bright coma head + a denser, tapered, colour-graded dust tail.

### Task 4: Star-direction terminator (sun shadow) on planets
**Files:**
- Modify: `src/presentation/filters/PlanetRotationFilter.ts` (add light-dir uniform + terminator)
- Modify: `src/presentation/PlanetSprite.ts` / `src/presentation/flight/PlanetManager.ts`
  (feed the star-direction each frame)
- Create/Modify tests under `src/tests/` (uniform wiring), screenshot for the visual

- [ ] `gitnexus impact` on `PlanetRotationFilter` and `PlanetSprite` shading.
- [ ] Add a `uLightDir` (vec2, screen-space direction to the star) uniform to the
      filter; in the fragment shader reconstruct the sphere normal from the disc UV,
      dot with `uLightDir`, and darken the night side with a smooth terminator
      (keep the existing limb-darkening + rim-light; the rim-light should sit on the
      lit limb).
- [ ] Each frame, set `uLightDir` from the planet→star vector
      (`StarRenderer.centerX/Y` − planet screen pos), normalized; rotation (`uOffset`)
      stays independent so the surface still spins under a fixed sun.
- [ ] write a test asserting the filter exposes/updates `uLightDir` and that
      `PlanetManager` feeds a star-pointing direction (math-level; no GL needed).
- [ ] run touched tests — green; **capture a screenshot** confirming a visible
      day/night terminator with the lit side facing the star.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] Reload mid-flight (load the autosave) → ship resumes at its saved position,
      not the system edge.
- [ ] In-range Overmind contact shows "Атаковать"; attacking engages real-time
      combat; an Overmind ship closes and fires on the player.
- [ ] Comet shows a bright coma + tapered graded tail (screenshot attached).
- [ ] Planets show a sun-facing lit side and a shadowed night side (screenshot attached).
- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only expected symbols affected.
- [ ] full unit suite `npm test -- --run` green (incl. untouched assertions); `npm run lint` clean.

## Technical Details
- Reload fix is an **optional additive** save field → no `SaveState` version bump;
  the restore is guarded by `currentSystemId` so a position can never be applied to
  the wrong system (else fall back to edge spawn).
- Overmind aggression reuses the existing aggressor/`addCombatant` pipeline and the
  `factionHostility` matrix — no parallel combat path; the contact-panel change only
  guarantees the attack affordance is never stripped by the comms-gibberish gate.
- Comet + planet-shadow obey the flight-scene **no-BlurFilter** rule (bake glows to
  gradient textures) and the comet keeps its **hard live-mote bound** (FPS guard).
- `SpaceFlightScene.ts` stays < 1900 lines (logic in modules/helpers).

## Post-Completion
**Manual verification (screenshots / live):**
- Reload at several in-system positions; confirm exact-ish resume and a clean
  fallback for pre-existing saves.
- Fly into an Overmind-held system; confirm two-way combat and the attack button.
- Eyeball a comet flyby and a few planet types (terrestrial/gas) for the terminator.
