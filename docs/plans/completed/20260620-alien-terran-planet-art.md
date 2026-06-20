---
# Earth-Type Planets Should Look Alien, Not Like Earth

## Overview
Habitable Earth-type planets (`PlanetType.TERRESTRIAL`) currently render as recognisable **Earth** —
the art prompt literally asks for *"blue ocean water with green and brown landmasses and scattered
thin white clouds … satellite imagery of terrain"*. The request: terran worlds should read as
**alien but habitable**, with variety (exotic ocean colours, non-Earth vegetation, unfamiliar
landmass shapes) so no planet looks like our Earth. Chosen approach: **new alien art** — rewrite the
ComfyUI asset prompts for the terran globe + surface map to alien biospheres with anti-Earth
negatives and more variants, plus a selection guard + tests. The textures themselves are generated
on the GPU host as a manual follow-up (ralphex cannot drive ComfyUI).

## Context
- **Type:** `PlanetType.TERRESTRIAL` (`src/types/index.ts` L14) is the only Earth-type; weighted 30
  in `PlanetGenerator.ts` and in `HABITABLE_TYPES`.
- **Art prompts (the cause):** `tools/comfyui/asset_prompts.json` —
  - `planets` (globe sprite) terran axis: *"blue oceans, white swirling clouds, green and brown
    continents"* (L39).
  - `planet_maps` (equirect surface map) terran axis: *"blue ocean water with green and brown
    landmasses and scattered thin white clouds, seen from directly overhead, satellite imagery of
    terrain"* (L58). `variants: 3`.
- **Rendering:** `src/presentation/PlanetSprite.ts` maps `PlanetType.TERRESTRIAL → "terrestrial"`
  prefix; the equirect `planet_maps/terrestrial_NN` is applied via the `PlanetRotationFilter` sphere
  shader (globe `planets/terrestrial_NN` is the disc fallback). Selection is by `pickVariant`/
  `pickVariantKey` (stable by planet id) over the Vite glob manifest (`src/assets/manifest.ts`), so
  **more files ⇒ more variety automatically** — no selection rewrite needed beyond a guard/test.
- **Current assets:** only `src/assets/planet_maps/terrestrial_04.jpg`, `terrestrial_05.jpg` (Earth-
  like) + the `planets/` globe variants.
- **Pipeline constraints (memory):** `planet_maps` must be **360° equirectangular** (Flux 360 LoRA),
  never top-down sphere sprites; headless generation runs on `oleg@192.168.88.193` (RTX 4090) with an
  **explicit `--ckpt`** (the default Flux model breaks `CheckpointLoaderSimple`); see memories
  `feedback-planets-equirectangular`, `feedback-comfyui-headless-generation`. **I run the generation;
  the user does not drive the canvas for headless gen.**
- **Decision (confirmed):** new alien art (not procedural recolor); scope = `TERRESTRIAL` only.

## Development Approach
- **TDD on the data + selection that ralphex CAN run autonomously:** the prompt JSON and the variant
  selection are testable now; the texture generation is a manual Post-Completion step. Write failing
  tests first (prompt contains no Earth tokens + has alien variety tokens; pickVariant spans the
  terran range stably).
- **Keep the template structure** of each art category (only the terran `{type}` axis content +
  variant count change) so the equirect/globe pipeline is unaffected.
- Run `impact` on `PlanetSprite` / `pickVariant` before any selection edit. **Do not modify existing
  test assertions** (standing rule); add new tests. Maintain a graceful fallback so the game still
  renders if a terran variant file is missing before art is generated.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: the terran `planet_maps` and `planets` prompt axes contain **no** Earth tokens (`earth`,
  `satellite imagery`, `green and brown continents`) and **do** contain alien-variety tokens; the
  `variants` count is raised; `pickVariant("planet_maps","terrestrial",id)` is deterministic per id
  and covers every available terran variant; a missing variant falls back without throwing.
- Visual (manual, Post-Completion): generated terran worlds look alien and varied, not like Earth.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Alien-ify the terran equirect surface-map prompt
**Files:**
- Modify: tools/comfyui/asset_prompts.json (`planet_maps` → terran axis: alien biosphere + variety
  axes; add anti-Earth negatives; raise `variants`)
- Create: src/tests/assets/terranPromptAlien.test.ts

