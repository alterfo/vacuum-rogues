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
