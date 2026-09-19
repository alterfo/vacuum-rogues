---
# Black Holes + Star Defender Arcade Minigame

## Overview

Adds black holes to the game as a new hazard/attraction:

1. **In-system anomaly**: a rare, procedurally-rendered black hole object placed in ~8% of
   generated star systems (a new `hasBlackHoleAnomaly` flag on `StarSystem`, independent of
   `StarType` — the existing `StarType.BLACK_HOLE` enum member stays unused/dead, as decided).
   Rendered as an animated accretion-disk/event-horizon object the player can fly toward and
   into, reusing the proximity-contact pattern `StarRenderer` already uses for the sun.
2. **Hyperjump mishap**: every hyperjump carries a small independent chance of being pulled off
   course into the nearest black-hole system instead of the intended destination — "sometimes
   you fall into one while traveling between systems."
3. **Arcade sub-game**: flying into (or being pulled into) the event horizon launches a
   horizontal, free-2D-movement scrolling shooter in the Star Defender II mold (StrategyWiki:
   https://strategywiki.org/wiki/Star_Defender_2) — 2-3 enemy waves with distinct enemy
   archetypes, run-scoped weapon/shield/bomb power-ups, and a single multi-phase boss — with
   Alawar-casual-game-level presentation polish (particles, screen shake, satisfying hit
   feedback) layered on top of fully procedural (Pixi `Graphics`/baked-canvas) art, since the
   project ships zero external art/audio assets for this feature.

Stakes: the player's real ship (`hullHP`/`maxHull`) is the arcade "life bar," so combat in the
minigame has real consequences, but this hazard **can never destroy the ship** — a deliberate,
explicitly-scoped exception to the normal death/GAME_OVER path (see Technical Details). Winning
(boss defeated) teleports the player to a system connected to the black-hole system plus a small
loot/credit reward; losing (hull would zero out) ejects the player back into normal flight with
heavy hull damage and no permadeath.

This plan is the explicitly-deferred follow-up named in
`docs/plans/completed/20260713-tactical-pause-combat-rework.md` ("Black holes... a follow-up
plan for the galaxy hazard entity, gated on this plan's core loop already being live and
stable" — that core loop, tactical-pause combat, is live).

## Context

Research (this session, via Explore agent + direct file reads) found:

- `StarType.BLACK_HOLE` (`src/types/index.ts:10`) exists but is unused/dead — excluded from
  star-type generation on purpose (`docs/plans/completed/20260625-economy-homogeneous-tech-start-speed.md`
  Task 5, "no art"). It stays dead; the anomaly is a **separate** object type, not a star-type
  swap (per this planning session's design decision).
- Hyperjump is a single synchronous transition, not a multi-turn travel screen:
  `SpaceFlightScene.performWarp()` (`src/presentation/SpaceFlightScene.ts:1264-1317`) deducts
  fuel, sets `player.currentSystemId`, autosaves, then calls `gameEngine.transitionTo`. The
  mishap roll hooks in here.
- `StarRenderer` (`src/presentation/flight/StarRenderer.ts`) is the closest existing precedent
  for an animated central hazard object with proximity contact: `updateSunContactDamage`
  (`:86-123`) computes `distToStar < this.radius` and applies periodic hull damage via
  `applyDamageWithMode` (`src/systems/combat/godMode.ts`) while touching. The black-hole
  renderer mirrors this shape but branches into a scene transition instead of damage-only.
- `AsteroidBelt.ts` / `gradientTexture.ts` (`docs/plans/completed/20260708-space-visual-cleanup.md`)
  establish the "bake once via Canvas2D, cache by seed, `Graphics` fallback with no 2D context"
  convention for procedural visuals — the pattern for a new `blackHoleTexture()` baker.
- `combatGravity.ts` (in-flight gravity assist) explicitly notes "black holes were deferred" —
  **out of scope here**: this plan does not touch in-combat gravity-assist physics, only the
  anomaly's own presence/contact/sub-game trigger.
- Combat is tactical-pause (`docs/plans/completed/20260713-tactical-pause-combat-rework.md`) —
  a 2D scrolling shooter is a different paradigm and is **fully green-field**; nothing to reuse
  for the arcade loop itself.
- Scene wiring conventions (`.claude/docs/adding-features.md` "New Scene"): add `SceneType`,
  register in `src/core/services/SceneFactory.ts`, add to `contextDependentScenes` in
  `GameEngine.loadGame()`, add an E2E page object. `npx tsx tools/scaffold/new-scene.ts --name
  BlackHoleArcade --context-dependent` automates steps 1-3 + the class stub.
- Domain-field convention (`.claude/docs/adding-features.md` "New Domain Field"): update
  `src/types/index.ts`/`src/domain/*.ts` → `src/validation/schemas.ts` → migration only if a
  bump is needed. `StarSystem`'s mutable fields (`explored`, `isFactionHome`, `techLevel`) are
  declared with defaults **outside** the constructor and set post-construction by galaxy-gen
  helpers (`assignSystemTechLevels` in `src/systems/galaxy/systemTechDistribution.ts`) — the
  same pattern applies to `hasBlackHoleAnomaly`, so **no constructor signature change** and no
  test-call-site churn (dozens of `new StarSystem(...)` call sites in `src/tests/**`).
  `StarSystemSchema.hasBlackHoleAnomaly` as `z.boolean().default(false)` is an additive-optional
  field per root `CLAUDE.md`'s save-compatibility rule — **no migration/version bump needed**.
- Root `CLAUDE.md` mandates a `gitnexus impact <Symbol>` blast-radius check before editing any
  existing symbol — required before touching `performWarp`, `StarSystem`, `GameEngine.transitionTo`,
  `SceneType`, and the `StarRenderer`/flight-module list.
- GOD-mode damage routing (`src/systems/combat/godMode.ts`, root `CLAUDE.md` "Difficulty Modes")
  — **every** hull-damage path must go through `applyDamageWithMode`.

## Development Approach

- **Testing**: Regular (implementation first, then tests per task — user's explicit choice for
  this plan), matching the project's normal (non-bugfix) convention. Route each new area to the
  project's matching test tier (root `CLAUDE.md` "Three test tiers"):
  - **Unit (mocked/pure)**: every new pure module (galaxy-gen roll, mishap roll, arcade state
    machine, collision, wave/boss pattern logic, outcome resolver) — PixiJS-free, following the
    `combatPlanning.ts`/`combatGravity.ts` convention of pure-logic-tested-standalone.
  - **Real-engine playtest** (`src/tests/playtest/**`): the wiring — entering a black-hole
    system mounts the renderer; flying into the horizon transitions to `BLACK_HOLE_ARCADE`;
    win/lose transitions back to `SPACE_FLIGHT` with the correct hull/credits/system changes.
  - **Playwright E2E**: the visual/interaction path (black hole visible + flyable-into,
    minigame movement/shooting responds to input) — this feature is rendering- and
    interaction-heavy, exactly the class E2E exists for.
- Before editing `performWarp`, `StarSystem`, `GameEngine.transitionTo`/`SceneType`, or the
  `StarRenderer`/flight-module wiring in `SpaceFlightScene`, run `gitnexus impact <Symbol>` and
  record the blast radius per root `CLAUDE.md`.
- Every hull-damage path in the arcade (enemy fire, boss attacks) routes through
  `applyDamageWithMode` — never mutate `ship.hullHP` directly.
- The arcade run is fully transient (no in-progress save state) — only the persistent
  `hasBlackHoleAnomaly` flag and the real hull/credit/inventory changes on exit touch save data.
  `BLACK_HOLE_ARCADE` goes into `contextDependentScenes` so a reload during a run falls back to
  `SPACE_FLIGHT` (the run itself is not resumable — same class as a combat encounter overlay).
- All new player-facing strings go through `t(key, params?)` with RU (`src/i18n/ru.ts`) +
  EN (`src/i18n/en.ts`) keys added in lockstep (parity test enforces this) — no literal Cyrillic.
- No new art or audio asset files are added (none were provided) — all visuals are procedural
  (`Graphics`/baked-canvas textures per `gradientTexture.ts`'s convention) and all sound reuses
  existing `SfxKey` entries in `src/systems/AudioManager.ts` (fire/explosion/pickup/warp).
- Keep each task's diff scoped to its stated files; run `gitnexus detect_changes()` before
  considering a task's commit final.

## Testing Strategy

- **Unit tests**: required for every pure module listed per task (success + edge cases:
  determinism, zero-black-hole-galaxy guard, hull-floor invariant, wave/boss transition logic).
- **Real-engine playtest**: scene-wiring tests for the black-hole → arcade → back-to-flight loop
  (win path and lose path), added to `src/tests/playtest/**`.
- **E2E**: one new Playwright spec (or an addition to `playtest-regression.spec.ts`) covering the
  visual black hole + flying into it + basic arcade input responsiveness — visually verified via
  screenshot before considered done (root `CLAUDE.md` bug-fixing-process rule 3, applied here to
  new UI/rendering work too).
- Run `npm test -- --run`, `npm run test:playtest`, and `npm run test:e2e` (or the regression
  subset) before marking the final task complete; `npm run lint` must be clean.

## Progress Tracking

- Mark `[x]` immediately when a checklist item completes.
- Add newly discovered tasks with ➕, blockers with ⚠️.
- Update this plan file if scope changes during implementation (e.g. if content volume needs to
  shrink from "2-3 waves + 1 boss" — record the change and why).

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): all code, tests, and wiring below — fully
  automatable by the agent.
- **Post-Completion** (no checkboxes): manual live-browser feel verification, balance tuning,
  and any real audio/art asset follow-up.

## Implementation Steps

### Task 1: Black-hole anomaly domain field + galaxy generation

**Files:**
- Modify: `src/domain/StarSystem.ts`
- Modify: `src/validation/schemas.ts`
- Modify: `src/config/balance.ts`
- Create: `src/systems/galaxy/blackHoleDistribution.ts`
- Modify: `src/systems/GalaxySimulator.ts`

- [x] Run `gitnexus impact StarSystem` and `gitnexus impact GalaxySimulator`, record blast radius
      (gitnexus MCP/CLI unavailable in this environment — index is stale at 2026-07-02 and the
      CLI exits without running; blast radius verified manually: `StarSystem` is constructed by
      `GalaxySimulator.generateGalaxy` and read type-only across `src/**`; `GalaxySimulator` has
      no external callers beyond tests)
- [x] Add `hasBlackHoleAnomaly: boolean = false;` as a mutable field on `StarSystem`
      (declared like `isFactionHome`/`techLevel`, **not** a constructor parameter, so no
      call-site churn across `src/tests/**`)
- [x] Add `hasBlackHoleAnomaly: z.boolean().default(false)` to `StarSystemSchema`
      (`src/validation/schemas.ts:259-293`) — additive-optional, no migration
- [x] Add balance constants to `src/config/balance.ts`: `BLACK_HOLE_SYSTEM_CHANCE` (0.08),
      `BLACK_HOLE_VISUAL_RADIUS` (130), `BLACK_HOLE_EVENT_HORIZON_RADIUS` (90),
      `BLACK_HOLE_JUMP_MISHAP_CHANCE` (0.015)
- [x] Create `blackHoleDistribution.ts` mirroring `systemTechDistribution.ts`'s shape:
      `pickHasBlackHoleAnomaly(rng): boolean` (weighted by `BLACK_HOLE_SYSTEM_CHANCE`) +
      `assignBlackHoleAnomalies(systems: StarSystem[], seed: string): void`, per-system seeded
      as `new SeededRNG(\`${seed}_blackhole_${i}\`)` (never perturbs the shared `this.rng`
      stream, matching the `_tech_${i}`/`_faction_${i}` convention) — guarantee **at least one**
      anomaly system when `systems.length >= 8` (mirrors the tech-floor guarantee pattern) so
      small test galaxies aren't guaranteed zero, but don't force one below that size
- [x] Wire `assignBlackHoleAnomalies(generatedSystems, seed)` into `GalaxySimulator.generate`
      right after the existing `assignSystemTechLevels(generatedSystems, seed)` call (`:139`)
- [x] Write tests for `pickHasBlackHoleAnomaly`/`assignBlackHoleAnomalies` (determinism by seed,
      approx rate over a large sample, the ≥1-guarantee on a large galaxy, zero-anomaly
      possibility on a tiny galaxy)
- [x] Write a schema round-trip test: an old-shaped save payload (no `hasBlackHoleAnomaly` key)
      parses with the field defaulting to `false`
- [x] Run tests — must pass before Task 2 (new `blackHoleDistribution.test.ts` 11/11 green;
      `npx tsc --noEmit` and `npm run lint` clean; full unit run has 2 pre-existing Node 26
      localStorage/canvas environment failures unrelated to this change — both pass in isolation)

### Task 2: In-system black-hole rendering + contact detection

**Files:**
- Modify: `src/presentation/gradientTexture.ts`
- Create: `src/presentation/flight/BlackHoleRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Run `gitnexus impact SpaceFlightScene` (flight-module wiring section), record blast radius
- [ ] Add `blackHoleTexture(seed: string): Texture | null` to `gradientTexture.ts` following the
      existing bake-once-via-Canvas2D-cache-by-seed convention (`nebulaCloudTexture`/
      `cometHeadTexture`): a radial accretion-disk gradient (warm inner ring → dark outer) plus
      a solid dark event-horizon core; return `null` with no 2D context so callers fall back to
      a `Graphics` approximation (same contract every other baker follows)
- [ ] Create `BlackHoleRenderer implements FlightModule` (`initialize()`/`update(dt,
      bgElapsed)`/`destroy()`), constructed only when `system.hasBlackHoleAnomaly` is true.
      Position seeded via `new SeededRNG(\`blackhole_${systemId}\`)` at a fixed angle/radius
      within `[SYSTEM_GEOMETRY.innerRadius, SYSTEM_GEOMETRY.outerRadius]` (same band planets
      use), independent of the star (never at the star's own position)
- [ ] Visual: mount the baked texture (or `Graphics` fallback: layered rotating rings + a dark
      core `Graphics.circle` + `softGlowTexture` halo tinted toward violet/blue, reusing
      `buildStarHalo`'s halo-sprite approach) at `BLACK_HOLE_VISUAL_RADIUS`; animate slow rotation
      + a subtle pulsing scale on the core in `update()`, gated on `!reducedMotion()` per the
      accessibility seam (`src/presentation/ui/reducedMotion.ts`) for the autonomous portion of
      the animation (idle spin), per `.claude/docs/adding-features.md`'s accessibility rules
- [ ] Add `updateBlackHoleContact(playerX, playerY): boolean` mirroring
      `StarRenderer.updateSunContactDamage`'s distance check, returning true once when
      `dist < BLACK_HOLE_EVENT_HORIZON_RADIUS` (no periodic damage here — a **single**
      one-shot trigger, since entering *launches the sub-game* rather than applying continuous
      damage)
- [ ] Wire into `SpaceFlightScene`: instantiate `BlackHoleRenderer` alongside the other flight
      modules only when the current system has the anomaly; on `updateBlackHoleContact` returning
      true, call a new `enterBlackHole()` method (stub in this task — full transition wired in
      Task 4) instead of applying damage
- [ ] Write tests for `BlackHoleRenderer`'s pure position-seeding (deterministic by systemId,
      lands within the expected radius band) and `updateBlackHoleContact`'s distance math
      (touching/not-touching/one-shot-not-retriggering-until-leaving-and-reentering)
- [ ] Run tests — must pass before Task 3

### Task 3: Hyperjump mishap

**Files:**
- Create: `src/systems/galaxy/blackHoleMishap.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Run `gitnexus impact performWarp`, record blast radius
- [ ] Create `blackHoleMishap.ts`: `rollBlackHoleMishap(seed: string): boolean` (pure, weighted
      by `BLACK_HOLE_JUMP_MISHAP_CHANCE`, seeded per-jump e.g.
      `\`mishap_${sourceSystemId}_${targetSystemId}_${gameDays}\`` so it's deterministic-testable
      but varies jump-to-jump) + `findNearestBlackHoleSystem(galaxy, fromSystemId): StarSystem |
      null` (BFS over `connections`, reusing the existing graph-hop approach from
      `src/systems/galaxy/jumpDistance.ts` as a reference, not a dependency) — returns `null`
      when the galaxy has zero `hasBlackHoleAnomaly` systems (mishap is then a no-op)
- [ ] In `performWarp()` (`SpaceFlightScene.ts:1264-1317`), after resolving `target` and before
      committing the jump: roll `rollBlackHoleMishap`; on a hit with a non-null nearest black-hole
      system, redirect the jump's `targetSystemId` to that system's id and pass a
      `warpMishap: true` flag through the `SPACE_FLIGHT` transition context
- [ ] On `SPACE_FLIGHT` init with `warpMishap: true` in a black-hole system, spawn the ship at a
      point already just outside `BLACK_HOLE_EVENT_HORIZON_RADIUS` from the anomaly (reusing
      `BlackHoleRenderer`'s seeded position, not a new spawn-geometry concept) so the existing
      `updateBlackHoleContact` check naturally fires within the first few frames — the mishap
      reuses the exact same entry trigger as flying in voluntarily, no second trigger path
- [ ] Write tests for `rollBlackHoleMishap` (rate/determinism) and `findNearestBlackHoleSystem`
      (correct nearest pick, `null` on a galaxy with none, doesn't mutate the galaxy)
- [ ] Write a real-engine playtest test: a forced-true mishap roll redirects `performWarp` to a
      black-hole system and the ship spawns within contact range
- [ ] Run tests — must pass before Task 4

### Task 4: `BLACK_HOLE_ARCADE` scene scaffold + transition wiring

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/core/services/SceneFactory.ts`
- Modify: `src/systems/GameEngine.ts`
- Create: `src/presentation/BlackHoleArcadeScene.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`
- Create: `e2e/page-objects/BlackHoleArcadeScenePage.ts`

- [ ] Run `gitnexus impact SceneType` and `gitnexus impact GameEngine.transitionTo`, record blast
      radius
- [ ] Run `npx tsx tools/scaffold/new-scene.ts --name BlackHoleArcade --context-dependent` to
      generate the `SceneType.BLACK_HOLE_ARCADE` enum entry, the `SceneFactory` case, the
      `contextDependentScenes` entry, and the scene stub — then verify/adjust its output against
      this task's remaining items (the scaffold does steps 1-3 of `adding-features.md`'s "New
      Scene" recipe automatically)
- [ ] Confirm `SceneType.BLACK_HOLE_ARCADE` is added to the `gameEngine`-context injection list
      in `GameEngine.transitionTo` (`:508-519`) so the scene receives `gameEngine` in context
- [ ] Exclude `BLACK_HOLE_ARCADE` from the terminal-scene autosave concerns (it's not terminal,
      normal mid-gameplay autosave-on-transition is fine and desired here)
- [ ] Wire `SpaceFlightScene.enterBlackHole()` (the Task 2 stub) to call
      `gameEngine.transitionTo(SceneType.BLACK_HOLE_ARCADE, { gameEngine, returnSystemId,
      blackHoleSystemId })`
- [ ] `BlackHoleArcadeScene.initialize(context)` reads `gameEngine`/`returnSystemId`/
      `blackHoleSystemId`, mounts an empty container (full gameplay wired in Tasks 5-9), and on
      `destroy()` releases all children (mirrors the `gameLayer.children.length === 0` contract
      flight modules follow)
- [ ] Add the scaffolded `BlackHoleArcadeScenePage` E2E page object
- [ ] Write a real-engine playtest test: contact-triggering `enterBlackHole()` transitions
      `currentSceneType` to `BLACK_HOLE_ARCADE` with the expected context; loading a save mid-run
      falls back to `SPACE_FLIGHT` (the `contextDependentScenes` contract)
- [ ] Run tests — must pass before Task 5

### Task 5: Arcade core loop — pure state machine

**Files:**
- Create: `src/systems/blackHoleArcade/arcadeState.ts`
- Create: `src/systems/blackHoleArcade/arcadeCollision.ts`

- [ ] Design `ArcadeState` (PixiJS-free): player `{x, y, hullHP, maxHull, weaponTier, shieldActive,
      bombCount}`, `enemies: ArcadeEnemy[]`, `playerBullets`/`enemyBullets: ArcadeBullet[]`,
      `powerups: ArcadePowerup[]`, `wave: number`, `elapsedMs`, `outcome: "playing" | "won" |
      "lost"` — mirrors `combatPlanning.ts`'s "pure PixiJS-free state machine over opaque
      handles" convention
- [ ] `tick(state: ArcadeState, input: ArcadeInput, dt: number): ArcadeState` — pure reducer:
      player movement clamped to the horizontal-scroller play-field bounds (free 2D movement
      within bounds, not rail-locked), bullet advancement, off-screen pruning, fire-cooldown
      handling
- [ ] `arcadeCollision.ts`: pure circle/AABB collision resolution — player-bullet vs enemy,
      enemy-bullet vs player, enemy vs player (ram damage), player vs powerup pickup. Returns
      resolved damage/pickup events rather than mutating in place, consumed by `tick`
- [ ] **Hull-floor invariant**: any damage event that would take `player.hullHP` to or below
      `BLACK_HOLE_ARCADE_HULL_FLOOR` (new balance constant, value 1) instead floors `hullHP` at
      that value **and** sets `outcome = "lost"` — this is the deliberate no-permadeath carve-out
      (see Technical Details); it applies regardless of `GameMode`, on top of (not instead of)
      the normal `applyDamageWithMode` call at the presentation layer
- [ ] Write tests: movement bounds-clamping, bullet lifecycle/pruning, each collision pairing,
      and the hull-floor invariant (damage that would zero hull floors it + flips outcome,
      confirmed for GOD/NORMAL/HARD alike)
- [ ] Run tests — must pass before Task 6

### Task 6: Arcade rendering — presentation layer

**Files:**
- Modify: `src/presentation/BlackHoleArcadeScene.ts`
- Create: `src/presentation/blackHoleArcade/arcadePlayerInput.ts`

- [ ] Wire keyboard/pointer input (reuse the existing `input/keymap.ts` seam for movement +a
      dedicated fire key/click, per `.claude/docs/adding-features.md`'s "new flight shortcut"
      convention — do not add a literal `event.key ===` branch) into `ArcadeInput` each frame
- [ ] Render the player ship, enemies, bullets, and a horizontally-scrolling procedural starfield
      background as `Graphics`/`Sprite` objects driven purely by the `ArcadeState` from Task 5 —
      no gameplay logic in the renderer, it only reads state and draws
- [ ] Render a HUD: hull bar (reads `player.hullHP`/`maxHull`, reusing hull-bar visual language
      from `combatStatusBars.ts` where reasonable), wave counter, weapon-tier indicator — all
      text through `scaledText`/`t(...)` per presentation-layer rules
- [ ] Write a real-engine playtest test: simulated input over several frames moves the rendered
      player position and the HUD hull value tracks `ArcadeState.player.hullHP`
- [ ] Run tests — must pass before Task 7

### Task 7: Enemy waves + power-ups

**Files:**
- Create: `src/systems/blackHoleArcade/arcadeWaves.ts`
- Create: `src/systems/blackHoleArcade/arcadePowerups.ts`
- Modify: `src/config/balance.ts`
- Modify: `src/presentation/BlackHoleArcadeScene.ts`

- [ ] Add `BLACK_HOLE_ARCADE` balance block to `balance.ts`: wave count (3), enemies-per-wave
      tiers, enemy archetype speeds/HP/fire-rates, power-up drop chance, `weaponTier` max (3),
      `BLACK_HOLE_ARCADE_HULL_FLOOR` (from Task 5)
- [ ] `arcadeWaves.ts`: pure wave/spawn-timing logic — 2-3 distinct enemy archetypes with
      different movement patterns (straight-line, sine-wave weave, aimed-shot) and fire
      behavior, advancing `wave` when a wave's enemies are cleared, triggering the boss (Task 8)
      after the final wave
- [ ] `arcadePowerups.ts`: weapon-upgrade (raises `weaponTier`, run-scoped only — never touches
      the player's real fitted loadout), temporary shield (absorbs N hits before hull damage
      applies), and a screen-clearing bomb (consumes `bombCount`, damages all on-screen enemies)
      — pure effect-application functions consumed by `arcadeState.tick`
- [ ] Wire wave spawning + power-up rendering/pickup into `BlackHoleArcadeScene`
- [ ] Write tests: wave progression/advancement, each enemy archetype's movement/fire pattern
      (deterministic given seed+time), each power-up's effect application and expiry
- [ ] Run tests — must pass before Task 8

### Task 8: Boss encounter

**Files:**
- Create: `src/systems/blackHoleArcade/arcadeBoss.ts`
- Modify: `src/presentation/BlackHoleArcadeScene.ts`

- [ ] `arcadeBoss.ts`: pure boss state machine — HP pool, 2-3 attack-pattern phases (transitioning
      on HP thresholds, e.g. spread-shot → homing burst → enrage), pure `tickBoss(state, dt):
      state` advancing pattern timers and emitting enemy-bullet spawns consumed by
      `arcadeState.tick`
- [ ] Boss defeat (`hp <= 0`) sets `ArcadeState.outcome = "won"`
- [ ] Render the boss (larger procedural `Graphics` composite, phase-based tint/silhouette
      change) + a boss health bar in the HUD
- [ ] Write tests: phase transitions at the correct HP thresholds, each pattern's bullet-emission
      shape (deterministic), defeat sets `outcome = "won"`
- [ ] Run tests — must pass before Task 9

### Task 9: Outcome, exit, and juice pass

**Files:**
- Create: `src/systems/blackHoleArcade/arcadeOutcome.ts`
- Modify: `src/presentation/BlackHoleArcadeScene.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/systems/AudioManager.ts` (if a currently-unused existing SfxKey needs a new call
  site — no new audio files)

- [ ] `arcadeOutcome.ts`: pure resolver —
      - **win**: pick a system connected to the black-hole system via its `connections`
        (fallback: the `returnSystemId` from Task 4's context) as the teleport target; roll a
        loot reward (small credit amount + a chance of a `ResourceType.ARTIFACTS`/`DATA_CORES`
        drop, "exotic matter from the singularity") using the same category of pure roll
        `encounterOutcome.ts` uses (deterministic `rng` default)
      - **lose**: a flat/percentage hull-damage amount (on top of whatever damage already
        floored `hullHP` at `BLACK_HOLE_ARCADE_HULL_FLOOR` in Task 5) and an eject point just
        outside the anomaly's exclusion radius in the `returnSystemId` system
- [ ] On `ArcadeState.outcome` becoming `"won"`/`"lost"`, `BlackHoleArcadeScene` applies the
      resolved outcome through **existing** seams only — `adjustPlayerCredits`, `Inventory
      .addResource`, and `applyDamageWithMode` for the hull result — then calls
      `gameEngine.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine, ... })` back to the
      `returnSystemId` system
- [ ] Juice pass (Alawar-polish requirement): hit-flash + small screen-shake on player/enemy/boss
      hits, particle burst on enemy/boss death and bullet impacts, punchy pickup animation on
      power-ups — gate the autonomous portions on `reducedMotion()` per the accessibility seam;
      reuse existing `SfxKey`s for fire/explosion/pickup/warp (no new audio files)
- [ ] Add `blackHoleArcade.*` i18n keys to **both** `ru.ts` and `en.ts` in lockstep (title, wave
      counter, boss HP label, win/lose banner text, control hint) — route every new string
      through `t(...)`, never a literal
- [ ] Write tests: `arcadeOutcome`'s win/lose resolution (teleport target selection, loot roll
      determinism, hull-damage/eject-point calculation)
- [ ] Write a real-engine playtest test: a forced `"won"` outcome grants credits/loot and returns
      to `SPACE_FLIGHT` in the expected system; a forced `"lost"` outcome applies hull damage via
      `applyDamageWithMode` (confirmed non-lethal in every `GameMode`) and returns to flight
- [ ] Run tests — must pass before Task 10

### Task 10: Verify acceptance criteria

**Files:**
- Modify: `.claude/docs/systems/` (new `black-hole-arcade.md`)
- Modify: `CLAUDE.md` (root, subsystem docs table)
- Modify: `src/presentation/flight/CLAUDE.md` (module list)

- [ ] Verify all three original requirements are implemented: (a) black holes occasionally
      reachable via a hyperjump mishap, (b) a visible, animated, fly-into-able black-hole object
      in systems that have one, (c) flying in launches the Star Defender-style sub-game with a
      boss
- [ ] Verify edge cases: zero-black-hole-galaxy (mishap and generation both degrade gracefully),
      hull never reaches destruction-triggering zero during an arcade run in any `GameMode`,
      reload mid-run falls back to `SPACE_FLIGHT` cleanly
- [ ] Run full unit suite (`npm test -- --run`), `npm run test:playtest`, `npm run test:e2e`
      (or the regression subset) — all green
- [ ] Run `npm run lint` — clean
- [ ] Run `gitnexus detect_changes({ scope: "compare", base_ref: "master" })` and confirm only
      the expected symbols/flows are affected
- [ ] Verify i18n parity test passes (`src/tests/i18n/parity.test.ts`) and the no-hardcoded-
      Cyrillic ratchet is clean for every touched file
- [ ] Write `.claude/docs/systems/black-hole-arcade.md` summarizing the anomaly-placement,
      mishap, and arcade-loop design (mirrors the existing subsystem-doc format), and add it to
      the root `CLAUDE.md` "Subsystem Docs" table
- [ ] Add `BlackHoleRenderer` to the module list at the top of `src/presentation/flight/CLAUDE.md`

## Technical Details

**Black-hole anomaly is a system object, not a star-type swap.** `StarSystem.hasBlackHoleAnomaly`
is a plain mutable boolean, independent from `StarType.BLACK_HOLE` (which remains dead code). The
anomaly's screen position is derived purely from `SeededRNG(\`blackhole_${systemId}\`)`, at a
radius within the existing planet orbit band (`SYSTEM_GEOMETRY.innerRadius`..`outerRadius`) — it
never overlaps the star's own position or exclusion radius.

**Hull-floor no-permadeath exception.** Normally a hull-damage path that would zero out `hullHP`
routes toward the death/`GAME_OVER` path (outside GOD mode, where `applyDamageWithMode` instead
floors at 0 and derives `isDowned`). This plan adds a **narrower, hazard-scoped** floor: inside an
active black-hole arcade run only, any damage event that would take `hullHP` to or below
`BLACK_HOLE_ARCADE_HULL_FLOOR` (1) instead floors it there and ends the run as a loss — this
applies in **every** `GameMode`, not just GOD. This is a deliberate design exception (explicitly
requested: "no permadeath from this hazard") and must be implemented as a check local to
`arcadeState.tick`, not as a change to `applyDamageWithMode`'s own semantics (which must stay
correct for every other damage source in the game).

**Run-scoped arcade weapon.** The arcade ship fires a fixed, self-contained blaster independent of
the player's real fitted `ShipLoadout` — translating a multi-weapon fitted loadout into an arcade
fire pattern is out of scope (explicitly simplified in planning). Power-ups upgrade this run-scoped
weapon only; nothing here writes to `ShipLoadout`/`GearCatalog`.

**No persisted arcade sub-state.** An in-progress run has no save representation (same class as an
open combat/encounter overlay) — only the pre-existing `hasBlackHoleAnomaly` flag (Task 1) and the
real hull/credit/inventory/system changes applied on exit (Task 9) touch persisted state.

## Post-Completion

**Manual verification** (live-browser, informational — headless tests can't judge feel):
- Fly into a black-hole system's anomaly and confirm the visual reads as an animated black hole
  (accretion disk, event horizon) at a satisfying scale/pulse rate.
- Play several full arcade runs (win and lose) and confirm pacing/difficulty of the 2-3 waves + 1
  boss feels fair, and that the "juice" (screen shake, particles, hit feedback) reads as
  Alawar-casual-game polish rather than flat/static.
- Confirm the hyperjump mishap rate (`BLACK_HOLE_JUMP_MISHAP_CHANCE`) feels rare-but-reachable
  over normal play, not either invisible or a constant nuisance — tune the constant if not.

**Balance tuning**: `BLACK_HOLE_SYSTEM_CHANCE`, `BLACK_HOLE_JUMP_MISHAP_CHANCE`, and the full
`BLACK_HOLE_ARCADE` block are first-pass numbers — expect a follow-up tuning pass after playtesting,
same as other balance constants in `src/config/balance.ts`.

**Real art/audio follow-up** (optional, out of scope for this plan): if real art/audio assets for
the black hole or arcade minigame are produced later (via `tools/comfyui/` for art, a new audio
drop for a dedicated arcade soundtrack), they can slot in behind the existing procedural-fallback
resolvers (`blackHoleTexture()`, reused `SfxKey`s) with no further code-path changes — same
convention as every other lazy-art category in the project.
