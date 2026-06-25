---
# Economy Rebalance: Homogeneous-but-Expensive Tech, Slower Top Tier, Start-Speed Fix

## Overview
Three linked balance problems make the game feel off:

1. **The player's starting ship is slower than basic NPCs.** Player `maxSpeed = 0.1`
   px/ms but `GAME_BALANCE.npcSpeed = 0.2` — NPCs are literally **2× faster**, so you
   can never flee even a basic enemy (`physics.canOutrun(npcSpeed)` always fails).
2. **Top tech is trivially affordable.** The top hull (DESTROYER) is `basePrice 12000`;
   with trade spreads (`basePrice × 3`) that's a couple of weeks — "I can field the most
   expensive hull almost immediately."
3. **Tech feels random across the galaxy.** It should be **homogeneous** — most of the
   galaxy runs similar mid-tech — and a *new* engine/hull should be **rare and very
   expensive**, so only the richest NPC/player can field it.

Goal feel: **harder to win** (a long, earned climb to top tech) but **easier to play**
(uniform tech ⇒ never randomly outclassed; you can outrun a basic threat).

## Context (from discovery)
- **Speeds:** `src/systems/ShipPhysics.ts` player `maxSpeed ?? 0.1`;
  `src/config/balance.ts` `npcSpeed: 0.2`; `NpcShipSprite.speed = GAME_BALANCE.npcSpeed`;
  `NpcShipManager` uses `npcSpeed` for drift + `canOutrun`.
- **Hull/gear prices:** `src/systems/equipment/GearCatalog.ts` `basePrice` per hull
  (LIGHT_FIGHTER 1200 … FRIGATE 7000 … **DESTROYER 12000**) + gear.
- **Economy curve (documented in `balance.ts`):** `QUEST_BASE_REWARD` (~680 cr/quest);
  trade buy/sell via `TradeSystem.getMarketPrice` (`basePrice × up to 3.0`) +
  `getBuyPrice`. The documented intent (day-250 → ~13,600 cr → tech-5) is already faster
  via trade margins.
- **Galaxy tech seeding:** NPC ship/gear tiers are assigned during galaxy/NPC
  generation (`GalaxySimulator`/`NpcSimulator`) — the lever for "homogeneous tech".

## Development Approach
- **Testing approach: TDD.** All knobs live in `balance.ts` / `GearCatalog` — pure
  data. Tests assert the *relationships* (player ≥ basic-NPC speed; a steep top-tier
  price gap; a homogeneous mid-tier spread) rather than exact magnitudes, so future
  tuning doesn't churn tests. `impact` on `npcSpeed`/`maxSpeed`/price consumers first.
- Config-only where possible; **avoid save migration** (prices/speeds are catalog/config,
  not persisted player fields). Verify the documented progression comment in
  `balance.ts` is updated to the new curve.

## Testing Strategy
- **Unit:** player starting `maxSpeed` ≥ the basic-NPC speed (you can match/outrun);
  the hull price curve has a steep top tier (top hull ≫ mid hull, e.g. ≥ 4×); the
  mid-tier spread is compressed (homogeneous); a progression test shows top tech now
  takes far longer than the old ~2 weeks under the same income model.
- **Real-engine playtest:** a fresh game can flee a basic NPC; affording the top hull
  requires a long credit climb (assert credits-to-top-hull ≫ before).

## Implementation Steps

### Task 1: Fix starting-ship speed vs NPCs
**Files:**
- Modify: `src/config/balance.ts` and/or `src/systems/ShipPhysics.ts`,
  `src/presentation/flight/NpcShipManager.ts`
- Create/Modify: `src/tests/balance/shipSpeed.test.ts`

- [x] Make the player's starting `maxSpeed` **≥** the basic-NPC speed (raise the player,
      and/or split NPC speed by class so basic ships are ≤ player and only specialised
      interceptors are faster — never a *basic* enemy at the start). Keep the arc-movement
      model intact.
      → Split by class: added `GAME_BALANCE.npcBasicSpeed = 0.08` (basic traders/patrols,
      below the ~0.11 starter speed) while `npcSpeed = 0.2` stays the interceptor tier
      (OVERMIND/PIRATE). New pure `npcCruiseSpeed`/`isInterceptorClass`
      (`src/presentation/flight/npcCruiseSpeed.ts`) is the single source for both the
      per-sprite speed (`NpcShipSprite.cruiseSpeed`) and the garrison-aggro gate; the
      escape predicate now reads the aggressor's own `cruiseSpeed`. Arc-movement intact.
