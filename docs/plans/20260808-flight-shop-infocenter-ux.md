# Flight, Shop, Hangar & Infocenter UX pass

## Overview

A batch of player-facing fixes and UX improvements across four areas, all reported from real play:

1. **Takeoff spawns at the system edge** — undocking from a station/planet drops the ship at the boundary instead of beside the body it launched from.
2. **Infocenter advertises hulls the shop doesn't stock** — the infocenter omits the shop's per-system tech-level filter, so it lists gear/hulls that the real `EquipmentShopScene` at that system filters out.
3. **Shop & hangar labels overlap** ("мешанина") — fixed-fraction columns with no width budget let long names run under the type/price/button columns. Move to an icon-forward layout with hover tooltips.
4. **No stat hints** — gear has no hover tooltip showing its characteristics; this also answers "some equipment's purpose is unclear."
5. **Installed gear still shown for sale** — the shop lists everything in stock regardless of what's already installed.
6. **Buying a hull should always replace the old one, sold with wear (износ)** — replacement + trade-in already works, but trade-in is a flat 40% of base price and ignores hull condition.
7. **Planet orbits too fast** — slow orbital motion around the star by 5×.
8. **Infocenter gear search is weak** — category/tech/price only, no search by characteristics; and its only navigation is "→ Карта". Add stat-based search, a route straight to the selling shop, and a "flight to purchase" quest entry instead of the bare map jump.
9. **Грузовоз (`hull_freighter`) renders as a blurry mess** — both `heavy_freighter_*.webp` variants are defective AI generations (one white-background kaleidoscope, one garbled fog). Temporarily alias the class to good art; proper regeneration is a separate art task.
10. **Starter (originally-installed) gear can't be sold or dropped** — unequipping via the HangarPanel routes gear into the legacy `modules[]` bag, which has no sell/jettison button; starter gear never had an `ownedGearIds` entry, so it's permanently stuck.
11. **The boarding grapple (GRAPPLE) is fully non-functional** — `grappleStrength` is derived but has **zero consumers**; enemies flee/disengage on speed alone with no grapple check. (Note: GRAV_TRACTOR and SCANNER are both properly wired — only GRAPPLE is dead.)
12. **Too few background stars** — increase starfield density in the procedural flight background.
13. **Infocenter lists uninhabited planets as sellers** — `buildRegistry` iterates every planet with no inhabited/station gate, advertising the full catalog at planets where no shop is reachable, and simultaneously **omits real station shops** (never enumerates `sys.stations`). The list is "unreal."
14. **Unplayable economic growth/progression** — a top-tier hull (T7/T8) has **no reachable matching engine** (the T7 engine is gated to `minDay 1050`; there is **no T3 or T4 engine at all** — a potency 0.9→1.4 dead-zone), the tech-cap chokepoint keeps most systems at tech ≤5, there's a **wealth-sink hole** (~14k → 68k) so 120k has nothing to buy in the mid-game, and gear has **zero uniqueness** (any id is infinitely re-buyable at many systems).
15. **Dev-only economy admin panel** — a local, dev-gated overlay (like the autopilot backquote hook) to live-tune economy knobs and poke state (credits/day/system-tech/shop refresh).

**Save compatibility:**
- Most changes add or alter **no** persisted domain field. Износ is *derived* from `hullHP/maxHull`. Starter-gear sale moves items between two **already-persisted** buckets (`ownedGearIds` ↔ legacy `modules[]`) — no new field. Grapple/stars/tooltips/icons/spawn are pure logic/render.
- **New gear ids** (engine T3/T4, shield T4/T5/T7 — Task 17) are catalog additions ⇒ **load revalidation, no migration** (existing saves keep their loadout; new ids only appear in shops). `ShipLoadout.revalidateToCurrentHull()` already runs on load.
- **Tech-floor / galaxy-tech changes** (Task 19) are **generation-only** ⇒ existing saves keep their persisted galaxy, new games get the new distribution. Uplift-cadence is config (computed from day) ⇒ applies live to all saves, safe.
- **Gear uniqueness / deplete-on-purchase** (Task 20) is the ONLY change that persists new state (which listings are sold-out per system/week). Implement it as an **optional additive field** (`.optional()` in `schemas.ts`, absent = nothing sold yet) so **no `CURRENT_VERSION` bump/migration** is needed (CLAUDE.md exception b). If a non-absent default were ever required, that flips to a migration + golden save — avoid.
- **Gate:** `npm run test:save-compat` must stay green throughout.

**Design assumption (Grapple, Task 15):** an installed grapple with sufficient `grappleStrength` **pins the targeted enemy** — it suppresses the NPC's `BREAK_OFF`/disengage and drives the shakedown flee-escape chance toward 0, scaled by `grappleStrength` vs the enemy's mass/tier. If a softer effect is wanted (e.g. only slow, not fully block), adjust in the balance constant added in that task.

## Context (from discovery)

### Area 1 — Takeoff spawn (`#1`)
- `src/presentation/SpaceFlightScene.ts:358-380` constructs the ship at `SYSTEM_BOUNDARY_RADIUS` (the edge) by default; `:494` calls `applyEntrySpawn(ctx)` to override.
- `src/presentation/flight/flightEntrySpawn.ts` — `applyEntrySpawn` precedence: `preserveShipPos` → `fromPlanetId` (takeoff arc) → `applyReentrySpawn(fromStationId)` → `spawnShipBeside`. **It silently no-ops if the station marker / planet sprite isn't found (`:44-64`), leaving the ship at the edge**, and a stale `lastFlightShipPos`/`preserveShipPos` can short-circuit the override.
- Takeoff ctx origin: `StationScene.ts:870-886` `undock()` (`fromStationId`), `PlanetScene.ts:1722-1741` `takeOff()` (`fromPlanetId`).
- Station world pos: `PlanetManager.ts:420-422,481-487` from `station.orbitAngle`/`orbitRadius`. Planet pos: `PlanetSprite.ts:468-475` (live).
- Existing tests: `src/tests/playtest/stationTakeoffSpawn.test.ts` (ship within 200px of marker, `< 0.9 * boundary`), `src/tests/presentation/planetSceneTakeOff.test.ts`. These pass today → the live failure is a lookup-timing / short-circuit path the current tests don't cover.

