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
