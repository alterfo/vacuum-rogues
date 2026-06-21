---
# Faction Hostility & Pirate/Overmind AI

## Overview
Make pirates and the Overmind behave as distinct hostile factions that also fight **each other**:
- **Overmind** attacks **everyone indiscriminately** (player, traders, pirates, Rangers); its goal is
  **capturing systems** (expansion).
- **Pirates** prey on **weak ships** and demand **ransom (выкуп)**; they operate **solo in foreign
  systems** but **in packs in systems they have captured**. Pirates and the Overmind are **mutual
  enemies**. A player with **good pirate reputation is left alone** by pirates (no attack/ransom).

This plan owns the **who-is-hostile-to-whom** logic and the pirate/overmind targeting + grouping; the
ransom *dialog/payment* is owned by the universal-comms plan (this plan decides who gets shaken down).
(Companion plan `20260620-captured-system-landing-gating.md` handles planet-landing access.)

## Context
- **NPC AI:** `src/systems/npc/NpcBrain.ts` (role→goal; PIRATE goal), `src/presentation/flight/npcBehavior.ts`
  (pirate→trader targeting, trade-lane stalk points). `src/systems/npc/NpcSimulator.ts` already runs:
  off-screen pirate raids (`PIRATE_DAMAGE_FRACTION`, loot), **Overmind capture fleets**
  (`CAPTURE_FLEET_MIN/MAX`, capture cadence), captured-system garrisons (`GARRISON_MIN/MAX`,
  `garrisonIds`), and Ranger liberation campaigns. `galaxy.overmindSystems` / `galaxy.pirateSystems`
  flag captured systems.
- **In-flight combat:** `src/presentation/flight/CombatModule.ts` (`combatants` set, fire timers) +
  `src/presentation/flight/NpcShipManager.ts` engage NPCs **against the player**; there is no NPC-vs-NPC
  (overmind attacking a pirate) path yet.
- **Reputation:** `src/domain/Player.ts` `getReputation(factionId)` (clamped −100..100), `isHostileTo`
  (< −30); `FactionType.PIRATE` and the Overmind faction; `Planet.capturedBy: FactionType | null`.
- **Ransom overlap:** the pirate "кошелёк или жизнь" shakedown dialog + payment live in
  `20260619-universal-comms-and-pirate-encounters.md` (`NpcBrain.wantsToShakedown`). This plan feeds it
  the **weak-target + not-good-rep** decision; it does not rebuild the dialog.
- **Decision (confirmed):** good pirate reputation = pirates leave the player alone (combat + ransom).

## Development Approach
- **TDD, pure-first.** The hostility matrix and target selection are pure functions of faction +
  relative strength + reputation + system control — write them and their failing tests first, then
  wire the sim and in-flight combat to the one source of truth (no duplicated relation logic).
- **Blast radius first.** Run `impact`/`detect_changes` on `NpcSimulator`, `NpcBrain`, `CombatModule`,
  and `npcBehavior` before editing; these are HIGH fan-in — report the radius. ⚠️ **Do not run this
  plan concurrently** with the NPC-persistence plan or the universal-comms plan (shared NpcSimulator /
  NpcBrain) — sequence after them.
- **Do not modify existing test assertions** (standing rule); add new tests. Keep transient
  capture/garrison state transient (not persisted) as today. One concern per task; full suite green
  between tasks.

## Testing Strategy
- Unit: hostility matrix — overmind hostile to all; pirate hostile to weak/valuable targets unless the
  target is the good-rep player; pirate↔overmind mutual; traders/Rangers per faction. Pirate target
  selection picks the weaker ship; good-rep player is exempt. Solo in foreign systems vs pack in
  pirate-captured systems. Overmind keeps its capture goal.
- Integration: in a system holding both pirates and overmind, off-screen combat resolves between them;
  in-flight, an overmind ship engages a pirate (NPC-vs-NPC) via the matrix.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Faction hostility matrix (pure, single source of truth)
**Files:**
- Create: src/systems/npc/factionHostility.ts (`isHostile(attacker, target, ctx)` where ctx carries
  player pirate-rep + system control)
- Create: src/tests/npc/factionHostility.test.ts

