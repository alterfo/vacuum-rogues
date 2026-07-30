# Presentation Layer Rules

PixiJS scenes, sprites, rendering, input. No hardcoded pixel coords for hit detection — use
`eventMode='static'` + handlers, position UI in world/relative coords. Always
`event.stopPropagation()` in UI click handlers over gameLayer/stage.

**Dark-panel text goes through `scaledText(text, basePx, color, opts?)`** (`ui/scaledText.ts`),
not `new Text({ style: { fontSize: … } })` directly. It sizes via `scaledFont()` so panel text
tracks the S/M/L setting, and lifts dim fills to a legible luminance floor (`READABLE_FLOOR`).
Pass `rawColor: true` only for already-bright/semantic colors (accents, intentionally-dimmed
disabled states, light backgrounds) where the floor would distort hue. Migrated: JobBoardPanel,
StationScene, TradeScene, EquipmentShopScene, InfoCenterScene, QuestJournalUI, TextQuestScene,
PlanetInfoPanel.
Still hardcoding `fontSize:` (route through `scaledText` when you touch them): StarMapScene,
InventoryScene, ResearchUpgradePanel, GovernmentScene, RaceSelectionScene,
NpcContactPanel, DialogueScene, WinScene, MainMenuScene, SystemMiniMap, CombatHud.
(Flight modules that already read `scaledFont` — FlightHud, PlanetManager, DamageNumbers, UiButton,
PlanetScene — don't need it; for the in-flight restyle-in-place rule see `flight/playtest-traps.md`.)

**Responsive layout + touch targets go through `ui/responsiveLayout.ts`** (mobile adaptation,
`docs/plans/20260625-mobile-adaptation.md`). `layoutFor({width,height})` is the **pure**
viewport classifier → `{mode: 'desktop'|'tablet'|'phone', uiScale, minTarget, touch}`, bucketed on
the **shorter** side at the soft-gate's 768/1024 breakpoints — the intended single source for
panel reflow/scale (though **no panel consumes `layoutFor`/`uiScale` yet** — only `touchHitArea`/
`isTouchLayoutActive` are wired today; panel reflow is a deferred follow-up). The touch *capability* gate is separate: `isTouchLayoutActive(env?)`
= touch layout **and** a coarse primary pointer, the **single source of truth** so a narrow desktop
window never gets touch chrome. `touchHitArea(w, h, env?)` grows + re-centres a hit rect to
`minTarget` (44 px) on a touch layout and returns exact `{0,0,w,h}` otherwise — already wired into
the **shared** `UiButton`, so every panel's buttons get comfortable targets at once with **no desktop
change** (the `uiButtonHitArea.test.ts` exact-bounds contract still holds on desktop/Node). The
on-screen flight touch controls (pinch-zoom + «✕» cancel) read the same `isTouchLayoutActive` gate —
see `flight/CLAUDE.md`.

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

**Station interior backdrop mirrors the planet backdrop resolver** (`flight/stationBackdrop.ts`,
`docs/plans/20260729-ux-review-fixes.md` Task 5). `StationScene.renderMain()` used to paint a flat
black rect behind its panel, so a docked station read as a bare panel on a void. It now mounts
`buildStationBackdrop(w, h, type)` as the **first** child of `mainContainer` — a full-bleed 12-band
vertical gradient (near-black top → dim accent-tinted floor) plus a dark vignette, `eventMode="static"`.
The per-`StationType` accent (`STATION_BACKDROP_ACCENT`/`stationBackdropAccent`) mirrors the marker
diamond's `TYPE_COLOR` coding so an interior reads the same hue as its flight-map marker. Structure
is deliberately identical to `PlanetScene.resolvePlanetBackdropKey` + `skyGradientColors`:
`resolveStationBackdropKey(type, id)` resolves a `pickVariantKey("station_interior", …)` art variant
and **returns `null` today** (no `station_interior/` art category is committed), so the procedural
gradient is the graceful fallback. Drop real interior-panorama art behind the same resolver and the
sprite path lights up with no scene change — same convention as planet panoramas and station markers.
The bands (`stationBackdropBands`) are pure + exported so a unit test asserts the tint tracks the
station type without a renderer.

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
`docs/plans/20260623-combat-multiweapon-starter-loadout-shared-hangar.md`,
SR2-style ring rework: `docs/plans/20260707-gear-variety-and-hangar.md`). It renders a
presentation-only ring (`renderFittingRing`/`renderRingZone`) over the same four category banks
+ install/unfit + the ТРЮМ owned-gear strip via `scaledText`, plus a ВЫБРОСИТЬ/ШЛЮЗ jettison
action, a СЕРВИСНЫЙ ЦЕНТР repair block, and КОМПЛЕКТАЦИЯ 1/2/3 loadout-preset tabs — see
`.claude/docs/systems/equipment.md`'s "Hangar ring UI" / "Loadout presets" sections for the
full breakdown. It mutates the canonical `ShipLoadout` through the shared gear helpers —
**never** fork fit logic into a scene. **Both** `StationScene` and the `EquipmentShopScene`
**АНГАР tab** mount the same `HangarPanel` (constructed with the scene's renderer), so fitting
looks/behaves identically at either entry point; the per-slot micromodule-apply modal is the
shared `ui/MicromoduleApplyPanel.ts`, opened from a fitted slot in both scenes. Gear renders via
the shared `ui/gearIcon.ts` (`gearIconKey`/`mountGearIcon`) with a text-only fallback when art is
missing — never resolve icon keys locally in a scene. A fresh game arrives fully fitted
(weapon/grapple/engine, empty hold — see `GameEngine.starterLoadout()`), so the hangar's job is
swapping/upgrading, not first-time assembly.

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
An **active** BOUNTY card (`DEFEAT_ENEMY`) gets the same button by reusing the
courier destination resolution as its `navTargetId`, falling back to
`quest.targetSystemId` when no concrete planet resolves (`buildCardContent`,
`docs/plans/20260706-ui-flight-bugfixes.md` Bug 5) — no new quest data needed,
BOUNTY already stores `targetSystemId`/`targetPlanetId`.
`FlightHud` feeds `gameEngine.galaxy` + `player.currentSystemId` into the journal
ctor (both optional — the system suffix/button simply omit when absent). Pure
helper + reuse of existing routing: no domain/schema/save change.

**InfoCenter trade margins respect partial observability** (`rumorPanel.ts`,
`docs/plans/20260625-infocenter-margin-known-systems-only.md`). A rumor's **margin
number** is shown only when **every system the route depends on is known** — both
endpoints explored on the star-map or visited. "Known" is the pure predicate
`isSystemKnown(player, galaxy, systemId)` (`src/systems/galaxy/systemKnown.ts`) =
`player.hasVisited(id) || system.explored`. `buildRumorPanel(galaxy, max, player)`
threads the `player` and masks the margin («маржа ~?%» via `describeRumor(r, galaxy,
true)`) for a route touching an undiscovered system, while the товар/route text still
renders — so the player can't read the profit of a route into a system they've never
seen. With **no** `player` (legacy callers/tests) nothing is masked. The **same masking
covers the news feed**: a `TRADE_OPPORTUNITY` event's description is baked unmasked at
open time (and persisted), so `buildNews` re-masks it at render time via
`maskTradeNewsMargin(desc, event, galaxy, player)` (also in `rumorPanel.ts`) — keyed on
the event's `fromSystemId`/`toSystemId` against current knowledge, so the «[МАРШРУТ]» row
can't leak the number the panel above it hides (and the margin re-appears once the system
is explored). Presentation/visibility only — the rumor data is unchanged, so no
domain/schema/save change.

