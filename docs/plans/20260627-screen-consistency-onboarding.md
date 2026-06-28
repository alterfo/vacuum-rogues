---
# Screen Consistency: Shared Capabilities + Onboarding Accuracy

## Overview
Bring the game's screens into mutual + onboarding conformance. The trigger: the
planet shipyard ("Верфь", `EquipmentShopScene`) and the in-space facilities
(`StationScene`) don't behave the same. The goal is **NOT** to make every screen
identical (per-type specialization is canon — a repair dock isn't a military base),
but to guarantee that **where the same capability appears on two screens it uses the
same shared component and behaves identically**, and that **each screen's onboarding
help accurately describes what that screen actually does**. So: lock the
already-shared surfaces against drift, route any forked duplicate through the shared
helper, and align the help text — no behavioral surprises between equivalent
entry points.

## Context
- **Planet Верфь** — `src/presentation/EquipmentShopScene.ts`: tabs `gear`
  (ТОВАРЫ — buy gear), `hull` (buy hulls + `buyHullWithTradeIn`/`hullTradeInPrice`),
  `hangar` (АНГАР — fit). Uses shared `ui/HangarPanel.ts` + `ui/MicromoduleApplyPanel.ts`.
- **Space facilities** — `src/presentation/StationScene.ts`: services per
  `StationType` (`hangar`/`repair`/`refuel`/`micromodules`/`quests`). Uses the same
  shared `HangarPanel` + `MicromoduleApplyPanel`, plus `micromoduleShop` (buy) and
  the military `JobBoardPanel`.
- **Capability matrix today** (the divergence): fitting + micromodule-apply are
  already shared; but buy-gear/buy-hull/trade-in live only on the planet, while
  buy-micromodules/repair/refuel/quests live only at stations. Some of that is
  legitimate specialization; some is an inconsistency to fix.
- **Shared seams (single source of truth — never fork):** `HangarPanel`,
  `MicromoduleApplyPanel`, `gearFit`/`GearBridge`, `sellHull.ts`
  (`hullTradeInPrice`/`buyHullWithTradeIn`), `micromoduleShop.ts`
  (`micromoduleShopCatalog`/`buyMicromodule`).
- **Onboarding:** `mountSceneHelp` (`ui/mountSceneHelp.ts`) + `HELP_CONTENT`
  (`systems/onboarding/helpContent.ts`, keyed by `SceneType` string). Wired on 11
  gameplay scenes; terminal/menu scenes (GameOver/Win/MainMenu/SaveLoad/Dialogue)
  intentionally omit it. SpaceFlightScene uses `mountFlightSceneHelp` + the
  `welcome` intro. Guard: `src/tests/onboarding/sceneHelpWiringRemaining.test.ts`.
- **Conventions:** dark-panel text via `scaledText`; presentation rules in
  `src/presentation/CLAUDE.md`; visual bugs need a screenshot/E2E check, not just
  green unit tests.

## Development Approach
Regular (code-first) + tests-per-task, regression-first. Lock parity with unit
tests that assert two entry points build the **same shared component / expose the
same actions** (cheap, deterministic), and screenshot the two Верфь screens for
visual parity (PixiJS metrics are unreliable under jsdom). Task 1 is a concrete
audit that records each duplicate capability + its divergence as a checklist the
later tasks fix (new divergences found mid-flight are added with ➕). Route every
fix through the existing shared helper — **never fork fit/shop/trade-in logic into a
scene** (the repo's standing rule). Presentation-only; no domain/schema/save change.
Keep per-scene line guards intact.

## Implementation Steps

### Task 1: Capability audit + parity guard for the shared hangar
**Files:**
- Modify: docs/plans/20260627-screen-consistency-onboarding.md (record the audit findings as ➕ fix tasks)
- Create: src/tests/presentation/shipyardParity.test.ts

- [x] Enumerate, per screen, the player-facing capabilities (planet `EquipmentShopScene` tabs vs each `StationType`'s `StationScene` services) and mark each as shared-component / forked / planet-only / station-only; capture the concrete divergences (and which are legitimate specialization vs. real inconsistencies) in this plan as ➕ tasks.
- [x] Write a unit test asserting the planet Верфь АНГАР tab and the station hangar service both construct the shared `HangarPanel` and expose identical fit/unfit/install actions (locks the already-shared surface so it can't drift).
- [x] Run tests — must pass before Task 2.

**Audit findings (Task 1) — capability matrix.** Per-type `StationScene` services:
TRADE_POST `{shop, hangar, infoCenter, bank, repair, refuel}`, REPAIR_DOCK
`{hangar, repair, refuel}`, MILITARY_BASE `{quests, rankPromotion, infoCenter, bank,
repair, refuel}`, RESEARCH_LAB `{shop, research, infoCenter, refuel}`, CRAFT_CENTER
`{micromodules, hangar, repair, refuel}` (all + `leave`). Planet `EquipmentShopScene`
tabs: `gear` (buy), `hull` (buy + trade-in), `hangar` (fit).

| Capability | Planet Верфь | Station | Verdict |
|---|---|---|---|
| Fit/unfit gear (hangar) | АНГАР tab → `HangarPanel` | hangar svc → `HangarPanel` | **SHARED ✅** locked by `shipyardParity.test.ts` |
| Apply micromodule chip | hangar → `MicromoduleApplyPanel` | hangar → `MicromoduleApplyPanel` | **SHARED ✅** (verify in Task 2) |
| Buy gear | gear tab `buyItem` → warehouse only | shop svc `buyItem` → **auto-installs** (+ gear trade-in modal) | **FORKED ⚠** → ➕A |
| Buy micromodules | — (tray: «купите в Центре крафта») | CRAFT_CENTER `micromodules` → `micromoduleShop` | station-only — *legitimate* (verify shared seam, Task 2) |
| Buy hull + trade-in | hull tab → `sellHull` | — | planet-only — *legitimate specialization* |
| Repair / Refuel | — | per-type, `REPAIR_DISCOUNT` | station-only — *legitimate* |
| Quests (job board) | planet board | MILITARY_BASE → `JobBoardPanel` (shared) | shared component, type-gated — *legitimate* |
| InfoCenter / Bank / Research / Rank | — | per-type | station-only — *legitimate* |

Real inconsistency found → resolved in Task 4 (➕A below). All other planet-only /
station-only rows are intentional per-type specialization (Post-Completion note) and
are left intact.

### Task 2: Micromodule fit + buy parity across shipyard surfaces
**Files:**
- Modify: src/presentation/EquipmentShopScene.ts and/or src/presentation/StationScene.ts (route through shared seams)
- Create/Modify: src/tests/presentation/micromoduleParity.test.ts

- [ ] Ensure every surface that fits micromodules uses the shared `MicromoduleApplyPanel`, and every surface that sells them uses `micromoduleShop` — aligning any forked behavior so the flow is identical wherever it appears.
- [ ] If a Верфь is meant to offer micromodule purchase consistently (not only the science station), route it through `micromoduleShop` (no new purchase path).
- [ ] Write tests asserting the shared seams are used identically at both entry points (no forked catalog/price/fit logic).
- [ ] Run tests — must pass before Task 3.

### Task 3: Onboarding help accuracy + coverage
**Files:**
- Modify: src/systems/onboarding/helpContent.ts (correct body/controls to match real capabilities)
- Modify: scenes missing onboarding (add the one `mountSceneHelp` line where a gameplay screen lacks it)
- Modify: src/tests/onboarding/sceneHelpWiringRemaining.test.ts (update the tracked list)

- [ ] For each gameplay screen with onboarding, verify `HELP_CONTENT` title/body/controls match what the screen actually does (the Верфь help must describe its real capabilities at that entry point); fix mismatches.
- [ ] Wire `mountSceneHelp` on any gameplay screen missing it (exclude the intentional terminal/menu omissions); add its `HelpKey` + `HELP_CONTENT` entry.
- [ ] Write/extend tests: help-content keys exist for every onboarded scene; the wiring guard reflects the new coverage.
- [ ] Run tests — must pass before Task 4.

### Task 4: Resolve the concrete Верфь planet-vs-space behavioral deltas
**Files:**
- Modify: src/presentation/EquipmentShopScene.ts, src/presentation/StationScene.ts (per the Task 1 ➕ list)
- Modify/Create: the matching parity tests

- [ ] Fix each real inconsistency surfaced in Task 1 so a shared capability behaves identically regardless of entry point (e.g., install-block messaging via `explainInstallBlock`/`gearFit`, trade-in via `sellHull`, tab labels/order, action wording), routing through shared helpers.
- [ ] ➕A **Buy-gear behavioral fork** (Task 1 audit): the same «buy this gear» action behaves differently by entry point — planet `EquipmentShopScene.buyItem` always banks the purchase to the warehouse (`acquireUninstalledGear`; documented SR-canon «the shop never auto-installs, fitting is a separate hangar action»), whereas station `StationScene.buyItem` **auto-installs** into a free slot (`equipment.installGear`, re-homing the displaced engine/radar) and additionally offers a gear trade-in modal (`buyItemWithTradeIn`) the planet gear tab lacks. Align the station gear-buy to the canonical no-auto-install warehouse path (check `shipyardInstall.test.ts` first — if it pins the auto-install, that's a root-cause signal to reconcile, not a test to weaken), so a purchase lands in the same place regardless of where it was bought; reconcile or scope the gear trade-in. Lock with a parity test.
- [ ] Leave legitimate per-type specialization intact (don't add repair to a planet shop or hull-sales to a repair dock unless that was an identified inconsistency) — hull market+trade-in stays planet-only, micromodule purchase stays CRAFT_CENTER-only, repair/refuel/bank/infocenter/research/rank stay station-type-gated.
- [ ] Write tests locking each fixed divergence.
- [ ] Run tests — must pass before Task 5.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: docs/plans/20260627-screen-consistency-onboarding.md (check off items)

- [ ] A shared capability (fitting, micromodules, gear/hull where offered) behaves identically at the planet Верфь and the equivalent station surface.
- [ ] Every gameplay screen's onboarding help accurately matches its actual capabilities; coverage guard green.
- [ ] Full unit suite + `npm run test:playtest` + `npm run lint` green; per-scene line guards intact.
- [ ] Screenshot-verify the planet Верфь and the station hangar show consistent shared-capability behavior.

## Post-Completion
*Informational — no checkboxes:*
- Per-type specialization is intentional (repair dock ≠ military base ≠ science station ≠ planet shop) — this plan aligns *shared* capabilities + help text, it does not homogenize the screens.
- If the audit (Task 1) surfaces a capability that *should* be everywhere but isn't, that's a design call to confirm before adding it (don't expand scope silently).