- [x] pure matrix: Overmind→all; Pirate→weak/valuable targets except the good-rep player; Pirate↔Overmind
      mutual; traders/Rangers per faction; encode the good-pirate-rep exemption
- [x] write tests for every pair + the rep-exemption boundary
- [x] run affected tests — must pass before next task

### Task 2: Pirate targeting — weak ships + ransom + good-rep exemption
**Files:**
- Modify: src/presentation/flight/npcBehavior.ts / src/systems/npc/NpcBrain.ts (pirates select the
  weaker target by relative strength; a good-rep player is not targeted; feed the shakedown/ransom
  decision used by the universal-comms plan)
- Create: src/tests/npc/pirateTargeting.test.ts

- [x] pirates prefer weaker targets and demand ransom from them; a player above the good-rep threshold
      is exempt from attack/ransom
- [x] write tests: weak target chosen over strong; good-rep player skipped; ransom decision gated on weakness
- [x] run affected tests — must pass before next task

### Task 3: Solo vs pack behavior
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts / src/presentation/flight/npcBehavior.ts (pirates act solo in
  foreign systems; coordinate as a pack in systems they have captured — using `galaxy.pirateSystems`)
- Create: src/tests/npc/pirateSoloVsPack.test.ts

- [x] in a pirate-captured system pirates engage as a group; in a foreign system they hunt alone
- [x] write tests: captured-system → pack engagement; foreign system → solo
- [x] run affected tests — must pass before next task

### Task 4: Overmind indiscriminate aggression + expansion
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts / src/systems/npc/NpcBrain.ts (Overmind engages all factions
  incl. pirates via the matrix; capture-fleet expansion goal confirmed/retained)
- Create: src/tests/npc/overmindAggression.test.ts

- [x] Overmind attacks every non-Overmind ship (player, trader, pirate, Ranger); its capture goal persists
- [x] write tests: overmind targets a pirate + a trader + the player; capture cadence intact
- [x] run affected tests — must pass before next task

### Task 5: Cross-faction combat (off-screen + in-flight)
**Files:**
- Modify: src/systems/npc/NpcSimulator.ts (off-screen resolve pirate↔overmind when co-present),
  src/presentation/flight/CombatModule.ts / NpcShipManager.ts (allow NPC-vs-NPC engagement driven by
  the matrix, not only NPC-vs-player)
- Create: src/tests/npc/crossFactionCombat.test.ts

- [x] pirate and overmind ships fight each other off-screen and in-flight (matrix-driven), independent
      of the player
- [x] ⚠️ existing combat/sim tests stay green — if any reds, STOP and re-diagnose
- [x] write tests: co-present pirate+overmind → mutual damage off-screen; in-flight NPC-vs-NPC engage
- [x] run affected tests — must pass before next task

### Task 6: Verify acceptance criteria
- [x] verify Overview: overmind hostile to all + expands; pirates hit weak ships, ransom, solo/pack,
      enemy of overmind; good-rep player left alone
- [x] run full unit suite — all green (2308 tests / 261 files); `npm run test:e2e:regression` (25 passed);
      `npm run lint` clean (0 errors; 29 pre-existing `any` warnings in unrelated test files)
- [x] confirm no existing NPC/combat test assertions changed (the 5 plan commits add 5 net-new npc test
      files — pure insertions — and modify only production code)

## Technical Details
- **One matrix, many callers:** both the off-screen `NpcSimulator` and in-flight `CombatModule` ask
  `factionHostility.isHostile(...)`; no relation logic is duplicated.
- **"Weak ship":** relative combat strength (target damage/HP/shields vs attacker) — pirates pick the
  weaker; the good-rep player short-circuits to "not a target".
- **Good-rep threshold:** a config constant (shared with the landing-gating plan) in `balance.ts`.
- **Transient state:** capture fleets / garrisons stay transient (not persisted), as today.

## Post-Completion
**Manual verification:** find a system where pirates and Overmind meet and watch them fight; fly a weak
ship near pirates and get shaken down; raise pirate reputation and confirm they stop attacking; watch
the Overmind push to capture a new system while attacking everyone in its path.
