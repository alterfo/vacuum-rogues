---
# Fix: Station Name Overlaps Sprite + Military Base Refuses Its Own Quests

## Overview
Two playtest bugs at space stations:

1. **The station name label is drawn *on top of* the station.** When the station sprite
   was bumped 40→80 px, the name label's offset wasn't updated — `label.y = 18` now sits
   *inside* the 80 px sprite (which spans ±40 from centre) instead of below it.
2. **A military base refuses its own quests.** The station `"quests"` action is a **stub
   that unconditionally** toasts *"Задания выдаются только на военных базах"* (quests are
   only issued at military bases) — with **no station-type check** — so at an *actual*
   military base you get that contradictory message and can't get quests.

Fix: place the label clear of the sprite, and make the `"quests"` action **offer quests at
military bases** while showing the "only at military bases" message **only at other**
station types.

## Context (from discovery)
- **Label (`src/presentation/flight/PlanetManager.ts` `createStations`):** `sprite.width =
  80` (anchor 0.5 ⇒ ±40), but `label.anchor.set(0.5, 0)` + `label.y = 18` puts the name
  inside the sprite. (Pre-bump the sprite was 40 px so y=18 cleared it.)
- **Quests action (`src/presentation/StationScene.ts` ~L581):** `case "quests":
  this.showToast("Задания выдаются только на военных базах", …)` — unconditional; no
  `this.station.type === StationType.MILITARY_BASE` branch.
- **Quest offering:** planets use the JobBoard / `QuestGenerator`; stations don't have a
  wired quest surface — the toast is a placeholder for the whole military-base quest
  feature. The fix routes military bases to a real quest offering (reuse the job board /
  `generateQuestBoard`) rather than the dead-end toast.

## Development Approach
- **Testing approach: TDD.** The label offset is a layout assertion (label below the
  sprite's bottom edge). The quests gate is pure-ish: at a military base the action opens
  the quest offering; elsewhere it shows the message. `impact` on `createStations` +
  the StationScene `"quests"` handler.
- Small, presentation-level. No domain/schema/save change.

## Implementation Steps

### Task 1: Move the station name label clear of the 80px sprite
**Files:**
- Modify: `src/presentation/flight/PlanetManager.ts` (`createStations`)
- Create/Modify: `src/tests/presentation/planetManagerStations.test.ts`

- [ ] Set the label `y` below the sprite's bottom edge (≈ half the sprite size + a small
      gap, e.g. `~44`), so the name sits under the station, not over it. Keep anchor/center.
- [ ] write/extend a test: the label's `y` is ≥ the sprite half-height (no overlap) for the
      80 px sprite.
- [ ] run tests — green; screenshot-verify the name sits below the station.

### Task 2: Military bases offer quests; the message only shows elsewhere
**Files:**
- Modify: `src/presentation/StationScene.ts` (the `"quests"` case), wiring to the job board / `QuestGenerator`

- [ ] In the `"quests"` action, branch on `this.station.type`: at `MILITARY_BASE`, open a
      real quest offering (reuse the JobBoard / `generateQuestBoard` for the station,
      threading the dedupe exclusions); at any other type, show the "only at military
      bases" toast. No more contradictory message at a military base.
- [ ] write tests: at a military base the action opens the quest surface (not the toast);
      at a non-military station it shows the toast.
- [ ] run tests — green.

### Task 3: Crisp panel text (resolution) + bigger quest fonts
**Files:**
- Modify: `src/presentation/ui/scaledText.ts`, `src/presentation/JobBoardPanel.ts`, `src/presentation/QuestJournalUI.ts`
- Create/Modify: `src/tests/presentation/scaledText.test.ts`

- [ ] **Blur (global):** set `resolution: window.devicePixelRatio || 1` on the `Text`
      created by `scaledText` (the renderer is high-DPI `autoDensity`, but the text was
      rendered at 1× then upscaled → blur). One change fixes every migrated panel.
- [ ] **Small (quests):** bump the small base sizes in the quest UIs — descriptions
      `10→~13`, tags `9→~11`, meta `11→~13` (`JobBoardPanel`/`QuestJournalUI`) so quest
      text is comfortably readable at the M setting; keep it tracking S/M/L.
- [ ] write tests: `scaledText` sets a DPR-aware resolution; quest body/tag sizes are at
      the new (larger) bases.
- [ ] run tests — green; **screenshot-verify** quest text is crisp + readable.

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes` — PlanetManager + StationScene (+ quest wiring) affected; no schema.
- [ ] full unit suite green; `npm run test:playtest` green; lint/build ok.

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md` (station marker + station services note)

- [ ] Note the label-below-sprite offset (scales with sprite size) and that military bases
      offer quests (other stations show the wrong-place message).

## Post-Completion
**Manual:** at a station the name reads cleanly *below* the sprite; at a military base the
«Задания» action shows real quests; at other stations it explains quests come from military
bases.
