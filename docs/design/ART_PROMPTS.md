# Galactic Horizon — промпты для генерации арта

Растровый «нарисованный» арт (туманности, планеты, рамки UI) я кодом не нарисую —
вот промпты под генератор (Midjourney / SDXL / Flux / DALL·E). 

**Правила копирайта:** только оригинальный арт. **Не** упоминай «Space Rangers»,
названия рас/кораблей/локаций оригинала и не проси «in the style of Space
Rangers». Описывай жанр и мудборд своими словами.

Технические рекомендации:
- Туманности/фон — **бесшовный тайл** (`--tile` в MJ / "seamless tileable") или
  большие 4096² поля, экспорт **PNG с альфой** (нужны на чёрном/прозрачном).
- Иконки/модули — квадрат, прозрачный фон, единый угол света.
- Делай **3–4 цветовых варианта** каждого ассета (по палитрам систем: красно-
  оранжевая, сине-фиолетовая, жёлто-зелёная, бирюзовая).

---

## 1. Фон-туманность (слой параллакса)
```
Deep space nebula, vast painterly gas clouds with glowing ember cores lit from
within, billowing volumetric tendrils, dense starfield, high dynamic range,
cinematic, dark near-black background, fiery red-orange and gold palette,
subtle dust lanes, photoreal astrophotography meets digital matte painting,
seamless tileable, 4k, no text, no UI, no characters
--ar 16:9 --tile --stylize 250
```
Варианты палитры — заменяй цвет: `cyan-teal and emerald`, `violet and magenta`,
`olive-green and amber`. Сгенерируй 3 слоя: **far** (тёмный, малоконтрастный),
**mid** (основные облака), **near wisps** (редкие яркие клочья с альфой).

## 2. Звёздные «облака»/скопления (мелкие точки-кластеры)
```
Cluster of tiny glowing star particles, green and yellow specks scattered in a
loose swarm against transparent background, bokeh, soft glow, no nebula,
PNG alpha, top-down, 2k --tile
```

## 3. Планета (спрайт сверху/в перспективе)
```
Alien planet sphere, top-down game sprite, soft global illumination, detailed
surface (oceans, clouds, continents / barren rock / ice / gas bands),
subtle atmospheric rim light, isolated on transparent background, no stars,
high detail, centered, 1024x1024 PNG alpha, painterly sci-fi
```
Сделай по типам: `terrestrial (blue oceans + clouds)`, `gas giant (banded,
storm spot)`, `ice (white-cyan, cracks)`, `volcanic (black + glowing lava)`,
`industrial (grey, city lights on night side)`, `habitat ring station`.

## 4. Звезда системы (солнце)
```
Bright star / sun, intense glowing core with corona and flares, lens-flare,
isolated on transparent background, additive glow, 1024x1024 PNG alpha
```
Варианты: `red dwarf (dim red)`, `yellow (sun-like)`, `blue giant (white-blue)`,
`neutron (tiny intense white + beams)`.

## 5. Корабль игрока/NPC (спрайт сверху)
```
Sci-fi spaceship top-down game sprite, small agile ranger vessel, metallic blue
hull with glowing engine, clean readable silhouette, isolated transparent
background, soft top light, 512x512 PNG alpha, no background
```
Варианты по ролям: `military (heavy, red accents)`, `trader (bulky cargo pods)`,
`pirate (asymmetric, spikes, dark)`, `patrol (sleek, cyan)`.

## 6. Рамка/панель UI (хром-сай-фай HUD)
```
Sci-fi game UI panel frame, glowing cyan-blue holographic bezel, brushed metal
edges, rounded corners, semi-transparent dark glass center, ornate but clean,
isolated on transparent background, 9-slice friendly borders, PNG alpha, no text
```
Также: `bottom command bar`, `circular radar bezel`, `small tooltip card`.

## 7. Иконки модулей/оборудования (грид магазина)
```
Sci-fi ship module icon, single object centered: <fuel tank | engine | radar
dish | shield generator | laser weapon | repair droid>, glossy 3d render, soft
studio light, isolated transparent background, 256x256 PNG alpha, game inventory
icon, consistent lighting angle across set
```

## 8. Портреты NPC (диалоги/торговец)
```
Alien humanoid portrait bust, sci-fi, neutral background panel, distinct
non-human features (skin tone, eyes), shoulders-up, soft cinematic light,
512x512, original character, painterly --no text
```
Сделай по фракциям (наши): Окраинники, Бастионы, Синдикат, Парадоксы, Прогрессоры
— каждой свой визуальный код (цвет/силуэт), но **не копируй** рас оригинала.

---

### Интеграция в движок
- Фон: заменить процедурные `createNebulae`/`createStarField` на тайл-спрайты по
  слоям (far/mid/near) с тем же параллаксом; процедурку оставить как фоллбэк.
- Планеты/звёзды/корабли: подменить Graphics-рисовку на `Sprite` из текстур.
- UI-рамки: 9-slice (`NineSliceSprite` в PixiJS 8).
- Ассеты класть в `src/assets/` (или `public/`), грузить лениво.

---

## LoRA Pipelines

Production assets are generated on the ComfyUI host (`oleg@192.168.88.193`, port
8188, RTX 4090) using three purpose-built LoRAs. The sections below give the
exact trigger words, prompts, and sampler notes each workflow JSON in
`tools/comfyui/` consumes. The user drives the ComfyUI UI; this file is the
single source of truth for the prompts.

