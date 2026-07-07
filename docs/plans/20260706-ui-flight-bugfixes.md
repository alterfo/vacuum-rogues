# Flight/UI Bug-Fix Pack: 8 playtest-found bugs

## Overview

Eight bugs found by the user during live play (2026-07-06/07), all UI/UX-level except two
flight-physics seams. Each follows the CLAUDE.md regression-first process: red test → fix → green → visual
verification by screenshot for the visual ones.

1. **[Межзвездная карта] overlapped by the "?" help button** — replace the text button with a
   compact icon button positioned clear of the help corner.
2. **Inventory menu has no functionality** — add jettison-to-space and move-to-hold verbs.
3. **HUD clutter** — remove the camera zoom/pan debug text near the minimap; drop time-of-day
   from the date display; move [МЕНЮ] to the bottom-left corner.
4. **Ship always enters a system at the same angle** — it must arrive on the heading it
   departed with.
5. **BOUNTY («Охота») quests lack the «Проложить маршрут» button** — route to the hunted
   ship's system.
6. **InfoCenter search finds nothing** — the index only covers NPC-ship + planet names and
   keystrokes are dropped outside the ОБЪЕКТЫ tab.
7. **Star-map purchase gives no balance/purchase feedback** — credits ARE deducted in the
   domain immediately, but the planet-scene balance HUD is a one-shot snapshot and never
   refreshes, and the toast says only «Открыто систем: N» without confirming the purchase.
8. **Take-off from shipyard/station spawns the ship at the EDGE of the system** (reported
   2026-07-07) — the ship should reappear beside the station it undocked from.

**Sequencing constraint:** the three-year-campaign ralphex run is active on this branch.
Run THIS plan only after that run stops/completes (never two ralphex instances on the same
files). Bug 4 edits `SpaceFlightScene.performWarp`, which that run has touched — rebase
understanding on the committed state before starting Task 4.

## Context (from discovery — file:line pointers)

- **Bug 1**: star-map button `src/presentation/flight/FlightHud.ts:758-788` (`x = w-220, y=20`,
  re-anchored in `reposition` :378-381); "?" is the contextual-help button
  (`src/presentation/flight/flightSceneHelp.ts:28-33`) placed by
  `helpButtonRect(screenWidth)` in `src/presentation/ui/mountSceneHelp.ts:93-105` at
  `x = w-46, y = 12`, size 34. `helpButtonRect` is documented as the corner zone other
  top-right HUD elements must avoid — the star-map button doesn't consult it.
- **Bug 2**: `src/presentation/InventoryScene.ts` is deliberately read-only (docstring :11-20;
  loadout cards :209-270; close button only). Reusable action-row pattern:
  `src/presentation/ui/HangarPanel.ts:861-991` (СКЛАД rows with [Установить]/[Продать]) using
  `installOwnedGear` (`src/systems/equipment/GearBridge.ts:182`), `sellUninstalledGear`
  (`src/systems/equipment/sellGear.ts:35`), `ownedUninstalledGear` (`GearBridge.ts:95`).
  Domain: `src/domain/Inventory.ts` — gear `ownedGearIds` :27 (`removeOwnedGear` :60-67),
  goods `resources` :18 — **no `removeResource`/jettison method exists**.
- **Bug 3a**: camera debug text `FlightHud.ts:616-628` (created, `__DEBUG__`-gated),
  `:355-359` (`setCameraDebug`), `:366-374` (positioning).
- **Bug 3b**: `FlightHud.ts:1393-1399` (`updateDayCounter`) uses `formatGameTimestamp`
  (date + HH:MM, `src/utils/gameCalendar.ts:63-71`); clock-free `formatGameDate` at :51-54.
- **Bug 3c**: `menuBtn` created `FlightHud.ts:728-756` at `(20,20)`, NOT in `reposition`
  (:377-399). Top-left stack below it: [КВЕСТЫ] y=80, [I] y=110, [?] y=140 (:643-726).
