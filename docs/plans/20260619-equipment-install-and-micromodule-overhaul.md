---
# Equipment Install at the Shipyard & Micromodule Overhaul

## Overview
Fix and deepen ship fitting:
1. **Install at the planet Верфь.** Buying gear at a planet opens the equipment shop, but the player
   can't *fit* it there. Bring the hangar fitting flow (install/uninstall owned gear) to the planet
   Верфь, mirroring `StationScene`.
2. **Un-installable legacy artifacts.** Old items sit in the hold and cannot be installed — "Лазер
   мк-1", "Базовый щит", "быстрый двигатель" — leftovers in the legacy `inventory.modules` bag from
   the dual-hull unification (the "Residual" noted in CLAUDE.md). Convert them to installable owned
   gear, and clarify/replace the cryptic **"[+ микромодуль]"** label.
3. **Real micromodule system.** Micromodules become a proper upgrade layer: **buy at science
   (CRAFT_CENTER) stations**, **drag-and-drop** onto gear to improve stats. Many varied modules —
   some for the hull, some targeting the engine. **Hulls gain 1–4 micromodule slots** (today a hull
   has a single `hullMicromoduleId`). Hull micromodules can **boost defense, boost cargo, or redirect
   energy to weapons or the engine** — improving those systems' stats *without* applying a module
   directly to them.
4. **Sell the hull (trade-in on replace).** The planet Верфь shop lets you buy/install hulls but has
   **no way to sell a hull** — the «Продать» action only exists on the gear ТРЮМ strip, and hulls are
   excluded. Buying/installing a new hull should refund a fraction of the **old hull's** value (a
   trade-in), mirroring the `StationScene` hull trade-in. You can never be left with zero hulls.

## Context
- **Canonical loadout (single source of truth):** `src/systems/equipment/ShipLoadout.ts` — derives
  all ship stats; today a **single** `hullMicromoduleId` (~L110); `applyMicromodule(gearId, microId)`
  (~L367) is one-per-item; `derivedStats()` reports categories/mass. Per CLAUDE.md, `ShipLoadout`/
  `GearCatalog` is canonical; the live `PlayerShip` is a projection via `applyLoadoutHullToShip`.
- **Hull spec:** `src/systems/equipment/GearCatalog.ts` — `HullSpec` has `slots`, `weaponSlots`,
  `equipmentSlots`, `massCapacity` (~L61–67) but **no micromodule-slot count**. `MICRO_MODULES`
  (~L424) = 12 defs (4 categories × 3 tiers), "Sold at CRAFT_CENTER stations".
- **Fit projection / owned gear:** `src/systems/equipment/GearBridge.ts` — `gearFit`,
  `ownedUninstalledGear`, `installOwnedGear`, `uninstallToOwned`, micromodule `targetCategory`
  (note: "Hulls have no micromodule category here — the hull micromodule is applied by hull").
- **Legacy bag (the artifacts):** `src/domain/Inventory.ts` `modules` + `ownedGearIds`;
  `slotToBagModule` preserves a slot's micromodule + upgrades. Combat loot and the hangar **unequip**
  button still route into `inventory.modules` (CLAUDE.md "Residual"). `src/types/index.ts`
  `ShipLoadoutData` (`hullMicromoduleId`, per-slot `micromoduleId`).
- **UI surfaces:** `src/presentation/EquipmentShopScene.ts` (buy + ТРЮМ strip),
  `src/presentation/StationScene.ts` (hangar: `removeAt`/`applyMicromoduleAt`),
  `src/presentation/PlanetScene.ts` — "Верфь" button (~L1169) → `openGarage()` (~L1518) →
  transitions to `SceneType.EQUIPMENT_SHOP` (~L1562).
- **Persistence (lockstep):** `src/validation/schemas.ts` (`ShipLoadoutSchema`, `InventorySchema`)
  + `src/data/MigrationPipeline.ts`. Expanding to **multiple** hull micromodule slots and converting
  the bag → installable owned gear are **save-format changes** → schema update + migration required.
- **Decision (confirmed):** **full overhaul** — multi-slot hulls, hull energy-redirect, buy at
  science stations, drag&drop, plus legacy-artifact fix.

## Development Approach
- **TDD, pure-first.** The loadout is the single source of truth and is heavily tested. Drive every
  stat/slot change from a failing `ShipLoadout`/`GearCatalog` unit test before any UI. Write the
  `impact`/`detect_changes` blast-radius check on `ShipLoadout`, `HullSpec`, `applyMicromodule`,
  and `ShipLoadoutData` **before** editing — these are HIGH-fan-in symbols; report the radius.
