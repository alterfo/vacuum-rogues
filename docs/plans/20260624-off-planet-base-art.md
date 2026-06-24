---
# Off-Planet Base Art (Space-Station Sprites)

## Overview
Space stations ("внепланетные базы") already exist as a full domain entity
(`src/domain/Station.ts`), are placed in systems by `GalaxySimulator`, and are
clickable + dockable in flight (`PlanetManager.stationMarkers` → `StationScene`).
The only gap is **visuals**: every station renders as a plain colour-coded
**diamond** (`PlanetManager.createStations()`), so off-planet bases read as
placeholder markers rather than real stations.

This plan adds **per-type station sprite art** and renders bases as sprites in
flight, falling back to the existing diamond when no art is present — exactly the
`pickVariant`-with-fallback pattern the `ships`/`planets` art passes already use.
The actual GPU art generation is a manual step (the ComfyUI host is not reachable
by the autonomous runner) captured in Post-Completion; **all code here works and
is fully tested with the diamond fallback before any art lands**, then upgrades to
sprites automatically once the `station/` art is committed (Vite glob manifest).

There are five station types to cover: `TRADE_POST`, `REPAIR_DOCK`,
`MILITARY_BASE`, `RESEARCH_LAB`, `CRAFT_CENTER` (`StationType`, `src/types/index.ts`).

## Context (from discovery)
- **Domain:** `src/domain/Station.ts` — `{id, name, type, faction, orbitRadius,
  orbitAngle}`. `StarSystem.stations: Station[]`. No art field (art is resolved by
  type + id, like planets — no domain/schema change, no save migration).
- **Render (the diamond to replace):** `src/presentation/flight/PlanetManager.ts`
  `createStations()` (~L549) builds, per station: a `Graphics` diamond coloured by
  `stationColor(type)`, a `Text` label, and a transparent circular hit-area wired to
  `onStationClick`. Markers are pushed to `stationMarkers` (used by `getStationAt`,
  docking range, route planning). **Label + hit-area + marker bookkeeping must be
  preserved unchanged** — only the diamond `Graphics` becomes a sprite-or-diamond.
- **Prefix-map pattern to mirror:** `PLANET_TEXTURE_PREFIX: Record<PlanetType,string>`
  (`src/presentation/PlanetSprite.ts:15`) + `pickVariant(category, prefix, id)`
  (stable FNV-1a hash by entity id).
- **Art-config pattern to mirror:** the `ships` category in
  `tools/comfyui/asset_prompts.json` (`categories.ships`: 1024×1024 transparent
  centred top-down sprite, `template` + `axes.role` + `variants`, generated via
  `generate_assets.py --category ships --ckpt realvisxl_v5.safetensors`).
- **Texture plumbing:** `src/presentation/textures.ts` — new `src/assets/station/`
  folder is auto-globbed by `src/assets/manifest.ts`; station sprites are small
  transparent PNG/WebP, **not** heavy, so they stay **out of `LAZY_PREFIXES`** and
  use the synchronous `pickVariant` (like `ships`/`planets` discs). Key-parity
  baseline: `src/tests/assets/manifestKeys.snapshot.json` (regenerated when art lands).

## Development Approach
- **Testing approach: TDD.** Write the pure, deterministic units first (the
  per-type prefix map + the `stationSpriteKey` resolver), then wire the renderer.
- The resolver must degrade safely: with **no `station/` art committed**,
  `pickVariant("station", …)` returns `undefined`, the resolver returns `null`, and
  the renderer draws the **existing diamond** — so every test here is green before
  any GPU art exists.
- **Blast-radius rule:** run `impact` on `createStations`/`StationMarker` before
  editing; the only production caller of the diamond is `PlanetManager` itself.
  Keep one concern per commit (rendering vs config vs docs).
- Additive only: no domain/`schemas.ts`/migration change (art is type+id-derived,
  like planet discs). Maintain backward compatibility — old saves render identically
  (diamond) until art lands, then sprites with no save change.

## Testing Strategy
- **Unit tests** (required per task): the prefix map (every `StationType` →
  a stable non-empty prefix, total mapping), and `stationSpriteKey(type, id)`
  (stable per id, varies across the variant pool, returns `null` when no art).
- **Integration (pixi-mocked):** a `PlanetManager` station-render test asserting the
  marker still gets a label + working hit-area + `stationMarkers` entry whether the
  sprite path or the diamond fallback is taken (mock `pickVariant`).
