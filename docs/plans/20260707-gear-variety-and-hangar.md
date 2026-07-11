# Gear Variety + SR2-Style Hangar Interface

## Overview

Two coupled deliverables (user request 2026-07-07, reference screenshot: the classic
Space Rangers 2 hangar):

1. **Gear variety expansion** — the catalog today is thin: 6 hulls, 6 weapons, 12 equipment
   items, entire families missing (GRAPPLE has an enum + a `derivedStats` branch but ZERO
   catalog items; fuel tank/radar/scanner/droid/shield are ×1 each). Fill the tech ladder
   (T1–T8) for every family with items that differ *meaningfully* (not +10% clones), and give
   the under-used stat dimensions real gameplay consumers.
2. **Hangar interface rework** — replace the two-column text board with the SR2-style hangar:
   central ship view with a **ring of equipment slots** grouped ВООРУЖЕНИЕ (top) / СИСТЕМА
   ДВИЖЕНИЯ (left) / СИСТЕМА ОТСЛЕЖИВАНИЯ (right) / ДОПОЛНИТЕЛЬНОЕ ОБОРУДОВАНИЕ (bottom),
   МАССА/СВОБОДНО + СКОРОСТЬ/ЗАЩИТА stat chips, СКЛАД warehouse column, ТРЮМ cargo strip,
   ВЫБРОСИТЬ/ШЛЮЗ jettison zone, СЕРВИСНЫЙ ЦЕНТР repair block, and КОМПЛЕКТАЦИЯ 1/2/3
   loadout-preset tabs. Gear renders as icons (art exists for 6 module classes; the rest is a
   new art category), with text fallback.

**Sequencing constraint:** run AFTER (or paused-around) the active three-year-campaign ralphex
run and the ui-flight-bugfixes pack — this plan shares the `derivedStats` contract and the
`balance.ts` power anchors (`POWER_INDEX_*`, `BATTLE_READY_*`) with the campaign's adaptive
difficulty and the autopilot's arm-up logic. Never two ralphex instances at once.

## Context (from discovery — file:line pointers)

- **Catalog** (`src/systems/equipment/GearCatalog.ts`): `GearKind` HULL/WEAPON/EQUIPMENT (:20);
  `GearBase` = id/name/techLevel(1–8)/size/basePrice/mass/upgrades/rare (:46). Hulls ×6
  (:133-251, hp/slots/weaponSlots/equipmentSlots/cargo/massCapacity/micromoduleSlots).
  Weapons ×6 (:253-339: weaponClass ENERGY/FRAGMENT/MISSILE, damage, range, ability,
  cooldownTurns). Equipment ×12 (:341-472, single `potency` field): engines ×3, fuel ×1,
  radar ×1, scanner ×1, repair droid ×1, shield ×1, grav-tractor ×3. **GRAPPLE enum (:34-44)
  + no-op derivedStats branch (:587) but NO catalog item** (starter grapple referenced in
  `GameEngine.starterLoadout`).
- **Mass budget is first-class**: `HullSpec.massCapacity` (:79); slots AND mass both enforced
  (`canInstall`/`install` `ShipLoadout.ts:356/385`; eviction :203-266).
- **Slot model**: `SlotCategory = weapon|engine|radar|equipment` (:110/:120) — engine/radar are
  single replace-slots; fuel/shield/scanner/droid/tractor/grapple ALL share the `equipment`
  bank (2–5 slots by hull). The ring UI groups visually; the domain model stays as-is.
