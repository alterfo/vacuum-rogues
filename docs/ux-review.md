# UX Review — Galactic Horizon: Neural Onslaught

**Reviewed:** all presentation-layer scenes in `src/presentation/`  
**Screenshots reviewed:** main-menu, race-selection, star-map, space-flight, combat, inventory, station  
**Date:** 2026-06-06  
**Reviewer:** UX Audit (Claude Sonnet 4.6)

---

## Executive Summary

Galactic Horizon has a coherent retro-terminal visual identity built around Courier New / monospace typography, a dark near-black palette, and cyan/green accent colours. The visual atmosphere in SpaceFlightScene is polished (animated nebulae, parallax starfields, warp effects), and the faction-selection screen demonstrates real art quality. However, a significant number of usability problems sit just beneath that surface: the star map screenshot reveals the entire galaxy content collapsed into a tiny cluster in the centre of a black canvas; the combat scene renders no units or battlefield state whatsoever; the station scene screenshot shows an empty panel with no service buttons visible; and the title screen mixes Russian and English in the same `Text` node, undermining localisation consistency throughout. Feedback mechanisms are weak — there is no loading state, no persistent toast-style confirmation, and no undo for irreversible purchases. Keyboard discoverability is essentially zero. These issues are fixable without a design overhaul, but they must be addressed before public-facing playtesting.

---

## Navigation Flow

### Scene graph and entry paths

```
MainMenu
  └─ "Новая игра" → RaceSelection → SpaceFlightScene
  └─ "Продолжить" → SpaceFlightScene (via loadGame)

SpaceFlightScene
  ├─ Click planet → PlanetInfoPanel (inline) → land → PlanetScene
  ├─ Click station → StationScene
  ├─ Click NPC → NpcContactPanel → combat → CombatScene
  ├─ [M] → StarMapScene → warp confirmation → SpaceFlightScene
  ├─ [J] → QuestJournalUI (overlay on SpaceFlightScene)
  └─ [I] → InventoryScene

PlanetScene
  ├─ "Губернатор" → GovernmentScene → [tasks] → TextQuestScene
  ├─ "Маркет" → TradeScene
  ├─ "Снаряжение" → EquipmentShopScene
  ├─ "Инфоцентр" → InfoCenterScene
  └─ "Взлёт" → SpaceFlightScene

StationScene
  ├─ "Магазин снаряжения" → (inline sub-view: shop)
  ├─ "Ангар / Оснастка" → (inline sub-view: hangar)
  ├─ "Микромодули" → (inline sub-view: micromodules)
  ├─ "Инфоцентр" → InfoCenterScene
  └─ "Отстыковаться" → SpaceFlightScene
```

### Issues

**No back-navigation from RaceSelectionScene.** There is no "Назад" or "Cancel" button. Once the player enters race selection via "Новая игра", the only exit is to press the "НАЧАТЬ ИГРУ" button, which immediately starts the game. Players who clicked accidentally or want to reconsider cannot escape to the main menu.

**Star map has no explicit "Return to flight" button in the fixed UI.** The only visible affordance is a `[Войти в систему]` text-link inside the right-side info panel, which only appears after clicking the player's current system node. If the player opens the star map and immediately wants to close it, there is no cancel affordance; they must discover that the route back requires clicking a node first, or learn the keyboard shortcut (which is also undisclosed).

**InventoryScene hard-codes return to SpaceFlightScene** (`SceneType.SPACE_FLIGHT` in `closeInventory()`). The comment says "For now, default to SPACE_FLIGHT". If a player opens inventory from StarMapScene (which the keyboard handler in SpaceFlightScene does allow via `[I]`), closing inventory drops them into flight rather than the star map they came from.

**InfoCenterScene `goBack()` can silently do nothing.** If both `this.station` and `this.planet` are null, the async function returns without transition, leaving the player stranded inside InfoCenter with no way out except pressing Escape — and even then only because the keydown handler calls the same method.

**CombatScene "Продолжить" always returns to SpaceFlightScene**, discarding the station or planet context if combat was initiated from a station-adjacent NPC. This is tolerable for NPC combat, but means there is never a path back to the location-level UI (station / planet) post-combat.

---

## Button and Label Consistency

### Language mixing

The game targets a Russian-language audience (all in-game text is Russian) but ships with English strings in critical places:

| Location | English string | Expected |
|---|---|---|
| `MainMenuScene` title `Text` | `"GALACTIC HORIZON\nНЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ"` | All-English or all-Russian line, not split |
| `StarMapScene` fixed UI title | `"SECTOR MAP"` | `"КАРТА СЕКТОРА"` |
| `CombatScene` scene title | `"TACTICAL COMBAT"` | `"ТАКТИЧЕСКИЙ БОЙ"` |
| `QuestJournalUI` quest `typeText` | Raw enum value `[DELIVERY]`, `[BOUNTY]` etc. | Localised via the `TYPE_LABEL` map already defined in `JobBoardPanel.ts` |