### Area 2 — Infocenter ↔ shop stock consistency (`#2`)
- Infocenter registry: `GameEngine.getInfoRegistry()` (`GameEngine.ts:590-597`) → `buildRegistry` (`InfoService.ts:29-53`) → `generateGalaxyGear` → `generateShop` (`ShopGenerator.ts:56-74`, `:29-53`).
- Real shop: `EquipmentShopScene.buildShopInventory()` (`EquipmentShopScene.ts:253-270`) → same `generateShop`, **but passes `maxTechLevel = techLevelWithUplift(system.techLevel, gameDays)`** (`:258-261`, `techUplift.ts:3-8`) and a tech-derived `priceFactor` (`:267`).
- `generateShop` drops gear above `maxTechLevel` (`ShopGenerator.ts:38`). The infocenter passes **no** `maxTechLevel` → lists high-tech items the shop filters out. Root cause = the two callers pass different options.

### Area 3 — Shop & hangar UI (`#3,4,5,6`)
- Shop rows: `EquipmentShopScene.renderRows()` (`:662-815`); columns at fixed `w`-fractions (name `w*0.01`, type `w*0.52`, tech `w*0.68`, price `w*0.78`, buy right-anchored) with **no width clamp** on name/stat → overlap. Hull tab `renderHullPanel` (`:433-580`) same pattern.
- Icon system already exists: `src/presentation/ui/gearIcon.ts` — `gearIconKey`/`mountGearIcon`, wired at `EquipmentShopScene.ts:701-707` and `HangarPanel.ts:831-837`. Only 6 fallback icons committed (`src/assets/icons/`: engine/fuel_tank/radar/shield/repair_droid/laser). HULL/SCANNER/GRAPPLE/GRAV_TRACTOR/MISSILE/FRAGMENT have **no** icon → text-only today.
- Stats already modeled: `GearCatalog.ts` `HullSpec`/`WeaponSpec`/`EquipmentSpec`; formatted by `gearStatLine`/`gearComparisonSuffix` (`EquipmentShopScene.ts:75-130`).
- No tooltip system in shop/hangar (only alpha-dim on hover). Reuse the `mountIconTooltip`/`starMapTooltip` pattern (`ui/` — position from numeric x/y + font-scaled glyph budget, **never** `.width`/`.height`, which throws in jsdom).
- Installed set already computed: `installedGearIds()` (`:646-648`) / `ShipLoadout.installedGearIds()`. Shop currently only tints installed rows, doesn't hide them. Offers come from `gearListings()` (`:272-274`).
- Hangar: shared `HangarPanel.ts` (used by `StationScene` + shop АНГАР tab); filled-slot rows `:800-864`.

### Area 4 — Hull trade-in износ (`#7`)
- `sellHull.ts:11-15` `hullTradeInPrice(hull) = floor(basePrice * HULL_TRADE_IN_RATE)`, `HULL_TRADE_IN_RATE = 0.4`, **condition-blind**. Single choke point, consumed by UI preview (`EquipmentShopScene.ts:481-485`) and the transaction (`sellHull.ts:32`).
- Buy flow already replaces + trades in: `buyHullWithTradeIn()` (`sellHull.ts:24-64`) → `loadout.swapHull()` (`ShipLoadout.ts:119-134`) + evict overflow to inventory. Condition source: `hullStatus.ts` (`hullHP`/`maxHull`).

### Area 5 — Orbit speed (`#8`)
- Sole constant: `PlanetSprite.ts:115-118` — `BASE_PERIOD_DAYS = 80`; `radPerDay = 2π / (BASE_PERIOD_DAYS * (r/600)^1.5)`. Consumed at `:120`, `:469`, `:482`. Axial spin (`SPIN_SLOWEST`, `:61`) is separate — leave it.
- Tests pin only *relative* order/direction (`planetSpriteVelocity.test.ts`), not the absolute period → a uniform 5× is safe. `presentation/flight/CLAUDE.md` warns to re-run letsplay campaign gates after orbit-motion changes (landing/lead reads depend on trajectories).

### Area 6 — Infocenter search + route + quest (`#8` cont.)
- Gear search: `InfoCenterScene.ts` `renderGear()` (`:1041-1364`), `runGearSearch()` (`:1442-1473`) → `registry.findEquipment({types, maxPrice})`. Facets + tech + price + sort only; **no free-text, no stat inputs**.
- Backend already supports characteristics: `GalacticRegistry.findGear(GearQuery)` (`:288-309`, query `:87-102`) with `minHp/minSlots/minCargo/minDamage/minRange` + sort by damage/hp/tech. UI just doesn't use it.
- "→ Карта" action: rows call `openStarMapForSystem(hit.systemId)` (`:1425`, `:1503-1509`) — star-map jump only, no route, no quest.
- Route seam to reuse: `questRouteAction`/`questDestination.ts:29-58` → `navigateToQuestTarget(host, locationId)` (`flight/routePlot.ts:56-68`) → `planRouteTo`/`openStarMapOn`. `EquipmentHit` already carries `systemId` + `planetId`.
- Quest add: `QuestManager.acceptQuestFromTemplate(template, planetId, day, factionId)` (`:100-114`); template needs `id/title/description/type/objectives/reward/targetSystemId/targetPlanetId` (`:12-29`). Exposed as `GameEngine.questManager`.

