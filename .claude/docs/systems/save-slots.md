# Save Slots UI

Plan: `docs/plans/20260625-save-slots-ui.md`. No save-schema/migration change.

## Slot model (`src/systems/saves/saveSlots.ts`)

`listSlotRows(manager)` → `SlotRow[]`: `AUTO_SLOT_ID` first, then `slot-1 … slot-N` (manual, `MANUAL_SLOT_COUNT = MAX_SLOTS − 1 = 9`). Ops: `saveToSlot`/`deleteSlot`/`nextFreeSlot` over injectable `SlotManagerLike`. Slot names ride in `localStorage` key `sr_save_names` (`getSlotName`/`setSlotName`/`clearSlotName`) — not a persisted save field.

## Continue resolver

`latestMeaningfulSlot(manager)` — most recent **non-terminal** save across all slots, skipping `WIN_SCREEN`/`GAME_OVER`, or `null`. `GameEngine.continueGame()` uses this instead of hard-coding `"auto"`.

## SaveLoadScene

`src/presentation/SaveLoadScene.ts`, registered as `SceneType.SAVE_LOAD`. Two-step in-scene confirm for overwrite/delete. In `contextDependentScenes` so a pause-autosave that lands here bounces to SPACE_FLIGHT on reload. Reachable from main-menu «Сохранения» (`returnTo` MAIN_MENU) and in-flight system menu (`returnTo` SPACE_FLIGHT). i18n key: `menu.saves`.
