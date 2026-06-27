---
# Offline LLM Oddity-Judge + Scenario Generator

## Overview
A **deep-sweep layer that runs OFF the push hot-path** (nightly / on-demand, never
in pre-push) to catch the open-ended *semantic* oddities the deterministic oracles
miss — exactly the 2026-06-25 beta classes: "killed a pirate with 1000 cr and got
nothing", "rep fell to −50 with no way back", "quest target 6 jumps away but the
deadline is 30 days", stuck progression with zero feedback. The fast, deterministic
port-agent + invariants stay the cheap pre-push gate; this adds an LLM that
*judges* what the agent played and *generates* new things for it to try.

Two pieces:
1. **LLM-as-judge.** The fast letsplay agent plays K sessions and emits a
   **judge-ready transcript** (per-step scene/action/vitals-delta/day + notable log
   lines + a session summary; optional periodic screenshots). An offline script
   feeds each transcript to Claude with an oddity rubric and gets back a structured
   report (oddity + severity + evidence step-refs). Open-ended "is this absurd /
   unfair / a dead-end?" judgment no hand-written oracle can encode.
2. **LLM-as-scenario-generator.** Claude proposes a diverse curriculum of play
   goals ("go bankrupt", "max reputation then crash it", "ignore the Overmind 200
   days", "hoard one good"), emitted as machine-readable scenario configs the agent
   then executes — widening state coverage so the judge sees more.

**Hard constraints:** dev-only (never in the prod bundle or the pre-push gate — LLM
calls are slow, paid, and non-deterministic, which would make a gate flaky and
expensive); the LLM client is **injectable/mockable** so all tests are
deterministic and free; everything lives under `tools/` / `src/tests/`. No
domain/schema/save change.

## Context
- **Depends on the executor build** `docs/plans/20260627-letsplay-full-game-play-and-net-retrain.md`
  (Tasks 1-5): the judge is only as good as how much game the agent actually plays.
  Task 1 (day-advance) is done; richer transcripts arrive as Tasks 2-5 land. This
  plan can start on transcript plumbing in parallel but its *value* scales with the
  executors.
- **Agent + transcript:** `src/tests/playtest/letsplay/PlayerAgent.ts`
  (`AgentRunResult.steps` already records `{index, scene, action}`); `observe.ts`
  (the `Observation` to diff); `sessionMetrics.ts` (existing aggregate metrics);
  the harness error sink (`RealEngineHarness.errors()` — the captured log stream).
- **Screenshots (optional):** the dev autopilot drives the *rendered* game
  (`installAutopilotHook.ts` / `LiveApplier.ts`) and `e2e/` (Playwright) can capture
  frames — reuse for the visual judge rather than inventing capture.
- **LLM access:** the Anthropic SDK (`@anthropic-ai/sdk`). Use the latest Claude;
  default a cost-appropriate model for high-volume judging (Sonnet) with Opus
  selectable for a deeper pass — configurable. Wrap every call behind a small
  `LlmClient` interface so tests inject a fake. (See the `claude-api` reference for
  current model ids / params before writing the call layer.)
- **Oddity rubric source of truth:** the beta-bug classes + `src/tests/oddities/`
  invariants; the judge complements (not replaces) them.
- **Conventions:** dev-only enforced like the letsplay engine
  (`letsplayDevOnly.test.ts`); no `console.log` (use the logger); throw only the
  project exception types.

## Development Approach
Regular (code-first) with tests-per-task. The LLM boundary is the key design move:
a pure `LlmClient` port means the transcript builder, prompt assembly, report parser,
and scenario parser are all unit-tested deterministically against a **fake client** —
real API calls happen only when a script is run manually with a key. This plan adds
**no pre-push gate** (explicitly) — `letsplay:judge` is a separate offline script;
the cheap deterministic gate is untouched. Build the transcript artifact first
(useful on its own), then the judge, then the scenario generator. YAGNI: skip
screenshots in v1 unless the text transcript proves insufficient.

## Implementation Steps

### Task 1: Judge-ready session transcript artifact
**Files:**
- Create: src/tests/playtest/letsplay/transcript.ts
- Create: src/tests/playtest/letsplay/transcript.test.ts
- Modify: src/tests/playtest/letsplay/PlayerAgent.ts (emit the richer record)

- [x] Define a structured, serialisable `SessionTranscript` (seed, per-step `{day, scene, action, vitalsDelta, notableLogs}`, plus a compact session summary: days elapsed, credits curve, rep curve, kills, deaths, quests taken/completed) built purely from the existing run data + the harness log sink.
- [x] Build it from an `AgentRunResult` + observation/log stream without omniscient state (egocentric, like `observe`).
- [x] Write tests: a scripted session produces a transcript with the expected step records + summary; serialises to stable JSON.
- [x] Run tests — must pass before Task 2.

### Task 2: Injectable LLM client port
**Files:**
- Create: tools/ai/llmClient.ts (or src/tests/playtest/letsplay/llmClient.ts)
- Create: <same>.test.ts

- [x] Define a minimal `LlmClient` interface (`complete(messages, opts) → text`/JSON) and a real Anthropic-SDK implementation (model + key from env, configurable model id), plus a `FakeLlmClient` returning canned responses for tests.
- [x] Guard for a missing API key (degrade to a clear error only when actually invoked live; never at import).
- [x] Write tests: the fake client drives the interface; the real client builds the request shape correctly (mocked transport) — no live call in tests.
- [x] Run tests — must pass before Task 3.

### Task 3: LLM oddity-judge over transcripts
**Files:**
- Create: tools/ai/oddityJudge.ts
- Create: tools/ai/oddityJudge.test.ts

- [ ] Assemble a judge prompt from a `SessionTranscript` + an explicit oddity rubric (the beta classes: unrewarded combat, rep dead-end / no recovery feedback, uncollectable loot, quest unreachable-for-deadline, stuck progression, no-feedback events).
- [ ] Parse the model reply into a structured `OddityReport` (list of `{title, severity, evidence: step indices, rationale}`); robust to a malformed reply (degrade to "no structured findings" + raw text, never throw).
- [ ] Write tests against `FakeLlmClient`: a transcript with a planted oddity yields a parsed report flagging it; a clean transcript yields none; a malformed reply degrades safely.
- [ ] Run tests — must pass before Task 4.

### Task 4: LLM scenario generator
**Files:**
- Create: tools/ai/scenarioGen.ts
- Create: tools/ai/scenarioGen.test.ts
- Modify: src/tests/playtest/letsplay/PlayerPolicy.ts or a goal-bias shim (consume a scenario goal)

- [ ] A generator that asks the LLM for N diverse play scenarios and parses them into machine-readable configs `{name, seed?, goal, maxDays}` (goal ∈ a fixed enum the agent understands, e.g. `go-broke`/`max-rep`/`ignore-overmind`/`hoard`/`free-explore`).
- [ ] A thin goal-bias seam so the agent can execute a scenario (bias the policy / pick the seed); keep the default free-play unchanged.
- [ ] Write tests against `FakeLlmClient`: a canned LLM reply parses into valid scenario configs; an unknown goal is dropped, not crashed; the goal-bias seam steers the agent measurably in a short run.
- [ ] Run tests — must pass before Task 5.

### Task 5: `letsplay:judge` offline runner (NOT a gate)
**Files:**
- Create: tools/ai/runJudge.ts (or src/tests/playtest/letsplay/judge.run.ts)
- Modify: package.json (`letsplay:judge` script)
- Modify: src/tests/architecture/letsplayDevOnly.test.ts (assert the new modules stay out of the prod graph)

- [ ] Wire an offline runner: play K sessions (optionally scenario-driven) → transcripts → judge → write a consolidated oddity report to `.letsplay/oddity-report.*` (gitignored).
- [ ] `npm run letsplay:judge` runs it with a real key; with no key it prints a clear "set ANTHROPIC_API_KEY" and exits non-zero — and is **explicitly not** added to `lefthook.yml` pre-push or any CI gate.
- [ ] Write tests: the runner wired to `FakeLlmClient` produces a report end-to-end deterministically; dev-only guard passes (no prod module imports any of this).
- [ ] Run tests — must pass before Task 6.

### Task 6: Validate the judge reproduces a known shipped bug (vision path)
**Files:**
- Create: tools/ai/visionJudge.ts (screenshot-capable judge)
- Create: src/tests/fixtures/oddities/ (captured pre-fix screenshots / transcripts)
- Create: tools/ai/visionJudge.test.ts

- [ ] Promote the screenshot/vision judge from optional to real: a Claude **vision** call over captured frames + the transcript — text-only judging cannot see visual oddities.
- [ ] **User-requested self-test:** feed a PRE-FIX fixture of the bugs ralphex is fixing now — quest-card TEXT OVERFLOW + MISSING ship-death explosion — and assert the vision judge flags them. These are VISUAL, so they validate the vision path specifically; the text judge (Tasks 1-3) provably cannot catch them — that asymmetry is exactly what this check proves.
- [ ] Capture the fixtures from the pre-fix state (a saved screenshot/transcript, or a temporary fixture-gen revert) so the check is reproducible after the live bugs are gone.
- [ ] Write tests against a `FakeLlmClient` returning a canned vision verdict so the validation logic is deterministic; the live vision call runs only in the offline runner.
- [ ] Run tests — must pass before Task 7.

### Task 7: Verify acceptance + document
**Files:**
- Modify: docs/architecture/LETSPLAY_ENGINE.md
- Modify: tools/ai/README.md

- [ ] Full unit suite + `npm run test:playtest` + lint green; `npm run letsplay:judge` (fake-client path) produces a report.
- [ ] Confirm nothing here touches the prod bundle or the pre-push/CI gates (cost + determinism), and the cheap deterministic gate is unchanged.
- [ ] Document the three-tier model: fast deterministic gate (every push) → Playwright E2E (visual, targeted) → offline LLM judge + scenario-gen (deep sweep, manual/nightly, paid).

## Post-Completion
*Informational — no checkboxes:*
- Needs `ANTHROPIC_API_KEY` to run live; costs scale with sessions × transcript size — prefer Sonnet/Haiku for the high-volume judge, Opus for a periodic deep pass.
- Value scales with the executor build (`20260627-letsplay-full-game-play-and-net-retrain.md`): the more game the agent plays (Tasks 2-5 there), the more the judge can flag. Best sequenced after those land.
- Optional v2: feed periodic screenshots (via the autopilot/E2E capture) to a vision-capable Claude for visual oddities (suns/missing art/sameness) the text transcript can't show.