- **derivedStats** (`ShipLoadout.ts:507-641`): speed=0.05+tech×0.03; radarRange=600+tech×200
  (**ignores the item's `potency` — latent inconsistency**); shields=tech×30;
  repairRate=1+tech×0.5; fuel=50+potency; weaponDamage=Σ damage×micromodule×hullMult.
  **No consumers exist for weapon `range` (turn combat uses adjacency; flight uses fixed
  logic), no fire-rate/regen dimensions.**
- **HangarPanel** (`src/presentation/ui/HangarPanel.ts`, 1079 lines): title + hull banner
  (:248), stats strip МАССА/СВОБОДНО/СКОРОСТЬ/ЗАЩИТА (:315 — the budget readout already
  exists), 4 category banks (:357), hull-micromodule bank (:563), СКЛАД+ТРЮМ right column
  (:861), draggable micromodule tray (:635-853). All mutations via `GearBridge` helpers.
  Mounted by BOTH `StationScene` and `EquipmentShopScene` АНГАР tab — one shared component,
  never fork fit logic.
- **Layout pins**: `src/tests/presentation/HangarPanel.test.ts` (bank labels/counts :161,
  warehouse button spacing :237-263, over-mass toast :265, `explainInstallBlock` strings
  :299), `hangarLayout.test.ts`, `shopHangar.test.ts` — the rework rewrites these.
- **Shop tech-gating gap**: `ShopGenerator.generateShop` accepts `maxTechLevel`
  (`ShopGenerator.ts:44,61,76`; stockChance :54, rare ×0.5). `StationScene` threads
  `starSystem.techLevel` correctly (:270-299, RESEARCH_LAB +1); **`EquipmentShopScene.
  buildShopInventory` (:232-243) does NOT pass `maxTechLevel`** — planet shops ignore
  `systemTechDistribution` and can stock any tech.
- **Micromodules**: item-micromodules ×12 (4 cat × 3 tiers, one per fitted item) +
  hull-micromodules ×10; `MicromoduleApplyPanel` shared modal; CRAFT_CENTER shop.
- **Icons**: gear renders as TEXT today. `src/assets/icons/` already has 6 WebP module icons
  (engine, fuel_tank, laser, radar, repair_droid, shield) generated from the `icons` category
  in `tools/comfyui/asset_prompts.json` (:200) — **no code consumes them yet**.
- **Stat consumers**: turn combat `CombatSystem.ts:83-131` (damage/ability/cooldownTurns);
  flight `NpcInteractionController.ts:113,149,204` (scanPower, weaponDamage);
  `SpaceFlightScene.ts:356-363` (speed); `LootDropHandler.ts:116` (tractor);
  `playerPower.ts` (maxHull+weaponDamage → adaptive difficulty).
- **Prior art** (completed plans): `20260616-ship-fitting-hangar-rework`,
  `20260623-combat-multiweapon-starter-loadout-shared-hangar`,
  `20260619-equipment-install-and-micromodule-overhaul`, `20260616-dual-hull-unification`.

## Authorizations

- **Layout-pin test rewrite**: the hangar rework necessarily rewrites the HangarPanel/
  hangarLayout/shopHangar layout contracts. License granted by the rework request itself —
  rewrites must preserve MEANING (install/unfit/sell route through ShipLoadout; over-mass
  blocked with a toast; action buttons keep ≥16px vertical clearance / touch targets; fit
  logic never forked into a scene). Domain seams (`GearBridge`, `ShipLoadout`) stay stable —
  the letsplay autopilot arms up through them.
- **Balance-anchor coordination**: any change to existing item stats (weapon damage, hull hp)
  must land TOGETHER with re-tuned `POWER_INDEX_*`/`BATTLE_READY_*` anchors and re-run
  `playerPower.test.ts`, `armUpReserve.test.ts`, and the campaign smoke — do not silently
  shift the campaign difficulty's input scale. Prefer ADDING items over rebalancing existing
  ones.

## Development Approach

- TDD for logic (catalog invariants, derivedStats, new stat consumers, presets, shop gating);
  regular for pure layout code (build, then pin with tests + screenshot verification).
- New tunables in `balance.ts`/catalog data — never at call sites. Money via banking helpers.
- Catalog additions are **catalog data ⇒ load revalidation, no migration** (CLAUDE.md save
  rule); the ONLY persisted addition is loadout presets — an **optional additive field**
  (`.optional()` schema, no version bump). `npm run test:save-compat` after any schema touch.
- Icons follow the station-art pattern (`presentation/CLAUDE.md`): small WebP, eager
  (NOT lazy), `pickVariantKey` + cached `tex()`, graceful fallback when art is missing.
- Touch: all new hit targets through the shared `UiButton`/`touchHitArea` so mobile targets
  stay ≥44px; no hardcoded pixel hit detection.
- One concern per commit; run affected suites per task, full gates at the end.

## Testing Strategy

- **Unit**: catalog invariants, derivedStats math, ShopGenerator gating, preset round-trips,
  new combat-stat consumers (success + error/edge cases each).
- **Real-engine playtest**: shop→buy→install→fight wiring; autopilot arm-up still functions
  against the expanded catalog (`letsplay:ci` + a seeded arm-up playtest).
- **E2E (Playwright)**: hangar ring renders, real-pointer install/unfit/jettison, preset
  switch, both with-icons and text-fallback states; screenshot verification at ≥2 viewports.

## Progress Tracking

- Mark `[x]` immediately; ➕ discovered tasks; ⚠️ blockers; record decisions in-place.

## Implementation Steps

### Task 1: Shop tech-gating fix (prerequisite correctness)
- [x] write red test: `EquipmentShopScene.buildShopInventory` on a techLevel-2 system must not
      stock T4+ gear (mirror the existing `shopGenerator.test.ts` gating through the scene
      path) — `src/tests/presentation/equipmentShopTechGate.test.ts`
- [x] thread `maxTechLevel` from the planet's `starSystem.techLevel` into
      `buildShopInventory` (:232-243), matching StationScene's pattern (no RESEARCH_LAB
      analog exists for `PlanetType` — that bonus is station-only, so planet shops use the
      plain system `techLevel`, defaulting to 1 when no system is found, same as StationScene)