This is not stylistic: the title screen screenshot confirms both scripts appear simultaneously in the same `Text` node, which reads as a bug to any player.

### Button style inconsistency across scenes

There are three distinct button patterns with no shared abstraction:

1. **Plain text with bracket decoration** — e.g. `[ Атаковать ]`, `[ Назад ]`, `[Войти в систему]` — used in StationScene, StarMapScene, GovernmentScene, InfoCenterScene.
2. **Text only, no brackets** — e.g. `"Новая игра"`, `"Продолжить"` in MainMenuScene; `"Связаться"`, `"Торговать"` in NpcContactPanel (rendered as coloured `Graphics` rectangles with a `Text` label).
3. **Styled container with `Graphics` background** — used in InventoryScene (`createButton`), RaceSelectionScene start button, CombatScene (`makeButton`), and TradeScene (`createButton`).

The hover feedback also differs: styles 1 and 2 dim the alpha to 0.7, while style 3 changes background fill colour. There is no shared component, so each scene's interactive elements look and behave slightly differently.

### Font-size fragmentation

Sizes found across scenes: 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 32. No scene-wide or game-wide typographic scale is enforced. Scene titles range from 14px (StationScene `renderHangar` title `"АНГАР — ОСНАСТКА КОРАБЛЯ"`) to 32px (main menu), with intermediate values used inconsistently.

### Missing "active" state for toggle/tab controls

`InfoCenterScene` has a three-tab switcher (НОВОСТИ / ОБЪЕКТЫ / СНАРЯЖЕНИЕ). The active tab gets a lighter background (`0x1a2a3a`) and cyan border, while inactive tabs are `0x0d0d1a` with dim border `0x334455`. This contrast is very low (dark-on-dark). At 12px monospace, the active indicator is subtle enough that testing is needed to confirm players notice the state change.

The InfoCenter gear filter controls (kind, tech range, price, sort) are all implemented as single-click cycler buttons — clicking advances the value. There is no indicator that they are interactive or what clicking will do. They look identical to static labels.

---

## Feedback and State Communication

### No loading state

`MainMenuScene.handleContinue()` awaits `this.gameEngine.loadGame("auto")`, which involves IndexedDB access. During this time the UI is unresponsive and visually identical to its idle state. There is no spinner, no "Загрузка…" overlay, and no button disable. Players who double-click will trigger the call twice.

`StarMapScene.performWarpJump()` awaits a scene transition. Same problem: the warp button remains interactive with no feedback during the transition.

### Error messages are ephemeral and lack context

`MainMenuScene.showMessage()` displays errors for 3 seconds then destroys the `Text` node. The message "Ошибка загрузки. Начните новую игру." gives no technical detail and disappears before many players finish reading it. The clearing mechanism is also flawed: the `showMessage` loop in the function body iterates `buttonsContainer.children` looking for texts containing `"["`, but the newly added `msgText` is added to `uiLayer` directly rather than to `buttonsContainer`, so previously shown messages are never cleared — multiple error texts accumulate if the player clicks "Продолжить" repeatedly.

### Station scene renders empty panel in screenshot

The station screenshot (`e2e/screenshots/station.png`) shows the panel with type badge, station name ("Станция"), and stats row, but the service buttons are entirely absent. The generic name "Станция" (with no actual name) and the missing buttons indicate the scene was captured before a `Station` object was injected into context. This is a data-flow issue that also risks appearing in live play if context is lost during a scene transition.

### No confirmation for purchases

`StationScene.buyItem()`, `TradeScene.trade()`, and all micromodule purchases execute immediately on `pointerdown` with no confirm dialog. Destructive or expensive actions (spending all credits on an item) have no undo or confirmation step. The toast ("Куплено: X") appears, but it auto-fades at 2.5 seconds and the action is irreversible.

The only confirmed-before-execution action in the entire codebase is the warp jump in StarMapScene, which uses a proper `showWarpConfirmation()` dialog. This pattern should extend to purchase actions above a configurable credit threshold.

### Combat scene shows no battlefield state

The combat screenshot shows a hex grid and three action buttons but no units, no HP bars, no enemy portrait, no turn indicator, and no log. `renderCombatGrid()` draws only the empty grid; ship and enemy placement are not rendered. The player has no information about what they are fighting, how healthy either party is, or what is happening when they click "Атаковать". The weapon panel (`renderWeaponPanel`) only appears when the player has weapon modules equipped, and even then there is no visual for the enemy.