- **Backward-compatible saves are a contract.** `hullMicromoduleId` → `hullMicromoduleIds[]` and the
  bag → owned-gear conversion need a migration; **old saves must still load** and existing loadout
  tests must stay green. If an existing test reds, STOP and re-diagnose (root-cause signal), do not
  weaken it (standing rule: never modify existing test assertions).
- **Schema lockstep:** any `types/index.ts` or `domain/*` change updates `schemas.ts` +
  `MigrationPipeline.ts` in the **same task**.
- One concern per task; full suite green between tasks; visual-verify the fitting UI by screenshot.

## Testing Strategy
- Unit: `HullSpec.micromoduleSlots` honored; `ShipLoadout` accepts up to N hull micromodules and
  rejects N+1; `derivedStats()` applies defense/cargo/energy-redirect bonuses; engine-targeted
  module buffs engine stats; save round-trip of multiple hull micromodules; migration of an old save
  (`hullMicromoduleId` → array; legacy bag module → installable owned gear).
- Integration: buy a micromodule at a CRAFT_CENTER station; drag-drop applies it and stats change;
  install a converted legacy artifact at the Верфь; uninstall returns it to owned gear (not the bag).
- E2E/regression: at a planet Верфь, fit a bought item; a hull shows its micromodule slots; a hull
  energy-redirect module raises weapon (or engine) stats.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any loadout/save test that reds). Keep in sync.

## Implementation Steps

### Task 1: Fitting flow at the planet Верфь
**Files:**
- Modify: src/presentation/EquipmentShopScene.ts (add install/uninstall of owned gear via
  `installOwnedGear`/`uninstallToOwned`/`ownedUninstalledGear`), and/or src/presentation/PlanetScene.ts
  `openGarage` to surface the hangar ТРЮМ
- Create: src/tests/equipment/shipyardInstall.test.ts

- [x] at the planet Верфь the player can install owned/bought gear and uninstall fitted gear, using
      the existing `GearBridge` accessors (no new fit logic — reuse `gearFit`). Install already
      existed (buy → warehouse → "[Установить]" row → `installOwnedGear`); added the per-chip «Снять»
      uninstall on the УСТАНОВЛЕНО strip → `uninstallToOwned` (returns to the ТРЮМ owned store).
- [x] write tests: install owned gear at the shipyard → loadout updated; uninstall → owned gear
      (`src/tests/equipment/shipyardInstall.test.ts` — 4 tests, incl. strip-index ↔ slot alignment)
- [x] run affected tests — must pass before next task (195 equipment tests green; tsc + eslint clean)

### Task 2: Convert legacy bag artifacts into installable owned gear
**Files:**
- Modify: src/domain/Inventory.ts / src/systems/equipment/GearBridge.ts (map a legacy `modules` bag
  entry → installable owned gear id, preserving micromodule + upgrade count where possible),
  src/data/MigrationPipeline.ts (one-time bag → owned-gear conversion), src/validation/schemas.ts
- Create: src/tests/equipment/legacyArtifactInstall.test.ts

- [ ] "Лазер мк-1", "Базовый щит", "быстрый двигатель" (and other bag modules) become installable;
      clarify/replace the "[+ микромодуль]" label so its meaning is explicit
- [ ] migration converts old-save bag modules to installable owned gear; schema updated in lockstep
- [ ] write tests: a legacy bag module installs onto a compatible hull; migration round-trip
- [ ] run affected tests — must pass before next task

