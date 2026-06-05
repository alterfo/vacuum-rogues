# ComfyUI asset generation — Galactic Horizon

Generates game art into the exact folder/name structure of
`docs/design/ASSET_PIPELINE.md`, using the prompt variations from
`docs/design/ART_PROMPTS.md`. Names contain **no proprietary terms**.

## Files
- `asset_prompts.json` — categories, sizes, templates and variation axes (48 assets:
  nebula, planets, stars, ships, icons, ui, portraits).
- `generate_assets.py` — driver: builds the txt2img graph and queues one job per
  asset via the ComfyUI API, with `SaveImage.filename_prefix = "<category>/<name>"`.
- `workflow_api.json` — the API-format graph (what the script builds) for reference.
- `GameAssets.ui.json` — a UI-loadable workflow (Load it in ComfyUI to tweak by hand).

## On the ComfyUI host (192.168.88.193)
Deployed copy lives in `~/ComfyUI/asset_gen/`; the UI workflow is in
`~/ComfyUI/user/default/workflows/GameAssets.json` (appears in the ComfyUI
workflow list).

## Usage
Run with the **ComfyUI venv python** (so `--cutout`'s rembg is available):
```bash
cd ~/ComfyUI/asset_gen
PY=~/ComfyUI/venv/bin/python
$PY generate_assets.py --list                    # preview all 48 names + prompts
$PY generate_assets.py --category ships --cutout  # one category, transparent
$PY generate_assets.py --cutout                  # everything, transparent where applicable
$PY generate_assets.py --ckpt realvisxl_v5.safetensors --cutout
```
- Default checkpoint = first non-turbo one (currently **`realvisxl_v5.safetensors`**,
  a strong SDXL finetune). Turbo/Lightning need ≈4 steps & cfg≈1 — pass `--ckpt` + edit config.
- `--clean` writes `output/<category>/<name>.png` (mirrors `src/assets/`); the
  original `_00001_` stays so the ComfyUI gallery still shows/downloads it.
- `--cutout` (implies `--clean`): removes the background on **alpha** categories
  (planets, ships, icons, portraits) → transparent PNG, via rembg (first run
  downloads a 168MB model to `~/.u2net/`). Needs the venv python.
- Per-category flags live in `asset_prompts.json`: `"alpha": true` (transparent
  cutout) and `"tileable": true` (nebula — see note).

## Getting the images into the game
ComfyUI writes to `~/ComfyUI/output/<category>/<name>.png`. Copy the ones you like
into the repo's `src/assets/<category>/<name>.png` (same structure), e.g. from your
Mac:
```bash
rsync -av oleg@192.168.88.193:'~/ComfyUI/output/' /Users/olegsidorkin/SpaceRangers/src/assets/
```
The engine auto-picks them up by name (`src/assets/manifest.ts`).

## Notes
- **Transparent backgrounds:** handled by `--cutout` (rembg post-process) for alpha
  categories. Prompts put subjects on a flat neutral background for a clean cut.
  Stars stay on black (additive glow in-engine); UI frames are kept on black.
- **Tileable nebula:** `"tileable": true` is currently metadata only — true seamless
  tiling needs a circular-conv node (the `ComfyUI-seamless-tiling` custom node didn't
  load on this host). Until that's fixed, use the engine's **procedural** nebulae for
  the diffuse parallax background and these AI nebulae as occasional "hero" backdrops.
- Tweak prompts/sizes/flags in `asset_prompts.json`; re-run. Seeds are deterministic
  per name (stable re-runs); change the `_NN` suffix for more variants.
