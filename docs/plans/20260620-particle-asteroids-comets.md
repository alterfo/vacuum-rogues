---
# Natural Comets & Asteroids: Particle Dust Tails + Baked Rock Textures

## Overview
Comets and asteroids look flat and cartoonish ("как игра на флеше") because `AsteroidBelt` draws
everything with **flat Graphics primitives** — the comet tail is 10 layered `poly` wedges, the
coma/head are stacked `circle` fills, and asteroids are irregular `poly` rocks with two crater
circles. Replace this with a **particle-based** look (the user's ask: "сделаем нормально —
частицами"): the comet becomes a glowing head with a **soft-particle dust tail** streaming
anti-sunward, and asteroids become **baked, shaded rock-texture sprites** that tumble. All in-code and
procedural (no GPU art, no per-frame blur), keeping the existing hyperbolic comet motion and asteroid
drift — only the **rendering** changes.

## Context
- **Current rendering:** `src/presentation/flight/AsteroidBelt.ts` — `drawAsteroid` (~L131) builds the
  comet from `poly` wedge tails + stacked `circle` coma/head, and rocks from `poly` + crater circles,
  all on a per-mote `Graphics`. This is the flat look. Motion (hyperbolic comet flyby + asteroid
  drift) was added by `20260619-comet-hyperbolic-trajectory.md` and stays unchanged.
- **Existing building blocks to reuse:**
  - `softGlowTexture()` in `src/presentation/gradientTexture.ts` — a baked soft radial sprite
    (returns `Texture | null`), already used by `StarRenderer` and `SpaceBackgroundLayer`. Ideal as a
    dust-particle / coma sprite.
  - `SpaceBackgroundLayer` already has a `DustParticle` system (~L1111 `createDustParticles`,
    `updateDustParticles`) — mirror its spawn/age/drift pattern.
- **PixiJS 8:** use `ParticleContainer` (efficient many-sprite rendering) for the tail particles.
- **Constraints (memory):** **no per-frame BlurFilters** (`feedback-no-blur-filters-flight`) — soft
  look comes from baked alpha textures, not live blur; **bake, don't per-frame redraw, and bound
  counts** for FPS (`project-system-map-baseline-fps`). Procedural/baked — **no asset-pipeline / GPU
  art** is needed (decision confirmed).

## Development Approach
- **TDD on the deterministic parts:** texture-baking helpers return valid cached textures; the
  particle emitter spawns/ages/prunes deterministically with a bounded count; an asteroid sprite spins
  over time. The **look** is verified by a **GIF/screenshot** (motion + diffusion can't be shown in a
  static frame).
- Run `impact` on `AsteroidBelt` and `gradientTexture` before editing; warn on HIGH/CRITICAL. **Do not
  modify existing test assertions** (standing rule); add new tests. Keep the hyperbolic-motion + drift
  logic untouched — replace only the draw path. No BlurFilter; particle counts bounded.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: baked dust-particle + rock textures are produced and cached (non-null, reused);
  the comet tail emitter spawns particles at the head, drifts them anti-sunward, fades+shrinks over
  lifetime, prunes spent ones, and never exceeds its max count; an asteroid sprite's rotation advances
  with dt; a comet with no glow texture falls back without throwing.
- Visual (manual GIF): a comet streams a soft diffuse particle tail; asteroids look like tumbling
  shaded rocks, not flat polygons; no FPS regression.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Baked dust-particle + rock textures (procedural)
**Files:**
- Modify/Create: src/presentation/gradientTexture.ts (or new src/presentation/flight/bakedRocks.ts) —
  `dustParticleTexture()` (soft alpha dot) and `rockTexture(seed)` (a small set of baked irregular,
  shaded grey rocks with craters/noise), cached like `softGlowTexture`
- Create: src/tests/presentation/bakedRockTextures.test.ts

- [x] bake a soft dust-particle texture and a few seeded irregular shaded rock textures; cache + reuse
      (no per-frame regeneration); null-safe like `softGlowTexture`
- [x] write tests: helpers return non-null textures, are cached/reused, distinct rock seeds differ
- [x] run affected tests — must pass before next task

### Task 2: Comet — glowing head + particle dust tail
**Files:**
- Modify: src/presentation/flight/AsteroidBelt.ts (replace the comet `poly`-wedge tail + circle coma
  with a `ParticleContainer` dust-tail emitter: spawn soft particles at the head each frame, velocity
  anti-sunward + slight spread, fade+shrink over lifetime, prune spent; head = a `softGlowTexture`
  sprite tinted icy-white) — keep the hyperbolic head motion
- Create: src/tests/flight/cometParticleTail.test.ts

- [x] comet renders as a glowing head trailing a soft particle dust tail (bounded count); the flat
      wedge/circle tail is removed; no BlurFilter
- [x] write tests: emitter spawns at head, drifts anti-sunward, ages/fades/prunes, count ≤ max
- [x] run affected tests — must pass before next task

### Task 3: Asteroids — baked rock sprites with tumble
**Files:**
- Modify: src/presentation/flight/AsteroidBelt.ts (replace the `poly` rock + crater circles with a
  baked `rockTexture` Sprite per asteroid; per-asteroid rotation/spin + slight tint/scale variation;
  optional faint debris particle) — keep the drift + edge-respawn logic
- Create: src/tests/flight/asteroidSprite.test.ts

- [x] asteroids render as baked shaded rock sprites that tumble (rotation advances with dt); flat
      polygon rocks removed; drift/respawn unchanged
- [x] write tests: asteroid uses a rock-texture sprite; rotation advances; distinct asteroids vary
- [x] run affected tests — must pass before next task

### Task 4: Verify acceptance criteria + performance
- [x] verify Overview: comets have soft particle tails, asteroids look like tumbling rocks, no flat
      polygons; hyperbolic motion + drift unchanged — confirmed by code inspection: `setupCometVisuals`
      builds a `ParticleContainer` + `CometDustTail` emitter + `softGlowTexture` head (flat wedge/circle
      tail removed; only a minimal fallback nucleus when no 2D canvas); `setupAsteroidVisuals` builds a
      baked `rockTexture` sprite that tumbles (`a.rock.rotation += spin*dt`); `buildCometFlyby`/
      `hyperbolaPoint` hyperbolic motion + asteroid drift/edge-respawn are unchanged
- [x] manual GIF (skipped - not automatable from harness); FPS guarded structurally: bounded particles
      (`MAX_TAIL_PARTICLES = 64`), baked+cached textures, no per-frame `BlurFilter` (grep found only doc
      comments)
- [x] run full unit suite — all green (265 files / 2329 tests); `npm run test:e2e:regression` 25/25
      green; `npm run lint` clean (0 errors; pre-existing warnings only, none in new files)
- [x] confirm no existing asteroid/flight test assertions changed — the three plan commits only ADD
      test files (`asteroidSprite`, `cometParticleTail`, `bakedRockTextures`); no existing test modified

## Technical Details
- **Particle tail:** a small emitter on a `ParticleContainer` (one per comet, or a shared pool). Each
  particle: `{x,y,vx,vy,age,life}` spawned at the head with velocity pointing anti-sunward (away from
  the star) plus a small random spread; drawn as the baked soft-dust sprite, alpha+scale ramping down
  with `age/life`. Max particles per comet is a constant (FPS bound); spent particles are recycled.
- **Comet head:** a `softGlowTexture` sprite (tinted) — soft edges from the baked alpha, not blur.
- **Asteroids:** baked `rockTexture(seed)` Sprites give shaded, irregular rocks; per-asteroid spin and
  scale/tint variation break the uniform look. Textures are baked once and cached.
- **Unchanged:** the hyperbolic comet trajectory + asteroid drift/edge-respawn from the prior plan are
  reused verbatim; this plan swaps only the visual representation.

## Post-Completion
**Manual verification (GIF):** fly in a system with comets and asteroids; confirm a comet streams a
soft, diffuse particle dust tail behind a glowing head, asteroids tumble as shaded rocks (no flat
Flash-style polygons), and the frame rate is unaffected.