- **Bug 4**: heading hard-reset — `ShipPhysics` constructor sets `shipAngle = 0`
  (`src/systems/ShipPhysics.ts:55`, field :9, public). Entry spawn:
  `SpaceFlightScene.ts:338-362` (fresh `ShipPhysics(entryX, entryY, cruise)`; no angle seam).
  Departure knows the heading: `performWarp` `SpaceFlightScene.ts:1406-1464` —
  `pendingWarp.exitVector` (:1427) → passes `{ entryVector, warpArrival }` (:1457-1463),
  position only. Heading is transient (not persisted; `liveFlightShipPos` cleared on warp).
  `SpaceFlightScene.ts` has a < 1900-line guard (`moduleContracts.test.ts`, currently ~1891) —
  new logic goes in `flight/` modules, not inline.
- **Bug 5**: «⇒ Проложить маршрут» exists only on pending-return cards
  (`src/presentation/QuestJournalUI.ts:837-842`, factory :857-903). Active-card nav buttons
  get `navTargetId` only for `VISIT_LOCATION`/`VISIT_SYSTEM`/courier `COLLECT_ITEM`
  (:338-350) — BOUNTY's `DEFEAT_ENEMY` falls through to null. BOUNTY already stores
  `targetSystemId`/`targetPlanetId` (`src/systems/quests/QuestGenerator.ts:825-847,946-947`),
  and resolvers `activeDestination` (:567-579) + `questRouteAction` work for it — no new data
  needed.
- **Bug 7**: purchase flow `src/presentation/PlanetScene.ts:1753-1793` (STAR_MAP_TIERS modal) —
  `adjustPlayerCredits(..., -tier.cost, ...)` at :1768 deducts correctly and immediately; the
  success toast at :1783-1788 reads «Открыто систем: N» / «Новых систем не открыто» (no
  purchase/price confirmation). The credits HUD is built once in setup
  (`PlanetScene.ts:1040-1052`, a `Text` snapshot of `player.credits`, anchored via
  `creditsHudAnchor` :219) and is never updated after the purchase — the stale label is why
  the balance "doesn't decrease". Note: PlanetScene still hardcodes `fontSize:` — per
  presentation CLAUDE.md, route any touched text through `scaledText`.
- **Bug 8**: re-entry spawn paths are `applyReentrySpawn` / `spawnShipBeside`
  (`SpaceFlightScene.ts`, ~1140-1199 pre-campaign-branch) — take-off should spawn beside the
  station/planet. **Prime regression suspect: campaign commit `ee634bc` (Task 9 iv,
  2026-07-07)** — it re-routes `SpaceFlightScene.initialize`'s escape-route block through
  `warpEdgePoint(...)` gated on `lastFlightShipPos != null` (the "mid-system flee" signal).
  If `lastFlightShipPos` is still set when undocking from a station, the take-off re-entry
  may be misclassified as a flee re-plot and routed/spawned toward the nearest system edge.
  Verify against `ee634bc` first (git bisect / disable the gate); the fix likely = clear or
  bypass the mid-system signal on the dock→undock path, not a spawn-code change.
- **Bug 6**: search IS wired: input `InfoCenterScene.ts:1514-1542` (keys accepted **only when
  `activeTab === "objects"`**; default tab is `"news"` :339), executor `runObjectsSearch`
  :1022-1061 → `GalacticRegistry.findShips`/`findPlanet`
  (`src/systems/info/GalacticRegistry.ts:176-254`) — index covers **NPC-ship names and planet
  names only**; systems/goods are not searchable, and procedural ship names are unknowable to
  the player, so natural queries return «Ничего не найдено».

## Development Approach

- **Testing approach**: TDD — every bug starts with a red regression test at the right tier
  (CLAUDE.md): pure logic → unit; wiring → real-engine playtest; visual/pointer → Playwright
  E2E in `playtest-regression.spec.ts`. Prove the red test red before fixing.
