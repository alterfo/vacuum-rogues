---
# ART Plan: Visual Asset Generation with LoRA Pipelines

## Overview

Generate high-quality visual assets for Вакуумные Пройдохи using three purpose-built LoRAs hosted on ComfyUI at `oleg@192.168.88.193` (RTX 4090). The plan covers nebula parallax layers, planet/star surface maps for the rotation shader, and 360° panoramas for planetary landing scenes, plus the PixiJS integration code that consumes them.

## Context

**ComfyUI host:** `oleg@192.168.88.193`, port 8188 (user drives the UI; Claude prepares workflow JSON + prompts)

**LoRAs:**
| ID | Base model | Trigger | Weight | Use |
|----|-----------|---------|--------|-----|
| Space Image ZIT (`civitai#2334878`) | ZImageTurbo | `Sp11` | ≤ 0.9 | Nebula parallax tiles |
| Flux Equirectangular 360° (`civitai#735980`, ver `823024`) | Flux.1 D | `equirectangular 360 degree panorama` | 0.5–1.5 | Planet/star surface maps, interior panoramas |
| 360 Diffusion for SD1.5 (`civitai#26815`) | SD 1.5 | `qxj` | 0.8–1.0 | SD1.5 fallback for interiors |

**Existing assets (keep, improve, or replace):**
- `src/assets/nebula/` — 12 PNGs (4 palettes × 3 layers); source LoRA unknown → replace with ZIT pipeline
- `src/assets/planet_maps/` — equirectangular maps from Solar System Scope (CC BY 4.0); supplement with faction-themed variants
- `src/assets/planets/` — empty `.gitkeep`; sprite circles will be derived from planet_maps via rotation shader
- `src/assets/star_maps/` — empty; will hold star-surface equirectangular maps
- `tools/comfyui/workflow_api.json` — baseline KSampler workflow to fork per pipeline

**Related:**
- US-075 (quality visual assets), EPIC-010, `docs/design/ART_PROMPTS.md`

## Development Approach

- Tasks 1–4 produce ComfyUI workflow JSON files + updated `ART_PROMPTS.md` — **no code execution needed, user runs ComfyUI**.
- Tasks 5–6 are manual asset-generation steps run by the user on the ComfyUI host.
- Tasks 7–8 are TypeScript/GLSL code tasks Claude implements and tests.
- Task 9 wires everything together and verifies the manifest.
- Order: 1 → 2 → 3 → 4 in parallel, then 5–6 (manual), then 7–8 in parallel, then 9.
- No new domain types required; assets are pure presentation layer.

## Implementation Steps

### Task 1: Update ART_PROMPTS.md with LoRA-Specific Sections
**Files:**
- Modify: `docs/design/ART_PROMPTS.md`

- [x] Add `## LoRA Pipelines` section documenting all three LoRAs (base model, trigger, weight range, aspect, sampler notes)
- [x] Add `### Nebula (Space ZIT LoRA)` with per-palette positive prompts:
  - Red:    `Sp11, Hubble space nebula, deep crimson red haze with bright hot star cores, wispy ionised gas tendrils, volumetric glow, black void background, tileable seamless`
  - Teal:   `Sp11, Hubble space nebula, cyan-teal emission nebula, oxygen-III glow, dark dust lanes, tileable seamless`
  - Violet: `Sp11, Hubble space nebula, deep violet purple gas cloud, star-forming pillars, dark molecular cloud, tileable seamless`
  - Amber:  `Sp11, Hubble space nebula, warm golden amber hydrogen-alpha nebula, bright stellar nursery, tileable seamless`
  - Negative (all): `planets, ships, text, watermark, blurry, low quality, lens flare`
- [x] Add `### Planet Surface Maps (Flux 360° LoRA)` with per-type prompts (aspect 2:1, trigger `equirectangular 360 degree panorama`):
  - Bastions:   rocky fortress world, scarred red plains, industrial scars, stormy atmosphere
  - Syndicate:  polluted smog world, acid-yellow sky, dense urban sprawl from orbit
  - Outlanders: temperate colony world, blue ocean patches, patchwork agriculture
  - Progressors:lush garden world, bioluminescent canopy, research domes visible
  - Paradoxes:  alien crystalline world, impossible geometries, iridescent surface
  - Volcanic:   magma seas, black obsidian plains, lava rivers
  - Ice:        cracked white ice sheets, subsurface ocean hints, blizzard bands
  - Gas:        banded gas giant, Great Storm eye, swirling ammonia clouds
  - Negative (all): `text, watermark, UI, cartography lines, latitude longitude grid, people`
- [x] Add `### Star Surface Maps (Flux 360° LoRA)` with per-type prompts:
  - Yellow:  solar granulation, prominences, sunspot groups
  - Blue:    superheated blue-white star, X-ray glow corona, extreme UV radiation
  - Red:     red dwarf, cool surface convection cells, dim orange glow
  - Neutron: pulsar jet beams, magnetosphere, faint blue polar glow
