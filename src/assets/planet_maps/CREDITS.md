# Planet map credits

The `*_04` / `*_05` equirectangular surface maps in this folder are derived from
**Solar System Scope** textures, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source: https://www.solarsystemscope.com/textures/
- © INOVE / Solar System Scope — used and redistributed under CC BY 4.0.

| File(s) | Source texture |
|---------|----------------|
| `terrestrial_05` | Mars |
| `gas_04` | Jupiter |
| `gas_05` | Saturn |
| `ice_04` | Neptune |
| `ice_05` | Uranus |
| `volcanic_04` | Venus (surface) |
| `volcanic_05` | Mars |
| `industrial_04` | Mercury |

## Suffix convention

Variant suffixes encode provenance so attribution can be reasoned about by
filename alone:

- `<type>_01` … `<type>_03` — **AI-generated** locally (ComfyUI), no third-party
  license.
- `<type>_04` and higher — originally **Solar System Scope**, CC BY 4.0 (the
  verified originals are tabled above; additional `_06`+ tiles follow the same CC
  BY 4.0 source and convention).

**Exception — terran & habitat `_04` are now AI-generated.** The `terrestrial_04`
and `habitat_04` Earth daymaps were replaced on disk with alien AI maps (see
"Terran art is alien-by-design" below), so for `terrestrial`/`habitat` *every*
shipped AI variant (`_01`…`_04`) is locally generated. The `_04+ = Solar System
Scope` convention still holds for `gas`/`ice`/`volcanic`/`industrial`.

Variant selection (`pickVariant`/`pickVariantKey`, FNV-1a hash by planet id)
spreads stably across every globbed `<type>_NN`. Keep CC BY attribution while any
Solar System Scope map is shipped.

## Terran art is alien-by-design

`PlanetType.TERRESTRIAL` worlds are **deliberately not Earth** (plan
`docs/plans/20260620-alien-terran-planet-art.md`). The ComfyUI prompts for the
terran axis (`tools/comfyui/asset_prompts.json` → `planet_maps` and `planets`)
describe an *alien but habitable* biosphere — exotic ocean liquids (turquoise,
emerald, indigo, wine), non-Earth vegetation (crimson, violet, amber-gold, cyan),
unfamiliar landmasses, lavender/pale-green haze — and the category negatives
explicitly exclude Earth (`Earth, blue marble, recognizable Earth continents,
real-world map, satellite photo of Earth, Africa, Americas, real-world
coastlines`). The `terranPromptAlien` unit test pins this so an edit can't
quietly reintroduce blue-marble imagery.

**Done:** the Earth daymaps have been replaced. `terrestrial_01`…`_04` and
`habitat_01`…`_04` are now alien AI maps (SDXL flat-swatch, `realvisxl_v5`, the
`planet_maps` prompts in `asset_prompts.json`). Only `terrestrial_05` (a CC BY
Mars map) remains from the original solar-system seed art. Variety is glob-driven:
selection (`pickVariant`/`pickVariantKey`, FNV-1a hash by planet id) spreads
stably across every globbed `terrestrial_NN`, so landing more variant files
widens variety with no code change.

**Generation params (manual, GPU host `oleg@192.168.88.193`, RTX 4090):**

- `planet_maps` (2:1 flat surface swatch, upscaled to 2048×1024): SDXL flat-swatch
  path with an explicit `--ckpt` —
  `python3 tools/comfyui/generate_assets.py --category planet_maps --ckpt realvisxl_v5.safetensors --clean`.
  The `asset_prompts.json` template + negative force a flat edge-to-edge texture
  (no sphere/globe/Earth). A Flux-360° equirect path also exists
  (`workflow_flux_360_planets.json`) but needs a working Flux checkpoint on the host.
- `planets` (globe sprite, 1024×1024, centered disc, transparent): SDXL with an
  explicit `--ckpt` (the default Flux model breaks `CheckpointLoaderSimple`) —
  `--category planets --ckpt realvisxl_v5.safetensors --clean`.
- Verify via `/history` (queued ≠ success); don't `/free` the shared GPU. rsync
  the emitted `terrestrial_NN` into `src/assets/planet_maps/` and
  `src/assets/planets/`.