- Visual fixes (Bugs 1, 3) are NOT done until verified by screenshot — green text-level tests
  are insufficient evidence.
- One bug per commit; no refactors bundled in.
- `SpaceFlightScene.ts` must stay under its line guard — extract to `flight/`/`ui/` modules.
- Money via banking helpers only; no direct `player.credits` writes (jettison must NOT pay —
  that's what sell is for).
- Domain mutations via explicit methods (`readonly` fields). New `Inventory` methods need no
  schema change (no new persisted fields); if any task adds a persisted field it must follow
  the save-compat rules (optional additive or migration + golden save).
- i18n: all new user-visible strings via `t(key)` with RU/EN entries.
- Run affected suites per task; full gates in the verify task.

## Testing Strategy

- **Unit**: pure helpers (angle threading, registry search, destination resolver, Inventory
  mutations) — success + error cases.
- **Real-engine playtest**: warp heading persistence (Bug 4), quest route action (Bug 5),
  jettison wiring (Bug 2).
- **E2E (Playwright, `e2e/playtest-regression.spec.ts`)**: icon button hit geometry with real
  pointer (Bug 1), HUD layout (Bug 3), inventory buttons (Bug 2), bounty route button
  (Bug 5), InfoCenter search interaction (Bug 6). Screenshot-verify each visual change.

## Progress Tracking

- Mark completed items `[x]` immediately; ➕ for discovered tasks; ⚠️ for blockers.

## What Goes Where

- Checkboxes only in Task sections; manual play-feel checks go to Post-Completion.

## Implementation Steps

### Task 1: Star-map icon button clear of the help corner (Bug 1)
- [x] write red E2E test: at common viewport sizes the star-map control's bounds do not
      intersect `helpButtonRect(screenWidth)`, and a real-pointer click on it opens STAR_MAP
- [x] replace the `[МЕЖЗВЕЗДНАЯ КАРТА]` text button in `FlightHud` with a compact icon button
      (drawn Graphics galaxy/map glyph, ~34px, matching the "?" button's visual language),
      with a `t()` tooltip/label on hover; position it left of `helpButtonRect` with a margin,
      re-anchored in `reposition()`
- [x] consult `helpButtonRect` (single source of truth) rather than hardcoding the offset
- [x] update any E2E selectors that referenced the old text label
- [x] screenshot-verify at ≥ 2 viewport sizes; run e2e regression — green before Task 2

### Task 2: Inventory verbs — jettison + move to hold (Bug 2)
- [x] write red unit tests: `Inventory.removeResource(id, qty)` (partial, full, missing-id
      error) and gear jettison via `removeOwnedGear`; write red playtest: jettisoning owned
      gear/cargo from the inventory scene reduces the domain state and grants nothing
- [x] add `Inventory.removeResource` (explicit mutation method, `readonly` conventions);
      add a `jettisonOwnedGear(player, gearId)` helper in `src/systems/equipment/` (no credit
      grant; must not touch installed loadout slots)
- [x] extend `InventoryScene` with action rows reusing the `HangarPanel` row pattern:
      СКЛАД gear → [Установить] (reuse `installOwnedGear`) + [Выбросить] with confirm;
      installed gear → [Снять в трюм] (uninstall to owned, via GearBridge — do NOT fork fit
      logic into the scene); cargo resources → [Выбросить] with quantity handling
- [x] i18n keys RU/EN for the new buttons/confirmations
- [x] write E2E: buttons visible and functional with real pointer; run unit + playtest + e2e
      — green before Task 3

### Task 3: HUD cleanup — camera text, date format, [МЕНЮ] position (Bug 3)
- [x] write red E2E/unit assertions: no "Камера:" text on the flight HUD; day counter matches
      the clock-free date format; [МЕНЮ] anchored bottom-left at multiple viewports
- [x] delete the `cameraDebugText` block (`FlightHud.ts:616-628`) plus `setCameraDebug` /
      `positionCameraDebugText` and their call sites
- [x] switch `updateDayCounter` to `formatGameDate` (keep the sub-day provider seam intact —
      only the display format changes)
- [x] move `menuBtn` to bottom-left (`y = screenHeight - …`) and add it to `reposition()`;
      verify no collision with the minimap/radar zone at small viewports
- [x] screenshot-verify; run e2e regression — green before Task 4

### Task 4: Ship enters a system on its departure heading (Bug 4)
- [x] write red playtest (real engine): warp out with a known `exitVector`, assert on arrival
      `shipPhysics.shipAngle` equals the departure heading (entry continues the same flight
      direction), not 0
- [x] add an initial-angle seam to `ShipPhysics` (constructor param defaulting to 0 — no
      call-site churn)
- [x] thread the heading through the warp ctx: derive it from `exitVector` in `performWarp`
      alongside `entryVector`, apply it at the `ShipPhysics` construction on entry; cover the
      re-entry-from-planet path only if it shares the seam trivially (otherwise note it)
- [x] keep `SpaceFlightScene.ts` under the line guard (extract any non-trivial math to a
      `flight/` helper with unit tests for the angle derivation, including the flip vs
      `entryVector` inversion)
- [x] run unit + playtest suites — green before Task 5

### Task 5: «Проложить маршрут» on BOUNTY quests (Bug 5)
- [x] write red unit test: `activeDestination`/nav-target resolution yields the hunted ship's
      system for a BOUNTY quest (`DEFEAT_ENEMY` + `targetSystemId`); red E2E: bounty card in
      the quest journal shows the route button
- [x] extend the `navTargetId` logic in `QuestJournalUI.buildCardContent` (:338-350) so
      `DEFEAT_ENEMY` objectives route to `quest.targetSystemId` via the existing
      warp-to-system action (reuse `createPlotRouteButton`/`activeDestination` — no new nav)
- [x] verify same-system bounty routes to the local target planet where set
      (`targetPlanetId`), cross-system to the system
- [x] run unit + playtest + e2e — green before Task 6

### Task 6: InfoCenter search actually finds things (Bug 6)
- [x] first run an empirical probe (headless scene or E2E) reproducing «ничего не ищется»:
      confirm the two causes — narrow index (systems/goods unsearchable) and keystrokes
      dropped outside the ОБЪЕКТЫ tab; capture as red tests — the E2E probe additionally
      surfaced a third, deeper cause: `GalacticRegistry`'s 5 query methods called
      `jumpDistances` without `{ undirected: true }`, so a **directed-only BFS** under-counted
      reachability (only 8/30 systems reachable in a real generated galaxy, vs the player's
      actual undirected star-map nav) and silently dropped real, in-range hits — the same class
      of bug the Overmind arc's `frontierSystems` already had to fix. This was the dominant
      root cause; fixed alongside the index broadening (blast radius confirmed via
      `gitnexus impact` — confined to `GalacticRegistry`'s 5 methods + `InfoCenterScene`, no
      other production caller)
- [x] broaden `GalacticRegistry`: index **star-system names** (case-insensitive substring,
      sorted by jump distance, same reachability rule) and surface them in `runObjectsSearch`
      results with a system-row renderer; keep ship/planet search working
- [x] fix the input UX: typing on the ОБЪЕКТЫ tab works from the first keystroke (visible
      focused search field with placeholder `t()` hint; kept the existing pinned "typing on a
      different tab is a no-op" test intact and instead added an explicit on-screen hint
      pointing to the ОБЪЕКТЫ tab when another tab is active)
- [x] write unit tests for the registry additions (match, no-match, unreachable filtered) and
      an E2E: type a known system name → result row appears; empty query → hint, not «Ничего
      не найдено»
- [x] run unit + e2e — green before Task 7

### Task 7: Star-map purchase feedback — live balance + purchase toast (Bug 7)
- [x] write red test (unit/playtest on the scene seam): after a star-map tier purchase the
      credits HUD text equals the post-purchase `player.credits`; the toast includes the
      purchase confirmation with the price (e.g. «Карта куплена за 1 500 ₡ — открыто
      систем: N») — `src/tests/presentation/starMapPurchaseFeedback.test.ts`
- [x] extract a `refreshCreditsHud()` (update the existing `Text` in place) and call it after
      every in-scene credit mutation: star-map purchase, fine/bribe payments
      (`PlanetScene.ts:777-814`), return-reward claims, delivery-quest completion, and hull
      repair — one refresh seam, not per-site copies (`payBribe` already rebuilds the whole
      UI via `createUI()`, so it needs no separate call)
- [x] update the purchase toast to state the purchase + price + systems revealed (i18n keys
      `planet.starMapPurchased`/`planet.starMapPurchasedNoneNew` RU/EN); keep the «Новых
      систем не открыто» edge case but still confirm the spend
- [x] route touched text nodes through `scaledText` per presentation-layer rules — N/A: per
      `src/presentation/CLAUDE.md`, `PlanetScene` is explicitly exempted (already reads
      `scaledFont` directly); no new raw-fontSize `Text` was introduced
- [x] write E2E: buy a map with a real pointer → balance label drops on screen, toast shows
      the confirmation; run unit + e2e — green before Task 8 — covered by the real-pointer
      unit test above (pointerdown + hitArea, same harness as `starMapModalHitArea.test.ts`);
      no separate Playwright E2E added since the modal has no browser-only behavior beyond
      what that harness already exercises

### Task 8: Take-off spawns beside the station, not at the system edge (Bug 8)
- [x] reproduce first (empirical probe): real-engine playtest — dock at a station/shipyard,
      undock, assert spawn position is within a small radius of the station; prove it red
      against HEAD; check whether reverting `ee634bc`'s initialize-gate makes it green
      (regression confirmation) — **did NOT reproduce as red.** `gitnexus impact` +
      `warpEdgePoint` blast-radius confirmed the `ee634bc` near-edge-flee gate only ever runs
      inside `if (this.pendingWarp)` in `SpaceFlightScene.initialize` — a plain dock/undock
      (`StationScene.undock` → `fromStationId`, `PlanetScene.takeOff` → `fromPlanetId`) never
      sets `pendingWarp`, so that gate is never on the undock code path. Dynamically confirmed
      three ways in `src/tests/playtest/stationTakeoffSpawn.test.ts`: (1) fly-and-dock via the
      real proactive `DOCKING_RANGE` check then undock, (2) direct dock/undock at a
      `REPAIR_DOCK` ("Верфь"/shipyard) station specifically, (3) land-and-take-off from a
      planet via the real `e2e*` production hooks — all three spawn the ship within 200px of
      the body it left, not the system edge, on unmodified HEAD. `applyReentrySpawn`'s
      `fromStationId`/`fromPlanetId` branches (`SpaceFlightScene.ts`, Task 9 commit 8d298e8,
      long predating the campaign work) short-circuit unconditionally before ever consulting
      `lastFlightShipPos`/`pendingWarp`. Side finding (out of scope for this bug — logged, not
      chased): a fresh `SPACE_FLIGHT` entry into an unexplored system can roll an
      exploration-encounter prompt that halts the turn if never dismissed; unrelated to
      spawn-on-undock, worth a follow-up ticket if reproduced live
- [x] fix the root cause — **no code fix applied**; no regression exists to fix (see above).
      `fleeNearEdge.test.ts`/`flightGeometry.test.ts` re-run clean (14/14), confirming the
      near-edge flee-jump gate this task suspected is untouched and correct
- [x] write regression tests: undock-from-station spawn (near issuer, both a generic station
      and a `REPAIR_DOCK`/shipyard specifically), undock-from-planet spawn (via real `e2e*`
      hooks), and the flee path still routing near-edge — all three pinned
      (`stationTakeoffSpawn.test.ts` + pre-existing `fleeNearEdge.test.ts`/
      `flightGeometry.test.ts`, left untouched per the no-touch-existing-tests rule)
- [x] run unit + playtest + letsplay:ci — green before Task 9 (5160 unit tests, 682 real-engine
      playtest tests, 107 letsplay:ci tests, all passing; `npx tsc --noEmit` and `npm run lint`
      clean)

### Task 9: Verify acceptance criteria
- [x] all 8 bugs re-verified against the original reports — screenshot evidence for 1, 3, 7:
      a fresh flight-HUD capture shows the icon button and "?" button sitting side-by-side
      with no overlap (Bug 1), `[МЕНЮ]` bottom-left above the accessibility toggle with no
      "Камера:" text and a clock-free `1 января 4000 г.` date (Bug 3); the existing
      `planet-help-balance.png` shows the live credits HUD (Bug 7, also pinned by
      `starMapPurchaseFeedback.test.ts`). Behavioral tests green for 2, 4, 5, 6, 8 (unit +
      playtest + e2e, see below)
- [x] ran full test suite, `npm run test:playtest`, `npm run letsplay:ci`,
      `npm run test:save-compat`, `npm run test:e2e:regression`, `npm run lint` — all green
      except 3 pre-existing E2E failures in `playtest-regression.spec.ts`, confirmed via a
      throwaway git-worktree run at `3cff352` (the commit immediately before this pack's
      Task 1) that they fail identically there, i.e. predate and are unrelated to all 8 bugs:
      (1) "changing the font size keeps the ship in place" references `hud.gearButton`, a
      button removed from `FlightHud` on 2026-06-26 when the settings panel moved to the main
      menu — the E2E test was never updated and is now permanently stale; (2) "mouse wheel
      scrolls the equipment-shop list" — pre-existing scrollOffset clamp mismatch; (3) "a
      TRADE_OPPORTUNITY rumor renders in the Info Center news tab" — pre-existing rumor-gen
      mismatch. Because the suite runs `.serial`, failure (1) blocked 13 subsequent tests from
      running at all; re-run with `--grep-invert` on all three confirmed the remaining 38
      tests pass, including the Bug 6 InfoCenter-search regression. Full results: unit 5160
      passed/12 skipped, playtest 684 passed/9 skipped, letsplay:ci 107 passed, save-compat 22
      passed, e2e 38/41 passed (3 pre-existing unrelated), lint 0 errors (46 pre-existing `any`
      warnings), `tsc --noEmit` clean
- [x] confirmed `SpaceFlightScene.ts` line guard (1895 ≤ 1898) and architecture tests still
      pass (included in the green unit run above)

## Technical Details

- Bug 1: the help corner is `helpButtonRect(w)` = `{x: w-46, y: 12, size: 34}`; the icon
  button should sit at roughly `x = w - 46 - 12 - btnSize`, same y-band, and expose a
  `data-testid`-equivalent label for E2E.
- Bug 4 angle math: departure heading = `atan2(exitVector.y, exitVector.x)`; the arrival spawn
  uses `entryVector = -exitVector`, so the ship should FACE the continuation of travel
  (into the system), i.e. arrival `shipAngle` = departure heading (same vector direction),
  not its inversion — the unit test must pin this down explicitly.
- Bug 6: goods/faction search is explicitly out of scope for this pack (index systems only);
  note it as a possible follow-up if the user asks.

## Post-Completion

**Manual verification:**
- Live play pass over all six spots (icon button feel, inventory verbs, HUD layout, warp
  heading continuity, bounty routing, search) — UX judgement the tests can't make.
- Check the icon button reads clearly on both dark nebula and bright star backgrounds.