### Task 3: Multi-slot hull micromodules — data + loadout
**Files:**
- Modify: src/systems/equipment/GearCatalog.ts (`HullSpec.micromoduleSlots: 1..4` per hull),
  src/systems/equipment/ShipLoadout.ts (`hullMicromoduleId` → `hullMicromoduleIds: string[]` bounded
  by the hull's slot count), src/types/index.ts (`ShipLoadoutData`)
- Create: src/tests/equipment/hullMicromoduleSlots.test.ts

- [ ] run `impact`/`detect_changes` on `ShipLoadout`, `HullSpec`, `ShipLoadoutData`, `applyMicromodule`
      and report the blast radius before editing
- [ ] a hull accepts up to `micromoduleSlots` hull micromodules and rejects beyond; `toJSON`/restore
      carry the array
- [ ] write tests: accept up to N, reject N+1, round-trip the array
- [ ] run affected tests — must pass before next task

### Task 4: Hull micromodule effects (defense / cargo / energy-redirect)
**Files:**
- Modify: src/systems/equipment/GearCatalog.ts (`MICRO_MODULES`: add varied hull modules + an
  engine-targeted module; an energy-redirect module that buffs weapon **or** engine),
  src/systems/equipment/ShipLoadout.ts (`derivedStats()` applies hull-module bonuses),
  src/systems/equipment/GearBridge.ts (`targetCategory` for hull/engine micromodules)
- Create: src/tests/equipment/hullMicromoduleEffects.test.ts

- [ ] hull micromodules boost defense / cargo / redirect energy to weapons or engine (improving those
      stats without a module fitted directly on them); engine-targeted modules buff engine stats
- [ ] write tests: each effect changes the expected `derivedStats()` field by the expected amount
- [ ] run affected tests — must pass before next task

### Task 5: Buy micromodules at science stations
**Files:**
- Modify: the CRAFT_CENTER station shop listing (StationScene / EquipmentShopScene) to stock the
  expanded `MICRO_MODULES`; purchase routes through the banking bus (ABS), goes into owned inventory
- Create: src/tests/equipment/micromoduleShop.test.ts

- [ ] CRAFT_CENTER (science) stations stock the micromodules; buying one (balanced bus transfer)
      adds it to the player's owned micromodules
- [ ] ⚠️ existing economy tests must stay green — purchase delta unchanged, GL balanced
- [ ] write tests: a science-station buy adds the micromodule and posts a balanced transfer
- [ ] run affected tests — must pass before next task

### Task 6: Drag-and-drop apply onto gear / hull
**Files:**
- Modify: src/presentation/StationScene.ts + src/presentation/EquipmentShopScene.ts (drag a owned
  micromodule onto a fitted item or a hull slot → `applyMicromoduleAt` / hull apply); honor
  compatibility (`micromoduleAccepted`, faction reject) and slot limits
- Create/Modify: e2e regression spec for drag-drop apply

- [ ] drag-drop a micromodule onto compatible gear/hull applies it and updates derived stats;
      incompatible / full-slot drops are rejected with a clear hint
- [ ] visually verify the drag-drop fitting via screenshot
- [ ] add e2e: buy a micromodule, drag it onto a weapon, see the stat change
- [ ] run affected tests + regression — must pass before next task

### Task 7: Hull trade-in (sell) on replace at the Верфь
**Files:**
- Create: src/systems/equipment/sellHull.ts (`hullTradeInPrice(hull)` — a fraction of `basePrice`,
  pure)
- Modify: src/presentation/EquipmentShopScene.ts (`buyHull`: credit the old hull's trade-in via the
  banking bus when installing a replacement; show the trade-in amount on the hull listing)
- Create: src/tests/equipment/hullTradeIn.test.ts

- [ ] installing a new hull refunds the old hull's trade-in value (a fraction of its `basePrice`)
      through the bus; the hull listing shows the trade-in credit; the player can never end hull-less
- [ ] ⚠️ existing economy tests must stay green — the net credit delta (price − trade-in) is balanced
      and GL-posted; if any reds, STOP and fix the posting
- [ ] write tests: buying a replacement nets `price − tradeIn`; trade-in is a balanced bus posting;
      no hull-less state
- [ ] run affected tests — must pass before next task

### Task 8: Verify acceptance criteria + persistence
**Files:**
- Modify: src/validation/schemas.ts + src/data/MigrationPipeline.ts (final check: multi-slot hull
  micromodules + converted owned gear persist and migrate)

- [ ] verify Overview: install at Верфь, legacy artifacts installable, multi-slot hull micromodules,
      hull effects, science-station buy, drag&drop, hull trade-in — all work
- [ ] old saves migrate (single `hullMicromoduleId` → array; bag → owned gear) and reload cleanly
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing loadout/equipment/save test assertions changed

## Technical Details
- **Energy-redirect model:** a hull micromodule applies a global multiplier to weapon or engine
  derived stats inside `derivedStats()` — it is fitted in a *hull* slot, not on the weapon/engine,
  satisfying "improve them without applying a micromodule directly."
- **Slot count:** `HullSpec.micromoduleSlots` (1–4) bounds `ShipLoadout.hullMicromoduleIds`. Bigger
  hulls get more slots.
- **Save migration:** `hullMicromoduleId?` → `hullMicromoduleIds: string[]` (old value becomes a
  one-element array; absent ⇒ `[]`); legacy `inventory.modules` entries map to `ownedGearIds`
  (preserving micromodule + upgrades where the richer owned-gear entry allows). Keep
  `PlayerShipSchema.modules` optional so pre-existing saves still validate.
- **Stay canonical:** all stat effects flow through `ShipLoadout.derivedStats()`; the live ship is
  re-projected via `applyLoadoutHullToShip` — no parallel stat path.

## Post-Completion
**Manual verification:** at a planet Верфь, install a bought item and a converted legacy artifact;
buy several micromodules at a science station; drag them onto weapons, the engine, and hull slots;
confirm defense/cargo/weapon/engine stats change and that a hull shows its 1–4 micromodule slots;
reload an old save and confirm everything migrates.