### Quest journal completed-quest section is a stub

`QuestJournalUI.renderCompletedQuestsSection()` ignores the actual list of completed quest IDs entirely and displays a generic string: "Вы завершили несколько квестов! Продолжайте исследовать галактику." The count shown in the header is correct, but clicking into this section yields no useful information.

### Toast in SpaceFlightScene overwrites itself silently

`SpaceFlightScene.showToast()` (the `this.toast` Text node) is updated in-place. If a toast is already fading and a new one fires, the second one may fire before `clearTimeout(this.toastTimer)` runs on the first path, leaving the player reading a half-faded previous message replaced mid-sentence.

---

## Accessibility

### Color contrast

All contrast ratios computed against the standard dark background (`0x000510` ≈ `#000510`, near-black).

| Element | Foreground | Background | Approx ratio | WCAG AA (4.5:1) |
|---|---|---|---|---|
| Main menu buttons (normal) | `0x00ff00` green | `0x000510` | ~10:1 | Pass |
| Main menu "Продолжить" | `0xffaa00` amber | `0x000510` | ~8:1 | Pass |
| Star map system labels | `0x88ccff` | `0x000510` | ~5.5:1 | Pass |
| Star map unvisited label | `0x445566` | `0x000510` | ~2.3:1 | Fail |
| RaceSelection description text | `0xcccccc` | `0x0a1a2a` | ~7:1 | Pass |
| RaceSelection stats text | `0xaaaaaa` | `0x0a1a2a` | ~5:1 | Pass |
| Station type label | `0xffcc44` on `0x080818` | — | ~9:1 | Pass |
| Station service buttons (blocked) | `0x445566` | `0x080818` | ~2.2:1 | Fail |
| Info center inactive tab label | `0x556677` | `0x0d0d1a` | ~2.1:1 | Fail |
| Planet info panel type text | `0xaaaaaa` | `0x000000` | ~5.3:1 | Pass |
| Planet info panel hint text | `0x888888` | `0x000000` | ~3.8:1 | Fail |
| SpaceFlightScene HUD (from screenshot) | small yellow-green text | dark space | appears ~3:1 at 10px | Fail |
| Combat title | `0xff4444` | `0x000000` | ~3.1:1 | Fail (large text: Pass) |

Key failures: star map unvisited "?" labels (`0x445566` on near-black), blocked station service buttons (`0x445566`), InfoCenter inactive tab labels, PlanetInfoPanel hint text (`0x888888`), and combat title at the rendered size.

### Text sizing

Multiple UI elements use 9px, 10px, and 11px `Courier New` monospace text:
- `StarMapScene` system labels: 10px
- `StarMapScene` planet type sub-labels: 9px (line 768: `fontSize: 9`)
- `RaceSelection` stats text: 10px
- `StationScene` type label: 11px  
- `NpcContactPanel` scan result: 11px
- `InfoCenterScene` day badge: 11px
- `QuestJournalUI` navigate button text: 10px

Courier New is among the least legible monospace fonts at small sizes. At 10px on a 1x display these strings are effectively illegible. At 9px (the planet type sub-label in StarMapScene) they are too small to read without zooming.

### Interactive target sizes

WCAG 2.5.5 recommends a minimum 44x44px touch target. Many interactive elements are well below this:

- `MainMenuScene` buttons: rendered `Text` nodes with no expanded hit area. The text "Новая игра" at 20px is approximately 150×22px — fine for click width, but only 22px tall.
- `StarMapScene` system hit areas: `Graphics` circle of radius 12px = 24×24px diameter. Below 44px.
- `NpcContactPanel` action buttons: 116×24px — width fine, height 24px is below threshold.
- `QuestJournalUI` close button: 20×20px — well below 44px.
- `InventoryScene` close button: 25×25px — below threshold.
- `InfoCenterScene` news bookmark star: rendered as a single `Text("★")` character with `eventMode = "static"`, approximately 16×20px.
- `InfoCenterScene` tab buttons: 120×30px — height below threshold.

For a desktop-only product the 44px guideline is less critical, but the 20×20 close buttons are too small even for mouse use.

### Keyboard navigation

There is no keyboard navigation between buttons. Tab focus does not exist (PixiJS canvas renders no DOM focusable elements). The keyboard bindings that do exist are undisclosed:

| Key | Action | Disclosed to player? |
|---|---|---|
| `J` | Open quest journal (SpaceFlightScene) | No |
| `M` | Open star map (SpaceFlightScene) | No — inferred from code |
| `I` | Open inventory (SpaceFlightScene / StarMapScene) | No |
| `Esc` | Back / undock | Disclosed only in station "Отстыковаться Esc" label |
| Arrow Up/Down | Scroll shop list (StationScene) | No |
| Arrow Up/Down | Scroll news (InfoCenterScene) | No |
| Enter | Submit search (InfoCenterScene objects tab) | No |
| Any printable key | Type in search field (InfoCenterScene) | No — field shows fake cursor but no indication it's active |