### Area 7 — Грузовоз art (`#9`)
- `PlayerShipRenderer.ts:46-47,122-136` picks `player_ships/<hullClass.toLowerCase()>`; `hull_freighter` → `HEAVY_FREIGHTER` → `heavy_freighter`. Assets `heavy_freighter_01/02.webp` exist (1024², largest files) but are **visually defective** (verified). `HULL_ART_ALIAS` (`:34-36`) already redirects `cruiser → destroyer`; add a freighter alias the same way. Hangar preview (`HangarPanel.ts:761-766`) resolves without the alias — patch both to stay consistent.

### Area 8 — Sell/drop starter gear (`#10`)
- Two inventory buckets (`src/domain/Inventory.ts`): `ownedGearIds[]` (`:20`, sellable) and legacy `modules[]` (`:16`, via `addItem` `:24`, NOT sellable).
- Sell path (`sellGear.ts:22` `sellUninstalledGear`) only touches `ownedGearIds`. HangarPanel renders `[Продать]`/`[Выбросить]` only for `kind:"owned"` rows (`HangarPanel.ts:1311`, `:1274`); `"legacy"` rows get only `[Установить]` (`:1338`).
- Root cause: HangarPanel `[снять]` (unequip) routes removed gear into the legacy bag (`HangarPanel.ts:859-860` `addItem`), not `ownedGearIds`. Starter gear is `install()`-ed directly (`GameEngine.ts:1021-1024`) and never had an `ownedGearIds` entry, so it can only ever reach the legacy bag → un-sellable.
- Correct helper already exists: `uninstallToOwned` (`GearBridge.ts:119-129`, does `addOwnedGear`), used by `InventoryScene.ts:650`. HangarPanel `[снять]` (`:860`), preset swap (`GearBridge.ts:306`), and load-revalidation (`GameEngine.ts:916`) all wrongly use `addItem`→legacy.
- No `locked`/`default` flag distinguishes starter vs bought gear — difference is only provenance/removal path.

### Area 9 — Boarding grapple is dead (`#11`)
- `grappleStrength` is derived (`ShipLoadout.ts:363,424-426,475`) but has **zero production consumers** (grep: only `ShipLoadout.ts` + `derivedStats.test.ts`).
- Player break-away runs on speed only: `NpcBrain.attemptFlee`/`fleeEscapeChance` (`:149-165,184`) = `playerSpeed/pirateSpeed`; sole caller `NpcInteractionController.ts:175` (`onFleeShakedown`) passes no grapple.
- NPC-initiated disengage: `combatManeuver.ts`/`NpcShipSprite.ts` `decideManeuver`/`BREAK_OFF` (edge-bounded) — no grapple check either.
- Contrast: GRAV_TRACTOR (`ShipLoadout.ts:418` → `LootDropHandler.ts:104`, loot radius) and SCANNER (`:404-409` → `NpcInteractionController.ts:68,127`, reveal NPC) are properly wired. Only GRAPPLE is inert.

### Area 10 — Starfield density (`#12`)
- `src/presentation/SpaceBackgroundLayer.ts` (procedural background `FlightModule`). Three parallax `Graphics`-dot layers in `layerConfigs`: `count 3400/1200/320` at `:205/:213/:221`. Twinkle/hero `Sprite` stars `count = 110` at `:293`. No test pins star count (`moduleContracts.test.ts` checks lifecycle only). Positions use `Math.random()` (not seeded).

### Area 11 — Infocenter lists non-shop locations (`#13`)
- `InfoService.ts:36-45` `buildRegistry` pushes **every** planet of every system into the shop-gen list with no `isHabitable`/station gate; `generateGalaxyGear`→`generateShop` then emits a full catalog for uninhabited planets.
- Real shop gate: `PlanetScene.ts:69-75` `visiblePlanetServices(isHabitable,…)` strips «Снаряжение» when `!isHabitable` (`:1071-1076` opens the shop); stations gate on `hasService("shop")` (`StationScene.ts:207`, `:268-269`).
- `buildRegistry` also never enumerates `sys.stations`, so real station shops are absent from `findGear`/`findEquipment`.
- Fix locus: gate the planet push at `InfoService.ts:38-44` with `if (!planet.isHabitable) continue;` (mirror `PlanetScene.ts:73-74`) and add station-shop enumeration from `sys.stations`.

