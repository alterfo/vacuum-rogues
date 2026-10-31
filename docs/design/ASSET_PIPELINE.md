# Asset pipeline — куда класть растр и музыку (авто-подхват)

Чтобы ассеты подхватывались **по правилу именования** без правок кода.

## Картинки (растр) — `src/assets/<категория>/<имя>.<png|jpg|webp>`

Кладёшь файл — он автоматически регистрируется по ключу `категория/имя` (без
расширения) через `src/assets/manifest.ts` (Vite `import.meta.glob`). Vite сам
хеширует/оптимизирует и подставляет финальный URL.

```ts
import { texture, allTextures } from "@/assets/manifest";

texture("planets/ice_01");      // → "/assets/ice_01.a1b2c3.png" (или undefined)
allTextures("nebula");          // → ["nebula/red_far", "nebula/red_mid", ...]
```

### Категории и конвенция имён
| Папка | Имя файла | Пример |
|-------|-----------|--------|
| `nebula/` | `<palette>_<layer>` | `red_far`, `blue_mid`, `teal_near` |
| `planets/` | `<type>_<NN>` | `terrestrial_01`, `gas_02`, `ice_01` |
| `stars/` | `<startype>` | `yellow`, `red_dwarf`, `blue_giant`, `neutron` |
| `ships/` | `<role>` | `ranger`, `trader`, `pirate`, `patrol` |
| `icons/` | `<module>` | `engine`, `fuel_tank`, `radar`, `shield` |
| `ui/` | `<name>` | `panel`, `radar_bezel`, `bottom_bar` |
| `portraits/` | `<faction>` | `outlanders`, `bastions`, `syndicate` |

- `palette`: `red | blue | green | teal` · `layer`: `far | mid | near`.
- `type` (planets): `terrestrial | gas | ice | volcanic | industrial | habitat`.
- Несколько вариантов — суффикс `_01.._NN` (движок выберет по seed).
- Промпты для генерации — `docs/design/ART_PROMPTS.md` (имена файлов = из таблицы).

## Музыка — `public/audio/mus_<key>.ogg` (+ `.mp3` фоллбэк)

Папка `public/` отдаётся как есть (не бандлится). Имя строго `mus_<key>.ogg`,
где `<key>` — **ключ состояния** из `docs/design/AUDIO_TRACKLIST.md`
(`explore_calm`, `combat`, `planet_hub`, `warp`, …). Путь строится из ключа:

```ts
import { musicUrl } from "@/assets/manifest";
musicUrl("combat"); // → "/audio/mus_combat.ogg"
```

Будущий `AudioManager` (модуль `audio`, см. MODULES.md) по ключу состояния сам
возьмёт нужный трек и кроссфейднет. Слои для адаптивности: `mus_<key>_calm.ogg`
и `mus_<key>_intense.ogg`.

## Форматы и подготовка
- **Туманности/фон**: PNG с альфой, бесшовные/большие; 3 слоя `far/mid/near`.
- **Планеты/звёзды/корабли/иконки**: PNG с альфой, квадрат, единый угол света.
- **Аудио**: `.ogg` (осн.) + `.mp3` (фоллбэк Safari), loop-seamless, ≈ −14 LUFS.

## Интеграция в рендер (следующий шаг)
- Заменить процедурные `createNebulae/createStar/createPlanets` на `Sprite` из
  `texture(...)`, оставив текущую Graphics-рисовку как **фоллбэк**, если ассета
  нет (`texture(key) ?? procedural`). Так игра работает и без артов, и с ними.
- UI-рамки — `NineSliceSprite` (PixiJS 8) из `ui/panel`.
- Ассеты грузить лениво через `Assets.load(url)` (PixiJS Assets API).

## Почему так
- **Картинки в `src/assets`** → Vite оптимизирует, хеширует, tree-shake; ключ от
  пути = стабильная конвенция; добавление файла не требует кода.
- **Музыку в `public/audio`** → большие медиа не гоняем через бандлер; путь
  предсказуем из ключа состояния.

## Asset coverage audit (2026-10-31)

Canonical inventory of the raster categories currently shipped under `src/assets/`:

| Category | Count | Render path |
|----------|------:|-------------|
| `planets` | 36 | `PlanetSprite` planet disc (`pickVariant`) |
| `planet_maps` | 47 | `PlanetSprite` equirect map (`pickVariant`) |
| `surfaces` | 24 | `PlanetScene` landing backdrop |
| `star_maps` | 31 | `StarRenderer` (`pickVariantKey`) |
| `stars` | 30 | dead art (zero code references) |
| `ships` | 24 | `NpcShipSprite` / main menu |
| `player_ships` | 12 | `PlayerShipRenderer` |
| `portraits` | 15 | `RaceSelectionScene` / dialogue |
| `icons` | 6 | `gearIcon` family fallback |
| `station` | 15 | `stationArt` flight marker |
| `panoramas` | 8 | `PlanetScene` panorama fallback |
| `ui` | 8 | dead art (zero code references) |

Audit note: the plan draft expected 48 `planet_maps`, but the committed glob has 47 —
`habitat_05` is the missing Solar System Scope original while `terrestrial/gas/ice/volcanic/
industrial` each have `_04` and `_05`.

### `station_interior/` decision (procedural-only for now)

`resolveStationBackdropKey(type, id)` already queries `pickVariantKey("station_interior", …)`
and falls back to the 12-band procedural gradient in `buildStationBackdrop` when the category
is absent. Decision: keep the procedural fallback as the shipped interior backdrop; do not
generate `station_interior/` art in this pass. When real interior panoramas are produced, drop
them under `src/assets/station_interior/<prefix>_NN.webp` (prefixes from
`STATION_TEXTURE_PREFIX`: `trade`, `drydock`, `military`, `science`, `fabricator`) and the
existing resolver lights up with no scene change.

### Gear-icon coverage gaps

The six committed `icons/` files cover the flat fallbacks: `engine`, `fuel_tank`, `radar`,
`shield`, `repair_droid`, and `laser` (ENERGY weapons). These gear families still render a
drawn category-glyph badge in `gearIcon.ts` and would benefit from an icon:
- Hull (`HL`)
- Equipment: `SCANNER` (`SC`), `GRAPPLE` (`GR`), `GRAV_TRACTOR` (`GT`)
- Weapons: `FRAGMENT` (`FR`), `MISSILE` (`MS`)

### Nebula decision (closed)

Do not re-add the `nebula/` texture category. The owner removed the generated nebula art
(2026-10-31) and nebula rendering stays procedural. `allTextures("nebula")` must remain empty;
the resolver/asset-coverage tests ratchet that.
