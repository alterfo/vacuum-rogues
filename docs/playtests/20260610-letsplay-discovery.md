# Letsplay Discovery — 2026-06-10

Full-loop playtest with **real visuals** (background NOT hidden), driven by
`e2e/letsplay-discovery.spec.ts`. 21 steps, all passed, **0 JS errors**.
Screenshots: `e2e/screenshots/letsplay/lp-*.png` (gitignored, regenerate by
running the spec with `NO_PROXY=localhost,127.0.0.1`).

## Findings

**Status (2026-06-10): all six findings FIXED** via plan
`docs/plans/20260610-letsplay-fixes-regression-first.md` (regression-first:
red test → fix → screenshot verification). Verifying screenshots regenerated
2026-06-10 by re-running the spec — 21/21 steps ok, 0 JS errors:

| Finding | Fix | Verified by |
|---------|-----|-------------|
| F1 rectangles | PlanetRotationFilter disc coords from `vPos` varying, not raw `vTextureCoord` | `lp-04-planet-0..3` — all four planets circular with real textures |
| F2 background | `BACKGROUND_DIM` (0.45) overlay in SpaceBackgroundLayer | `lp-03-flight-initial`, `lp-07-route` — game layer readable |
| F3 ship invisible | CameraController pan clamp covers full system boundary | `lp-06-ship` — ship centred, outline + engine glow visible |
| F4 sun band | sphereMesh mirror-repeat U / clamp V; seam-row star maps removed; tiling fallback mask wrapped | `lp-05-sun` — clean disc, no band |
| F5 combat layout | hex grid centred from screen size; units = faction-tinted ship sprites | `lp-20-combat` — centred grid, cyan ranger vs red pirate |
| F6 dual equipment | InventoryScene shows canonical GearCatalog loadout; legacy modules hidden | `lp-19-inventory` — same gear the shop sells + derived stats |

(F7, DialogueSystem session-map growth, was fixed in the same plan — unit
regression in `src/tests/dialogueSystem.test.ts`.)

Original findings below, kept for the record.

### CRITICAL

**F1. Planets render as rectangles in SpaceFlightScene — GLSL filter path (NOT the TilingSprite path).**
Evidence: `lp-04-planet-0/1/2`, `lp-15-reentry` (two planets, both broken).
The real game takes the *preferred* `createPlanetRotationFilter` path
(`PlanetSprite.buildEquirectSphere`), not the TilingSprite fallback that was
fixed earlier. Visual signature: circular arc on one side, straight clipped
edge on the other.

Root-cause hypothesis (matches signature exactly): in
`src/presentation/filters/PlanetRotationFilter.ts` the fragment shader assumes
`vTextureCoord` spans [0,1] over the sprite (`vec2 p = (vTextureCoord-0.5)*2`),
but the PixiJS v8 vertex stage computes
`vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw)` — when the
pooled filter input texture is **larger** than the output frame,
vTextureCoord only reaches `k = frame/texture < 1`. The disc circle is then
mis-centred/mis-scaled: clipped correctly near origin-side, never reaches
`r > 1` on the far side → straight edge. Same bug affects limb darkening and
rim-light placement.

Fix direction: pass `aPosition` through as its own varying (`out vec2 vPos`)
and compute disc coords from it, OR normalize in fragment:
`vec2 norm = vTextureCoord * uInputSize.xy / uOutputFrame.zw`.
Must be verified **in a real browser with screenshots** — jsdom unit tests
cannot catch this class of bug; the regression test must sample canvas pixels
(corner of planet bounds must be transparent) or compare screenshots.

Note: `lp-10-planet-scene` shows the planet **circular** in PlanetScene — that
scene uses a different render path. Only the flight scene is broken.

### HIGH

**F2. Readability: nebula background drowns the game layer.**
Evidence: `lp-03-flight-initial` (planets/ship invisible at default zoom),
`lp-07-route` (route line barely visible). The panorama is too bright/opaque.
Direction: darken overlay (e.g. 0.4–0.6 black multiply) or reduce panorama
alpha; keep the art, tune readability. This was the user's standing complaint.

**F3. Player ship cannot be found/seen.**
Evidence: `lp-06-ship` (camera focused on diag ship coords at zoom 3.5 — no
ship discernible), `lp-03` (not visible at default view). Initial spawn is at
the system edge, outside camera pan-clamp range (known finding ④ from the
e2e plan). Needs: (a) verify outline/engine glow renders at all in real
visuals, (b) fix pan clamp so the camera CAN reach the ship spawn point,
(c) consider readability marker (e.g. subtle pulsing ring) at low zoom.

### MEDIUM

**F4. Sun has a horizontal seam/band artifact in its lower third.**
Evidence: `lp-05-sun` — dark discontinuity band across the disc. Suspect
texture v-seam or limb-mask arc in StarRenderer. Verify in browser.

**F5. Combat scene is bare and mis-laid-out.**
Evidence: `lp-20-combat` — hex grid floats top-left (not centred), units are
plain circles, ~60% of the screen is empty. Functional but reads as
unfinished. Candidate polish task (grid centring, ship sprites on hexes).

**F6. Two parallel equipment systems are both player-visible.**
Evidence: `lp-19-inventory` shows legacy modules (Лазер МК-1, Базовый щит,
Быстрый двигатель) with 3 empty slots — the legacy `Player.ship.modules`
system, which is INERT in normal play (known caveat: EquipmentSystem has no
production callers; speed bonus never applies). `lp-12-equipment-shop` sells
GearCatalog gear which DOES work. A player installing the legacy «Быстрый
двигатель» gets nothing. Decide canonical system; hide or wire the other.

### Verified working ✅

- 0 JS errors across all 21 steps (page errors + console.error collected)
- Pause stops the ship immediately mid-flight (drift 0.00px) — sprint3 fix holds
- Main menu, faction select, trade, equipment shop, government, info center,
  star map, station, NPC info panel, inventory, combat — all load and render
- PlanetScene planet is circular; panorama parallax mounts
- Re-entry spawn works: ship at (-68, 207) beside the planet, not system edge
- «Продолжить» highlights in main menu once a save exists

## Reproduction

```bash
NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=chromium
```

Step results and JS errors are printed as `STEP_RESULTS` / `JS_ERRORS` JSON in
stdout; `SCENE_DIAG` logs planet/ship world coordinates.
