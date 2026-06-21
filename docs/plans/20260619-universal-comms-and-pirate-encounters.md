---
# Universal Comms Window & Pirate Encounters ("Кошелёк или жизнь")

## Overview
Make ship-to-ship communication a real interaction layer:
1. **Universal comms window** — the player can hail any ship and get **context-driven** options:
   trade, hire-to-attack a target, offer to ally in a fight, or attack. One reusable window, not a
   per-purpose panel.
2. **Pirate-initiated shakedown** — passing pirates sometimes *want* to attack and open a comms hail
   with a demand: **"кошелёк или жизнь"** — pay credits (a tribute) or refuse and fight (or attempt
   to flee).
3. **Hire / ally offers** — the player can hail a ship and offer credits to attack a target or aid in
   an ongoing fight; the NPC accepts or declines based on strength/relations.
4. **Overmind gibberish** — hailing Overmind ships is useless: they reply with nonsense, no real
   options.

## Context
- **Comms panel:** `src/presentation/NpcContactPanel.ts` — player-initiated, callbacks
  `onHail`/`onTrade`/`onAttack`/`onApproach`/`onScan`; buttons "Связаться/Торговать/Атаковать/
  Сканировать" (~L128–145). `src/presentation/DialogueScene.ts` renders hail dialogue.
- **NPC behaviour:** `src/systems/npc/NpcBrain.ts` (decisions), `src/systems/npc/NpcSimulator.ts`
  (population, hostile garrisons, `hostile` flag, factions). `domain/NpcShip` carries `credits`,
  `hullHP`, `shields`, `damage`, faction/role, hostility.
- **Flight trigger:** `src/presentation/SpaceFlightScene.ts` opens the contact panel and runs combat;
  it's where a pirate-initiated hail must be raised when a hostile passes within range.
- **Money:** any tribute/hire payment goes through the **banking bus** (ABS) — a `Transfer`
  player↔NPC (counterparty = the NPC's account), never a direct `credits` write. Use the
  `economy.ts` transfer facade; net deltas must stay correct.
- **Decision (confirmed):** **full set** in this pass — pirate shakedown + hire/ally + Overmind gibberish.

## Development Approach
- **TDD for the pure decision logic** (does a passing pirate demand? does an NPC accept a hire?
  outcome of pay/refuse) — these are pure functions of ship stats + RNG + relations; write failing
  tests first. **Visual-verify** the comms window via screenshot.
- **ABS contract:** tribute/hire payments are balanced bus transfers; existing economy tests must
  stay green — if any reds, STOP and fix the posting, don't weaken the test.
- **Do not modify existing tests**; add new ones. Run `impact` on `NpcContactPanel`, `NpcBrain`, and
  any `SpaceFlightScene` method touched before editing; warn on HIGH/CRITICAL.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: pirate-demand decision (probability gated by relative strength + hostility + RNG seed);
  pay/refuse/flee outcomes (pay → balanced transfer + pirate disengages; refuse → combat; flee →
  escape chance by speed); hire/ally acceptance (declines weaker payer / accepts sufficient offer);
  Overmind hail returns a gibberish line and no actionable options.
- Integration: a tribute payment moves `player.credits` by exactly `-amount` and the GL stays
  balanced; a hired NPC retargets the named target.
- E2E/regression: a pirate hail opens the comms window with pay/fight options; paying closes it and
  the pirate disengages.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any economy test that reds). Keep in sync.

## Implementation Steps

### Task 1: Generalize the comms window into a universal hail
**Files:**
- Modify: src/presentation/NpcContactPanel.ts (context-driven option set: trade / hire / ally /
  attack / pay-tribute / leave), src/presentation/DialogueScene.ts (render hail lines per context)
- Create: src/tests/comms/commsOptions.test.ts

- [x] derive the available options from a pure `commsOptionsFor(npc, context)` (hostile pirate hail
      vs neutral trader vs Overmind) so the panel renders the right buttons