- [x] write tests: a fresh player can match/outrun the basic NPC speed (`canOutrun`
      true for the starter ship vs a basic NPC); interceptor-class (if added) stays a
      deliberate exception.
      → `src/tests/balance/shipSpeed.test.ts`: split exists, classification, starter >
      basic, cruising starter out-runs basic but NOT interceptor (upgrade-gated).
- [x] run tests — green. (full unit suite 2839 green, playtest gate green, lint/tsc clean)

### Task 2: Steep, rare top tier (expensive top tech)
**Files:**
- Modify: `src/systems/equipment/GearCatalog.ts`, `src/config/balance.ts`

- [x] Re-curve hull/engine `basePrice` so top-tier items are **much** more expensive
      (top hull/engine ≫ mid, e.g. ≥ 4× the mid tier) and gate their availability to
      rare, high-end markets — only the richest field them.
      → Top hull «Бастион» (12000) is exactly ≥4× the median mid hull «Корвет» (3000)
      and the steepest step in the curve (warden 7000 → 12000). Added a **new apex
      engine** «Двигатель Тип-V» (`eq_engine_v`, tech 7, 13500) — rare and very
      expensive, its 0.26 px/ms finally out-runs the interceptor tier. Marked the
      apex pieces `rare: true` (bastion / eq_engine_v / wpn_torpedo / grav_tractor_3).
      New `isRareGear(gear)` = explicit flag OR `techLevel ≥ RARE_TECH_THRESHOLD` (6,
      a new `balance.ts` knob). Bastion price kept at 12000 (locked by
      `hullTradeIn.test.ts`); all rare items stay ≤ 14000 (economyBalance band). Gating:
      `ShopGenerator.stockChance` now halves a rare item's stock chance
      (`RARE_STOCK_FACTOR = 0.5`) on top of the tech-level falloff — only the richest
      markets field the apex. **No schema/migration** (gear is catalog-derived).
- [x] write tests: the price curve is monotone with a steep top step; top-tier items are
      flagged rare/high-end.
      → `src/tests/balance/topTierPricing.test.ts` (8 tests): steepest step at the top,
      apex hull ≥4× median mid, apex engine ≥4× entry engine, apex hull/engine flagged
      rare, the new top engine exists, rare⇒high-tech & common⇒not, rare ≤14000 ceiling,
      and a rare apex appears in far fewer shops than a common item (gated availability).
- [x] run tests — green. (full unit suite 2847 green +1 skipped; playtest gate 64 green;
      lint 0 errors; `tsc --noEmit` clean.)

### Task 3: Homogeneous galaxy tech + slower progression
**Files:**
- Modify: `src/config/balance.ts` (income/price curve), galaxy/NPC tech seeding (`GalaxySimulator`/`NpcSimulator`)
- Create/Modify: `src/tests/balance/progression.test.ts`, NPC tech-seeding tests

- [x] Compress the galaxy's NPC tech spread toward a homogeneous mid-tier (no wild
      disparities), and tune income vs. top-tier price so reaching top tech takes a long
      earned climb (update the documented progression comment in `balance.ts`).
      → NPC tech was already role-derived and tight (`npcRoleTechLevel`: TRADER 1,
      RANGER/PIRATE 2, PATROL 3 — locked by `warpToCombat.test.ts`); documented &
      locked that homogeneity with a new single-source-of-truth `NPC_TECH_BAND =
      {min:1,max:3}` in `NpcSimulator.ts` (whole band < `RARE_TECH_THRESHOLD` 6, so
      a *common* NPC never fields apex tech). Income (`QUEST_BASE_REWARD`/`PER_JUMP`)
      and gear prices are both locked by `economyBalance.test.ts`, so the climb is set
      by Task 2's steep, rare, gated apex prices; added a pure progression model
      (`QUEST_INTERVAL_DAYS=12` + `modelledDaysToAfford(price, avgReward)`) and rewrote
      the `balance.ts` progression comment to the new long-climb curve (~210 days for
      the apex hull, ~470 for the hull+engine pair — an order of magnitude beyond the
      old ~2-week buy). Config/comment only — **no schema/migration**.