**Contextual help is one-line per scene** (`ui/mountSceneHelp.ts`,
`docs/plans/20260623-onboarding-and-contextual-help.md`). Onboarding is three pure pieces +
one wiring call: the **content registry** `src/systems/onboarding/helpContent.ts` (`HELP_CONTENT:
Record<HelpKey, HelpEntry>` — concise Russian `title`/`body[]`/`controls?` for every reachable
screen plus the `welcome`/`quest-journal`/`combat` in-flight surfaces; `HelpKey` reuses the
`SceneType` string values so a scene passes its own type; read via `helpFor(key)`), the **"seen"
persistence** `src/systems/onboarding/onboardingState.ts` (`hasSeen`/`markSeen`/`resetSeen` over
browser-level `localStorage` key `sr_help_seen` — same class as `sr_settings`/`sr_mobile_ack`, so
**no save-schema/migration change** and it survives «Новая игра»; injectable + degrades to "nothing
seen" on absent/corrupt JSON), and the wiring helper `mountSceneHelp(deps, key, options?)`. A scene
opts in with **one line** in `initialize()` —
`this.helpTeardown = mountSceneHelp({ renderer, container: renderer.stage }, "PLANET")` — and calls
the returned teardown in `destroy()`. On mount it (1) auto-shows the panel **once** the first time
the key is seen (then `markSeen`s it so it never nags again) and (2) always mounts the top-right
«?» `UiButton` that reopens that key's `HelpPanel` on demand. Mount on **`renderer.stage`** (not a
per-frame-rebuilt `uiLayer`) so the «?»/panel survive layer rebuilds. The auto-show decision is the
pure, unit-tested `pickAutoShowKey(key, firstTimeKey, hasSeen)` / `shouldAutoShow` — no
renderer/DOM. **To add a new scene to onboarding:** add its `HelpKey` + `HELP_CONTENT` entry, then
the single `mountSceneHelp` line — nothing else. Two non-scene surfaces: pass
`options.firstTimeKey: "welcome"` to greet a brand-new player with the goal intro on the very first
flight before the per-screen hint (the flight scene; «?» still reopens the scene key, not the
intro), and `showHelpOnce(deps, "combat")` fires the one-shot combat hint on a transient event
(first in-flight engagement) with no «?» button. «Показать обучение заново» (Main Menu) calls
`resetSeen()` so every first-time hint shows again. The «?» sits top-right to avoid the bottom-right
«Оставить issue» overlay.