| ID | Base model | Trigger | Weight | Aspect | Use |
|----|-----------|---------|--------|--------|-----|
| Space Image ZIT (`civitai#2334878`) | ZImageTurbo | `Sp11` | ≤ 0.9 | 1:1 (1024²) | Nebula parallax tiles |
| Flux Equirectangular 360° (`civitai#735980`, ver `823024`) | Flux.1 D | `equirectangular 360 degree panorama` | 0.5–1.5 | 2:1 | Planet/star surface maps, interior panoramas |
| 360 Diffusion for SD1.5 (`civitai#26815`) | SD 1.5 | `qxj` | 0.8–1.0 | 1:2 / 2:1 | SD1.5 fallback for interiors |

**Sampler notes:**
- **ZImageTurbo** is a turbo (distilled) model — use low steps (`steps=20`) and
  low CFG (`cfg=4.0`), sampler `dpmpp_2m`, scheduler `karras`. Higher steps wash
  out the LoRA structure.
- **Flux.1 D** uses split loaders (`UNETLoader` + dual `CLIPLoader` for T5 and
  CLIP-L + `VAELoader`), guidance `2.5–3.0`, `steps=30–40`. No classic CFG.
- **SD1.5 360°** is the no-Flux fallback: render at 1:2 (e.g. 768×384) and
  upscale via img2img (`denoise=0.35`) to reach the target resolution.

### Nebula (Space ZIT LoRA)

Tileable square tiles, `1024×1024`, trigger `Sp11`. Generate three parallax
layers (far/mid/near) per palette by adjusting LoRA weight: far `0.6` (faint),
mid `0.8` (visible gas lanes), near `0.9` (bright highlights). Output naming:
`<layer>_<palette>.png` (e.g. `far_red.png`).

**Positive prompts (per palette):**
- **Red:** `Sp11, Hubble space nebula, deep crimson red haze with bright hot star cores, wispy ionised gas tendrils, volumetric glow, black void background, tileable seamless`
- **Teal:** `Sp11, Hubble space nebula, cyan-teal emission nebula, oxygen-III glow, dark dust lanes, tileable seamless`
- **Violet:** `Sp11, Hubble space nebula, deep violet purple gas cloud, star-forming pillars, dark molecular cloud, tileable seamless`
- **Amber:** `Sp11, Hubble space nebula, warm golden amber hydrogen-alpha nebula, bright stellar nursery, tileable seamless`

**Negative (all palettes):** `planets, ships, text, watermark, blurry, low quality, lens flare`

### Planet Surface Maps (Flux 360° LoRA)

Equirectangular maps, aspect `2:1` (2048×1024), trigger prefix
`equirectangular 360 degree panorama`. Aim for ≥ 2 variants per type. Output
naming: `<type>_0N.jpg` (e.g. `bastions_01.jpg`). The rotation shader
(`PlanetRotationFilter`) consumes these as sphere textures.

**Positive prompts (prefix `equirectangular 360 degree panorama, ` + type):**
- **Bastions:** rocky fortress world, scarred red plains, industrial scars, stormy atmosphere
- **Syndicate:** polluted smog world, acid-yellow sky, dense urban sprawl from orbit
- **Outlanders:** temperate colony world, blue ocean patches, patchwork agriculture
- **Progressors:** lush garden world, bioluminescent canopy, research domes visible
- **Paradoxes:** alien crystalline world, impossible geometries, iridescent surface
- **Volcanic:** magma seas, black obsidian plains, lava rivers
- **Ice:** cracked white ice sheets, subsurface ocean hints, blizzard bands
- **Gas:** banded gas giant, Great Storm eye, swirling ammonia clouds

**Negative (all types):** `text, watermark, UI, cartography lines, latitude longitude grid, people`

### Star Surface Maps (Flux 360° LoRA)

Same Flux 360° pipeline as planet maps; aspect `2:1`. Output naming:
`<type>_0N.jpg` in `src/assets/star_maps/`.

**Positive prompts (prefix `equirectangular 360 degree panorama, ` + type):**
- **Yellow:** solar granulation, prominences, sunspot groups
- **Blue:** superheated blue-white star, X-ray glow corona, extreme UV radiation
- **Red:** red dwarf, cool surface convection cells, dim orange glow
- **Neutron:** pulsar jet beams, magnetosphere, faint blue polar glow

**Negative (all types):** `text, watermark, UI, cartography lines, latitude longitude grid, people`

### Planet Interior Panoramas (Flux 360° or SD1.5 360°)

High-res equirectangular panoramas for planetary landing scenes (`PlanetScene`
→ `PanoramaViewer`). Flux preferred at `4096×2048`; SD1.5 360° fallback uses
`qxj` trigger at 768×384, then iterative img2img upscale (`denoise=0.35`) to
1536×768. Output naming: `<faction>_<biome>.jpg` (e.g. `bastions_city.jpg`).

**Positive prompts (prefix `equirectangular 360 degree panorama, interior view, `):**
- **Bastions city:** feudal fortress city, brutalist stone towers, warships in sky
- **Syndicate city:** neon-lit port district, fog, holographic signs
- **Outlanders city:** mid-tech colony town, market square, farmland horizon
- **Progressors city:** gleaming research campus, drone corridors, glass domes
- **Paradoxes site:** impossible crystal architecture, floating islands, alien sky
- **Wilderness:** alien jungle/tundra/desert (per climate)

**Negative (all):** `fisheye, text, watermark, latitude lines, grid, people, faces`
