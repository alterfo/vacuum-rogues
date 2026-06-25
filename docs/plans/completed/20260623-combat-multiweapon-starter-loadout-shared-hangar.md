---
# Multi-Weapon Combat + Complete Starter Loadout + Shared Hangar Panel

## Overview
Three equipment/combat polish items:
1. **Fire all fitted weapons in combat.** The real-time auto-fire only fires the
   single `selectedWeapon`. It should fire **every** fitted weapon, each at a target
   within **that weapon's own range** ("в зоне поражения орудия").
2. **A ready-to-play starter ship.** A fresh game should have everything essential
   **already installed** — basic weapon, grapple (gravity tractor), engine — with
   **nothing left loose in the hold** for the player to discover and fit. (Today the
   loadout fits engine + tank + weapon but no grapple.)
3. **One hangar, two entry points.** The slot-fitting **hangar** lives in
   `StationScene` while the **equipment shop** has its own buy/sell+fit UI — two
   interfaces for the same thing. Extract a **shared hangar panel** and embed it in
   both, so fitting looks and behaves identically wherever you open it.

## Context (from discovery)
- **Combat fire:** `src/presentation/flight/CombatModule.ts` — `fittedWeapons()`
  (~L272, returns ALL fitted weapons), `firePlayerShot(target, weapon)`,
  `playerFireTimer` + `selectedWeapon` (single, ~L126/L159). Each weapon has a
  `range` (px) on `WeaponSpec` (`GearCatalog.ts:87`). The active-pause overlay's
  «Огонь!» (`confirmAttack`) fires the chosen weapon at the chosen target.
- **Starter loadout:** `GameEngine.starterLoadout()` (~L1246) installs
  `eq_engine_i` + `eq_tank` + `wpn_pulse`. The grapple/"захват" is a **gravity
  tractor** (`grav_tractor_1` — Гравитяга Тип-I, `GearCatalog.ts:398`, mass 3,
  EQUIPMENT bank). Corvette: 2 weapon slots, mass cap 40.
- **Equipment UIs (already share the LOGIC):** both `StationScene` (hangar) and
  `EquipmentShopScene` import the same gear helpers (`ownedUninstalledGear`,
  `installOwnedGear`, `uninstallToOwned`, `gearFit`, `sellUninstalledGear`) —
  only the **rendering** is duplicated. `ShipLoadout` is the canonical fitting model.
- **⚠️ Existing starter-gear test:** `GameEngine.loadout-persistence.test.ts`
  asserts the starter installed-gear list (updated to `wpn_pulse` in the combat
  plan); adding `grav_tractor_1` is a **feature-driven update** to that expectation,
  not a weakening.

## Development Approach
- **TDD.** Red tests first: every fitted weapon fires at an in-range target; the
  starter loadout has weapon+grapple+engine installed and an empty bag; the shared
  hangar component fits/unfits via `ShipLoadout`. Then implement.
- **Equipment stays canonical:** all fitting goes through `ShipLoadout` + the
  existing gear helpers — do not fork fit logic. Presentation text uses `scaledText`.
- Run `gitnexus impact` on `CombatModule.update`, `starterLoadout`, and the
  StationScene hangar before editing. Additive; don't weaken existing tests (only
  the starter-gear expectation changes, with reason). `SpaceFlightScene.ts` < 1900.

## Implementation Steps

### Task 1: Fire all fitted weapons (each within its own range)
**Files:**
- Modify: `src/presentation/flight/CombatModule.ts` (real-time auto-fire)
- Create/Modify tests under `src/tests/`

- [x] Replace the single-`selectedWeapon` auto-fire with a loop over
      `fittedWeapons()`: each weapon, on the shared `combatFireIntervalMs` cadence,
      fires at the **nearest combatant within that weapon's `range`** (preferring the
      selected target when it is in range); a weapon with no target in range holds.
      Give each weapon its own fire timer so cadence is per-weapon.
- [x] Keep the active-pause overlay «Огонь!» (`confirmAttack`) as the deliberate
      single-shot path; the real-time loop is what now uses all weapons.
- [x] write tests: two weapons of different ranges + two targets at different
      distances → each weapon fires at a target inside its range; a weapon whose
      range reaches no combatant does not fire; total damage reflects all in-range
      weapons.
- [x] run touched tests — green.

### Task 2: Complete the starter loadout (grapple installed, empty bag)
**Files:**
- Modify: `src/systems/GameEngine.ts` (`starterLoadout`)
- Modify (expectation): `src/tests/core/GameEngine.loadout-persistence.test.ts`
- Create/Modify tests under `src/tests/`

- [x] Install `grav_tractor_1` (the grapple/захват) in `starterLoadout()` alongside
      engine + tank + weapon; verify it fits the corvette's EQUIPMENT bank + mass
      budget (engine+tank+weapon+grav-tractor ≤ 40).
- [x] Ensure a fresh game leaves **no install-required gear in the hold**
      (`inventory.modules` / `ownedGearIds` empty) — everything essential is fitted.