The SpaceFlightScene HUD (visible in the screenshot) shows a horizontal bar of text items at the top but does not label any keyboard shortcuts there.

### Colorblind considerations

The game uses red/green as a semantic pair in several places:
- CombatScene: victory border `0x44ff88` (green) vs defeat `0xff4444` (red)
- StationScene: hull OK `0x445566` vs repair needed `0x88ff88`
- GovernmentScene reputation: ally `0x00ff88` vs hostile `0xff4444`
- QuestJournalUI: completed objectives `0x00ff00` vs incomplete `0xaaaaaa`

Players with deuteranopia or protanopia will have difficulty distinguishing these states. Shape or iconography (checkmark vs circle vs X) would make these states legible without colour.

---

## Scene-by-Scene Observations

### MainMenuScene

The screenshot shows a clean space backdrop with animated ships, parallax stars, and two buttons. The visual quality is good. Issues:

1. **Bilingual title string.** The `Text` node at line 224–232 hard-codes `"GALACTIC HORIZON\nНЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ"`. The English line is spaced with `letterSpacing: 6`; the Cyrillic line uses the same setting but kerning behaves differently, making the two lines read with different visual rhythm. The screenshot confirms this asymmetry is visible.

2. **"Продолжить" is always enabled.** There is no check whether a save exists before showing the button. Clicking it with no save shows the error toast "Нет доступных сохранений". A simple pre-check on mount could grey it out (fill `0x445566`) when no save exists, preventing the false-positive click.

3. **`showMessage()` accumulation bug.** The internal loop at lines 336–340 iterates `buttonsContainer.children` looking for texts containing `"["` but never removes anything. The `msgText` is added to `uiLayer`, not `buttonsContainer`. Multiple errors accumulate as stacked Text nodes at the same position.

4. **No settings or credits entry point.** The menu offers only New Game and Continue. There is no Options, Volume, or Credits link anywhere in the flow.

### RaceSelectionScene

The screenshot shows a polished 3-column faction card layout with portrait art, descriptions, and a highlighted selection (Окраинники with an orange border). Issues:

1. **No back navigation.** No "Назад" button exists. The Escape key is not handled by this scene.

2. **Description text overflow.** Cards are 300×230px. The description and bonus text use `wordWrap: true` with `wordWrapWidth` set to `textW` (panel width minus portrait minus padding ≈ 176px). At 11px Courier New this is approximately 25 characters per line. Longer faction descriptions may overflow the card's bottom edge without clipping, depending on the faction.

3. **Stats text is 10px.** The stats block (hull, shields, speed, evasion) renders at 10px, which is extremely small in a card-style selection UI. These are decision-critical values; they should be 13–14px.

4. **Selection state relies on full re-render.** `selectFaction()` calls `this.refresh()`, which destroys and recreates the entire `mainContainer`. At five faction cards this is fast, but the approach means no transition animation is possible and the selected state is never animated (the card border simply changes colour on the next frame).

5. **No hover tooltip explaining what stats mean.** "Уворот: 0.8" is meaningless to new players with no context about scale or effect.

### SpaceFlightScene

The screenshot shows a rich visual environment: nebula backdrop, star halo, orbit lines, minimap in the lower-right, and a HUD strip across the top. Issues:

1. **HUD text is extremely small.** The top bar text visible in the screenshot (system name, fuel, date, etc.) appears to render at approximately 10–12px. The minimap title "СИСТЕМА" renders at 10px (`SystemMiniMap.drawFrame()` line 149). These are effectively illegible at normal viewing distance.

2. **Play/Pause button label is undisclosed.** The `playPauseButton` Text node exists but its label and keyboard shortcut are not documented in the HUD. The "Ход" text (Play) appears only after reading the source.

3. **Camera controls are not disclosed in-game.** The scene's `logger.info` at line 537 says "pan (Shift+click), zoom (wheel)" — but this is never shown to the player. The star map discloses its controls in small text at the bottom; SpaceFlightScene has no equivalent.

4. **Route planning has no cancel affordance.** Once a route is planned (click on destination), the ship auto-routes on the next "Ход" press. There is no clear button, no click-to-cancel, and no indication of how to deselect.

5. **PlanetInfoPanel hardcodes "Фракция: Окраинники".** At line 57 of `PlanetInfoPanel.ts`: `text: this.planet.isHabitable ? 'Фракция: Окраинники' : 'Дроны: ${this.planet.drones}'`. For habitable planets the faction is always shown as "Окраинники" regardless of actual ownership. This is misleading.