**Settings live in one ⚙ panel** (`ui/SettingsPanel.ts`,
`docs/plans/20260625-settings-interface-speed-font-neural.md` +
`docs/plans/20260625-localization-i18n.md`). A self-contained component with
four rows — **СКОРОСТЬ** (game speed), **ШРИФТ** (S/M/L font), **ЯЗЫК** (RU/EN language) and
**НЕЙРОСЕТЬ (ИИ)** (experimental on/off, default off) — opened by the ⚙ HUD button (replacing the
old font-only stub) and closed via the existing `isSettingsPanelOpen` + `closeModals`
Esc/outside-click wiring in `flightKeyHandler` (unchanged). Every control writes through the shared
accessor `src/systems/settings/gameSettings.ts` (**no new save field** — speed →
`GameEngine.gameSpeedMultiplier`, font → `fontScale.ts`, neural → `localStorage("neuralEnabled")`;
language goes through i18n `setLanguage` → `localStorage("language")`) and fans the live effect out
via `SettingsPanelDeps` callbacks: `applySpeed` (HUD label + physics `timeScale`), `applyFont`
(restyle in place, then `onRequestClose` — a font change rebuilds the whole HUD), `applyLanguage`
(the same in-place restyle a font change uses, so text nodes re-read `t(...)`; then close),
`onNeuralToggle` (the policy gate, see root CLAUDE.md "Neural / AI Pipeline"). Build the font row
**first** so its hit areas precede the others (the historical ⚙-panel "first font button" contract)
and the **НЕЙРОСЕТЬ** row **last** (the "neural is the final hit area" contract). The neural row is
**dev-only** — `showNeural` defaults to `import.meta.env.DEV`, so prod hides it entirely (its only
consumers, autopilot/letsplay, are dev-only, so a prod toggle would be a dead switch); the panel's
drawn height drops `SETTINGS_PANEL_HEIGHT_FULL`→`_COMPACT` accordingly, read by the host through the
single `SettingsPanel.heightPx` getter (not a separate build-time constant) so the background and the
centring can't desync. Control actions are public
(`selectFont`/`selectSpeed`/`selectLanguage`/`toggleNeural`) so they're unit-testable without PixiJS
pointer events.

