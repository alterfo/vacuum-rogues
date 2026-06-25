# Presentation Layer Rules

PixiJS scenes, sprites, rendering, input. No hardcoded pixel coords for hit detection — use
`eventMode='static'` + handlers, position UI in world/relative coords. Always
`event.stopPropagation()` in UI click handlers over gameLayer/stage.

**Dark-panel text goes through `scaledText(text, basePx, color, opts?)`** (`ui/scaledText.ts`),
not `new Text({ style: { fontSize: … } })` directly. It sizes via `scaledFont()` so panel text
tracks the S/M/L setting, and lifts dim fills to a legible luminance floor (`READABLE_FLOOR`).
Pass `rawColor: true` only for already-bright/semantic colors (accents, intentionally-dimmed
disabled states, light backgrounds) where the floor would distort hue. Migrated: JobBoardPanel,
StationScene, TradeScene, EquipmentShopScene, InfoCenterScene, QuestJournalUI, TextQuestScene.
Still hardcoding `fontSize:` (route through `scaledText` when you touch them): StarMapScene,
InventoryScene, ResearchUpgradePanel, GovernmentScene, RaceSelectionScene,
PlanetInfoPanel, NpcContactPanel, DialogueScene, WinScene, MainMenuScene, SystemMiniMap, CombatHud.
(Flight modules that already read `scaledFont` — FlightHud, PlanetManager, DamageNumbers, UiButton,
PlanetScene — don't need it; for the in-flight restyle-in-place rule see `flight/playtest-traps.md`.)

**Station markers render sprite-or-diamond** (`flight/PlanetManager.createStations`).
Each off-planet base resolves a per-type sprite via `stationSpriteKey(type, id)`
(`flight/stationArt.ts`): `STATION_TEXTURE_PREFIX` maps every `StationType` to an
`src/assets/station/<prefix>_NN` art prefix (`TRADE_POST→trade`, `REPAIR_DOCK→drydock`,
`MILITARY_BASE→military`, `RESEARCH_LAB→science`, `CRAFT_CENTER→fabricator`), mirroring
`PLANET_TEXTURE_PREFIX`. A **cached** texture mounts as an 80×80 (`STATION_SPRITE_SIZE`)
`eventMode="none"` `Sprite`; otherwise the marker falls back to the existing colour-coded diamond. Station
art is **non-lazy/eager** (small transparent WebP, kept out of `LAZY_PREFIXES`) and
resolved **synchronously** via `pickVariantKey` + `tex` (cache lookup) — no async/lazy
load, and no save/schema impact (art is type+id-derived, like planet discs). The name label
sits **below** the sprite, not over it: `STATION_LABEL_Y = STATION_SPRITE_SIZE / 2 + 4` (= 44
for the 80 px sprite) derives the label `y` from the sprite size, so a resize keeps the name
clear of the disc (`20260625-station-label-and-military-quests-fix`; pre-bump the sprite was
40 px and a fixed `y=18` happened to clear it). The label, transparent circular
hit-area + `onStationClick`, `zIndex` and `stationMarkers` bookkeeping are identical on
both paths. The matching ComfyUI prompt category is `station` in
`tools/comfyui/asset_prompts.json` (mirrors `ships`); the art lands in a separate commit
and lights up the sprite path automatically via the Vite glob manifest.

**Military bases offer quests; other station types show the wrong-place message**
(`StationScene` `"quests"` case, `20260625-station-label-and-military-quests-fix`). The action
branches on `this.station.type`: at `MILITARY_BASE` it opens the shared `JobBoardPanel` —
the **same** board planets use, keyed by `station.id` so each base keeps its own deduped
listing (`getQuestBoard`/`acceptBoardQuest`, threading the active/completed/pending-return
exclusions; `TEXT_ADVENTURE` quests route to the text-quest scene). At any **other** station
type it shows the «Задания выдаются только на военных базах» toast. Do **not** restore the old
unconditional toast — it contradicted itself at an actual military base. The panel is torn down
in `destroy()` via `closeJobBoard()`. A station-issued quest carries `planetId = station.id`, so
return-requiring types (BOUNTY/ESCORT/EXPLORATION/DEFENSE/DIPLOMACY) can only be claimed back at
the station: `StationScene.checkReturnQuestCompletion()` (called on dock from `initialize()`)
mirrors `PlanetScene`'s and `claimReturnReward`s any pending-return quest whose `planetId`
matches `station.id` — **keep it**, else those quests stay stuck in pending-return forever
(`PlanetScene` only claims *planet*-issued ones). (Known gap: `QuestJournalUI.returnDestination` /
`resolveQuestLocationName` still resolve only *planets*, so a station-issued return quest's journal
card can't yet name/route to its station issuer.)

**The slot-fitting hangar is one shared component** (`ui/HangarPanel.ts`,
`docs/plans/20260623-combat-multiweapon-starter-loadout-shared-hangar.md`). It renders the
four category banks + install/unfit + the ТРЮМ owned-gear strip via `scaledText` and mutates
the canonical `ShipLoadout` through the shared gear helpers — **never** fork fit logic into a
scene. **Both** `StationScene` and the `EquipmentShopScene` **АНГАР tab** mount the same
`HangarPanel` (constructed with the scene's renderer), so fitting looks/behaves identically at
either entry point; the per-slot micromodule-apply modal is the shared
`ui/MicromoduleApplyPanel.ts`, opened from a fitted slot in both scenes. A fresh game arrives
fully fitted (weapon/grapple/engine, empty hold — see `GameEngine.starterLoadout()`), so the
hangar's job is swapping/upgrading, not first-time assembly.

**Warehouse-row action buttons need vertical clearance** (`HangarPanel.renderWarehouseAndCargo`,
`20260625-arc-movement-and-combat-fixes` Task 3). The stacked «Установить» (install) and
«Продать» (sell) actions in a СКЛАД row once sat 13 px apart — inside the ~14 px text height —
so their hit boxes overlapped and got mis-tapped. Each row is 40 px tall with «Установить» at
`y+12` and «Продать» at `y+32` (a 20 px centre gap, clear of the text height); the row step is
48 px and the clip guard `y+42`. Keep the centre gap **greater than the button text height** when
re-laying these out. Guarded by `src/tests/presentation/HangarPanel.test.ts` (asserts the gap
exceeds the button height and a 16 px minimum).

**Quest cards name the target system + plot a route** (`QuestJournalUI`,
`docs/plans/20260625-quest-return-route-and-system.md`). The pure, Pixi/DOM-free
resolver `questDestination(quest, galaxy, currentSystemId)` /
`questRouteAction(dest)` (`src/systems/quests/questDestination.ts`, structural
`*Like` inputs like `deliveryCompletion.ts`) turns a quest's
`targetSystemId`/`targetPlanetId` into a `{ systemId, systemName, planetId,
planetName, sameSystem }` descriptor and picks a route action —
`approach-planet` only when `sameSystem` AND a concrete planet, else
`warp-to-system`. A pending-return card resolves the **issuer planet's** system
(`returnDestination`), appends « — система <name>» to «↩ Вернитесь в …» so the
player knows *where* to fly, and (when a galaxy + nav hook are wired) hosts the
«Проложить маршрут» button: on click it runs `questRouteAction` and dispatches
the chosen id (planet id or system id) to the existing
`onNavigateToObjective` → `SpaceFlightScene.navigateToQuestObjective` seam
(in-system planet approach vs. star-map warp) — it **invents no navigation**.
`FlightHud` feeds `gameEngine.galaxy` + `player.currentSystemId` into the journal
ctor (both optional — the system suffix/button simply omit when absent). Pure
helper + reuse of existing routing: no domain/schema/save change.

Three most-hit PixiJS 8 traps:
- **`eventMode='none'` on Text over clickable areas** — Text defaults to `'auto'` and blocks
  clicks underneath; set `'none'` on labels so clicks pass through.
- **A Container whose children are ALL `eventMode='none'` needs an explicit `hitArea`**
  (`new Rectangle(...)`) — otherwise the event boundary prunes them and the button is
  mouse-dead even with `eventMode='static'`. Root cause of the 2026-06-10 regression.
- **Graphics mask must be `addChild()`'d to the masked object BEFORE assigning `.mask`** —
  else the mask is ignored (planets render as rectangles). A `TilingSprite` drops a child
  mask: wrap it + mask in a plain Container.

Full rule list (Rules 1–9, mouse-button codes, custom-filter `vTextureCoord`/equirect
gotchas), Scene Lifecycle, and Planet Backdrop / lazy-texture conventions: see `pixi-rules.md`.
