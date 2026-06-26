---
# Letsplay Agent as a CI Regression + Balance Oracle

## Overview
We're building an agent that **plays the game to find bugs** (the dev letsplay engine).
Wire it into CI so **every change** is auto-playtested: run N headless sessions and fail
the build on any crash, soft-lock, always-actionable-invariant violation, or **balance
regression** (e.g. credits/day or days-to-top-hull drifting outside a band). This makes
all other work safer — bugs that pass 2600 unit tests but break the real loop get caught
by an agent actually playing.

## Context (from discovery)
- **Engine exists** (`src/tests/playtest/letsplay/`): `PlayerAgent` + `HeuristicPolicy`
  over `RealEngineHarness`, `npm run letsplay`, transcript + error sink.
- **CI gates today:** `lefthook` pre-push runs build + lint + full-test + the
  `test:playtest` harness; CI mirrors these. The letsplay run slots beside `test:playtest`.
- **Balance signals to watch** come from `balance.ts` (income curve, prices) — the same
  knobs the economy plan tunes.

## Development Approach
- **Testing approach: TDD.** A pure **session-report evaluator** (transcript + metrics →
  pass/fail against thresholds) is unit-tested; the CI runner is deterministic (seeded)
  so failures are reproducible. Keep it **fast** (a bounded session count/step budget) so
  it fits the pre-push budget.
- Dev-only (under `src/tests/`); never touches prod.

## Implementation Steps

### Task 1: Metrics + report evaluator
**Files:**
- Create: `src/tests/playtest/letsplay/sessionMetrics.ts` (+ test)

- [x] Aggregate a session into metrics: errors/soft-locks, invariant violations, and
      balance signals (credits/day, days-to-first-upgrade, survival). `evaluate(report,
      thresholds)` → pass/fail with reasons.
- [x] write tests: clean session passes; injected error/soft-lock/out-of-band metric fails.
- [x] run tests — green.

### Task 2: Deterministic multi-session CI runner
**Files:**
- Create: `src/tests/playtest/letsplay/ci.run.ts` (+ a `letsplay:ci` script)

- [x] Run K seeded sessions of N steps, aggregate via `evaluate`, exit non-zero on
      failure with a readable report; bound runtime for the pre-push budget.
- [x] write a test: the runner flags a deliberately broken build and passes a healthy one.
- [x] run tests — green.

### Task 3: Wire into CI + thresholds
**Files:**
- Modify: `lefthook.yml` / CI workflow, `package.json`

- [x] Add `letsplay:ci` to the pre-push/CI gate (after `test:playtest`); set initial
      thresholds with headroom; document how to update bands when balance intentionally
      changes. (`lefthook.yml` `letsplay-ci` pre-push command after `playtest`;
      `.github/workflows/letsplay-ci.yml` CI workflow; thresholds = hard-faults-zero +
      measured-empty balance bands left unscored — rebaseline procedure documented in
      `DEFAULT_CI_THRESHOLDS` + `LETSPLAY_ENGINE.md`.)
- [x] verify the gate runs in CI and is reproducible. (Verified locally:
      `npm run letsplay:ci` passes, runs in ~2 s; same seed → identical metrics across
      repeated runs. GitHub CI execution observable on push — workflow wired.)

### Task 4: Automated oddity / asset / visual-sameness assertions
**Files:**
- Create: `src/tests/oddities/balanceInvariants.test.ts`, `assetCoverage.test.ts`, `visualVariety.test.ts`

> Standing rule (memory `feedback-letsplay-oddity-hunting`): the oracle must catch
> *oddities*, not just crashes — balance/logic cringe, missing images, and visual
> sameness like the all-yellow suns.

- [x] **Balance invariants:** no gear item is strictly dominated by a cheaper one
      (price-vs-value monotonic per role); no dead stat (e.g. `cooldownTurns` must affect
      fire cadence); the player can match/outrun a basic NPC; reachable escape range;
      delivery/combat rewards are bounded (not guaranteed-profit printers).
      (`balanceInvariants.test.ts`: weapon/equipment no-dominance, `weaponFireIntervalMs`
      strictly monotonic in `cooldownTurns` + distinct cadences across the real catalog,
      best engine's real `ShipLoadout.derivedStats().speed` ≥ `npcSpeed` while the starter
      stays below it (escape is upgrade-gated), delivery-margin + artifact-payout bounds.)
- [x] **Asset coverage:** every `pickVariant` prefix used in production resolves to ≥1
      asset (no entity renders a missing/placeholder image); flag categories whose art
      exists but is *never referenced* (e.g. unused `star_maps`).
      (`assetCoverage.test.ts`: every prod (category, prefix) — planets/planet_maps/surfaces/
      star_maps/ships/player_ships/portraits/nebula/station, mirrors typed against the live
      enums so a new type without art fails — resolves; orphan-category sweep flags any art
      folder with no render path, allowlisting the two genuinely-unwired families found:
      `icons` + `stars` (legacy, superseded by equirect `star_maps`).)
- [x] **Visual variety:** a generated galaxy yields varied star types (not all yellow);
      same-type planets/backdrops spread across variants rather than collapsing to one.
      (Purely-pixel checks stay manual via `window.__gameEngine` screenshots.)
      (`visualVariety.test.ts`: ≥3 distinct star types over seeded draws + no type >60%;
      each prod art family ships ≥2 variants AND `pickVariantKey` spreads many ids across
      them — guards both type-collapse and variant-collapse.)
- [x] write the assertions; wire them into `letsplay:ci`. run — green. (Added
      `src/tests/oddities` to the `letsplay:ci` script; gate green at 94 tests / ~2.5 s.)

### Task 5: Verify + docs
- [x] full suite + the new gate green; lint/build ok; document the oracle (what it
      catches, how to triage a failure, how to rebaseline a band). (Verified:
      `npm run test:run` 3421 pass / 4 skip; `npm run letsplay:ci` 94 pass ~2.5 s;
      `npm run lint` 0 errors; `npm run build` clean. Docs: `LETSPLAY_ENGINE.md`
      Oracle section now covers all three layers — played-session metrics + the
      Task-4 static oddity assertions (balance/asset/visual) — with a new
      "Triaging a failure" workflow and the existing rebaselining procedure.)

## Post-Completion
**Manual:** introduce a known soft-lock locally → the oracle fails the gate with a clear
report; revert → green. Once the memory agent lands, swap the policy for richer coverage.