- [x] verify the letsplay arm-up path is unaffected (it already gates via
      `generateSystemListings`, a separate helper untouched by this change); ran
      `letsplay:ci` (108 tests green) to confirm no arm-up regression
- [x] run unit + playtest + letsplay:ci — green before Task 2 (5352 unit + 693 playtest + 108
      letsplay:ci, all green; lint 0 errors; tsc clean)

### Task 2: Catalog invariants + equipment variety wave (fill the families)
- [x] write catalog invariant tests FIRST: unique ids; every `EquipmentClass` has ≥3 items
      spanning the tech ladder; every hull's massCapacity admits a sensible same-tech kit;
      price/mass grow with tech within a family; `rare` items T5+; every item's
      `slotCategoryFor` resolves — `src/tests/equipment/catalogInvariants.test.ts`
- [x] add **GRAPPLE items ×3** (`eq_grapple_i/ii/iii`, T1/T3/T5, potency = capture
      strength/range) and make the `derivedStats` grapple branch real (`grappleStrength` field
      on `DerivedStats`, best-grapple-wins + micromodule scaling)
- [x] extend thin families to ≥3 items each: fuel tanks (`eq_tank`/`eq_tank_ii`/`eq_tank_iii`,
      T1/T3/T6 capacity ladder), radars (`eq_radar_near`/`eq_radar`/`eq_radar_far`), scanners
      (`eq_scanner_near`/`eq_scanner`/`eq_scanner_deep`), repair droids
      (`eq_droid_basic`/`eq_droid`/`eq_droid_nano`), shields
      (`eq_shield_light`/`eq_shield`/`eq_shield_apex`) — each tier a real mass/potency/price
      tradeoff, not a linear clone; added 2 more engines (`eq_engine_light` T2 light /
      `eq_engine_iv` T7 rare)
- [x] fixed the latent `radarRange` inconsistency: `derivedStats` now consumes the item's
      `potency` directly (`eq_radar`'s potency was set equal to the old tech-formula output,
      600+4×200=1400, so shipped values are unchanged); artifact-upgrade scaling (
      `setSlotUpgrades`) is preserved via a tech-level ratio applied to potency (ratio=1 when
      un-upgraded) — this was needed to keep the existing
      `hangarUpgradeRoundTrip.test.ts` pin green (upgrades must still extend radar range)
- [x] wrote derivedStats tests for every new branch/field (radar-potency + grapple, 8 new
      cases in `derivedStats.test.ts`); ran full unit suite (5380 tests green), lint (0
      errors), `tsc --noEmit` (clean), and `npm run test:save-compat` (22 tests green,
      catalog-change revalidation path) — green before Task 3

### Task 3: Weapon variety wave + real consumers for weapon dimensions
- [x] write red tests for the new consumers first: **discovery — this checkbox's premise was
      stale.** Real-time flight combat already has full consumers for both dimensions, landed
      by unrelated prior work (`CombatModule.ts`: `weaponFireIntervalMs()` derives fire cadence
      from `cooldownTurns`, commit `856384c` "pre-charge slow-weapon fire timers"; `pickTargetInRange()`
      / `advancePlayerWeapons()` bound engagement to each fitted weapon's own `range`,
      `npcWeaponRange()` does the NPC side). Coverage already exists and is thorough:
      `src/tests/flight/weaponCadence.test.ts` (14 cases, cadence math) and
      `src/tests/combat/multiWeaponFire.test.ts` (4 cases, per-weapon range gating). Verified
      green against the expanded catalog — no new consumer code needed.