**Accessibility lives in a sibling ♿ panel** (`ui/AccessibilityPanel.ts`,
`docs/plans/20260625-accessibility-pass.md`). The colorblind **ПАЛИТРА** / **МЕНЬШЕ ДВИЖЕНИЯ** /
key-remap **УПРАВЛЕНИЕ** group is a **separate** panel from `SettingsPanel` on purpose — the ⚙
panel's hit-area layout is pinned by locked tests, so the a11y group gets its own ♿ HUD surface
mounted beside the ⚙ gear button (`FlightHud`); the two bottom-left panels share one anchor so only
one is open, and the ♿ panel reuses the ⚙ panel's Esc-close / outside-click / Space-suppression
wiring (`FlightHud.isSettingsPanelOpen`/`closeModals`, so `flightKeyHandler` is untouched). Each
row writes through its own pure seam — palette → `ui/palette.ts` (`currentPaletteMode`/
`setPaletteMode`), reduced-motion → `ui/reducedMotion.ts` (`isReducedMotionSet`/`setReducedMotion`),
remap → `input/keymap.ts` (`rebind`+`setKeymap`, conflicts surfaced, Escape aborts) — each a
browser-level `localStorage` pref, **no new save field**. Consume these seams, don't re-derive
them: read faction colours through `factionColor(faction)` (never a raw colour map), gate idle/
parallax/heavy-particle animation on `reducedMotion()`, and route a new flight shortcut through a
`FlightAction` + `resolveFlightAction` (not a literal `event.key ===`). Control actions are public
(`cyclePalette`/`toggleReducedMotion`/`beginRebind`/`captureRebind`/`resetKeymapToDefaults`) so the
behaviour is unit-testable without PixiJS pointer events. See root CLAUDE.md "Accessibility" +
`.claude/docs/adding-features.md` → "Consuming an Accessibility seam".

