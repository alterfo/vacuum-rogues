# Golden-save corpus (the save-compatibility safety net)

Beta-testers have **real, progressed saves**. Every balance / schema / catalog
change must keep an old save loadable: it must still **deserialize → validate →
migrate to `CURRENT_VERSION` → re-validate → load into the engine on a resumable
scene**, with credits and galaxy intact and no logged/thrown error.

The `*.json` files here are a **frozen** corpus of representative saves. The gate
`goldenSaveCompat.test.ts` replays them against the *current* code on every run
(plus `loadoutRevalidateOnLoad.test.ts` for catalog-shrink eviction). Run the
whole gate locally with:

```bash
npm run test:save-compat
```

It runs in the pre-push hook (`lefthook.yml` → `save-compat`) and CI
(`.github/workflows/save-compat.yml`), so a save-breaking change fails there
instead of in a beta-tester's browser.

## The fixtures

| File | Version | Why it exists |
|------|---------|---------------|
| `early-current.json` | current | engine-generated, fresh-start baseline |
| `late-banking-current.json` | current | engine-generated: ~4M credits, savings ledger, frigate loadout |
| `progressed-v23.json` | 23 | hand-pinned: exercises the v23→`CURRENT` migration chain end-to-end |
| `legacy-v1.json` | 1 | hand-pinned: the oldest shape we still promise to load (full migration chain) |

Engine-generated fixtures (`*-current.json`) come from the **opt-in** generator
`generateGoldenSaves.test.ts`; the older-version fixtures are authored by hand
because they predate features the current engine can no longer produce.

## When to add a golden save

**Add one whenever a new *persisted* feature ships** — i.e. any change that
touches `src/types/index.ts` / `src/domain/**` + `schemas.ts` (+ a
`MigrationPipeline` migration & `CURRENT_VERSION` bump). The new save should
exercise the new field at a non-default value, so a future regression that
mis-migrates it is caught.

### Refresh the engine-generated fixtures

After a new persisted feature, regenerate the current-version saves so they carry
the new field, then commit the emitted JSON:

```bash
GEN_GOLDEN=1 npm test -- --run src/tests/data/goldenSaves/generateGoldenSaves.test.ts
```

(The generator is skipped without `GEN_GOLDEN=1` so a normal run never silently
re-freezes the corpus to the current code shape — that would defeat the point of
a frozen baseline.)

### Pin an older-version save by hand

To prove the migration chain across a version boundary, **do not** regenerate —
copy an existing lower-version fixture, hand-edit it to the shape that version
produced (omit fields added later; the schema tolerates them via
`.optional()`/`.default()`), set its `version`, and commit it. The gate asserts
the corpus spans more than one version and includes at least one save below
`CURRENT_VERSION`, so always keep a genuinely-old fixture here.
