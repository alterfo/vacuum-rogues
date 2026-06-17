---
# Mouse-Wheel Scrolling Everywhere + Sell Uninstalled Gear

## Overview
Two equipment/hangar UX gaps. (1) **Mouse-wheel scroll doesn't work** in the
equipment shop — it relies on a PixiJS *federated* `wheel` handler bound to the
backdrop, which the list rows (eventMode `static`) sitting on top swallow, so the
wheel never reaches the scroll logic. The repo already has a **working** pattern —
SpaceFlightScene uses a **window-level** `wheel` listener (`addEventListener("wheel",
…, {passive:false})`). This plan extracts that into a reusable helper and wires it
into **every** scrollable list so the wheel works consistently. (2) **You can't sell
owned-but-uninstalled gear.** After the dual-hull unification, installed gear lives
in `ShipLoadout`, but there is no canonical store for gear the player owns yet hasn't
fitted (code comments call it "the legacy bag … not canonical yet"). This plan gives
owned-uninstalled gear a real home, **shows it as cargo-hold (ТРЮМ) content**, and
adds a **sell** action (refund at the existing `basePrice × 0.4` trade-in rate).

## Context
- **Broken scroll:** `src/presentation/EquipmentShopScene.ts:254`
  `backdrop.on("wheel", …)` (federated, unreliable). Scroll state: `scrollOffset` +
  `addScrollButtons`.
- **Working pattern:** `src/presentation/SpaceFlightScene.ts:491` window-level
  `wheel` listener with add/remove lifecycle (`boundWheel`, removed in `destroy`).
- **Other scrollable lists:** `StationScene` (shop + hangar inventory), `InfoCenterScene`,
  `JobBoardPanel` (already has a federated `container.on("wheel")` at L222 — same
  unreliability), `MainMenuScene` (saves list).
- **Gear stores (post-dual-hull):** `ShipLoadout.installedGearIds()` = installed;
  owned-uninstalled is currently ad-hoc (`StationScene` ~L1519/L1583 comments flag
  "no canonical uninstalled-gear store"). `GearCatalog.gearById(id).basePrice` for
  pricing; existing trade-in `Math.floor(basePrice * 0.4)` at `StationScene:914`.
- **Cargo/ТРЮМ view:** rendered in `StationScene` hangar and `EquipmentShopScene`
  (`renderLoadoutStrip`). `Player`/`Inventory` hold the resource cargo today.
- **Tests:** interaction/visual behaviour → `e2e/` regression (`playtest-regression.spec.ts`);
  pure pricing/store logic → unit tests. Do not modify existing assertions; add new.

## Development Approach
- **Testing approach: TDD / regression-first** per repo rule. Wheel + UI behaviour is
  proven with an E2E regression test (red first); pure logic (owned-uninstalled
  derivation, sell pricing/removal) with unit tests.
- **Orthogonality:** one reusable wheel helper consumed by every scene (no per-scene
  copy); a single owned-uninstalled-gear accessor both UIs read — no divergent stores.
- Domain stays PixiJS-free; the wheel helper lives in presentation.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: owned-uninstalled = owned − installed; sell refund math; store removal.
- E2E regression: wheel scrolls each list (shop, hangar, info center, job board);
  selling an uninstalled item refunds credits and removes it from the ТРЮМ view.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep this file in sync.

## Implementation Steps

### Task 1: Reusable window-level wheel-scroll helper
**Files:**
- Create: src/presentation/ui/WheelScroll.ts (`attachWheelScroll(onScroll: (dir: 1|-1)
  => void): () => void` — adds a `{passive:false}` window `wheel` listener, returns a
  detach fn; pure `wheelDirection(deltaY)` helper exported for unit test)
- Create: src/tests/presentation/wheelScroll.test.ts

- [x] implement `wheelDirection(deltaY)` (>0 → 1, <0 → -1, 0 → 0) and the
      attach/detach lifecycle
- [x] write unit tests for `wheelDirection` (positive/negative/zero)
- [x] run affected tests — must pass before next task

### Task 2: Wire wheel scroll into every scrollable scene
**Files:**
- Modify: src/presentation/EquipmentShopScene.ts (replace the federated
  `backdrop.on("wheel")` with the helper; detach in `destroy`)
- Modify: src/presentation/StationScene.ts, src/presentation/InfoCenterScene.ts,
  src/presentation/JobBoardPanel.ts, src/presentation/MainMenuScene.ts (same)
- Modify/Create: e2e regression spec asserting wheel scrolls a list

