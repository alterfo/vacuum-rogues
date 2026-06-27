---
# Playtest Bugs Batch — Planet Backdrop, Hull Desync, Target-Lost, Pause-Circle

## Overview
A batch of live-playtest bugs (2026-06-27) to fix **after** the running ralphex
job (quest-card/ship-explosion) finishes, so concurrent edits don't race its
commits on `feat/planet-backdrop-variety`:

1. **Planet menu backdrop too dark** — the dim overlay behind the on-planet menu
   hides a nice planet background; lighten or drop it.
2. **Hull % vs "perfect" desync** — the planet shows hull 71% but pressing Верфь
   (repair) says "Корпус уже в идеальном состоянии". Two `maxHull` reads disagree.
3. **"Цель потеряна" doesn't stop the turn** — losing a chase target leaves the
   turn running; it should end.
4. **Ship circles during the active pause** — already fixed in code (`be7b59d`:
   pause-freezes ship-sync + camera + anti-spin orbit guard); verify it's resolved
   on a current-branch build (the report is likely the stale Service-Worker/preview
   build) and only add work if a residual case reproduces.

Presentation/logic only — no domain/schema/save change expected.

## Context
- **#1 backdrop:** the on-planet menu/overlay dim layer in `src/presentation/PlanetScene.ts`
  (a full-screen `Graphics` `fill({color:0x..., alpha})` behind the menu). Lower the
  alpha (or remove) so the planet art reads through; keep menu text legible.
- **#2 hull desync:** `PlanetScene.ts:1092` renders `Math.round(ship.hullHP/ship.maxHull*100)`
  (= 71%), while the repair action at `:1519-1522` computes `missing = ship.maxHull - ship.hullHP`
  and shows "Корпус уже в идеальном состоянии" when `missing <= 0`. Same fields ⇒
  the only way both are true is two **different `maxHull` values** at the two reads
  (live `PlayerShip.maxHull` vs a loadout-derived `derivedStats().maxHull` /
  `applyLoadoutHullToShip`). Also `EquipmentShopScene.ts:417` mislabels the HP
  read-out as `HP: ${player?.ship.maxHull}` (shows max, not `hullHP/maxHull`).
  Canonical hull source: the `ShipLoadout`/`derivedStats` per the equipment rules
  (root CLAUDE.md "Equipment System: ShipLoadout is Canonical").
- **#3 target-lost:** `src/presentation/flight/NpcShipManager.ts` `updateCombat`
  case `"lost"` (`:1931-1933`) does `showMessage("Цель потеряна") + followNpcId = null + return`
  — it does NOT call `this.deps.endTurn()` (cf. the shakedown hail at `:1535` which
  does freeze the turn). The scene wires `endTurn` via `NpcShipManagerDeps.endTurn`.
- **#4 pause-circle:** `SpaceFlightScene.ts:577-595` already gates `playerShip.update`
  + `camera.update` on `combatPause.paused`, plus the `steerCombatOrbit` anti-spin
  guard (`be7b59d`). So the code is fixed; the report predates it on the deployed/
  preview build. Verify on a fresh build before doing any work.

## Development Approach
Regression-first. #2 and #3 are logic bugs → unit/playtest tests asserting the
observable fix (display==repair agree on hull; a lost target ends the turn). #1 is
visual → screenshot verify (+ a cheap assert on the overlay alpha if a constant is
extracted). #4 is verify-only unless reproduced. Each fix routes through the
existing canonical source (hull via `ShipLoadout`/`derivedStats`; turn via
`endTurn`) — no new plumbing. Complete + test each task before the next.

## Implementation Steps

### Task 1: Lighten/remove the on-planet menu backdrop
**Files:**
- Modify: src/presentation/PlanetScene.ts
- Create/Modify: src/tests/presentation/planetBackdrop.test.ts (if an alpha constant is extracted)