- [x] write tests: starter loadout reports an installed weapon + grav-tractor (auto-
      pickup range > 0) + engine; the starting inventory has no uninstalled gear.
- [x] Update the starter-gear-list expectation to include `grav_tractor_1` (feature
      change; keep the rest of the assertion).
- [x] run touched tests — green.

### Task 3: Extract a reusable HangarPanel from StationScene
**Files:**
- Create: `src/presentation/ui/HangarPanel.ts`
- Modify: `src/presentation/StationScene.ts` (consume the panel)
- Create/Modify tests under `src/tests/`

- [x] Extract the slot-fitting hangar (the four slot banks + install/unfit + the
      ТРЮМ owned-gear strip) into a `HangarPanel` component that takes the loadout +
      player + callbacks and renders via `scaledText`; all mutations go through
      `ShipLoadout` + the shared gear helpers (no forked logic).
- [x] Refactor `StationScene` to mount `HangarPanel` (behaviour unchanged).
- [x] write tests for the panel's pure parts (which banks render, fit/unfit calls
      the loadout) with a fake renderer; **screenshot-verify** the station hangar
      looks unchanged. (Visual parity is covered by the unchanged
      `hangarLayout.test.ts`, which asserts the real rendered text/layout through
      the scene→panel path; live screenshots are unreliable in this harness.)
- [x] run touched tests — green.

### Task 4: Embed the shared hangar in the equipment shop
**Files:**
- Modify: `src/presentation/EquipmentShopScene.ts`
- Create/Modify tests under `src/tests/`

- [x] Mount the same `HangarPanel` in `EquipmentShopScene` so buying and fitting live
      in one screen with identical UI; reconcile it with the shop's existing
      install/sell strip so there is one fitting surface (no duplicate controls).
      (New АНГАР tab mounts the shared `HangarPanel`; the gear tab's row-install and
      the УСТАНОВЛЕНО «Снять» control were removed so fitting/uninstall lives only in
      the hangar. The micromodule-apply modal was extracted into a shared
      `MicromoduleApplyPanel` so the station and shop open the identical flow. The
      ТРЮМ quick-sell strip stays on the gear tab as a buy companion — pinned by the
      existing E2E sell regression — and is a different tab from the hangar.)
- [x] write tests: the shop renders the shared hangar and fitting from the shop
      mutates the same `ShipLoadout`; **screenshot-verify** the shop hangar.
      (Covered by `src/tests/presentation/shopHangar.test.ts`, which drives the real
      `EquipmentShopScene` through the scene→АНГАР-tab→`HangarPanel` path and asserts
      the four banks render + an install mutates the canonical `ShipLoadout`; live
      screenshots are unreliable in this harness, same as Task 3.)
- [x] run touched tests — green.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — only combat/loadout/
      equipment-UI symbols affected. (The plan's own increment touches exactly
      `CombatModule.ts`, `GameEngine.starterLoadout`, the new shared `HangarPanel.ts`
      + `MicromoduleApplyPanel.ts`, and `StationScene`/`EquipmentShopScene` + their
      tests. The raw `compare` vs master reads "critical / 501 files" only because
      this is a long-lived branch — that count is whole-branch divergence
      (AGENTS.md, CLAUDE.md, planet-backdrop, station-sprite art), not this plan.)
- [x] full unit suite green (incl. the updated starter-gear expectation);
      `npm run lint` clean; `npm run build` ok; `SpaceFlightScene.ts` < 1900.
      (2704 unit tests pass; lint 0 errors; build OK; `SpaceFlightScene.ts` = 1898 lines.)

### Task 6: Update documentation
**Files:**
- Modify: `CLAUDE.md` (equipment section), `src/presentation/CLAUDE.md`

- [x] Document: the starter ship ships fully fitted (weapon/grapple/engine, empty
      bag); combat fires all weapons within range; the hangar is one shared
      `HangarPanel` mounted by both the station and the equipment shop.
      (Updated `CLAUDE.md` equipment section — new ready-to-fly-starter/shared-hangar/
      multi-weapon bullet + reconciled the now-stale micromodule-surface and
      `uninstallToOwned`/«Снять» notes that Task 4 invalidated — and
      `src/presentation/CLAUDE.md` with the shared-`HangarPanel` component rule.)

## Technical Details
- Multi-weapon: per-weapon timers on the shared cadence; target = nearest combatant
  within `weapon.range`, selected target preferred. Reuses `firePlayerShot` (single
  damage/kill/loot path).
- Starter loadout + bag are runtime state from `starterLoadout()` — catalog ids
  only, no schema/migration change.
- `HangarPanel` is a presentation component; the canonical fitting model
  (`ShipLoadout`) and gear helpers are unchanged — this is a UI consolidation.

## Post-Completion
**Manual verification:**
- New game: open the hangar (station and shop) — weapon, grapple, engine already
  fitted, hold empty; both screens show the identical hangar.
- Combat with two weapons: confirm both fire at enemies within their respective
  ranges, not just one.
