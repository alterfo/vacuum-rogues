# Oddity vision-judge fixtures (pre-fix, dev-only)

Captured **pre-fix** fixtures for the vision oddity-judge self-test
(`tools/ai/visionJudge.test.ts`, Task 6 of
`docs/plans/20260627-llm-oddity-judge-and-scenario-generator.md`).

Each fixture pairs a captured **frame** with the **transcript** context at capture
time and an **expected-bug oracle** (`ExpectedVisualBug`). They encode two known
shipped **visual** bugs:

| id | bug | why the *text* judge can't catch it |
|----|-----|--------------------------------------|
| `questCardTextOverflow` | quest card description text overflows its card | overflow is a layout fact, not in the log/vitals |
| `shipDeathNoExplosion` | NPC destroyed but no explosion/death VFX drawn | the *absence* of a sprite can't appear in a transcript |

This asymmetry is the point of the vision path: feed the same transcript to the
text judge (Tasks 1–3) and it sees nothing; attach the **frame** and the vision
judge flags the bug. The deterministic test proves this against a faked LLM
verdict (no key, no network).

## Files

- `index.ts` — the typed fixtures: transcript (a TS object), the frame(s), and
  the `ExpectedVisualBug` keywords. `loadVisualBugFixtures()` returns them all.
- `frames/<id>.png.b64` — the captured frame, base64-encoded (committed as text so
  the repo carries no binary). Loaded + decoded by `index.ts`.

## The frames are PLACEHOLDERS

The committed `frames/*.png.b64` are tiny solid-colour PNGs, not real screenshots.
The **deterministic test drives a fake LLM verdict**, so frame pixels don't affect
it — the placeholders keep the suite self-contained and binary-free.

To run the **live** vision call against the real bug (offline runner, real key),
replace the placeholder with a real **pre-fix** screenshot:

1. Capture the frame from the rendered game (the dev autopilot / Playwright E2E
   capture path), saved as PNG.
2. Base64-encode it into the matching file, e.g.
   `base64 -i shot.png | tr -d '\n' > frames/questCardTextOverflow.png.b64`.
3. Keep the `ExpectedVisualBug` keywords in `index.ts` aligned with what a correct
   flag would say.

Capturing a *pre-fix* frame after the live bug is fixed needs a temporary revert
(check out the pre-fix commit, capture, restore) — see the plan's Task 6 notes.