- [x] Lower the dim-overlay alpha behind the planet menu (or remove the overlay) so the planet background art shows through, keeping menu text legible (lift to a legible floor only where needed). (0.55 → 0.28; menu's per-row dark panels carry text contrast)
- [x] If practical, extract the overlay alpha to a named constant so it is assertable. (`PLANET_BACKDROP_OVERLAY_ALPHA`, exported)
- [x] Write a test asserting the backdrop alpha is at/below the new (lighter) threshold (if extracted); otherwise rely on the screenshot check in Task 5. (added to `planetSceneBackdrop.test.ts`)
- [x] Run tests — must pass before Task 2.

### Task 2: Single hull source of truth (fix 71% vs "perfect")
**Files:**
- Modify: src/presentation/PlanetScene.ts (hull % display + repair check read the same maxHull)
- Modify: src/presentation/EquipmentShopScene.ts (correct the `HP:` label)
- Create: src/tests/presentation/hullRepairConsistency.test.ts

- [x] Make the planet hull-% display and the repair "missing/perfect" check read the **same** canonical hull values (the `ShipLoadout`/`derivedStats` `maxHull` per the equipment rules), so a 71% hull never reports "perfect". (new pure `hullStatus(hullHP, shipMaxHull, loadoutMaxHull?)` helper prefers the loadout-derived max; display + `openGarage` both route through it, and `openGarage` first `applyLoadoutHullToShip`-syncs the live ship so `repair()` fills to the canonical max)
- [x] Fix `EquipmentShopScene:417` to show `hullHP/maxHull` (current/max), not just `maxHull`. (now `HP: ${hullHP}/${maxHull}` using `derivedStats().maxHull`)
- [x] Write tests: at 71% hull the repair path reports a positive `missing` (repairable) and the display % matches the repair's view; at full hull it reports "perfect". (`src/tests/presentation/hullRepairConsistency.test.ts` — 6 tests incl. a real ShipLoadout + defense micromodule desync→sync flow)
- [x] Run tests — must pass before Task 3. (hullRepairConsistency 6/6, equipment suite 260/260, tsc + eslint clean)

### Task 3: "Цель потеряна" ends the turn
**Files:**
- Modify: src/presentation/flight/NpcShipManager.ts (updateCombat case "lost")
- Create/Modify: src/tests/combat/targetLostEndsTurn.test.ts

- [x] In the `"lost"` case, call `this.deps.endTurn()` (in addition to the message + clearing `followNpcId`) so losing a chase target stops the running turn — mirroring the shakedown-hail freeze. (added after clearing `followNpcId` in `updateCombat`)
- [x] Write a test: a chase whose target becomes unreachable/destroyed drives `updateCombat` to the `"lost"` branch and invokes `endTurn` exactly once (turn no longer running). (`src/tests/combat/targetLostEndsTurn.test.ts` — lost ⇒ endTurn once + cleared follow id; a live chase ⇒ no endTurn)
- [x] Run tests — must pass before Task 4. (targetLostEndsTurn 2/2, npcShipManager 15/15, flightCombatResolver + targetLostRepause green; tsc + eslint clean)

### Task 4: Verify pause-circle is resolved (no new code unless reproduced)
**Files:**
- Verify only: src/presentation/SpaceFlightScene.ts, src/presentation/flight/NpcShipManager.ts

- [ ] Confirm on a current-branch build that the ship no longer circles during the active combat pause (the `be7b59d` freeze + anti-spin guard); the original report is almost certainly the stale build.
- [ ] If a residual circling case reproduces on current code, capture it as a red regression (real-engine playtest) and fix; otherwise mark resolved (no code change).
- [ ] Run tests — must pass before Task 5.

### Task 5: Looted gear lands in the gear inventory (not converted to metal)
**Files:**
- Modify: src/presentation/flight/NpcShipManager.ts (applyLootPickup)
- Create: src/tests/combat/lootGearToInventory.test.ts

- [ ] In `applyLootPickup` (`:1389-1392`) a loot item with a real `moduleId` (a fitted-gear drop like `eq_tank`/`grav_tractor_1`) must be added to the **gear inventory** (`acquireUninstalledGear` → `ownedGearIds`, or the `inventory.modules` bag via `slotToBagModule`), NOT silently turned into `addResource(METALS, 1)`. Keep the resource/artifact path for non-gear drops.
- [ ] Respect a real capacity limit appropriate to gear (don't drop gear on the floor because the *resource* hold is full — gear isn't resource cargo); leave the drop in space only if genuinely unstorable.
- [ ] Write a test: killing an NPC that drops gear, then picking it up, leaves that gear id in the player's gear inventory (visible in the hangar ТРЮМ), and a resource drop still adds a resource.
- [ ] Run tests — must pass before Task 6.

### Task 6: Verify acceptance criteria
**Files:**
- Modify: docs/plans/20260627-playtest-bugs-planet-hull-target-pause.md (check off items)

- [ ] Full unit suite + `npm run test:playtest` + `npm run lint` green; per-scene line guards intact.
- [ ] Screenshot-verify: planet background reads through the lightened menu backdrop; planet hull % and the Верфь/repair agree; a lost chase target stops the turn; no circling during the active pause.

## Post-Completion
*Informational — no checkboxes:*
- Fix this batch **after** the running ralphex job completes (or on a separate branch) to avoid racing its commits on `feat/planet-backdrop-variety`.
- #4 (pause-circle) is expected to be already-fixed; if the tester saw it live, a redeploy (SW cache bust `6e4642a`) / hard reload resolves it.
