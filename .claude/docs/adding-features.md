# Adding New Features

## New Scene
> Tip: `npx tsx tools/scaffold/new-scene.ts --name <Name> [--context-dependent]` does steps 1–5 automatically (see `tools/README.md`).

1. Create class extending `GameScene` in `src/presentation/`
2. Add `SceneType.MY_SCENE` to `src/types/index.ts`
3. Add a `case SceneType.MY_SCENE:` to `src/core/services/SceneFactory.ts`
4. If the scene requires transient context (planet, NPC, station), add it to `contextDependentScenes` in `GameEngine.loadGame()` so "Continue" falls back to SPACE_FLIGHT instead of a blank screen (currently: `PLANET`, `TRADE`, `DIALOGUE`, `COMBAT`, `INVENTORY`, `STATION`, `EQUIPMENT_SHOP`, `GOVERNMENT`, `TEXT_QUEST`, `WIN_SCREEN`, `INFO_CENTER`, `BANK`)
5. Add Page Object in `e2e/page-objects/` for E2E tests

## New Audio Track or SFX
- Music files: `public/audio/mus_<key>.ogg` — add a `TrackKey` entry in `src/systems/AudioManager.ts`
- SFX files: `public/audio/sfx_<key>.ogg` — add a `SfxKey` entry in `src/systems/AudioManager.ts`
- Play from any scene via `this.gameEngine.audio.playTrack(key)` / `this.gameEngine.audio.playSfx(key)`

## New Art Asset
- Drop the file into `src/assets/<category>/` (e.g. `src/assets/planets/`). The Vite glob manifest (`src/assets/manifest.ts`) picks it up automatically — no code change needed. ANY new folder under `src/assets/` becomes a category (glob is `./**/*.{png,jpg,jpeg,webp}`).
- Naming convention: `<type>_<NN>` (e.g. `habitat_07.png`). For per-instance variety, consume via `pickVariant(category, prefix, entityId)` so each entity (planet/ship/star) gets a stable variant by id; add a fallback so the game works before the art is generated.
- Access via `texture(key)` / `texUrl(key)` from `src/presentation/textures.ts`.
- **Generating art:** the game's own asset pipeline is `tools/comfyui/` (distinct from the audio-reactive ComfyUI). Add a category to `tools/comfyui/asset_prompts.json` (`template` + `axes` + `variants`), then `python3 tools/comfyui/generate_assets.py --category <name> --ckpt <sdxl>.safetensors --clean` on the ComfyUI host (RTX 4090, `oleg@192.168.88.193`) emits `<category>/<name>_NN`; rsync into `src/assets/<category>/`. `--list` previews without generating. **Pass `--ckpt` explicitly** — the default picks the first checkpoint (a Flux model incompatible with `CheckpointLoaderSimple`); use an SDXL model (e.g. `realvisxl_v5.safetensors`). Operational gotchas live in memory `feedback-comfyui-headless-generation`.

## New ONNX Model
1. Add config to `src/ai/ModelManifest.ts`
2. Create adapter in `src/ai/adapters/` with `preprocessInput()`, `postprocessOutput()`, `infer()`
3. Implement fallback in `src/ai/FallbackEngine.ts`
4. Add test in `src/tests/`

## New Domain Field
> Tip: `npx tsx tools/scaffold/domain-field.ts --entity <Entity> --field <name> --type <number|boolean|string> --default <v>` does steps 1–3 automatically (see `tools/README.md`).

1. Update type in `src/types/index.ts` or `src/domain/*.ts`
2. Update Zod schema in `src/validation/schemas.ts`
3. Add migration in `src/data/MigrationPipeline.ts` if needed

# Plan Format (Ralphex)

All implementation plans in `docs/plans/` **must** use ralphex-compatible format — the plan runner rejects files that deviate.

**Required top-level structure (in order):**

```markdown
---
# Plan Title

## Overview
One-paragraph summary.

## Context
Key files, related US/EPICs, current state.

## Development Approach
TDD order, ordering constraints, applicable rules.

## Implementation Steps

### Task 1: Short Title
**Files:**
- Modify: path/to/file.ts
- Create: path/to/new.ts

- [ ] acceptance criterion or implementation step
- [ ] acceptance criterion or implementation step

### Task 2: Short Title
...
```

**Validation rules (enforced by ralphex):**

| Rule | Detail |
|------|--------|
| File starts with `---` | YAML front-matter separator — line 1 |
| `## Overview` present | Required section |
| `## Context` present | Required section |
| `## Development Approach` present | Required section |
| `## Implementation Steps` present | Required section |
| Tasks use `### Task N:` | Colon required; ralphex matches this exact pattern |
| Each task has `- [ ]` checkboxes | At least one per task — tracked as progress |
| `**Files:**` block per task | Recommended for traceability; not validated |

Do **not** use `## 1.` / `## 0.` section numbering — ralphex ignores those.
Use `### Iteration N:` only for time-boxed sprint iterations, not regular tasks.
