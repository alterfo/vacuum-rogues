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

- [ ] Aggregate a session into metrics: errors/soft-locks, invariant violations, and
      balance signals (credits/day, days-to-first-upgrade, survival). `evaluate(report,
      thresholds)` → pass/fail with reasons.
- [ ] write tests: clean session passes; injected error/soft-lock/out-of-band metric fails.
- [ ] run tests — green.

### Task 2: Deterministic multi-session CI runner
**Files:**
- Create: `src/tests/playtest/letsplay/ci.run.ts` (+ a `letsplay:ci` script)

- [ ] Run K seeded sessions of N steps, aggregate via `evaluate`, exit non-zero on
      failure with a readable report; bound runtime for the pre-push budget.
- [ ] write a test: the runner flags a deliberately broken build and passes a healthy one.
- [ ] run tests — green.

### Task 3: Wire into CI + thresholds
**Files:**
- Modify: `lefthook.yml` / CI workflow, `package.json`

- [ ] Add `letsplay:ci` to the pre-push/CI gate (after `test:playtest`); set initial
      thresholds with headroom; document how to update bands when balance intentionally
      changes.
- [ ] verify the gate runs in CI and is reproducible.

### Task 4: Verify + docs
- [ ] full suite + the new gate green; lint/build ok; document the oracle (what it
      catches, how to triage a failure, how to rebaseline a band).

## Post-Completion
**Manual:** introduce a known soft-lock locally → the oracle fails the gate with a clear
report; revert → green. Once the memory agent lands, swap the policy for richer coverage.
