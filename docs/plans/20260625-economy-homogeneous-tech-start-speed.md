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

- [ ] Re-curve hull/engine `basePrice` so top-tier items are **much** more expensive
      (top hull/engine ≫ mid, e.g. ≥ 4× the mid tier) and gate their availability to
      rare, high-end markets — only the richest field them.
- [ ] write tests: the price curve is monotone with a steep top step; top-tier items are
      flagged rare/high-end.
- [ ] run tests — green.

### Task 3: Homogeneous galaxy tech + slower progression
**Files:**
- Modify: `src/config/balance.ts` (income/price curve), galaxy/NPC tech seeding (`GalaxySimulator`/`NpcSimulator`)
- Create/Modify: `src/tests/balance/progression.test.ts`, NPC tech-seeding tests

- [ ] Compress the galaxy's NPC tech spread toward a homogeneous mid-tier (no wild
      disparities), and tune income vs. top-tier price so reaching top tech takes a long
      earned climb (update the documented progression comment in `balance.ts`).
- [ ] write tests: NPC tech distribution is homogeneous (low variance) except rare
      high-end; the modelled days-to-top-hull is far larger than before.
- [ ] run tests — green (existing economy/quest tests stay green; adjust only if the
      curve intentionally changed).

### Task 4: Fix gear-curve inversions + money-printers (oddity sweep)
**Files:**
- Modify: `src/systems/equipment/GearCatalog.ts`, `src/config/balance.ts`, `src/systems/banking/BankingService.ts`
- Create/Modify: `src/tests/balance/gearCurve.test.ts`

- [ ] Remove the dominance inversions found in the sweep: the **Courier** (2500 cr,
      cargo 45) shouldn't be cheaper *and* roomier than the **Corvette** (3000, cargo
      30); the cheapest hull (**Scout**) shouldn't have the best HP-per-credit of the
      lineup. Re-price so each step up is a genuine upgrade for its role.
- [ ] Tame the money-printers: the local-delivery margin (**3.5×**) vs worst-case buy
      (**3.0×**) is structural free profit, and artifact drops (**40% × 1–3 × 1000 cr**)
      make combat a printer — narrow the delivery margin and/or drop rate; consider the
      generous savings yield (**~44%/yr**).
- [ ] write tests: hull/weapon value is monotonic with price for its role (no strictly-
      dominated pricier item); delivery is not guaranteed-profit; combat reward is
      bounded.
- [ ] run tests — green.

### Task 5: Diversify star types (every sun is the same yellow)
**Files:**
- Modify: `src/systems/GalaxySimulator.ts` (the hardcoded `"YELLOW_DWARF"` at ~L105)
- Create/Modify: `src/tests/galaxy/starTypeVariety.test.ts`

- [ ] Seed a **varied** star type per system (yellow/blue-giant/red-dwarf/white-dwarf/
      neutron on a weighted distribution) instead of the universal `YELLOW_DWARF` —
      which lights up the existing-but-unused `star_maps/{blue_giant,red_dwarf,
      white_dwarf,neutron}_*` art (16 assets) and ends "every sun is identical".
- [ ] write tests: a generated galaxy has a varied star-type distribution (not all
      yellow); each type resolves to its star-map prefix.
- [ ] run tests — green.

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