- [x] implement the consumers — pre-existing (see above); confirmed the 6 new weapons drive
      the same real seams (`weaponFireIntervalMs`, `pickTargetInRange`) with no special-casing.
- [x] add 6 new weapons filling the ladder T1–T8 across ENERGY/FRAGMENT/MISSILE with distinct
      identities: T1 `wpn_mining_laser` (ENERGY, low dmg/fast), T2 `wpn_swarm_racks` (MISSILE,
      burst), T4 `wpn_flak_burst` (FRAGMENT, short-range/high-dps burst), T5 `wpn_long_lance`
      (FRAGMENT, low-dps/extreme-range), T7 rare `wpn_disruptor` (ENERGY, EMP), T8 rare
      `wpn_singularity_lance` (MISSILE, HOMING, apex). Catalog now 12 weapons, 4 per class,
      tech ladder T1→T8. New invariant tests in `src/tests/equipment/weaponCatalogInvariants.test.ts`
      (count/class/ladder-span/no-clone/≥2-axes-differ). Pinned `weaponAbilities.test.ts`'s
      exact-count assertions to the new totals (12 / 4-4-4) rather than loosening them to
      open-ended bounds — existing-test-assertion values updated to match the plan-mandated
      catalog growth (flagged for review, not silently done: see iteration notes below).
- [x] coordinate balance anchors: `POWER_INDEX_WEAPON_MAX` (110) and `BATTLE_READY_WEAPON_DAMAGE`
      (30) both already sat above the new ladder's max single-weapon damage (55, tied with the
      pre-existing `wpn_torpedo` — `wpn_singularity_lance` does not raise the ceiling), so no
      anchor retune was needed. Re-ran `playerPower.test.ts` + `armUpReserve.test.ts` (33 tests)
      green to confirm.
- [x] run unit + playtest + letsplay:ci — green before Task 4 (5373 unit + 693 playtest + 108
      letsplay:ci, all green; lint 0 errors/46 pre-existing warnings; tsc clean)

### Task 4: Hangar ring — phase 1 (slot ring, ship view, stat chips, icons)
- [x] built the ring layout in `HangarPanel.renderFittingRing`: a central hull-view box
      (`renderHullArtBox`) flanked by ring zones rendered via a new shared
      `renderRingZone` helper — ВООРУЖЕНИЕ (top, full width, weapon bank) /
      СИСТЕМА ДВИЖЕНИЯ (left column, engine bank + fitted fuel-tank items) /
      СИСТЕМА ОТСЛЕЖИВАНИЯ (right column, radar bank + fitted scanner items) /
      ДОПОЛНИТЕЛЬНОЕ ОБОРУДОВАНИЕ (bottom, full width, remaining equipment-bank items).
      Each zone still renders the unchanged domain `${CATEGORY_LABEL[cat]} used/total`
      header alongside its new group title — VISUAL grouping only, the 4-bank
      `SlotCategory` model (`weapon`/`engine`/`radar`/`equipment`) is untouched; fuel/
      scanner items are equipment-bank members the ring simply displays next to their
      related zone, empty-slot counts stay keyed to the real bank capacity
- [x] restyled the МАССА / СВОБОДНО / СКОРОСТЬ / ЗАЩИТА strip as bordered chips
      (`renderHangarStats`, same `derivedStats` data + text contract, new Graphics
      chip background per stat); hull-micromodule chip bank (`renderHullMicromoduleBank`)
      untouched and still renders above the ring
- [x] wired the 6 existing module icons: new `gearIconKey(gear)` (weapon→laser,
      ENGINE/FUEL_TANK/RADAR/SHIELD/REPAIR_DROID→their icon; SCANNER/GRAPPLE/
      GRAV_TRACTOR→`undefined`, no art yet) + `mountGearIcon` mount it via `tex()`
      (eager `icons/` category, already outside `LAZY_PREFIXES`) into both fitted-slot
      rows (`renderFilledSlot`) and СКЛАД warehouse rows (`renderWarehouseAndCargo`);
      text-only fallback (no icon offset) when the key or the texture is absent —
      always true in unit/Node test environments, which never preload textures