- [x] Add `### Planet Interior Panoramas (Flux 360° or SD1.5 360°)`:
  - Bastions city:   feudal fortress city, brutalist stone towers, warships in sky
  - Syndicate city:  neon-lit port district, fog, holographic signs
  - Outlanders city: mid-tech colony town, market square, farmland horizon
  - Progressors city:gleaming research campus, drone corridors, glass domes
  - Paradoxes site:  impossible crystal architecture, floating islands, alien sky
  - Wilderness:      alien jungle/tundra/desert (per climate)

### Task 2: ComfyUI Workflow A — Nebula Tiles (ZIT LoRA)
**Files:**
- Create: `tools/comfyui/workflow_zit_nebula.json`

- [x] Fork `workflow_api.json`; change `CheckpointLoaderSimple.ckpt_name` to `"ZImageTurbo.safetensors"`
- [x] Insert `LoraLoader` node between checkpoint and KSampler:
  ```json
  "10": {
    "class_type": "LoraLoader",
    "inputs": {
      "model": ["4", 0], "clip": ["4", 1],
      "lora_name": "space_image_zit.safetensors",
      "strength_model": 0.85, "strength_clip": 0.85
    }
  }
  ```
- [x] Wire `["10", 0]` → `KSampler.model`, `["10", 1]` → both `CLIPTextEncode.clip`
- [x] Set `EmptyLatentImage`: `width=1024, height=1024` (tileable square)
- [x] Set KSampler: `steps=20, cfg=4.0, sampler_name="dpmpp_2m", scheduler="karras"` (ZImageTurbo needs lower steps)
- [x] Set positive text to `Sp11, [PALETTE_PROMPT]` (user substitutes palette from ART_PROMPTS.md)
- [x] Set `SaveImage.filename_prefix` to `"nebula/[LAYER]_[PALETTE]"` (e.g. `nebula/far_red`)
- [x] Add a `_generation_notes` comment block listing: layers (far/mid/near), palettes (red/teal/violet/amber), expected output count: 12 images

### Task 3: ComfyUI Workflow B — Planet & Star Surface Maps (Flux 360° LoRA)
**Files:**
- Create: `tools/comfyui/workflow_flux_360_planets.json`

- [x] Use `UNETLoader` for Flux.1-dev UNET + dual `CLIPLoader` (T5 + CLIP-L) + `VAELoader` (Flux VAE) — Flux requires split loaders, not `CheckpointLoaderSimple`
- [x] Insert `LoraLoader` after UNET: `lora_name="flux_equirectangular_360.safetensors"`, `strength_model=0.85`
- [x] Set `EmptyLatentImage`: `width=2048, height=1024` (2:1 equirectangular) — used `EmptySD3LatentImage` (Flux needs 16-channel latents; noted in `_generation_notes`)
- [x] Set `BasicGuider` (Flux) or `KSampler`: `cfg/guidance=2.5, steps=30` — `FluxGuidance` guidance=2.5 + `KSampler` cfg=2.5/steps=30
- [x] Positive text: `equirectangular 360 degree panorama, [TYPE_PROMPT]` — user substitutes from ART_PROMPTS.md
- [x] Negative text: `fisheye, text, watermark, latitude lines, grid, people, faces`
- [x] `SaveImage.filename_prefix`: `"planet_maps/[TYPE]_[NN]"` (e.g. `planet_maps/bastions_01`)
- [x] Add `_generation_notes`: list 8 planet types + 4 star types; aim ≥ 2 variants per type; naming convention `<type>_0N.jpg`
- [x] Include a commented SD1.5 fallback variant section for users who don't have Flux: use `workflow_api.json` base + `lora_name="360_diffusion_sd15.safetensors"`, trigger `qxj`, aspect 1:1 or 1:2, then centre-crop

### Task 4: ComfyUI Workflow C — Planet Interior Panoramas (Flux 360° LoRA)
**Files:**
- Create: `tools/comfyui/workflow_flux_360_interior.json`

- [x] Clone `workflow_flux_360_planets.json`; change image size to `width=4096, height=2048` for high-res panoramas
- [x] Adjust KSampler/BasicGuider: `steps=40, guidance=3.0` (more detail needed for interior scenes)
- [x] Positive prefix: `equirectangular 360 degree panorama, interior view, [FACTION_SCENE_PROMPT]`
- [x] `SaveImage.filename_prefix`: `"panoramas/[FACTION]_[CLIMATE]"` (e.g. `panoramas/bastions_city`)
- [x] Add `_generation_notes`: 5 faction cities + 3 wilderness biomes (jungle/tundra/desert) = 8 panoramas minimum
- [x] SD1.5 alt-workflow note: use `qxj` trigger, 768×384, iterative img2img upscale 2× with `denoise=0.35` to reach 1536×768

### Task 5: (Manual) Generate Nebula Assets on ComfyUI Host
**Files:**
- Populate: `src/assets/nebula/far_red.png`, `far_teal.png`, `far_violet.png`, `far_amber.png`
- Populate: `src/assets/nebula/mid_red.png`, `mid_teal.png`, `mid_violet.png`, `mid_amber.png`
- Populate: `src/assets/nebula/near_red.png`, `near_teal.png`, `near_violet.png`, `near_amber.png`