**Dev-only autopilot watches the agent fly the *rendered* game** (`docs/plans/20260625-dev-autopilot.md`,
`docs/architecture/LETSPLAY_ENGINE.md` → "Autopilot"). In `npm run dev` only, press `` ` ``
(Backquote) or call `window.__autopilot.start()/.stop()/.toggle()` to hand the live ship to the
letsplay agent: it runs the same `observe → policy.decide → applyLiveAction` loop over the live
`SpaceFlightScene`/`GameEngine` (default 800 ms/tick) and shows a top-centre «● АВТОПИЛОТ» pill.
**Reclaim-on-input** — the first real pointer/key/wheel/touch disengages it (the autopilot drives
scenes through a port, never synthesised DOM events). It's the **preferred way to eyeball visual
oddities live** (suns/missing art/sameness) the headless agent can't see. **Dev-only is guarded:**
the brain + live applier live wholly under `src/tests/` (`LiveApplier`/`AutopilotController`/
`installAutopilotHook`); the lone prod seam is `src/dev/devAutopilot.ts`, attached via a
DEV-gated dynamic `import()` in `main.ts` that Vite drops from the prod bundle
(`letsplayDevOnly.test.ts` enforces it). No domain/schema/save change.

**Fixed-pixel row heights/y-offsets and character-count truncation don't scale with `scaledFont`**
(`20260708-font-scale-and-faction-bugs`, Bug 1). `scaledFont(base)` only scales font **size** — it
never touches layout dims, so a panel with a fixed row step or a `str.length > N` truncation can
overlap/clip/overflow at the "L" font setting even though its text already goes through
`scaledText`/`scaledFont`. The fix pattern (first established by `QuestJournalUI`'s
`ui/questCardLayout.ts`, then generalized): step row/line offsets by `lineStepFor` (font-scale-derived
line height) instead of a fixed `+N` pixel constant, and replace `slice(N)+"…"` truncation with either
real `wordWrap`/`wordWrapWidth` or a `MONO_CHAR_WIDTH_RATIO`-derived pixel-width budget. Applied to:
`JobBoardPanel` (`ui/jobBoardRowLayout.ts`, dynamic per-row height replacing fixed `ROW_H`/`ROW_H_OFFER`),
`HangarPanel` (fitted-slot/warehouse row gaps), `BankScene` (ledger row step + reason truncation),
`EquipmentShopScene` (`renderRows` name/stat/price stacks, `ROW_H` now a floored getter), `StationScene`
(in-space shop rows + micromodule-shop rows), `InventoryScene` (`renderWarehouseRow` button gap),
`InfoCenterScene` (gear-search row stack + name/system truncation), `TextQuestScene`
(`refreshVmParamPanel` param stack). When adding a new stacked-row/multi-line panel behind
`scaledText`, size its row step and any truncation from `scaledFont`/`lineStepFor` up front rather
than a fixed pixel constant — retrofitting it later means auditing every consumer for this same bug
class. **Known gap, not yet fixed:** `ScrollableList`'s shared `itemHeight` is still uniform
(non-variable) across its 6+ panel consumers — a long wrapped item (e.g. InfoCenter news rows) can
still bleed into the next row at "L" scale; fixing it needs per-item variable-height support in that
shared component, out of scope for a single-panel fix.

**The star-map critical-threat line is a bordered banner chip, not stray red text**
(`ui/starMapThreatBanner.ts`, `docs/plans/20260729-ux-review-fixes.md` Task 6). `StarMapScene`'s old
`warningIndicator` was a raw `new Text({ fontSize: 12 })` at the routine stat-line size, so a
`critical`/`warning` alert carried no visual weight. `buildThreatBanner(level, …)` now mounts a filled,
bordered `Graphics` chip behind a **bold** `scaledText` label at `THREAT_BANNER_BASE_PX` (15) — strictly
larger than the 12px РАЗУМ/ПИРАТЫ stat lines — with a hotter red accent for `critical` than `warning`,
`eventMode="none"` so it never intercepts map clicks. Any animated emphasis (the subtle pulse) is gated
on `shouldPulseThreatBanner(level, env)` = `critical` **and** `!reducedMotion(env)` per the accessibility
seam — a reduced-motion player gets a static banner. This is the one StarMapScene line migrated to
`scaledText` (the file is still on the not-yet-migrated list above; migrate only lines you touch).

**Hover tooltips on icon-only HUD buttons reuse the star-map tooltip shape** (`FlightHud.mountIconTooltip`,
`docs/plans/20260729-ux-review-fixes.md` Task 10). An icon-only glyph button (`[I]` inventory, the flight
`[?]` help-overlay) reads as low-affordance next to a worded button (`[КВЕСТЫ]`). `mountIconTooltip(btn,
label, color)` mirrors the existing `starMapTooltip` pattern: an `eventMode="none"` label hidden until
hover, toggled on the button's `pointerover`/`pointerout` via a **second** listener so the button keeps
its own alpha/hover-audio handlers. Labels go through `t(...)` (`flight.inventoryTooltip` "Инвентарь",
`flight.helpTooltip` "Помощь"; keys in both `ru.ts`/`en.ts`). **Position the tooltip from the button's
numeric x/y + a font-scaled glyph budget, NOT `btn.width`/`btn.height`** — PixiJS Text measurement
throws in the jsdom harness (the `BOTTOM_LEFT_LANE_W` trap; see `flight/CLAUDE.md`). The shared
`mountSceneHelp` "?" glyph is left untouched (self-explanatory on every scene); a full word like
`[КВЕСТЫ]` needs no tooltip.

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
