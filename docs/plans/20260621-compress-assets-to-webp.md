---
# Compress Assets to WebP (~581 MB → smaller)

## Overview
`src/assets/` holds **~581 MB** of art, all PNG/JPG (180 PNG + 17 JPG, **0 webp**) — dominated by
`nebula` (249 MB), `panoramas` (189 MB), `ships`, `planets`, `portraits`, `stars`, and the maps.
Convert the source images to **WebP** to shrink the repo and the shipped bundle. **Per-category
quality** (confirmed): lossy ~q80 for photoreal categories, lossless/high-q for UI + icons (preserve
alpha + crisp edges). Because the asset manifest keys by path **without extension** and already globs
`.webp`, the conversion is **transparent to every `texture()` caller** — no rendering code changes.

## Context
- **Manifest (the key insight):** `src/assets/manifest.ts` — `import.meta.glob("./**/*.{png,jpg,jpeg,webp}",
  { query:"?url", eager:true })`; the key is the path **with the extension stripped**
  (`.replace(/\.(png|jpe?g|webp)$/i, "")`), so `nebula/red_mid.png` and `nebula/red_mid.webp` both map
  to key `nebula/red_mid`. Converting a file and deleting the original keeps the key identical →
  `texture("nebula/red_mid")` / `texUrl` / `allTextures` are unaffected.
- **Loading:** `src/presentation/textures.ts` (+ `LAZY_PREFIXES` for nebula/panoramas/surfaces/
  planet_maps/star_maps/stars) loads by resolved URL; WebP loads fine in PixiJS/browsers, lazy path
  included. `pickVariant`/`pickVariantKey` key off the stem, so variants are unaffected.
- **No converter installed** (no `sharp`, no `cwebp`, no Vite image plugin) — add `sharp` as a devDep
  and a conversion script in `tools/`.
- **Scope:** only `src/assets/**` game art. **Do NOT touch** `e2e/screenshots/*.png` (visual-test
  baselines) or `public/` favicons/OG images. `player_ships/` is currently untracked — convert it too.
- **Decision (confirmed):** per-category quality (lossy photoreal / lossless UI+icons); convert
  sources and remove originals (true size reduction).

## Development Approach
- **Regular + verification.** The bulk image conversion is a one-shot script run, not TDD-able as
  logic; what IS testable and must be guarded: (a) the pure per-category quality selection, (b)
  **manifest key-parity** — every key resolvable before conversion still resolves after (no caller
  breakage), (c) `npm run build` succeeds and total asset size drops.
- **Snapshot the key set first** as the regression baseline; assert parity after each conversion batch.
- Run `impact` on `manifest.ts`/`textures.ts` before touching them (likely no code change needed).
  **Do not modify existing test assertions** (standing rule); add new tests. Visual-verify key scenes
  by screenshot (WebP must look right — especially UI/icon edges + alpha).
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: pure `webpOptionsFor(category)` returns lossy ~q80 for photoreal categories and lossless for
  ui/icons; a sample PNG→WebP conversion produces a valid, smaller file with the same dimensions.
- Integration/parity: after conversion, the manifest exposes **exactly the same key set** as the
  pre-conversion snapshot (no missing/renamed keys); no PNG/JPG remain in converted categories.
- Build/size: `npm run build` succeeds; `src/assets` total bytes drop materially.
- Visual: nebula/panorama backgrounds, a planet, a ship, and the UI/icons render correctly.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Conversion tool + per-category quality (sharp)
**Files:**
- Modify: package.json (add `sharp` devDep)
- Create: tools/optimize-assets.ts (`webpOptionsFor(category)`; converts a path PNG/JPG → WebP,
  preserves dimensions + alpha, deletes the original; `--category` / `--dry-run` flags)
- Create: src/tests/assets/webpOptions.test.ts; src/tests/assets/manifestKeySnapshot.test.ts
  (captures the current key set as the parity baseline)

- [x] add `sharp`; implement the converter with a pure `webpOptionsFor` (lossy ~q80 photoreal,
      lossless for ui/icons), preserving size + alpha, deleting originals on success
- [x] snapshot the current manifest key set as the parity baseline
- [x] write tests: `webpOptionsFor` per category; a fixture PNG→WebP is valid + smaller + same dims
- [x] run affected tests — must pass before next task

### Task 2: Convert photoreal categories → lossy WebP
**Files:**
- Convert (remove originals): src/assets/{nebula,panoramas,planets,planet_maps,stars,star_maps,
  portraits,ships,player_ships,surfaces}/**.{png,jpg,jpeg} → .webp
- Create: src/tests/assets/keyParity.photoreal.test.ts

- [x] run the converter on the photoreal categories (lossy ~q80); no PNG/JPG remain in them
- [x] manifest key-parity holds for these categories (every prior key still resolves)
- [x] write tests: keys for the converted categories match the snapshot; files are `.webp`
- [x] run affected tests — must pass before next task

### Task 3: Convert UI + icons → lossless/high-q WebP
**Files:**
- Convert (remove originals): src/assets/{ui,icons}/**.{png,jpg,jpeg} → .webp (lossless / high-q, alpha preserved)
- Create: src/tests/assets/keyParity.ui.test.ts

- [x] convert ui + icons losslessly (preserve alpha + crisp edges); no PNG/JPG remain
- [x] key-parity holds for ui/icons; visual screenshot deferred to Task 4 (manual; screenshots
      flake on this game's render loop). Edge crispness guaranteed by lossless encode; alpha
      preservation verified programmatically (sharp `hasAlpha=true` on a transparent sample)
- [x] write tests: ui/icon keys match the snapshot; alpha preserved (sample has transparency)
- [x] run affected tests — must pass before next task

### Task 4: Verify acceptance + size + build
**Files:**
- Modify (if present): src/assets/**/CREDITS.md (update referenced filenames to .webp — cosmetic)

- [ ] full manifest key-parity vs the snapshot (zero missing keys across ALL categories); 0 PNG/JPG
      left under `src/assets`
- [ ] `npm run build` succeeds; record before/after `du -sh src/assets` (material reduction)
- [ ] visually verify a nebula background, a planet, a ship, and the UI render correctly
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing asset/texture test assertions changed

## Technical Details
- **Why callers are safe:** `manifest.ts` strips the extension when building keys, so swapping
  `x.png` → `x.webp` (and removing the png) leaves `texture("…/x")` resolving to the new hashed WebP
  URL. The glob already lists `webp`. No change to `textures.ts`, `pickVariant`, or any scene.
- **Quality map:** photoreal categories (nebula, panoramas, planets, planet_maps, stars, star_maps,
  portraits, ships, player_ships, surfaces) → lossy `quality: ~80`; `ui`, `icons` → `lossless: true`
  (or near-lossless) with alpha preserved. Dimensions unchanged (no resizing).
- **Determinism/idempotency:** the script skips files already WebP and is safe to re-run; convert →
  verify → delete-original only on success.
- **No screenshot baselines touched:** `e2e/screenshots/*.png` and `public/` are excluded.

## Post-Completion
**Manual verification:** launch the game; confirm nebula/panorama backdrops, planets, ships, portraits,
and the HUD/icons all render correctly with no missing textures, and that `src/assets` is materially
smaller than the ~581 MB baseline.