- [x] rewrite the terran `planet_maps` axis to an alien-but-habitable biosphere (exotic ocean colour,
      non-Earth vegetation, unfamiliar landmasses) and add anti-Earth tokens to the negative prompt
      (`Earth, planet Earth, recognizable Earth continents, real-world map, blue marble, satellite
      photo of Earth`); raise the variant count for variety
- [x] write tests: terran axis has no Earth tokens and includes alien-variety tokens; variants raised
- [x] run affected tests — must pass before next task

### Task 2: Alien-ify the terran globe-sprite prompt
**Files:**
- Modify: tools/comfyui/asset_prompts.json (`planets` → terran axis to match: alien ocean/vegetation
  palette + anti-Earth negatives; raise `variants`)
- Modify: src/tests/assets/terranPromptAlien.test.ts (extend to the `planets` category)

- [x] rewrite the terran `planets` (globe) axis to the same alien direction; keep the template/
      framing (single centered globe) unchanged
- [x] write tests: `planets` terran axis alien + no Earth tokens
- [x] run affected tests — must pass before next task

### Task 3: Variant-selection guard + variety test
**Files:**
- Modify (only if needed): src/presentation/PlanetSprite.ts / src/presentation/textures.ts (ensure
  terran selection spans all globbed variants and falls back cleanly if a variant is absent)
- Create: src/tests/presentation/terranVariantSelection.test.ts

- [x] confirm `pickVariant`/`pickVariantKey` for `TERRESTRIAL` is stable per planet id and ranges over
      every available terran variant; missing-variant fallback does not throw
- [x] write tests: deterministic per-id selection; distinct ids spread across variants; missing-file fallback
- [x] run affected tests — must pass before next task

### Task 4: Verify acceptance criteria + credits
**Files:**
- Modify: src/assets/planet_maps/CREDITS.md (note terran art is alien-by-design / generation params)

- [x] verify Overview: terran prompts are alien + varied, selection covers them, fallback safe
- [x] run full unit suite — all green (2017 tests); `npm run test:e2e:regression` (23 passed, needs
      `NO_PROXY=localhost`); `npm run lint` clean (0 errors)
- [x] confirm no existing asset/planet test assertions changed (alien-terran commits only ADDED
      `terranPromptAlien.test.ts` + `terranVariantSelection.test.ts`; CREDITS.md is not a test)

## Technical Details
- **Variety axes (terran):** ocean/liquid colour (turquoise, emerald, wine, indigo, methane-blue);
  vegetation/biosphere colour (crimson, violet, amber-gold, cyan); landmass character (jagged volcanic
  coasts, archipelago world, single supercontinent, crystalline shelves); atmosphere haze (ochre,
  lavender, pale-green). Each variant draws a distinct combination so no two terran worlds twin.
- **Anti-Earth negatives:** explicitly exclude `Earth, blue marble, recognizable continents,
  Africa/Americas outlines, real-world satellite map`.
- **Glob-driven variety:** because selection is over the Vite glob manifest keyed by planet id, simply
  landing more terran variant files (Task’s manual gen) widens variety with no further code change.
- **Equirect requirement:** `planet_maps` stays 2:1 equirectangular (Flux 360 LoRA at gen time); the
  `planets` globe stays a centered sphere (SDXL). Only the `{type}` axis text changes.

## Post-Completion
*Manual — requires the GPU host; ralphex cannot run these.*

**Generate the art (I run this):**
- On `oleg@192.168.88.193` (RTX 4090): regenerate the terran sets with the new prompts —
  `planet_maps` via the equirect/Flux-360 path, `planets` via an explicit SDXL `--ckpt` (e.g.
  `realvisxl_v5.safetensors`), using `--category planets --clean` / `--category planet_maps --clean`
  to replace the Earth-like `terrestrial_NN`. Verify via `/history` (queued ≠ success); don’t `/free`
  the shared GPU. (See memories `feedback-comfyui-headless-generation`, `feedback-planets-equirectangular`.)
- rsync the emitted `terrestrial_NN` into `src/assets/planet_maps/` and `src/assets/planets/`.

**Visual verification:** load several systems with terran planets and confirm they look alien and
varied — distinctly NOT Earth — both as the in-space globe and the rotating surface map.