- [x] click-to-install/unfit flow is unchanged — [снять]/[Установить]/[Продать] and the
      micromodule-apply control all still route through the exact same seams
      (`ShipLoadout.removeAt`, `installOwnedGear`, `sellUninstalledGear`,
      `ctx.openMicromoduleApply`); the drag-drop micromodule tray targets the fitted
      slots' `dropZones`, which `renderFilledSlot` still registers (now at the zone's
      x/w instead of the old full-width column) — `micromodule-drag-drop.spec.ts` reads
      zone/chip coordinates live from the render, not hardcoded, so it needed no changes
- [x] no existing layout-pin test needed rewriting — every pinned text/behavior
      assertion (`HangarPanel.test.ts`, `hangarLayout.test.ts`, `shopHangar.test.ts`,
      `shipyardParity.test.ts`, `hangarPanelFontScaleLayout.test.ts`, all 28 tests)
      stayed green because the ring is additive over the unchanged bank labels/counts/
      button seams; added a new pinning block instead (19 new assertions total in
      `HangarPanel.test.ts`: the 4 ring group titles render, a fitted fuel tank renders
      above a fitted shield (movement zone precedes the bottom zone), the central hull
      box shows the bare hull name distinct from the "Корпус:" banner, and `gearIconKey`'s
      full mapping table). Regenerated `cyrillicBaseline.json` for the 4 new Cyrillic
      zone-title literals in `HangarPanel.ts` (41→45; file already an established
      hardcoded-Cyrillic panel, not on the i18n-migrated list). E2E real-pointer
      install/unfit + 2-viewport screenshot verification: [x] manual test (skipped —
      this session's Bash sandbox blocks outbound `curl`/Playwright `webServer` readiness
      probes to `localhost`/`127.0.0.1` even with `NO_PROXY`/`--noproxy` set, so
      Playwright cannot be driven headlessly here; `e2e/micromodule-drag-drop.spec.ts`
      and `e2e/specs/shipyard-hangar-parity.spec.ts` already exist and read live
      zone/chip coordinates rather than hardcoded ones, so they should exercise the new
      ring geometry unchanged — needs a real run outside this sandbox to confirm)