- **E2E:** none required (the in-flight visual is verified by screenshot in
  Post-Completion once art lands; the headless suite can't see pixels).

## Progress Tracking
- Mark completed items `[x]` immediately. Add discovered tasks with ➕, blockers ⚠️.
- Keep this file in sync if scope shifts.

## What Goes Where
- **Implementation Steps** (`[ ]`): the prefix map, resolver, renderer wiring,
  art-config entry, docs — all code/config achievable headlessly with the diamond
  fallback.
- **Post-Completion** (no checkboxes): the GPU art generation + WebP + snapshot
  regen + in-flight screenshot verification (manual, GPU host).

## Implementation Steps

### Task 1: Station texture-prefix map + sprite-key resolver (pure)
**Files:**
- Modify: `src/presentation/flight/stationArt.ts` (Create)
- Create: `src/tests/presentation/stationArt.test.ts`

- [x] Create `src/presentation/flight/stationArt.ts` exporting
      `STATION_TEXTURE_PREFIX: Record<StationType, string>` —
      `TRADE_POST→"trade"`, `REPAIR_DOCK→"drydock"`, `MILITARY_BASE→"military"`,
      `RESEARCH_LAB→"science"`, `CRAFT_CENTER→"fabricator"` (mirrors
      `PLANET_TEXTURE_PREFIX`).
- [x] Add `stationSpriteKey(type: StationType, id: string): string | null` that
      returns `pickVariantKey("station", STATION_TEXTURE_PREFIX[type], id)` (or
      `null` when the category/prefix has no committed art — graceful fallback).
- [x] write tests: every `StationType` maps to a stable, non-empty, unique prefix
      (total mapping, no `undefined`); `stationSpriteKey` returns `null` today (no
      art) and is deterministic per id (success + no-art cases).
- [x] run tests — must pass before next task.

### Task 2: Render bases as sprite-or-diamond in `createStations()`
**Files:**
- Modify: `src/presentation/flight/PlanetManager.ts`
- Create/Modify: `src/tests/presentation/planetManagerStations.test.ts`

- [ ] In `createStations()`, replace the bare diamond `Graphics` with: resolve
      `stationSpriteKey(station.type, station.id)`; if it yields a cached texture,
      add a `Sprite` (anchor 0.5, ~40×40, `eventMode="none"`); **else** draw the
      existing diamond exactly as today. Keep the `stationColor` label, the
      transparent circular hit-area + `onStationClick`, `zIndex`, and the
      `stationMarkers.push({...})` bookkeeping unchanged.
- [ ] (If the sprite key resolves but the texture is not yet cached, just draw the
      diamond — do **not** add async/lazy loading; station art is non-lazy and
      eager-preloaded like `ships`.)
- [ ] write tests (mock `pixi.js` + `stationSpriteKey`): with a mocked texture the
      marker uses a sprite; with `null` it uses the diamond; **both** paths still
      produce a label, a working `static` hit-area that calls `onStationClick`, and
      a `stationMarkers` entry. Assert `getStationAt`/docking still find the marker.
- [ ] run tests — must pass before next task.

### Task 3: Add the `station` art category to ComfyUI prompts
**Files:**
- Modify: `tools/comfyui/asset_prompts.json`
- Create/Modify: `src/tests/assets/stationPrompts.test.ts` (lightweight JSON-shape guard)

- [ ] Add `categories.station` mirroring `ships`: 1024×1024, transparent centred
      **top-down orthographic** sprite, `name_order: ["type"]`, `variants: 4`, and
      `axes.type` with one prompt per station type (keys `trade`/`drydock`/
      `military`/`science`/`fabricator` matching `STATION_TEXTURE_PREFIX`), e.g.
      trade = "bustling modular trade station with docking rings and cargo pods";
      drydock = "open shipyard drydock with gantries and a ship in cradle";
      military = "armoured fortress station with turrets and hangar bays";
      science = "sleek research station with sensor dishes and glowing labs";
      fabricator = "industrial fabrication station with foundry glow and assembly arms".
      Negative: reuse the `ships`/`negative_common` anti-perspective/anti-scenery set.
- [ ] write a JSON-shape test: `categories.station` exists, has all five `axes.type`
      keys exactly matching `Object.values(STATION_TEXTURE_PREFIX)`, and a non-empty
      `template` (guards the art prefixes from drifting out of sync with the code map).
- [ ] run tests — must pass before next task.

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only stationArt,
      PlanetManager, asset_prompts.json (+ tests/docs) affected; no domain/schema.
- [ ] full unit suite green; `npm run lint` clean; `npm run build` ok;
      `npm run test:playtest` green (flight boots, stations still dockable).
- [ ] confirm: with no `station/` art on disk, every station renders the diamond
      (no regression); the sprite path is exercised only by the mocked test.

### Task 5: Update documentation
**Files:**
- Modify: `.claude/docs/adding-features.md` or `src/presentation/CLAUDE.md`

- [ ] Note the new `station` art category + the sprite-or-diamond fallback in
      `PlanetManager.createStations`, the `STATION_TEXTURE_PREFIX` map, and that
      station sprites are non-lazy (eager) transparent art keyed by `pickVariant`.

## Technical Details
- **No save/schema impact:** art is resolved from `station.type` + `station.id`
  (catalog-style), identical to how planet discs pick art — `schemas.ts`,
  `MigrationPipeline.ts`, and save version are untouched.
- **Prefix ↔ axes contract:** `STATION_TEXTURE_PREFIX` values are the literal art
  file prefixes (`station/<prefix>_NN.webp`) and must equal the `asset_prompts.json`
  `axes.type` keys — Task 3's shape test pins this both ways.
- **Fallback-first:** the renderer is correct and tested with zero art; sprites
  light up automatically when `src/assets/station/*` is committed (glob manifest),
  so code and art can ship in separate commits.

## Post-Completion
*Manual / external — no checkboxes.*

**Art generation (GPU host `oleg@192.168.88.193`, RTX 4090 — run by a human/Claude, not ralphex):**
- `python3 tools/comfyui/generate_assets.py --category station --ckpt realvisxl_v5.safetensors --clean`
  (≈4 variants × 5 types). Verify via `/history` (queued ≠ success); don't `/free` the shared GPU.
- rsync the emitted `station/<type>_NN` into `src/assets/station/`, run
  `npx tsx tools/optimize-assets.ts --category station` (lossy q80, transparent →
  keep alpha), then regenerate `src/tests/assets/manifestKeys.snapshot.json`.

**Manual verification:**
- Boot flight in a system with stations → bases render as sprites (not diamonds),
  remain clickable, route-to-dock + `DOCKING_RANGE` still work. Screenshot-verify
  per the visual-fix rule (the diamond fallback is what the headless suite sees).