- [ ] Load `workflow_zit_nebula.json` into ComfyUI at `oleg@192.168.88.193:8188`
- [ ] Run 12 generations (3 layers × 4 palettes); adjust per-layer density:
  - far:  low density, faint glow — LoRA weight 0.6
  - mid:  medium structure, visible gas lanes — LoRA weight 0.8
  - near: high density, bright highlights — LoRA weight 0.9
- [ ] Export as PNG 1024×1024; place in `src/assets/nebula/` using `<layer>_<palette>.png` naming
- [ ] Delete old 12 files (previously unnamed/inconsistent) and update `src/assets/manifest.ts` nebula entries

### Task 6: (Manual) Generate Planet/Star Maps and Interior Panoramas
**Files:**
- Populate: `src/assets/planet_maps/<type>_0N.jpg` for faction-themed types
- Populate: `src/assets/star_maps/<type>_0N.jpg`
- Populate: `src/assets/panoramas/<faction>_<biome>.jpg`

- [ ] Run `workflow_flux_360_planets.json` for 8 planet types (2 variants each = 16 images) + 4 star types (1 each = 4 images)
- [ ] Export as JPEG 2048×1024 (90% quality); keep existing Solar System Scope maps as fallbacks (`_04`, `_05`, `_06` suffix)
- [ ] Run `workflow_flux_360_interior.json` for 5 faction cities + 3 wilderness = 8 panoramas
- [ ] Export as JPEG 4096×2048 (85% quality); place in `src/assets/panoramas/`
- [ ] Verify no Solar System Scope originals are accidentally overwritten (they carry CC BY 4.0 attribution in `CREDITS.md`)

### Task 7: PixiJS Planet Sphere-Rotation Filter
**Files:**
- Create: `src/presentation/filters/PlanetRotationFilter.ts`
- Modify: `src/presentation/SpaceFlightScene.ts` (or wherever planet sprites are rendered)

- [ ] Create `PlanetRotationFilter extends Filter` with GLSL fragment shader that:
  - maps UV to equirectangular sphere projection (latitude/longitude to UV)
  - accepts `u_offset: float` uniform (0.0–1.0, incremented each frame)
  - clips output to circular mask (discard if `distance(uv, vec2(0.5)) > 0.5`)
  - applies a subtle atmosphere rim-light at edge (`smoothstep` ring)
- [ ] Export the filter class; accept `texturePath: string` and `rotationSpeed: number` constructor params
- [ ] In `SpaceFlightScene`, replace static planet sprites with `PlanetRotationFilter`-wrapped sprites using `planet_maps/<type>_04.jpg` as default texture, AI-generated variant if available
- [ ] Update planet `destroy()` to dispose filter and texture
- [ ] Unit test: `PlanetRotationFilter` increments `u_offset` by `rotationSpeed * dt` each frame; clamps to [0, 1] with wrap-around

### Task 8: PlanetScene 360° Panorama Viewer
**Files:**
- Create: `src/presentation/PanoramaViewer.ts`
- Modify: `src/presentation/PlanetScene.ts`

- [ ] Create `PanoramaViewer` PixiJS component that:
  - accepts a `panoramaUrl: string`
  - renders a wide-FoV slice of the equirectangular image as background (a horizontal band centred on y=50%)
  - responds to pointer/touch drag to pan horizontally (update `u_pan_x` uniform, wrap at ±1.0)
  - displays a subtle vignette overlay
- [ ] GLSL approach: equirectangular → rectilinear projection for the visible FoV slice (avoid sphere distortion for ground-level view)
- [ ] Wire into `PlanetScene.initialize()`: load panorama from `src/assets/panoramas/<faction>_city.jpg` (fallback to `src/assets/panoramas/outlanders_city.jpg`)
- [ ] Panorama texture is loaded lazily via `Assets.load()` with a loading spinner (reuse existing loading overlay from US-076)
- [ ] Unit test: `PanoramaViewer` renders without errors when panorama URL resolves; panning past 1.0 wraps to 0.0

### Task 9: Asset Manifest Update and Integration Verification
**Files:**
- Modify: `src/assets/manifest.ts`
- Modify: `src/assets/planet_maps/CREDITS.md`

- [ ] Add nebula entries: 12 paths `nebula/<layer>_<palette>.png` replacing old unnamed paths
- [ ] Add star_maps entries: `star_maps/<type>_01.jpg` (4 entries)
- [ ] Add panoramas entries: `panoramas/<faction>_city.jpg` + wilderness variants (8 entries minimum)
- [ ] Ensure `planet_maps/` CC BY 4.0 originals remain listed and attributed; add note for AI-generated variants (`_01`, `_02`, `_03` suffix = AI-generated, `_04`+ = Solar System Scope CC BY 4.0)
- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npm test -- --run` passes (unit tests for PlanetRotationFilter and PanoramaViewer)
- [ ] Launch dev server; confirm: nebula layers render in space flight, planets rotate smoothly at ≥ 30 fps, planet scene shows scrollable panorama background