### Area 12 — Economy / gear progression (`#14`)
- **Engine ladder gaps** (`GearCatalog.ts:490-545,779-790`): T2 (`eq_engine_light/i`, potency 0.8/0.9) → **no T3, no T4** → T5 `eq_engine_iii` (1.4) → T6 `eq_engine_iv` (1.6) → **T7 `eq_engine_v` (1.8) gated `minDay=APEX_ENGINE_MIN_DAY=1050`** (`balance.ts:103`) → T8 `eq_engine_vi` (2.2, minDay 840, 95k). Shields skip T4/T5/T7.
- **Top hull unserved**: hulls are a smooth T2→T8 ladder (`GearCatalog.ts:91-251`), but the best engine realistically buyable is T6 (1.6) — the T7 match is dead until day 1050.
- **Tech chokepoint**: system base tech generated `[1:2,2:3,3:3,4:2,5:1]` (`systemTechDistribution.ts:4-10`), galaxy peak floored to 5 (`GALAXY_MAX_TECH_FLOOR`), nothing above 5 generated. Uplift `+1/270d` cap 8 (`techUplift.ts:3-8`, `balance.ts:73-74`); research-lab +1 (`StationScene.ts:295-298`). ⇒ before day 270 a "T5 engine" is buyable almost nowhere.
- **Stocking**: `ShopGenerator.ts:24-52` seeded coin-flip; effective appearance ~T6 22% / T7 17% / T8 12% per qualifying planet/week; `isRareGear` = rare OR tech ≥ `RARE_TECH_THRESHOLD(6)`.
- **Wealth-sink hole**: pre-day-540 price ceiling ≈ 13.8k; the 68k–240k late band is double-gated (minDay 540-960 **and** tech-7/8). Nothing absorbs 120k mid-game.
- **No uniqueness**: stock is a pure seed fn of `(planetId, week, gearId)` (`ShopGenerator.ts:45`); `buyItem` (`EquipmentShopScene.ts:1080-1110`) never depletes. Any id is infinitely re-buyable, present at many systems at once.
- Key files: `GearCatalog.ts`, `ShopGenerator.ts`, `techUplift.ts`, `systemTechDistribution.ts`, `InfoService.ts`, `balance.ts`.

### Area 13 — Dev economy admin panel (`#15`)
- Model on the autopilot live hook: dev-gated toggle (backquote), overlay in `SpaceFlightScene`/`GameEngine`; see `.claude/docs/systems/letsplay.md` (`installAutopilotHook`/`createLiveSceneController`). Must be `import.meta.env.DEV`/`__DEBUG__`-gated and tree-shaken from production.
- Economy knobs live in `src/config/balance.ts` as module `const`s (uplift days, stock factors, `HULL_TRADE_IN_RATE`, `RARE_TECH_THRESHOLD`, minDay gates). Live tuning needs a small dev-only override seam the economy reads.
- State pokes: credits via `adjustPlayerCredits` (banking `economy.ts`), day advance via the engine tick, system tech via galaxy, shop re-roll via the weekly bucket.

## Development Approach

- **Testing approach: regression-first (project mandate, CLAUDE.md).** For each fix: write the failing red test FIRST (correct tier below), then fix to green. Do not claim a fix without the test.
- **Test tier per bug class:** pure logic → mocked unit test; component wiring (spawn, stock consistency, trade-in, quest add) → real-engine playtest (`src/tests/playtest/**`); visual/interaction (overlap, tooltip, icons) → verify via screenshot in addition to a text-level test — green text tests are NOT sufficient for visual bugs.
- **Do NOT modify/weaken existing test assertions** (standing rule). New tests only. If a change reds an existing test, STOP and re-diagnose — that's a root-cause signal.
- **Blast radius before each edit:** run `impact({target, direction:"upstream"})` on the symbol; warn on HIGH/CRITICAL. One concern per commit — no refactors bundled into fixes.
- Complete each task fully (green + lint) before the next.
- **No comments in code** (global rule).

## Testing Strategy
- **Unit / playtest tests**: required every task, tier per the table above.
- **E2E (Playwright)**: for the visual overlap/icon/tooltip tasks, add or extend an assertion in `e2e/playtest-regression.spec.ts` and capture a screenshot.
- **Campaign gate**: after the orbit-speed change, run the letsplay campaign gate (`npm run letsplay:ci`) — orbit trajectories feed landing/lead reads.
- Treat E2E with the same rigor as unit tests (must pass before next task).

## Progress Tracking
- Mark completed items `[x]` immediately.
- New tasks: `➕` prefix. Blockers: `⚠️` prefix.
- Keep this file in sync with actual work.

## What Goes Where
- **Implementation Steps** (`[ ]`): code, tests, docs achievable in this repo.
- **Post-Completion** (no checkboxes): manual screenshot review, and the ComfyUI art regeneration for Грузовоз (external, user-driven pipeline).

## Implementation Steps

### Task 1: Slow planet orbits 5×
- [x] run `impact` on `PlanetSprite` orbit constants; confirm `BASE_PERIOD_DAYS`/`radPerDay` have no other definition
- [x] in `src/presentation/PlanetSprite.ts:115` change `BASE_PERIOD_DAYS` `80 → 400` (5× longer period → 5× slower); do NOT touch `SPIN_SLOWEST` axial spin
- [x] write a unit test asserting `radPerDay` (or `orbitalVelocityPerDay()`) for a fixed radius is 1/5 of the pre-change value, and that the outer-slower-than-inner relation still holds
- [x] verify `src/tests/presentation/planetSpriteVelocity.test.ts` still green (relative-only assertions)
- [x] run `npm run letsplay:ci` — landing/lead reads must still pass
- [x] run tests — must pass before next task

### Task 2: Fix Грузовоз (heavy_freighter) blurry art via class alias
- [x] run `impact` on `HULL_ART_ALIAS` / `PlayerShipRenderer`
- [x] add `heavy_freighter → transport` (closest cargo silhouette; confirm `transport_*` reads well) to `HULL_ART_ALIAS` in `src/presentation/flight/PlayerShipRenderer.ts:34-36`
- [x] apply the SAME alias in the hangar preview resolver `src/presentation/ui/HangarPanel.ts:761-766` so flight and hangar match (fold the alias into a shared helper if trivial, else duplicate the one-line map) — factored into `src/presentation/flight/hullArtAlias.ts`, shared by both
- [x] write a unit test: resolving art for `hull_freighter` (class HEAVY_FREIGHTER) returns the aliased good texture key in BOTH the flight renderer and the hangar resolver, not `heavy_freighter`/`ranger`
- [x] screenshot-verify the ship in flight is no longer a white/foggy blob — verified at the asset level: `heavy_freighter_01.webp` is the defective kaleidoscope pattern, `transport_01.webp` is a clean top-down cargo silhouette
- [x] run tests — must pass before next task

