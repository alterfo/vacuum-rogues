# Planet map credits

The `*_04` / `*_05` equirectangular surface maps in this folder are derived from
**Solar System Scope** textures, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source: https://www.solarsystemscope.com/textures/
- © INOVE / Solar System Scope — used and redistributed under CC BY 4.0.

| File(s) | Source texture |
|---------|----------------|
| `terrestrial_04`, `habitat_04` | Earth daymap |
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

- `<type>_01` … `<type>_03` — **AI-generated** locally (ComfyUI, Flux 360° LoRA),
  no third-party license.
- `<type>_04` and higher — **Solar System Scope**, CC BY 4.0 (the verified
  originals are tabled above; additional `_06`+ tiles follow the same CC BY 4.0
  source and convention).

The rotation shader (`PlanetRotationFilter`) defaults to the `<type>_04` map and
prefers an AI variant only when one is present. Keep this attribution while any
CC BY map is shipped.

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

The CC BY `terrestrial_04`/`terrestrial_05` Earth daymaps above are the legacy
seed art; once the alien terran sets are generated they replace these on disk
under the same suffix convention (`_01`…`_03` AI-generated). Variety is
glob-driven: selection (`pickVariant`/`pickVariantKey`, FNV-1a hash by planet id)
spreads stably across every globbed `terrestrial_NN`, so landing more variant
files widens variety with no code change.

**Generation params (manual, GPU host `oleg@192.168.88.193`, RTX 4090):**

- `planet_maps` (equirectangular, 1024×512, 2:1): Flux 360° LoRA path —
  `python3 tools/comfyui/generate_assets.py --category planet_maps --clean`.
  Must stay 360° equirect, never a top-down sphere sprite.
- `planets` (globe sprite, 1024×1024, centered disc, transparent): SDXL with an
  explicit `--ckpt` (the default Flux model breaks `CheckpointLoaderSimple`) —
  `--category planets --ckpt realvisxl_v5.safetensors --clean`.
- Verify via `/history` (queued ≠ success); don't `/free` the shared GPU. rsync
  the emitted `terrestrial_NN` into `src/assets/planet_maps/` and
  `src/assets/planets/`.