### Task 5: Hangar ring — phase 2 (СКЛАД, ТРЮМ, ШЛЮЗ, СЕРВИСНЫЙ ЦЕНТР)
- [x] СКЛАД column (left): owned-uninstalled gear with icons, [Установить]/[Продать] (reuse
      the row seams; keep the ≥16px button-clearance contract) — **discovery: already landed**
      by Task 4 (`renderWarehouseAndCargo`'s icon wiring + the existing install/sell row seams);
      no new code needed for this checkbox, just verified it's still intact.
- [x] ТРЮМ strip (bottom): cargo goods with quantities; scrollable when overflowing —
      **discovery: already landed** pre-Task-5 (`renderWarehouseAndCargo`'s cargo block +
      `wireScrollRegion` on the shared `rightContent` column, which covers both СКЛАД and ТРЮМ);
      verified still intact.
- [x] ВЫБРОСИТЬ/ШЛЮЗ zone: jettison owned gear AND cargo — reused the already-landed
      `jettisonOwnedGear` (`GearBridge.ts`) and `Inventory.removeResource` (both landed by
      `ui-flight-bugfixes` Task 2 for `InventoryScene`, confirmed via that plan's completed
      copy — no re-implementation needed). Added a `[Выброс]` action to each owned СКЛАД row
      (third stacked action below Установить/Продать) and each ТРЮМ resource row, each arming
      a two-step `pendingJettison` confirm on the `HangarPanel` instance (mirrors
      `InventoryScene`'s `requestJettisonConfirm`/`cancelJettisonConfirm`/`confirmJettison`
      pattern) — a second `[Выбросить]` click is required, `[Отмена]` disarms it; no credit
      grant either way.
- [x] СЕРВИСНЫЙ ЦЕНТР block: hull repair status + [Полный ремонт <cost>₡] — **discovery: the
      "single-sourced `repairCost` seam (campaign Task 6/7 landed it)" premise was stale**,
      like Task 3's weapon-consumer premise. Task 6/7's `repairCost()` is a **dev-only**
      letsplay helper (`src/tests/playtest/letsplay/engineQueries.ts`), not a production seam;
      `StationScene.doRepair` and `PlanetScene.openGarage` still price repairs independently
      (8 cr/HP×discount vs 2 cr/HP) and neither was touched here (out of this task's blast
      radius — retuning either is a separate balance-anchor concern per the plan's
      Authorizations). Added the real production seam: `repairCost(status, ratePerHp = 2)` in
      `src/systems/equipment/hullStatus.ts` (pure, alongside `hullStatus`), and a new
      `HangarPanel.renderServiceCenter` block (rendered below ТРЮМ in the same scrollable right
      column) that syncs the live ship to the loadout max (`applyLoadoutHullToShip`, same as
      the planet Верфь), reads `hullStatus`, and either shows «Ремонт не требуется» (perfect) or
      a `[Полный ремонт <cost>₡]` button that pays via `adjustPlayerCredits`
      (`GL_COUNTERPARTY.SERVICES`) and sets `ship.hullHP = ship.maxHull` — toasts
      "недостаточно средств" and no-ops when unaffordable.
- [x] tests: jettison unit + repair block states — `src/tests/presentation/HangarPanel.test.ts`
      (7 new cases: arm/confirm/cancel/no-refund for gear, resource jettison, perfect/damaged/
      unaffordable repair states) and `src/tests/presentation/hullRepairConsistency.test.ts` (4
      new `repairCost` cases: null-when-perfect, default rate, custom rate, rounding). Existing
      СКЛАД/ТРЮМ/scroll/ring pinning tests across `HangarPanel.test.ts`, `hangarLayout.test.ts`,
      `shopHangar.test.ts`, `shipyardParity.test.ts`, `hangarPanelFontScaleLayout.test.ts` all
      stayed green — the new rows/block are additive over the unchanged bank model. Fixed 2
      test fixtures that constructed a `Player` without a `.ship` field (`HangarPanel.test.ts`,
      `hangarPanelFontScaleLayout.test.ts`) — added an effectively-infinite default hull pool so
      every pre-existing test syncs to a perfect/undamaged hull and never renders a stray repair
      button; `shopHangar.test.ts`'s ship fixture was missing `hullHP` (NaN risk), given a real
      value. Regenerated `cyrillicBaseline.json` for the new hardcoded Cyrillic literals
      (СЕРВИСНЫЙ ЦЕНТР block + jettison buttons), same pattern as Task 4.
      ⚠️ **E2E pointer pass over all four zones: skipped (not automatable here)** — same sandbox
      limitation Task 4 hit (outbound Playwright `webServer` probes blocked); additionally, the
      real-engine playtest harness's `pixiStub.ts` `.on()` is a total no-op (doesn't record
      handlers), so simulated pointer clicks aren't reachable through that harness either — the
      established precedent for ALL of HangarPanel's install/sell/unfit wiring (Tasks 3-4) is
      the same mocked-pixi unit tier used here, with zero prior real-click-through playtest
      coverage to match. Needs a real run outside this sandbox to confirm.
      Full unit suite green (5389 tests, 0 failed), `test:playtest` (693 tests), `test:save-compat`
      (22 tests, no schema change — no new persisted field), lint (0 errors), `tsc --noEmit`
      (clean) — before Task 6.