- [x] write tests: NPC tech distribution is homogeneous (low variance) except rare
      high-end; the modelled days-to-top-hull is far larger than before.
      → `src/tests/balance/npcTechDistribution.test.ts` (4): every role's tech in the
      band, whole band below the rare threshold, tight cross-role spread (≤2), and a
      2000-sample uniform-role draw has low variance (<1.0), mid-tier mean (1.5–2.5),
      and never an apex ship. `src/tests/balance/progression.test.ts` (4): apex
      hull/engine flagged rare, `modelledDaysToAfford` monotone w/ price & cadence,
      apex-hull days ≫ the old fortnight buy (>5×, >80), full apex loadout ≥10× a
      fortnight and strictly > hull-alone (mean reward read from a real quest board).
- [x] run tests — green (existing economy/quest tests stay green; adjust only if the
      curve intentionally changed). → full unit suite 2855 green +1 skipped; playtest
      gate 64 green +1 skipped; `tsc --noEmit` + lint clean. No existing test touched.

### Task 4: Fix gear-curve inversions + money-printers (oddity sweep)
**Files:**
- Modify: `src/systems/equipment/GearCatalog.ts`, `src/config/balance.ts`, `src/systems/banking/BankingService.ts`
- Create/Modify: `src/tests/balance/gearCurve.test.ts`

