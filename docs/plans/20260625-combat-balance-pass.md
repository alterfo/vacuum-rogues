---
# Combat Balance Pass: Real Cooldowns, Symmetric NPC Weapons, Working Escape

## Overview
An oddity sweep found combat *rules* that are broken (not just numbers):

1. **`cooldownTurns` is a dead stat** — `CombatModule.advancePlayerWeapons` fires every
   weapon on a flat `GAME_BALANCE.combatFireIntervalMs` (2500 ms) and ignores each
   weapon's `cooldownTurns` (1–3). So a weapon's cooldown shown in the catalog/UI does
   nothing; balance collapses to raw `damage`, and the high-damage/"slow" beam has no
   real drawback.
2. **NPCs have no weapon variety + a range asymmetry** — the player fires at each
   weapon's own `range` (railgun **360**), but every NPC fires at a flat
   `GAME_BALANCE.weaponRange: 240` with flat damage. So one railgun lets the player
   **outrange every enemy** (hit from 360 while they can't return fire until 240),
   trivialising combat, and all enemies feel identical.
3. **Escape is unreachable** — `combatEscapeRange: 1200` exists, but with NPCs faster
   than the player you can never open the gap. (The *speed* fix lives in
   `economy-homogeneous-tech-start-speed`; this plan verifies escape actually works
   once the player can match a basic NPC.)

Goal: weapon choice matters (cadence is a real tradeoff), enemies vary and can't be
trivially out-ranged, and fleeing is possible.

## Context (from discovery)
- **Fire path** (`src/presentation/flight/CombatModule.ts`): `advancePlayerWeapons`
  (~L412) gates on `combatFireIntervalMs`, `pickTargetInRange(weapon)` uses
  `weapon.range`; `advanceNpcTimers` (~L375) uses `GAME_BALANCE.combatFireIntervalMs`
  **and** the global `GAME_BALANCE.weaponRange` (240) for every NPC.
- **Weapon catalog** (`GearCatalog.ts`): each `WeaponSpec` has `damage`, `range`
  (180–360), `cooldownTurns` (1–3) — the last currently inert.
- **NPC damage**: `fireNpcShot` → `applyDamageWithMode(...)` with a flat value (no
  per-weapon spec); NPCs carry no `WeaponSpec`.
- **Escape**: `GAME_BALANCE.combatEscapeRange: 1200`; speed knobs `npcSpeed: 0.2` vs
  player `ShipPhysics.maxSpeed 0.1` (the speed fix is the economy plan's Task 1 — this
  plan depends on it).

## Development Approach
- **Testing approach: TDD.** Per-weapon cadence + the NPC weapon-range/variety are pure
  combat-timing logic — unit-tested with a stubbed clock/targets (assert a high-`cooldownTurns`
  weapon fires less often; an NPC's reach equals its weapon's range, not a global 240).
  Escape verified in the real-engine playtest after the speed fix. Tune magnitudes in
  `balance.ts`/catalog; assert *relationships*, not exact numbers.
- **Ordering:** run after `economy-homogeneous-tech-start-speed` (it owns the
  player≥basic-NPC speed fix that makes escape reachable). `impact` on `CombatModule`
  fire paths first.

## Implementation Steps

### Task 1: Make `cooldownTurns` govern fire cadence
**Files:**
- Modify: `src/presentation/flight/CombatModule.ts`
- Create/Modify: `src/tests/flight/weaponCadence.test.ts`

- [x] Derive each weapon's fire interval from its `cooldownTurns` (× a base ms) instead
      of a single flat `combatFireIntervalMs`, in `advancePlayerWeapons` (per-weapon
      timer already exists). A slow, high-damage weapon now trades cadence for punch.
      (New exported pure helper `weaponFireIntervalMs(weapon)` = `max(1, cooldownTurns) ×
      combatFireIntervalMs`; `cooldownTurns:1` keeps the old flat cadence so existing
      combat tests stay green.)
- [x] write tests: a `cooldownTurns=3` weapon fires ~⅓ as often as a `cooldownTurns=1`
      weapon over N ticks; DPS ordering reflects damage ÷ cadence (so the beam is a real
      tradeoff, not a free upgrade). (`src/tests/flight/weaponCadence.test.ts`.)
- [x] run tests — green.

### Task 2: Give NPCs real weapon range + variety
**Files:**
- Modify: `NpcShipManager`/`NpcShipSprite` (assign a `WeaponSpec`/range per NPC), `CombatModule.advanceNpcTimers`
- Create/Modify: `src/tests/flight/npcWeapons.test.ts`

- [x] Give NPCs a per-ship weapon (range + damage from a small set scaled by role/tier)
      and have `advanceNpcTimers` use **that** range instead of the global
      `GAME_BALANCE.weaponRange` — so the player can't trivially out-range every enemy
      and NPCs vary. (New pure helper `npcWeaponRange(npc)` /  `NPC_WEAPON_RANGE`
      in `src/systems/combat/npcWeapon.ts`: TRADER 200 / PIRATE 260 / RANGER 300 /
      PATROL 340, derived from the already-persisted `role` — **no schema/migration**.
      Damage stays per-NPC on `NpcShip.damage` (ROLE_STATS). `advanceNpcTimers` now
      gates fire on `d <= npcWeaponRange(npc.npc)`, falling back to the legacy flat
      240 for a role-less stand-in so existing combat tests stay green.)
- [x] write tests: an NPC engages at its own weapon range (not a flat 240); different
      NPC types differ; the player's range edge is bounded, not infinite.
      (`src/tests/flight/npcWeapons.test.ts` — 7 tests: a PATROL returns fire from 300
      where the old flat 240 could not, a TRADER holds past its 200, the PATROL drops
      out past its own 340; four distinct role ranges; the best common player weapon
      (railgun 360) still out-ranges the toughest enemy but the edge ≤ 40 px.)
- [x] run tests — green.

### Task 3: Verify escape/flee actually works
**Files:**
- Modify: (verify; small tuning only) `balance.ts` / pursuit logic
- Create: `src/tests/playtest/combatEscape.test.ts`

- [ ] After the speed fix (economy plan), confirm a player can open `combatEscapeRange`
      and disengage from a basic NPC; if pursuit still pins the player, tune pursuit
      speed/leash so flee is possible but not trivial.
- [ ] write a real-engine playtest: engage → flee → distance exceeds escape range →
      combat ends.
- [ ] run tests — green.

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — CombatModule + NPC
      weapons + balance affected; no schema/migration.
- [ ] full unit suite green; `npm run test:playtest` green; lint/build ok.

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md` / `playtest-traps.md`

- [ ] Document: per-weapon cadence (`cooldownTurns` now governs fire rate), NPC weapon
      range/variety, and that escape is reachable post-speed-fix.

## Post-Completion
**Manual:** weapons feel distinct (slow-hard vs fast-light), enemies vary and can return
fire at sensible ranges, and you can actually flee a losing fight.
