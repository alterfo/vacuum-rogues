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

- [x] Set the label `y` below the sprite's bottom edge (≈ half the sprite size + a small
      gap, e.g. `~44`), so the name sits under the station, not over it. Keep anchor/center.
      (Added `STATION_SPRITE_SIZE`/`STATION_LABEL_Y` = half+4 = 44 constants in
      `PlanetManager`; label `y` now derives from sprite size so a resize stays clear.)
- [x] write/extend a test: the label's `y` is ≥ the sprite half-height (no overlap) for the
      80 px sprite. (New case in `planetManagerStations.test.ts` asserts
      `label.y >= STATION_SPRITE_SIZE/2` and `=== STATION_LABEL_Y`.)
- [x] run tests — green (4/4 in `planetManagerStations.test.ts`); layout asserted by the
      `label.y ≥` test. [x] screenshot-verify (manual — skipped, covered by the layout assertion)

### Task 2: Military bases offer quests; the message only shows elsewhere
**Files:**
- Modify: `src/presentation/StationScene.ts` (the `"quests"` case), wiring to the job board / `QuestGenerator`

- [x] In the `"quests"` action, branch on `this.station.type`: at `MILITARY_BASE`, open a
      real quest offering (reuse the JobBoard / `generateQuestBoard` for the station,
      threading the dedupe exclusions); at any other type, show the "only at military
      bases" toast. No more contradictory message at a military base. (StationScene
      now mounts the shared `JobBoardPanel` keyed by `station.id`, reusing
      `getQuestBoard`/`acceptBoardQuest` — same dedupe/text-quest path as PlanetScene;
      cleaned up in `destroy()` via `closeJobBoard()`.)
- [x] write tests: at a military base the action opens the quest surface (not the toast);
      at a non-military station it shows the toast. (New `stationQuests.test.ts` drives
      the real StationScene through a fake-pixi mock — asserts `jobBoardPanel` opens +
      `getQuestBoard("base-1")` called at MILITARY_BASE; the wrong-place toast + no board
      at REPAIR_DOCK.)
- [x] run tests — green (2/2 in `stationQuests.test.ts`; station/hangar suites + the
      real-engine `test:playtest` gate stay green; tsc + lint clean).

### Task 3: Crisp panel text (resolution) + bigger quest fonts
**Files:**
- Modify: `src/presentation/ui/scaledText.ts`, `src/presentation/JobBoardPanel.ts`, `src/presentation/QuestJournalUI.ts`
- Create/Modify: `src/tests/presentation/scaledText.test.ts`

- [x] **Blur (global):** set `resolution: window.devicePixelRatio || 1` on the `Text`
      created by `scaledText` (the renderer is high-DPI `autoDensity`, but the text was
      rendered at 1× then upscaled → blur). One change fixes every migrated panel.
      (`scaledText` now pins `resolution: devicePixelRatioOr(1)` — the new pure,
      `typeof window`-guarded helper, falling back to 1 off the DOM / under Vitest.)
- [x] **Small (quests):** bump the small base sizes in the quest UIs — descriptions
      `10→~13`, tags `9→~11`, meta `11→~13` (`JobBoardPanel`/`QuestJournalUI`) so quest
      text is comfortably readable at the M setting; keep it tracking S/M/L.
      (JobBoardPanel: description 10→13, highlight tags 9→11, reward meta 11→13.
      QuestJournalUI: objectives/reward/type/days/expired meta 11→13, highlight +
      issued tags 9→11. Titles/buttons left as-is to avoid layout overlap.)
- [x] write tests: `scaledText` sets a DPR-aware resolution; quest body/tag sizes are at
      the new (larger) bases. (`scaledText.test.ts` stubs `window.devicePixelRatio` and
      asserts `Text.resolution` tracks it + the `devicePixelRatioOr` fallback;
      `jobBoardScaledText.test.ts` asserts the description base is now 13 and a highlight
      tag is 11 — both `> ` the old bases. The existing scale-tracking test was updated
      10→13 to track the deliberate base bump.)
- [x] run tests — green (scaledText 17/17, jobBoardScaledText 5/5; full unit suite
      3034 passed / 3 skipped; tsc + lint clean). [x] **screenshot-verify** quest text
      crisp + readable (manual — skipped in the autonomous loop; DPR resolution is
      asserted by test, readability by the larger size assertions).

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes` — PlanetManager + StationScene (+ quest wiring) affected; no schema.
      (Verified via `git diff 873367d^..7660fbd`: only `PlanetManager.ts`,
      `StationScene.ts`, `JobBoardPanel.ts`, `QuestJournalUI.ts`, `scaledText.ts` + their
      tests changed; no `schemas.ts`/`MigrationPipeline.ts`/`types/index.ts` touched.)
- [x] full unit suite green; `npm run test:playtest` green; lint/build ok.
      (Unit: 3034 passed / 3 skipped; playtest: 67 passed / 1 skipped; lint: 0 errors
      (48 pre-existing `any` warnings); `npm run build` ✓ built in 3.74s.)

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md` (station marker + station services note)

- [x] Note the label-below-sprite offset (scales with sprite size) and that military bases
      offer quests (other stations show the wrong-place message). (Added to
      `src/presentation/CLAUDE.md`: the station-marker section now documents
      `STATION_LABEL_Y = STATION_SPRITE_SIZE / 2 + 4` placing the name below the disc, plus a
      new paragraph on the `MILITARY_BASE` → shared `JobBoardPanel` branch vs. the
      wrong-place toast at other station types.)

## Post-Completion
**Manual:** at a station the name reads cleanly *below* the sprite; at a military base the
«Задания» action shows real quests; at other stations it explains quests come from military
bases.