### Task 6: КОМПЛЕКТАЦИЯ 1/2/3 — loadout presets
- [x] design: presets store gear-id layouts (slots + micromodules), NOT copies — applying a
      preset re-installs from owned gear via the normal install path (missing/sold items skip
      with a toast; mass/slot rules enforced by the engine, never bypassed). `LoadoutPreset`
      (`src/types/index.ts`) + pure helpers in `GearBridge.ts`:
      `captureLoadoutPreset`/`upsertLoadoutPreset`/`removeLoadoutPreset`/`applyLoadoutPreset`.
      `applyLoadoutPreset` first returns every currently-fitted item to the bag (preserving its
      micromodule/upgrades via the existing `slotToBagModule`, same as the hangar's [снять]),
      then re-installs each preset slot's gearId from whichever owned store has it (legacy bag
      preferred when it carries a matching micromodule, else `ownedGearIds`) through the normal
      `ShipLoadout.install`, so slot/mass caps are never bypassed. Hull micromodules are never
      touched by apply (canon: a fitted one can't be removed) — a preset can only add one to a
      free hull slot, never swap.
- [x] persist as an **optional additive** save field (`loadoutPresets?`), `.optional()` in
      `src/validation/schemas.ts` (`LoadoutPresetSchema`, capped at 3), threaded through
      `SaveState`/`GameEngine.playerLoadoutPresets` (save/load, reset to `[]` on new game) —
      no migration, no version bump; `test:save-compat` stays green.
- [x] preset tabs 1/2/3 in the hangar header: save-current / apply / clear; disabled states
      when empty. `HangarPanel.renderPresetTabs` — top-right of the header (free space beside
      the centred hull banner): each tab shows `К{n}:` + `[Сохр]`/`[Прим]`/`[X]`; `[Прим]`/`[X]`
      render dim with no `pointerdown` handler wired (matching this file's existing
      disabled-button convention, e.g. the micromodule-apply prompt) when that slot has no
      saved preset. `HangarPanelContext` gained `presets`/`mutatePresets`, wired identically in
      both `StationScene` and `EquipmentShopScene` from `gameEngine.playerLoadoutPresets`.
- [x] tests: `src/tests/equipment/loadoutPresets.test.ts` (11 cases — capture, upsert/remove
      array helpers incl. tab-order-preserving replace, round-trip apply after a gear swap,
      micromodule preservation across unfit/re-apply, partial-availability skip (sold gear),
      never-force-fits-over-slot-caps, schema optional/cap-at-3 round-trip) +
      `HangarPanel.test.ts` (6 new cases: tab rendering, save wiring, apply-disabled-when-empty,
      apply re-fits through the canonical loadout, clear wiring, clear-disabled-when-empty).
      Golden-save gate green (no new fixture needed — additive optional field, no version bump).
      Regenerated `cyrillicBaseline.json` for the new hardcoded Cyrillic literals (tab
      labels/toasts), same pattern as Tasks 4–5.
- [x] run unit + save-compat + E2E preset switch — unit (5406 tests), `test:playtest` (693),
      `test:save-compat` (22), lint (0 errors, 46 pre-existing warnings), `tsc --noEmit` clean —
      all green. ⚠️ **E2E preset switch: skipped (not automatable here)** — same sandbox
      limitation Tasks 4–5 hit (outbound Playwright `webServer` readiness probes blocked); needs
      a real run outside this sandbox to confirm.

### Task 7: Gear icon art category (per-item icons)
- [x] extended the `icons` category in `tools/comfyui/asset_prompts.json`: one prompt per
      weapon class×tier (`wpn_energy/fragment/missile_low/mid/high`) and equipment
      family×tier (`eq_engine/fuel_tank/radar/scanner/repair_droid/grapple/shield/
      grav_tractor_low/mid/high`) — 27 new id-keyed prompts (hulls deferred: the central
      hull-view box already renders via the existing per-hull ship-art pattern, not a
      generic icon, so no new prompt axis was needed there)
- [x] integration: `src/presentation/ui/gearIcon.ts` — new shared `gearIconKey(gear)` +
      `mountGearIcon(container, gear, x, y, size)`, resolving a per-item
      `wpn_<class>_<tier>`/`eq_<family>_<tier>` key (tier bucketed low/mid/high from
      `techLevel`) via `pickVariantKey` + cached `tex()` (eager `icons/` category), falling
      back to the flat family icon (today's 6 shipped WebPs), then to `undefined` (text-only).
      `HangarPanel` now imports this shared module instead of its own local
      `gearIconKey`/`mountGearIcon` (deleted the fork, re-exports `gearIconKey` for the
      pinned test import); `EquipmentShopScene.renderRows` wired the same `mountGearIcon`
      call so shop listings show icons identically to the hangar. `src/tests/presentation/
      gearIcon.test.ts` (13 cases: exact prefix per weapon/equipment tier bucket, flat
      fallback, text-only fallback, mount no-op/mount-with-texture) +
      `equipmentShopGearIcon.test.ts` (2 cases: one `mountGearIcon` call per row, name
      offset by consumed width) — both green
- [x] manifest key-parity snapshot: no update needed — Task 7 only lands prompts (art
      generation is the separate Post-Completion GPU step), so no new files exist under
      `src/assets/icons/` yet and the live manifest is unchanged; the "no-art state stays
      fully functional" contract is exactly what `gearIcon.test.ts`'s fallback-to-flat-icon
      and text-only cases pin
- [x] E2E: attempted `npx playwright test e2e/specs/shipyard-hangar-parity.spec.ts` —
      **blocked (not automatable here)**, same sandbox limitation Tasks 4–6 documented
      (`config.webServer` readiness probe to `127.0.0.1` times out after 120 s under this
      session's outbound-network sandboxing); needs a real run outside this sandbox to
      confirm shop + hangar render correctly with and without the new art
- [x] run unit + e2e — unit green: full suite 5412/5427 passed (12 skipped), the 3 failures
      (`assetManifest.test.ts`, `manifestKeySnapshot.test.ts`) are pre-existing and belong to
      an unrelated concurrent in-flight task on this branch (nebula backdrop visual tuning —
      uncommitted changes to `balance.ts`/`SpaceBackgroundLayer.ts`/`optimize-assets.ts` plus
      untracked `src/assets/nebula/*.webp`, none touched by this task); all Task-7-scoped
      files (`gearIcon.test.ts`, `equipmentShopGearIcon.test.ts`, `HangarPanel.test.ts`,
      `hangarLayout.test.ts`, `shopHangar.test.ts`, `shipyardParity.test.ts`, 52 tests) pass
      in isolation, lint 0 errors (46 pre-existing warnings), `tsc --noEmit` clean; e2e
      flagged skipped above — before Task 8

### Task 8: Autopilot + campaign compatibility gate
- [ ] seeded playtest: autopilot arm-up against the EXPANDED catalog picks sensible gear
      (best affordable damage/hull path still reachable; `planArmUp`/`armUpCost` behave with
      more candidates)
- [ ] run `letsplay:ci` + a campaign smoke (5–10 sessions): no regression in battle-ready
      day / win-rate vs the pre-plan baseline; record numbers in this plan
- [ ] verify power-index distribution didn't shift (adaptive difficulty inputs stable or
      anchors re-tuned deliberately in Task 3)
- [ ] run full unit + playtest suites — green before Task 9

### Task 9: Verify acceptance criteria
- [ ] hangar matches the reference structure: ring + масса/свободно + склад + трюм + шлюз +
      сервисный центр + комплектации — screenshot evidence at 2 viewports, both art states
- [ ] every equipment family ≥3 items, weapons ≥12 total, grapple family exists, all catalog
      invariant tests green
- [ ] full test suite, `npm run test:playtest`, `npm run letsplay:ci`,
      `npm run test:save-compat`, `npm run test:e2e:regression`, `npm run lint` — all green
- [ ] load a pre-plan golden save: loads, revalidates loadout, hangar opens correctly

### Task 10: [Final] Update documentation
- [ ] update `.claude/docs/systems/equipment.md` (new families/dimensions, ring UI, presets,
      icon pattern) + `src/presentation/CLAUDE.md` hangar section
- [ ] update `docs/requirements` reference if the equipment model description changed
- [ ] record final catalog counts + any balance-anchor changes in this plan

## Technical Details

- **Ring is presentation-only**: domain `SlotCategory` (weapon/engine/radar/equipment) is
  untouched; the ring's four visual groups map onto it (движение = engine slot + fuel items
  from the equipment bank; отслеживание = radar slot + scanner items; доп = remaining
  equipment-bank items). No schema impact.
- **Presets**: `{ name: "1"|"2"|"3", slots: Array<{gearId, micromoduleId?}>, hullMicromoduleIds }`
  — ids only; apply = sequential `install` calls with normal validation.
- **New stat consumers land WITH their data** (Task 3) so no dead dimensions are added; any
  dimension we choose not to consume does not get a field.
- **Icon keys**: mirror station-art (`stationSpriteKey`) — `gearIconKey(item)` resolves
  family/tier prefix; art lands separately and lights up automatically via the Vite glob
  manifest.

## Post-Completion

**External art generation (user-driven):** generate the Task 7 icon set + hull views on the
ComfyUI box (oleg@192.168.88.193) from `asset_prompts.json`; `tools/optimize-assets.ts`;
commit manifest snapshot additions.

**Manual verification:** live hangar feel-pass (drag, click, touch targets on mobile layout);
icon readability against the panel background; preset workflow with a real progressed save.