6. **NpcContactPanel button text truncated.** "Приблизиться" fits 116px at 12px Courier New but only just. With any longer translated string or a wider character variant, text will overflow the button width with no clipping.

7. **Low-hull warning fires once but is not persistent.** The `lowHullStopped` latch means the warning fires once when hull drops below threshold. After that, the player may continue flying with critically low hull with no ongoing visual indicator (no red pulsing border, no HUD colour change).

### StarMapScene

The screenshot reveals the most severe visual bug in the reviewed scenes: the entire galaxy (player's current system and connected unvisited nodes) is collapsed into a tiny cluster near the centre of a completely black canvas. The system cluster occupies roughly 80×60px in a 1280×720 viewport. The map is technically functional (zoom/pan work) but on first open no player would find this legible or usable.

1. **Map renders at too small a scale on initial load.** The `mapContainer` starts at `zoomLevel = 1` with `scale` of 4 per coordinate unit. With the galaxy's coordinate range spanning a small integer domain, the entire map may render within a 200px bounding box. An initial zoom-to-fit that centres and scales the map to fill ~70% of the screen is essential.

2. **"SECTOR MAP" title is English** while all other UI is Russian.

3. **Fuel indicator uses a different label key than SpaceFlightScene.** The star map calls it "ТОПЛИВО" (uppercase, monospace, 14px), but SpaceFlightScene renders the same stat as part of the HUD with different formatting. There is no consistency in how this critical resource is labeled.

4. **No back button visible.** There is no "Закрыть" or "Назад" in the fixed UI; the only way back to flight is the `[Войти в систему]` link inside the info panel or pressing a key that is not documented on-screen.

5. **Double-click detection uses a custom 300ms timer** (line 468: `doubleClickDelay = 300`). The browser native `dblclick` event is intentionally not used because PixiJS uses DOM events. The 300ms delay is reasonable but any jitter in `Date.now()` resolution could cause a single quick double-click to register as two single clicks, opening the info panel twice rather than initiating travel.

6. **Info panel is 200px wide at fixed right-edge position** (`width - 220`). On narrower viewports this can overlap the map content. Panel is not responsive to viewport size.

### StationScene

The screenshot shows a near-empty panel — only station type badge, name, and stats row. Service buttons are completely absent. This is the most critically broken screenshot in the set.

1. **Screenshot captures empty-context state.** The station was rendered without a `Station` domain object in context, causing `this.station` to be null. The `TYPE_SERVICES` lookup defaults to an empty array and no buttons are rendered. This represents a real regression risk: if any code path reaches `StationScene` without a station, the player sees an empty dead-end.

2. **Repair and refuel buttons are not dimmed, they disappear.** When hull and fuel are 100%, the labels change to "Корпус в норме" / "Баки полны" with colour `0x445566`. This is so dark on the `0x080818` background that it reads as absent rather than disabled — contrast ratio approximately 2.2:1.

3. **Micromodule display shows raw ID** in the applied state: `mmTag.text = '[мм: ${mod.micromoduleId}]'` (line 1218). Players see something like `[мм: mm_shield_boost_t1]` rather than a human-readable name.

4. **Shop sub-view has no scroll indicator.** The shop list is masked and scrollable via Arrow Up/Down. Nothing on-screen indicates that more items exist below the visible rows or that arrow keys scroll it.

5. **"Esc" keyboard shortcut is only disclosed on "Отстыковаться".** Other Esc behaviours (shop → main, hangar → main) are not labeled anywhere.

### CombatScene

The screenshot shows the 9×9 hex grid and three action buttons. No ships, units, HP bars, or combat log are visible. Issues:

1. **No units rendered.** `renderCombatGrid()` draws the empty grid only. Player ship and enemy ships are never placed on the grid with position, visual representation, or health state. The "TACTICAL COMBAT" title with no visual payoff is deeply confusing.

2. **No HP bars or combat log.** After clicking "Атаковать", the player's only feedback is the outcome panel at the end of combat. There is no indication of damage dealt, shields reduced, or intermediate state.

3. **The "Атаковать" generic button ignores installed weapons.** `onPlayerAttack()` fires the default attack regardless of weapons. `onPlayerAttackWithWeapon()` is a separate path invoked from `renderWeaponPanel()`, but the weapon panel only renders when modules with `category === "WEAPON"` are installed. A new player with no weapons sees only the generic "Атаковать" button and has no indication that weapon modules change combat behaviour.

4. **Action buttons are at hardcoded pixel positions** (`btnY = 430`, `x = 50, 230, 370`). On viewports shorter than 500px or narrower than 530px, buttons will be clipped or off-screen. PixiJS canvas is resizable.

5. **"TACTICAL COMBAT" title is English.**

6. **Retreat outcome message is in Russian ("Отступление — корабль цел.") but the scene title is English.** Language inconsistency within the same scene.

### InventoryScene

> **Outdated (2026-06-10, letsplay F6):** the scene was reworked into a read-only
> view of the canonical GearCatalog loadout (КОРАБЛЬ / УСТАНОВЛЕННОЕ
> ОБОРУДОВАНИЕ / РЕСУРСЫ); the legacy module slots and the equip/unequip flow
> described in items 2–3 below no longer exist. Truncation (item 3) is now an
> explicit "…и ещё N" counter.

The screenshot shows a clean three-column layout: КОРАБЛЬ / УСТАНОВЛЕННЫЕ МОДУЛИ / МОДУЛИ В ИНВЕНТАРЕ. Visual quality is acceptable. Issues:

1. **Close button is 25×25px.** A red `0xff0000` square with "X" at 16px. The size is the smallest of any close button in the game, and the colour choice (pure red on dark) is visually alarming — it looks like an error state rather than a navigation control.

2. **Module cards in inventory have no equip-to-slot affordance when clicked while no slot is selected.** The `renderSlotCard()` shows an "Установить" button inside an empty slot only when `this.selectedModule !== null`. The UX requires: 1. Click module card to select it, 2. Then click an empty slot to see the button. This two-step process is discoverable only by trial-and-error; there is no hint text.

3. **Scroll is not implemented for the inventory module list.** The comment at line 349 says "add scrolling later". If the player has more than approximately five modules, items are silently truncated at `y > y + 450` with no indicator.

4. **Resources section at the bottom is single-line concatenation.** `"Кредиты: 1000 | FUEL: 2 | METALS: 5"` with separator `| `. If many resource types are held, this line will overflow the 900px panel width at 11px with no wrapping.

5. **Category labels use English enum strings wrapped in brackets.** `getCategoryRussian()` returns translated strings, but `categoryText.text = '[${this.getCategoryRussian(module.category)}]'` — which is correct. However, the bracket style `[Оружие]` is inconsistent with how categories are displayed in StationScene where `KIND_LABEL` from `GearBridge.ts` is used instead.

### DialogueScene

Source-only analysis (no screenshot available).

1. **Only `governor` NPCs are supported.** `loadDialogueTree()` returns `null` for any NPC whose ID does not contain "governor". If a non-governor NPC somehow reaches `DialogueScene`, the scene silently fails to load any tree and `displayNode()` is never called, leaving the player on a black screen.

2. **Dialogue responses overflow the panel height.** `buttonStartY = panelY + 250` with each response button 50px tall and no scrolling. If a node has more than three responses (unlikely with current trees, but possible), buttons will render below the 400px panel boundary.

3. **No "close dialogue" keyboard shortcut.** Esc is not handled. The player must click a response to advance (including "Прощайте" which navigates to `nextNodeId: null`).

4. **NPC portrait is a placeholder circle.** `this.npcPortrait = new Graphics(); this.npcPortrait.circle(...); this.npcPortrait.fill({color: 0x4488cc})` — a solid blue circle at line 233. This is more noticeable than a missing portrait because it actively signals "placeholder" to any player.

### TradeScene

1. **All items trade one unit at a time** with no quantity selector. Buying 10 units of Metals requires 10 separate clicks. The hint at the bottom ("1 единица за нажатие") acknowledges this limitation but does not compensate for it.

2. **The sell button is always enabled** regardless of whether the player owns any units. Clicking "Продать" with zero units calls `TradeSystem.executeTrade()`, which returns `result.success = false` with message "Not enough resources to sell." — the English message that `localizeMessage()` translates. This path works correctly but the enabled sell button is misleading.

3. **No buy-price affordability indicator.** Prices are shown in amber (`0xffcc66`) for buy and blue (`0x66ccff`) for sell. When the player cannot afford a buy price, there is no visual change to the buy button or price row. The StationScene shop does this correctly (dimming the buy button and price). TradeScene does not.

4. **Toast persists until next refresh, not on a timer.** `showToast()` in TradeScene adds a `Text` to the top of the screen without a timer. It is removed only by the next `refresh()` call (the next trade). If the player views the panel without trading again, the previous trade confirmation remains visible indefinitely.

### GovernmentScene

1. **"Задания" button silently does nothing when no text quest exists.** `openQuests()` calls `showToast("Заданий нет", 0xffaa44)`. The button is always visible and clickable; the only indication that there are no quests is a 2.5-second toast. This trains players to distrust the button.

2. **Reputation scale is not explained.** The info block shows "Репутация: Нейтрал (+0)" but no context on what range constitutes "Враг" vs "Нейтрал" vs "Союзник", or what actions change it.

3. **Dialogue lines are static strings** — no line varies based on quest state, recent events, or player actions beyond the `repTier` lookup.

### InfoCenterScene

1. **Objects tab search field has no real cursor blink.** The `"|"` cursor indicator is a static `Text` rendered on each `render()` call, which fires on every keypress. Between keypresses it is static — there is no blink animation. Players who click the field and wait may not realise it is focused.

2. **Gear filter cycler controls have no undo.** Clicking "Kind" cycles HULL → WEAPON → EQUIPMENT → HULL. There is no back-cycle. Accidentally advancing past the desired value requires cycling through all remaining values.

3. **InfoCenter "goBack" cannot navigate to flight.** The `goBack()` method only handles `this.station` and `this.planet` cases. If somehow reached from SpaceFlightScene directly (which is not a current flow, but could be added), the function silently returns without transition.

4. **News tab scroll has no visual scrollbar.** The `↑↓ 1–12 / 28` counter at the bottom right is the only scroll indicator. No scrollbar, drag, or mouse-wheel scroll is implemented.

### QuestJournalUI

1. **Completed quests section shows placeholder text only.** The actual completed quest titles and descriptions are never rendered — just "Вы завершили несколько квестов!"

2. **`createQuestCard()` uses a hardcoded 100px card height** but renders an unbounded number of objectives inside it. Three or more objectives will overflow the card boundary into the next card.

3. **`backdrop` extends −1000 to +3000 pixels** (`Graphics().rect(-1000, -1000, 3000, 3000)`) to block clicks behind the overlay. This is a workaround for PixiJS event propagation; it works but creates a very large invisible interactive surface that might cause unexpected event-capture in edge cases.

4. **Quest type labels in card header use raw enum string** (`[DELIVERY]`, `[BOUNTY]`). The `TYPE_LABEL` map in `JobBoardPanel.ts` already provides Russian equivalents (`"Доставка"`, `"Охота"`). `QuestJournalUI` should import and use that map.

### SystemMiniMap

1. **The title "СИСТЕМА" is positioned at `(5, 5)` inside the frame graphic** that sits above the clipping mask. The title does not clip — it can be read regardless of zoom — but planet dots near the top of the map area may render under the title text.

2. **Ship indicator uses a hard-coded cyan circle at radius 6** regardless of ship size or zoom level. At zoomed-out views this indicator is prominent and clear; at zoomed-in views it may dominate the minimap.

3. **The `update()` method** (non-sprite version) is implemented but draws only orbit paths without actual planet positions. It is superseded by `updateWithSprites()` but the dead code path remains, which creates maintenance confusion.

---

## Prioritized Work Plan

### Critical

| # | Scene | Issue | Proposed Fix | Effort |
|---|---|---|---|---|
| C1 | StarMapScene | Map renders as a tiny near-invisible cluster on initial open; unplayable without manual zoom | Compute bounding box of all explored systems on `initialize()`, set `zoomLevel` and `viewportX/Y` to fit them at ~70% of the available canvas | S |
| C2 | StationScene | Service buttons entirely absent in screenshot; null-station context renders empty dead-end | Add a guard in `renderMain()` — if `this.station` is null, show an error message and a "Назад" button; add `contextDependentScenes` guard in GameEngine to prevent context-less entry | S |
| C3 | CombatScene | No ships, HP bars, or combat log rendered; player cannot see what is happening | Render player ship token and enemy token(s) on the hex grid with their current HP; add a scrolling combat log text area | L |
| C4 | RaceSelectionScene | No back navigation to main menu | Add "Назад" button and Esc handler that transitions to `SceneType.MAIN_MENU` | S |
| C5 | Entire game | Raw English strings in scene titles: "SECTOR MAP", "TACTICAL COMBAT", "GALACTIC HORIZON" line in main menu | Replace with Russian equivalents throughout; unify the bilingual title string | S |

### High

| # | Scene | Issue | Proposed Fix | Effort |
|---|---|---|---|---|
| H1 | MainMenuScene | "Продолжить" enabled with no save; `showMessage` accumulates duplicate nodes | Check save existence on mount, grey button if missing; fix `showMessage` to remove previous message before adding new | S |
| H2 | All scenes | No loading state during async transitions (loadGame, warp) | Show a "Загрузка…" overlay on the current scene while the transition awaits; disable interactive buttons during the await | M |
| H3 | SpaceFlightScene | Keyboard shortcuts (J, M, I) undisclosed in-game | Add a small HUD legend or keybindings panel accessible via "?" key | M |
| H4 | SpaceFlightScene | PlanetInfoPanel hardcodes "Фракция: Окраинники" for all habitable planets | Look up the planet's owning faction from the star system domain object | S |
| H5 | InventoryScene | Inventory module list silently truncates with no scroll | Implement vertical scroll for module list; add "X / N модулей" counter | M |
| H6 | CombatScene | Action buttons at hardcoded pixel positions (y=430, x=50/230/370) | Position buttons relative to screen height and width; use `renderer.app.screen` dimensions | S |
| H7 | QuestJournalUI | Completed quests section shows placeholder text, not actual quest data | Implement a `getCompletedQuests()` method and render minimal title+reward summary per completed quest | M |
| H8 | TradeScene | All trades are 1-unit only; no quantity selector | Add increment/decrement controls and a quantity input; at minimum, hold-to-repeat on the buy/sell button | L |
| H9 | StarMapScene | No close/back button in the fixed UI | Add `[ Назад ]` button to `fixedUIContainer`, transitioning to `SceneType.SPACE_FLIGHT` | S |
| H10 | Multiple | Red/green-only semantic pairs for success/failure states | Add a shape or icon indicator alongside colour (checkmark, X, warning triangle) in combat outcome, quest completion, and reputation display | M |
| H11 | DialogueScene | Non-governor NPCs reach DialogueScene and get a null tree, producing a blank screen | Add a fallback generic dialogue tree for any NPC with a role; or guard against null tree and return to previous scene with a toast | S |
| H12 | StationScene | Applied micromodule shown as raw ID `[мм: mm_shield_boost_t1]` | Look up the micromodule name from `MICRO_MODULES` by ID before rendering | S |

### Low

| # | Scene | Issue | Proposed Fix | Effort |
|---|---|---|---|---|
| L1 | All scenes | Three distinct button visual patterns with no shared component | Extract a shared `createTextButton(label, color, onClick)` factory and a `createBoxButton(label, bgColor, accentColor, onClick)` factory | M |
| L2 | All scenes | Font-size values range from 9–32px with no enforced scale | Define a typographic scale constant object (e.g. `FONT_SIZE = {xs: 10, sm: 12, md: 14, lg: 18, xl: 24}`) and replace magic numbers | M |
| L3 | QuestJournalUI | Quest type labels show raw enum strings `[DELIVERY]` | Import and use `TYPE_LABEL` from `JobBoardPanel.ts` | S |
| L4 | InventoryScene | Close button 25×25px, pure red; reads as error state | Enlarge to 32×32px; use a neutral grey or cyan close affordance consistent with other panel close buttons | S |
| L5 | StarMapScene | Info panel is fixed 200px wide at `screenWidth - 220`, not responsive | Clamp panel width to `Math.min(220, screenWidth * 0.25)` and update position accordingly | S |
| L6 | InfoCenterScene | Gear filter cyclers advance-only; no reverse cycle | On right-click or Shift+click, cycle backwards; or use a small `<` / `>` pair of arrows flanking the current value | S |
| L7 | SpaceFlightScene | "Продолжить" button in CombatScene outcome hardcodes white text on dark, no hover | Add hover effect consistent with other buttons | S |
| L8 | GovernmentScene | "Задания" button always visible but often does nothing | Only render button when `getQuestBoard()` returns at least one quest; otherwise show "Заданий нет" as static greyed text | S |
| L9 | TradeScene | Toast persists indefinitely between trades | Start a 3-second `setTimeout` in `showToast()` to remove the toast text, matching other scene patterns | S |
| L10 | NpcContactPanel | "Сканировать" result renders below buttons at fixed `y = 284`, which may overlap buttons if the panel is in out-of-range mode | Compute result Y dynamically as `maxButtonY + 8` | S |
| L11 | DialogueScene | NPC portrait is a placeholder blue circle | Replace with an NPC art sprite using the same `pickVariant("portraits", ...)` pattern from RaceSelectionScene | M |
| L12 | MainMenuScene | No Options, Volume, or Credits entry point in the menu | Add at minimum a Volume toggle button (mute/unmute) | S |
| L13 | InfoCenterScene | News tab has no mousewheel scroll | Add `wheel` event listener that calls `scrollNews(delta > 0 ? 1 : -1)` | S |
| L14 | SystemMiniMap | Dead `update()` method alongside `updateWithSprites()` | Remove `update()` or mark it `@deprecated`; use only `updateWithSprites()` | S |
| L15 | All scenes | Star map unvisited labels (`0x445566`), blocked service buttons (`0x445566`), InfoCenter inactive tab text (`0x556677`) all fail WCAG AA contrast | Lighten to at least `0x6688aa` for secondary text; use `0x888899` minimum for disabled states | S |