- [x] each scrollable scene attaches the helper to its scroll method and detaches on
      destroy/close (no leaked listeners) — EquipmentShopScene, StationScene (shop view),
      InfoCenterScene (news tab), JobBoardPanel; MainMenuScene has no scrollable list
      (single-slot "Continue"), so nothing to wire there
- [x] remove the now-dead federated `wheel` handlers (EquipmentShopScene backdrop.on,
      JobBoardPanel container.on); migrated jobBoardScroll.test.ts to the window listener
- [x] add an E2E regression assertion that the equipment-shop list scrolls on wheel
      (playtest-regression.spec.ts: real page.mouse.wheel drives scrollOffset to the clamp + back)
- [x] run affected tests + regression — must pass before next task (lint 0 errors, tsc clean,
      21 affected unit tests green, 17/17 e2e regression green)

### Task 3: Canonical owned-uninstalled-gear store
**Files:**
- Modify: src/domain/Player.ts or src/domain/Inventory.ts (a typed `ownedGearIds`
  list — gear owned but not installed); src/validation/schemas.ts (persist it)
- Modify: src/systems/equipment/GearBridge.ts (helper `ownedUninstalledGear(player,
  loadout)` = owned − installed)
- Create: src/tests/equipment/ownedGear.test.ts

- [x] purchases/loot that aren't auto-installed land in `ownedGearIds`; installing
      moves an id from owned → loadout; uninstalling moves it back
      (mechanism: `Inventory.addOwnedGear`/`removeOwnedGear` + GearBridge
      `acquireUninstalledGear`/`installOwnedGear`/`uninstallToOwned`; the
      EquipmentShop/Station call-sites are wired in Task 4 per its Files list)
- [x] schema-mirror the new field (save compatibility; default empty for old saves)
      (`InventorySchema.ownedGearIds: z.array(z.string()).default([])`)
- [x] write tests: owned − installed derivation; install/uninstall transitions
      (src/tests/equipment/ownedGear.test.ts, 15 cases)
- [x] run affected tests — must pass before next task (180 unit tests green across
      data/equipment/inventory/loadout-persistence suites; lint + tsc clean)

### Task 4: Show uninstalled gear in ТРЮМ + sell action
**Files:**
- Modify: src/presentation/StationScene.ts + src/presentation/EquipmentShopScene.ts
  (render `ownedUninstalledGear` in the cargo/ТРЮМ view with a "Продать" button)
- Create: src/systems/equipment/sellGear.ts (`sellGearPrice(gear) = floor(basePrice*0.4)`;
  `sellUninstalledGear(player, gearId)` → refund + remove from store)
- Create: src/tests/equipment/sellGear.test.ts

- [x] uninstalled gear appears as ТРЮМ content; selling refunds `basePrice × 0.4` and
      removes it; cannot sell installed gear
      (`sellGear.ts`: `sellGearPrice`/`sellUninstalledGear`; ТРЮМ strip in
      EquipmentShopScene + hangar section in StationScene with «Продать» (+ «надеть»);
      buy call-sites now park non-installed purchases in `ownedGearIds` via
      `acquireUninstalledGear`; installed gear lives in the loadout, never the owned
      store, so the sell is a no-op for it)
- [x] write unit tests: price, refund, removal, reject-if-installed
      (src/tests/equipment/sellGear.test.ts, 9 cases)
- [x] add an E2E regression assertion for the sell flow
      (playtest-regression.spec.ts: seed owned gear → open shop → REAL click «Продать»
      → credits +1120, item gone from the hold)
- [x] run affected tests + regression — must pass before next task (tsc clean, lint 0,
      452 unit tests green, 18/18 e2e regression green)

### Task 5: Verify acceptance criteria
- [ ] verify Overview: wheel scrolls all listed scenes; uninstalled gear shows in ТРЮМ
      and is sellable at the trade-in rate
- [ ] run full unit suite — all green
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run lint` — clean
- [ ] confirm no existing test assertions changed

## Technical Details
- **Why federated wheel fails:** PixiJS only dispatches `wheel` to the object under
  the pointer; the scrollable rows (`eventMode:"static"`) intercept it and don't
  bubble to the backdrop handler. A window-level DOM listener sidesteps the scene
  graph entirely — the proven SpaceFlightScene approach.
- **Listener hygiene:** the detach fn must run in each scene's `destroy()`/close to
  avoid stacked listeners across scene transitions.
- **Sell price** reuses the existing trade-in rate (`basePrice × 0.4`) for consistency
  with hull/gear swaps; installed gear is never sellable (must uninstall first).

## Post-Completion
**Manual verification:** wheel-scroll the equipment shop, station hangar, info center,
and job board; buy gear without installing, confirm it shows in ТРЮМ, sell it, confirm
the credit refund and that it disappears from the hold.
