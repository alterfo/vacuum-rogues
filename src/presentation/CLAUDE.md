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