- [x] write unit tests: pirate-shakedown context → pay/fight/flee; neutral → trade/hire/ally; Overmind → none
- [x] run affected tests — must pass before next task

### Task 2: Pirate-demand decision + shakedown trigger
**Files:**
- Modify: src/systems/npc/NpcBrain.ts (`wantsToShakedown(npc, player, rng)` — pure), 
  src/presentation/SpaceFlightScene.ts (raise the comms hail when a hostile pirate passes in range)
- Create: src/tests/npc/pirateShakedown.test.ts

- [ ] pure decision: a passing pirate demands tribute with a probability gated by relative strength
      and hostility (seeded RNG, deterministic in tests)
- [ ] SpaceFlightScene opens the universal comms window in the shakedown context on a positive decision
- [ ] write unit tests for the decision across strength ratios + seeds
- [ ] run affected tests — must pass before next task

### Task 3: Resolve the shakedown — pay / refuse / flee
**Files:**
- Modify: src/systems/npc/NpcBrain.ts (outcomes), src/presentation/SpaceFlightScene.ts (apply),
  src/systems/banking/economy.ts (tribute transfer — reuse facade)
- Create: src/tests/comms/shakedownOutcome.test.ts

- [ ] pay → balanced bus transfer (player → pirate) + pirate disengages; refuse → combat begins;
      flee → escape chance from relative speed
- [ ] ⚠️ existing economy tests must stay green — if any reds, STOP and fix the posting
- [ ] write unit tests: pay moves credits by exactly `-tribute` + GL balanced; refuse → hostile;
      flee escape probability
- [ ] run affected tests + economy suite — must pass before next task

### Task 4: Player hire / ally offers
**Files:**
- Modify: src/presentation/NpcContactPanel.ts (hire/ally actions + target pick),
  src/systems/npc/NpcBrain.ts (`acceptsHire(npc, offer, target)` — pure), src/presentation/SpaceFlightScene.ts
  (retarget the hired NPC), src/systems/banking/economy.ts (hire payment)
- Create: src/tests/comms/hireOffer.test.ts

- [ ] offering credits to attack a target / aid a fight → NPC accepts or declines (pure logic);
      payment is a balanced bus transfer; accepted NPC retargets
- [ ] write unit tests: accept above threshold, decline below, payment balanced
- [ ] run affected tests — must pass before next task

### Task 5: Overmind gibberish
**Files:**
- Modify: src/systems/npc/NpcBrain.ts / a dialogue table (Overmind hail → nonsense line, no options),
  src/presentation/DialogueScene.ts
- Create: src/tests/comms/overmindGibberish.test.ts

- [ ] hailing an Overmind ship returns a gibberish line and exposes no actionable comms options
- [ ] write unit tests asserting no trade/hire/ally options for Overmind
- [ ] run affected tests — must pass before next task

### Task 6: Verify acceptance criteria
- [ ] verify Overview: universal window, pirate shakedown, hire/ally, Overmind gibberish — all work
- [ ] visually verify the comms window via screenshot in each context
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing test assertions changed

## Technical Details
- **One window, many contexts:** the panel is a thin renderer over `commsOptionsFor(npc, context)`;
  contexts = `pirate-shakedown | neutral | hostile-other | overmind`. Keeps option logic pure/testable.
- **Payments through the bus:** tribute and hire are `Transfer`s (ABS), counterparty = the NPC's
  account, so money has a source/sink and existing delta tests stay valid.
- **No new persistence** unless an ally relationship must survive save/load — if so, add the field to
  `schemas.ts` in the same task (lockstep) with a migration default.

## Post-Completion
**Manual verification:** fly near pirates and confirm an occasional "кошелёк или жизнь" hail; pay and
watch them disengage (and credits drop by the tribute); refuse and fight; hail a neutral ship and
hire it to attack a target; hail an Overmind ship and confirm only gibberish.