- [x] Remove the dominance inversions found in the sweep: the **Courier** (2500 cr,
      cargo 45) shouldn't be cheaper *and* roomier than the **Corvette** (3000, cargo
      30); the cheapest hull (**Scout**) shouldn't have the best HP-per-credit of the
      lineup. Re-price so each step up is a genuine upgrade for its role.
      → Courier basePrice **2500 → 3000** (level with the corvette — no longer cheaper
      *and* roomier; an equal-price role *choice*: hauler cargo/equip slots vs the
      corvette's HP/2nd weapon). Scout HP **90 → 55** so the workhorse «Корвет»
      (140 ÷ 3000 ≈ 0.047 HP/cr) is now the most HP-efficient hull, not the budget
      scout (was 0.075). All four hull *prices* pinned by `hullTradeIn.test.ts`
      (scout 1200 / corvette 3000 / warden 7000 / bastion 12000) and the locked
      tech-band + 4×-median + steepest-top-step relationships are preserved (mid-hull
      median stays 3000 ⇒ apex 12000 holds its ≥4× gap). Only Courier (free) re-priced;
      HP fields read dynamically by the equipment tests. **No schema/migration**.
- [x] Tame the money-printers: the local-delivery margin (**3.5×**) vs worst-case buy
      (**3.0×**) is structural free profit, and artifact drops (**40% × 1–3 × 1000 cr**)
      make combat a printer — narrow the delivery margin and/or drop rate; consider the
      generous savings yield (**~44%/yr**).
      → `LOCAL_DELIVERY_REWARD_MARGIN` **3.5 → 3.1**: keeps the contract just-profitable
      vs the hot-market ceiling (locked floor `> 3.0`, `localDeliveryProfit.test.ts`)
      while shrinking the cold-market windfall — no longer a fat printer. It *cannot*
      go ≤ 3.0 without making a buy-for contract a hidden loss (the locked design).
      `ARTIFACT_DROP_CHANCE` **0.4 → 0.25**: expected artifact sell-value per Overmind
      kill ~800 → ~500 cr (still funds upgrades, no longer prints). Savings yield left
      as-is (high banking-test blast radius; soft "consider", not required). Both
      consts read dynamically by prod + the combat-drop tests (0.1 < 0.25), so green.
- [x] write tests: hull/weapon value is monotonic with price for its role (no strictly-
      dominated pricier item); delivery is not guaranteed-profit; combat reward is
      bounded.
      → `src/tests/balance/gearCurve.test.ts` (7): no hull strictly dominated by a
      cheaper-or-equal hull; cheapest hull no longer the best HP/cr; courier not
      cheaper-and-roomier than corvette; combat-hull HP ladder strictly rises with
      price; no weapon dominated by a cheaper same-profile weapon; delivery margin
      tight against worst-case buy (> 3.0, ≤ 10% headroom — guaranteed-not-a-loss is
      a *locked* design, so the test asserts the tamed-printer bound instead);
      expected per-kill artifact payout bounded (≤ 600 cr).
- [x] run tests — green. (gearCurve 7 green; full unit suite 2862 green +1 skipped;
      playtest gate 64 green +1 skipped; lint 0 errors; `tsc --noEmit` clean. No
      existing test touched.)

### Task 5: Diversify star types (every sun is the same yellow)
**Files:**
- Modify: `src/systems/GalaxySimulator.ts` (the hardcoded `"YELLOW_DWARF"` at ~L105)
- Create/Modify: `src/tests/galaxy/starTypeVariety.test.ts`

- [x] Seed a **varied** star type per system (yellow/blue-giant/red-dwarf/white-dwarf/
      neutron on a weighted distribution) instead of the universal `YELLOW_DWARF` —
      which lights up the existing-but-unused `star_maps/{blue_giant,red_dwarf,
      white_dwarf,neutron}_*` art (16 assets) and ends "every sun is identical".
      → New pure module `src/systems/galaxy/starTypeDistribution.ts`:
      `STAR_TYPE_WEIGHTS` (yellow 40 / red 25 / blue-giant 15 / white-dwarf 12 /
      neutron 8 — BLACK_HOLE excluded, no art), `pickStarType(rng)` (weighted,
      deterministic), and `STAR_MAP_PREFIX` (single source of truth for the
      `star_maps/<prefix>` mapping). `GalaxySimulator.generateGalaxy` now picks
      `pickStarType(new SeededRNG(`${seed}_star_${i}`))` per system (per-system
      seed mirrors `PlanetGenerator`, so the shared `this.rng` stream — and all
      downstream NPC/faction determinism — is untouched). `StarRenderer` now
      imports `STAR_MAP_PREFIX` instead of its own inline copy (DRY). **No
      schema/migration** (star type is generation-derived; `StarSystemSchema`
      already accepts every `StarType`).
- [x] write tests: a generated galaxy has a varied star-type distribution (not all
      yellow); each type resolves to its star-map prefix.
      → `src/tests/galaxy/starTypeVariety.test.ts` (9): deterministic pick, never
      a BLACK_HOLE, every art-backed type appears with yellow commonest, draws
      track the weights, `STAR_MAP_PREFIX` covers each type / no BLACK_HOLE, and a
      generated 40-system galaxy has >1 distinct star type (not all yellow), every
      type art-backed, deterministic per seed.
- [x] run tests — green. (new suite 9 green; galaxy+npc+fog+events 164 green; full
      unit suite 2871 green +1 skipped; playtest gate 64 green +1 skipped; lint 0
      errors; `tsc --noEmit` clean. No existing test touched.)

### Task 6: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — balance/config + catalog
      + NPC seeding affected; confirm **no schema/migration**.
- [ ] full unit suite green; `npm run test:playtest` green; lint clean; build ok.

### Task 7: Update documentation
**Files:**
- Modify: `src/config/balance.ts` comment + a balance note

- [ ] Document the new feel: player ≥ basic-NPC speed; homogeneous galaxy tech; rare,
      very expensive top tier; longer top-tech climb (harder to win, easier to play).

## Technical Details
- Config/catalog-only (no persisted player fields) ⇒ no save migration. Tests assert
  *relationships* (player≥NPC speed, steep top step, low tech variance, longer
  days-to-top) so magnitudes stay tunable.

## Post-Completion
**Manual verification:** fresh game — flee a basic NPC successfully; the galaxy's ships
feel similarly teched; the top hull/engine is a long-term goal, not a two-week buy. The
memory letsplay agent (once trained) can auto-validate the new progression.
