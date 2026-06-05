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