### Task 3: Fix takeoff spawning at the system edge
- [ ] run `impact` on `applyEntrySpawn`/`applyReentrySpawn`/`spawnShipBeside`
- [ ] write a RED real-engine playtest that reproduces the live failure: undock with a `fromStationId`/`fromPlanetId` whose marker/sprite lookup resolves late or a stale `lastFlightShipPos` is present, and assert the ship ends up beside the body (`< 0.9 * SYSTEM_BOUNDARY_RADIUS` from center), not at the edge
- [ ] fix `src/presentation/flight/flightEntrySpawn.ts`: (a) ensure `fromStationId`/`fromPlanetId` overrides take precedence over a stale `lastFlightShipPos`/`preserveShipPos` on a fresh undock, and (b) when the marker/sprite isn't found, fall back to the station/planet's domain orbit position (`station.orbitAngle`/`orbitRadius`; planet `setOrbitForDay`) instead of silently leaving the ship at the edge
- [ ] ensure the undock ctx actually carries the id (verify `StationScene.undock()` `:870-886` and `PlanetScene.takeOff()` `:1722-1741`)
- [ ] confirm existing `stationTakeoffSpawn.test.ts` / `planetSceneTakeOff.test.ts` stay green (do not weaken them)
- [ ] write tests for the fallback path (marker missing → domain-position spawn) — success + edge case
- [ ] screenshot-verify undock places the ship next to the station/planet
- [ ] run tests — must pass before next task

### Task 4: Make infocenter stock consistent with the real shop
- [ ] run `impact` on `generateGalaxyGear`/`buildRegistry`/`generateShop`
- [ ] write a RED test: for a low-tech system, an item the real `buildShopInventory()` filters out (tech > `techLevelWithUplift(system.techLevel, day)`) must NOT appear in the infocenter registry for that system
- [ ] thread the same per-system `maxTechLevel = techLevelWithUplift(system.techLevel, day)` and price factor into `generateGalaxyGear`/`buildRegistry` (`InfoService.ts:29-53`) that `EquipmentShopScene.buildShopInventory()` uses (`EquipmentShopScene.ts:258-267`), so both callers of `generateShop` agree on membership
- [ ] verify infocenter listing == shop stock for the same system/day/seed (add an assertion comparing the two id sets)
- [ ] write tests: parity for a high-tech and a low-tech system (success + boundary at the cap)
- [ ] run tests — must pass before next task

### Task 5: Hide already-installed gear in the shop
- [ ] run `impact` on `renderRows`/`gearListings`/`installedGearIds`
- [ ] in `EquipmentShopScene`, filter the gear listing (`gearListings()`/the `renderRows` loop, `:662-815`) to exclude ids in `this.installedGearIds()` before rendering (hide by exact installed id; keep same-class-installed rows visible as upgrades — those use `installedSameClass`, a different concept)
- [ ] confirm the hull tab is unaffected (hull replacement is handled in Task 6, hulls aren't "installed gear ids")
- [ ] write a unit/playtest test: install a gear id, open shop, assert that id is absent from rendered rows while a same-class higher-tier item still appears
- [ ] write an edge test: nothing installed → full list unchanged
- [ ] run tests — must pass before next task

### Task 6: Hull trade-in accounts for wear (износ) from current HP
- [ ] run `impact` on `hullTradeInPrice`
- [ ] change `hullTradeInPrice` in `src/systems/equipment/sellHull.ts:13-15` to scale by current condition: `floor(basePrice * HULL_TRADE_IN_RATE * conditionFactor)` where `conditionFactor = clamp(hullHP / maxHull, floor, 1)` via `hullStatus.ts`; pass current `hullHP`/`maxHull` (from ship/loadout) into the function — no persisted field, derived only
- [ ] update both consumers to pass condition: UI preview (`EquipmentShopScene.ts:481-485`) and the transaction (`sellHull.ts:32` in `buyHullWithTradeIn`)
- [ ] confirm buying a hull still always replaces + evicts overflow (behavior already present in `buyHullWithTradeIn`/`swapHull`) — add an assertion, don't refactor
- [ ] write tests: full-HP hull → 40% trade-in unchanged; half-HP hull → ~20%; near-dead hull → floored value; and buy replaces the old hull
- [ ] run tests — must pass before next task

### Task 7: Category-glyph fallback icons for every gear family
- [ ] run `impact` on `gearIcon.ts` (`gearIconKey`/`mountGearIcon`/`FAMILY_FALLBACK_ICON`)
- [ ] add a deterministic per-category glyph fallback (colored shape/letter drawn with `Graphics`/`Text`, keyed by `slotCategoryFor()`/`GearKind`/`WeaponClass`/`EquipmentClass`) for the families with no committed art: HULL, SCANNER, GRAPPLE, GRAV_TRACTOR, and MISSILE/FRAGMENT weapons — so `mountGearIcon` ALWAYS returns a visible glyph and a non-zero x-offset (no more text-only fallback)
- [ ] keep existing real fallback icons (engine/fuel_tank/radar/shield/repair_droid/laser) as-is; glyphs only fill the gaps
- [ ] reuse `KIND_COLOR` from `GearBridge` for glyph tint so categories are visually distinguishable
- [ ] write a unit test: `mountGearIcon` yields a visible node + positive offset for one gear of EACH family (no family returns 0/undefined)
- [ ] run tests — must pass before next task

### Task 8: Icon-forward shop rows (kill the label overlap)
- [ ] run `impact` on `EquipmentShopScene.renderRows`/`renderColumnHeaders`/`renderHullPanel`
- [ ] rework `renderRows` (`:662-815`): left = icon (from Task 7) as the primary identifier; keep a single short name with a hard `wordWrapWidth`/truncation clamped to the column budget (name must not cross the type column at `w*0.52`); keep price + Buy button; drop the inline stat line (moves to the tooltip in Task 10)
- [ ] apply the same width-clamp / column discipline to the hull tab `renderHullPanel` (`:433-580`) so `specText`/`priceText`/`tradeInText`/button don't collide
- [ ] update `renderColumnHeaders` (`:626-644`) to match the new columns
- [ ] write a test asserting the name node's right edge does not exceed the type-column X (measure via numeric x + font-scaled glyph budget, NOT `.width`)
- [ ] screenshot-verify: no overlapping text in the gear tab or hull tab
- [ ] run tests — must pass before next task

### Task 9: Icon-forward hangar rows
- [ ] run `impact` on `HangarPanel` filled-slot/loadout/hold renderers
- [ ] apply the same icon-forward + name-clamp treatment to `renderFilledSlot` (`HangarPanel.ts:800-864`) and the loadout/hold strips so the `[снять]`/chip buttons never sit under the name
- [ ] write a test asserting hangar slot name width is clamped and the `[снять]` button hit area doesn't overlap the name
- [ ] screenshot-verify the hangar (mounted by both `StationScene` and the shop АНГАР tab)
- [ ] run tests — must pass before next task

### Task 10: Hover tooltips with characteristics (shop + hangar)
- [ ] run `impact` on `gearStatLine`/`gearComparisonSuffix` and the shop/hangar hover handlers
- [ ] add a reusable gear tooltip node (model on `mountIconTooltip`/`starMapTooltip`): `eventMode="none"`, hidden until `pointerover`, positioned from numeric x/y + font-scaled glyph budget (never `.width`/`.height`)
- [ ] populate it from the full stat set (`HullSpec`/`WeaponSpec`/`EquipmentSpec` via `gearStatLine` + the richer fields: HP/slots/cargo/mass for hull, damage/range/ability/cooldown for weapon, class/potency for equipment) plus the `gearComparisonSuffix` delta vs installed same-class
- [ ] wire `pointerover`/`pointerout` on shop rows (`EquipmentShopScene.ts:795-800`) and hangar rows (`HangarPanel.ts:902`, `:1353`) to show/hide it (keep the existing alpha-dim)
- [ ] write a test: hovering a row shows a tooltip node containing that gear's key stats; leaving hides it
- [ ] screenshot-verify tooltip content and placement
- [ ] run tests — must pass before next task

### Task 11: Infocenter gear search by characteristics
- [ ] run `impact` on `InfoCenterScene.runGearSearch`/`renderGear` and `GalacticRegistry.findEquipment`/`findGear`
- [ ] switch the infocenter gear search to `registry.findGear(GearQuery)` (or extend `EquipmentQuery` with stat thresholds) so it can filter by `minHp/minSlots/minCargo/minDamage/minRange` (`GalacticRegistry.ts:87-102,288-309`)
- [ ] add stat-threshold controls to the gear search UI (`InfoCenterScene.ts:1041-1364`) alongside the existing facet/tech/price pills — one input per relevant stat, shown per active facet (e.g. damage/range for weapons, HP/slots/cargo for hulls)
- [ ] keep existing facet/tech/price/sort controls working; add sort-by-stat (damage/hp) where `findGear` supports it
- [ ] write tests: a stat threshold filters out gear below it; combining facet + stat + price narrows correctly; empty thresholds == current behavior
- [ ] screenshot-verify the new search controls render without overlap
- [ ] run tests — must pass before next task

### Task 12: Route-to-shop + "flight to purchase" quest (replace "→ Карта")
- [ ] run `impact` on `openStarMapForSystem`, `navigateToQuestTarget`, `QuestManager.acceptQuestFromTemplate`
- [ ] replace the gear-row "→ Карта" action (`InfoCenterScene.ts:1416-1437`, handler `:1425`) with: create a "flight to purchase" quest via `questManager.acceptQuestFromTemplate(...)` with `targetSystemId = hit.systemId`, `targetPlanetId = hit.planetId`, a购-purchase title/description, then plot the route through the same seam the journal uses (`questRouteAction`/`navigateToQuestTarget`, `flight/routePlot.ts:56-68`) instead of the star-map-only jump
- [ ] ensure the quest carries a real `targetPlanetId` (planet-issued shop) so the journal's "Проложить маршрут" button can name/route to it (`presentation/CLAUDE.md` journal gap)
- [ ] keep a plain map-jump only as a secondary affordance if needed; primary action = add quest + route
- [ ] write a real-engine playtest: triggering the action on a gear hit adds an active quest with the correct `targetSystemId`/`targetPlanetId` and initiates a route/warp toward it
- [ ] write an edge test: same-system hit → in-system approach route; cross-system hit → warp-to-system
- [ ] run tests — must pass before next task

### Task 13: Sell/drop any installed gear (incl. starter gear)
- [ ] run `impact` on the HangarPanel `[снять]` handler, `uninstallToOwned`, `addOwnedGear`, `sellUninstalledGear`
- [ ] route the HangarPanel unequip (`HangarPanel.ts:859-860`) through `uninstallToOwned` (`GearBridge.ts:119-129`) so removed gear lands in `ownedGearIds` (sellable), not the legacy bag; do the same for the preset-swap path (`GearBridge.ts:306`) and load-revalidation (`GameEngine.ts:916`)
- [ ] make pre-existing legacy-bag (`kind:"legacy"`) rows sellable/jettisonable too (so items already stuck in old saves free up) — either migrate legacy→owned on display or extend the sell/jettison guards (`HangarPanel.ts:1311`, `:1274`) to legacy rows
- [ ] write a RED playtest: unequip a starter item, assert it appears as a sellable owned row and `sellUninstalledGear` returns >0; sell it and assert credits increase + item gone
- [ ] write an edge test: a save with a pre-existing legacy-bag item can now sell/jettison it
- [ ] run `npm run test:save-compat` — confirm no schema break (bucket move only)
- [ ] run tests — must pass before next task

### Task 14: Wire the boarding grapple into enemy disengage/flee
- [ ] run `impact` on `attemptFlee`/`fleeEscapeChance`/`onFleeShakedown` and the NPC `BREAK_OFF`/`decideManeuver` path
- [ ] add a `GRAPPLE_*` balance constant block in `src/config/balance.ts` (strength→hold mapping; do NOT hardcode at call sites)
- [ ] thread the player's `grappleStrength` (`DerivedStats`) into the shakedown flee path (`NpcInteractionController.ts:175` → `NpcBrain.attemptFlee`) to drive enemy escape chance toward 0 when `grappleStrength` ≥ the enemy's mass/tier threshold, scaled below it (per the Overview design assumption)
- [ ] suppress NPC-initiated `BREAK_OFF`/disengage in `combatManeuver.ts`/`NpcShipSprite.ts` for the grappled target while grapple holds
- [ ] surface a hint that the enemy is grappled (reuse existing combat/contact UI; no new art)
- [ ] write tests: with sufficient grapple, an enemy that would flee cannot escape; below threshold it's only slowed; no grapple → unchanged behavior (existing flee tests stay green)
- [ ] run tests — must pass before next task

### Task 15: Denser background starfield
- [ ] run `impact` on `SpaceBackgroundLayer`
- [ ] raise `count` in the three `layerConfigs` entries (`SpaceBackgroundLayer.ts:205/:213/:221`) and the twinkle `count` (`:293`) to increase density (tune values for feel; keep it a cheap Graphics-dot draw — no per-frame filters, per the no-blur rule)
- [ ] verify frame cost is acceptable (dots, not sprites/filters) and `moduleContracts.test.ts` still green
- [ ] write a light test asserting the configured star total increased vs the prior constant (or that layers instantiate the new counts)
- [ ] screenshot-verify a denser starfield in flight
- [ ] run tests — must pass before next task

### Task 16: Gate infocenter listings to real shop locations
- [ ] run `impact` on `buildRegistry`/`generateGalaxyGear`
- [ ] write a RED test: an uninhabited (`isHabitable === false`) planet must produce NO gear listings in the registry; a station shop location must be present
- [ ] in `InfoService.ts:38-44`, skip non-shop planets (`if (!planet.isHabitable) continue;`, mirroring `PlanetScene.ts:73-74`) and enumerate `sys.stations` shop locations so `findGear`/`findEquipment` cover real stations
- [ ] (depends on Task 4) ensure these gated locations also use the shop's `maxTechLevel`/price factor so listing == real stock
- [ ] write tests: inhabited planet lists gear; uninhabited planet lists none; station shop appears; registry id-set ⊆ what the real shop at that location sells
- [ ] run tests — must pass before next task

### Task 17: Fill the engine (and shield) tier-ladder gaps
- [ ] run `impact` on `GEAR_CATALOG`/`GearCatalog` consumers; confirm catalog-add is load-revalidation only (no migration)
- [ ] add `eq_engine_ii` (T3, ~2.2k, potency ~1.1) and a T4 engine (~4k, potency ~1.25) to `GearCatalog.ts` to remove the 0.9→1.4 dead-zone; add shield T4/T5/T7 fillers to smooth that ladder
- [ ] keep ids unique and names/stats consistent with the existing naming; update `manifestKeys.snapshot.json` only if new asset keys are introduced (prefer reusing existing engine/shield icons)
- [ ] write tests: the engine potency ladder is now monotonic with no tech gap T2→T6; new gear validates against the catalog/schema
- [ ] run `npm run test:save-compat` (catalog add → revalidate, no migration)
- [ ] run tests — must pass before next task

### Task 18: Give the top-tier hull a reachable matching engine
- [ ] run `impact` on `APEX_ENGINE_MIN_DAY`/`eq_engine_v` gating
- [ ] lower the T7 engine's reachability so a top hull has a matching engine within the campaign: drop `APEX_ENGINE_MIN_DAY` (`balance.ts:103`) from 1050 to ~540 (align with the dreadnought) and/or reduce its tech to 6 — tune in `balance.ts`/catalog, not at call sites
- [ ] verify via a production-parameter check (per the "verify content reachable" rule): at a realistically-reachable system/day, the T7 engine actually becomes stockable
- [ ] write a test asserting the top hull's tier has a buyable engine by ~day 540 at an uplifted system
- [ ] run tests — must pass before next task

### Task 19: Loosen the tech-cap chokepoint
- [ ] run `impact` on `GALAXY_MAX_TECH_FLOOR`/`systemTechDistribution`/`TECH_UPLIFT_DAYS`
- [ ] make tech-6+ gear reachable without waiting the whole campaign: either add a few high-tech systems / raise the galaxy tech ceiling (generation-only, new games) and/or shorten `TECH_UPLIFT_DAYS` (270 → ~180, config, applies live) — tune in `balance.ts`/`systemTechDistribution.ts`
- [ ] compute the resulting effective buyable engine tier by day 300/500 and confirm it now matches the hull ladder
- [ ] confirm existing pacing/overmind adaptive tests still green — if one reds, STOP and re-diagnose (do not weaken)
- [ ] write a test pinning the new effective tech cap over time (day→cap curve)
- [ ] run `npm run letsplay:ci` — progression/pacing gate
- [ ] run tests — must pass before next task

### Task 20: Mid-game wealth sink + gear uniqueness
- [ ] run `impact` on `buyItem`/`generateShop`/`SaveStateSchema`
- [ ] add a few day-270-gated mid-value items (~20k–50k) to bridge the 14k→68k hole (catalog add, revalidation-only)
- [ ] add gear uniqueness: deplete a premium listing on purchase (mark it sold for the current weekly bucket at that system) so a big bankroll buys genuinely scarce items, not infinite duplicates
- [ ] persist sold-out state as an **optional additive field** (`.optional()` in `src/validation/schemas.ts`, absent = nothing sold) — NO `CURRENT_VERSION` bump/migration (CLAUDE.md exception b); wire it into `buyItem` (`EquipmentShopScene.ts:1080-1110`) and `generateShop` membership
- [ ] write tests: buying a unique item removes it from that system's stock for the week; a non-unique/common item still restocks; an old save without the field loads and behaves as "nothing sold"
- [ ] run `npm run test:save-compat` — additive-optional must not brick saves
- [ ] run tests — must pass before next task

### Task 21: Dev-only economy admin panel
- [ ] run `impact` on the autopilot hook seam and `balance.ts` consumers
- [ ] add a dev-gated (`import.meta.env.DEV`/`__DEBUG__`) overlay toggled by a key (model on `installAutopilotHook`/`createLiveSceneController`), tree-shaken from production builds
- [ ] add a minimal dev-only override seam for the highest-value `balance.ts` knobs (uplift days, stock factors, `HULL_TRADE_IN_RATE`, minDay gates) that the economy reads when an override is set — no effect in production
- [ ] add live state pokes: set/add credits (`adjustPlayerCredits`), advance day, set a system's tech level, force a shop re-roll
- [ ] write tests: the override seam changes the economy output in dev and is a no-op / absent in production; state pokes apply
- [ ] add an architecture test (or reuse the ONNX-exclusion pattern) asserting the admin panel is not referenced from production entry paths
- [ ] run tests — must pass before next task

### Task 22: Verify acceptance criteria
- [ ] verify each of the 15 reported issues is fixed against the Overview
- [ ] run the full unit + playtest suite (`npm test -- --run`, `npm run test:playtest`)
- [ ] run `npm run test:e2e:regression` (visual/interaction gate)
- [ ] run `npm run letsplay:ci` (post-orbit + post-progression gate)
- [ ] run `npm run lint` — fix all issues
- [ ] run `npm run test:save-compat` to confirm no save regression (additive-optional only, no migration)
- [ ] run `detect_changes({scope:"compare", base_ref:"master"})` — confirm only expected symbols/flows affected

### Task 23: Update documentation
- [ ] update `.claude/docs/systems/equipment.md` (icon-forward layout, tooltip pattern, hide-installed rule, износ-based trade-in, sell-any-gear via `uninstallToOwned`, engine/shield ladder, uniqueness)
- [ ] note the infocenter↔shop stock-consistency + inhabited/station-gate contract wherever the info system is documented
- [ ] document the grapple mechanic + its `GRAPPLE_*` balance knobs, the tech-cap/uplift progression changes, and the dev economy admin panel (with its production-exclusion guarantee)
- [ ] record the `heavy_freighter → transport` alias as interim, pending art regeneration

## Technical Details

- **Orbit:** `radPerDay = 2π / (BASE_PERIOD_DAYS * (r/600)^1.5)`; `BASE_PERIOD_DAYS 80 → 400`. Uniform 5× on both day-driven orbit and visual boost (both read `radPerDay`).
- **Износ:** `trade-in = floor(basePrice * 0.4 * clamp(hullHP/maxHull, floor, 1))`, derived — no persisted field, no migration.
- **Stock parity:** single lever = pass `maxTechLevel`/`priceFactor` to `generateShop` identically from both `buildShopInventory` and `generateGalaxyGear`.
- **Icons:** `mountGearIcon` must always return a visible glyph + positive x-offset; missing families get colored category glyphs (no ComfyUI dependency).
- **Tooltips:** numeric positioning only — PixiJS text `.width`/`.height` throws under jsdom.
- **Quest:** `QuestTemplate` needs `targetSystemId`/`targetPlanetId`; route via `questRouteAction`/`navigateToQuestTarget`.

## Post-Completion
*Manual / external — no checkboxes.*

**Manual verification:**
- Screenshot-review each UI surface in real dev (`npm run dev`): shop gear + hull tabs, hangar (station & shop АНГАР tab), infocenter gear search, undock placement, planet orbit speed feel, Грузовоз in flight, starfield density.
- Play-verify progression feel: with a top hull, a matching engine is findable at a reachable system within the campaign; 120k has worthwhile mid-game sinks; infocenter listings match what the shop actually stocks (no uninhabited-planet phantoms, no unbuyable T5).
- Use the dev economy admin panel (Task 21) to sweep the new balance knobs live and confirm the progression curve feels playable before locking the constants.

**External / art pipeline (user-driven):**
- Regenerate proper `heavy_freighter_01/02.webp` art (transparent background, coherent top-down freighter silhouette) via the ComfyUI candidate pipeline, then drop the `heavy_freighter → transport` alias. Both current variants are defective AI generations.
- Optional future: real per-category/per-tier gear icon art to replace the interim category glyphs from Task 7.
