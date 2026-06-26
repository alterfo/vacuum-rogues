/**
 * No-new-hardcoded-Cyrillic ratchet (`docs/plans/20260626-playtest-bugs-pause-help-infocenter-i18n.md`,
 * Task 7).
 *
 * The migrated-scenes guard (`migratedScenes.test.ts`) enforces a HARD ZERO on
 * the handful of fully-migrated files. This gate is its complement: a per-file
 * **ratchet** over the whole UI source set (`src/presentation` + `src/systems` +
 * `src/ai`) that fails the build the moment a NEW hardcoded Russian string
 * literal appears — WITHOUT forcing the entire ~1500-literal backlog to be
 * migrated at once.
 *
 * How it works (allow-list seeded, green-on-clean):
 *   - `cyrillicBaseline.json` is a snapshot of the CURRENT known backlog
 *     (`file → literal count`). It is the seeded allow-list: every literal that
 *     exists today (incl. content/data catalogs, logs, ids) is grandfathered in.
 *     Comments and the i18n dicts/tests are already skipped by the shared scanner
 *     (`scanFiles` → `findCyrillicLiterals`).
 *   - The gate fails when a file EXCEEDS its baseline (or a previously-clean file
 *     gains a literal) — that is the "new hardcoded user-facing Russian" the plan
 *     wants to block; it reports the offending `file:line`s.
 *   - It also fails when a file DROPS BELOW its baseline — you migrated literals,
 *     so lock the win by regenerating the baseline (keeps the ratchet tight; a
 *     stale-high baseline would let a migrated file silently backslide).
 *
 * Regenerate after an intentional change (a real migration, or an intentional new
 * data literal that must be grandfathered):
 *
 *   UPDATE_CYRILLIC_BASELINE=1 npm test -- --run src/tests/i18n/noHardcodedCyrillic.test.ts
 *
 * The rule for callers: **add a string ⇒ add a key** (route it through `t(...)`,
 * ru/en lockstep) — see CLAUDE.md / `.claude/docs/adding-features.md` → "New UI
 * String (i18n / localization)".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_ROOTS,
  scanFiles,
  type FileBacklog,
} from "@/i18n/cyrillicLiterals";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Project root — three levels up from `src/tests/i18n/`. */
const PROJECT_ROOT = resolve(HERE, "../../..");
const BASELINE_PATH = resolve(HERE, "cyrillicBaseline.json");

/** Per-file allow-list: project-relative path → permitted literal count. */
type Baseline = Record<string, number>;

/** Live backlog of the UI source set, by the shared migration-tracker scanner. */
const backlogs: FileBacklog[] = scanFiles(DEFAULT_SCAN_ROOTS, PROJECT_ROOT);
const byFile = new Map(backlogs.map((b) => [b.file, b]));

/** Current per-file literal counts (the live ratchet position). */
const current: Baseline = {};
for (const b of backlogs) current[b.file] = b.hits.length;

/** Sort keys so the on-disk baseline diffs cleanly. */
function stableStringify(counts: Baseline): string {
  const sorted: Baseline = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

// Regen mode: rewrite the baseline to the live position, then the assertions
// below compare current-vs-itself and pass.
if (process.env.UPDATE_CYRILLIC_BASELINE === "1") {
  writeFileSync(BASELINE_PATH, stableStringify(current), "utf8");
}

const baseline: Baseline = JSON.parse(
  readFileSync(BASELINE_PATH, "utf8"),
) as Baseline;

describe("no new hardcoded Cyrillic (UI source ratchet)", () => {
  it("the baseline is a seeded allow-list (non-empty snapshot of the known backlog)", () => {
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
  });

  it("introduces no NEW hardcoded Cyrillic literal beyond the baseline", () => {
    const offences: string[] = [];
    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        const hits = byFile.get(file)?.hits ?? [];
        const lines = hits
          .map((h) => `      ${file}:${h.line}  ${h.text.slice(0, 50)}`)
          .join("\n");
        const reason =
          allowed === 0
            ? "previously-clean file now has hardcoded Russian"
            : `+${count - allowed} over baseline ${allowed}`;
        offences.push(`  ${file} (${reason}):\n${lines}`);
      }
    }
    expect(
      offences,
      "New hardcoded user-facing Russian — route it through t(key) (ru/en " +
        "lockstep), see CLAUDE.md → Internationalization. If it is intentional " +
        "data (a catalog literal), regenerate the baseline with " +
        "UPDATE_CYRILLIC_BASELINE=1.\n" +
        offences.join("\n"),
    ).toEqual([]);
  });

  it("has not silently shrunk below the baseline (regenerate to lock a migration)", () => {
    const stale: string[] = [];
    for (const [file, allowed] of Object.entries(baseline)) {
      const count = current[file] ?? 0;
      if (count < allowed) {
        stale.push(`  ${file}: now ${count}, baseline ${allowed}`);
      }
    }
    expect(
      stale,
      "Backlog reduced (good!) — lock the win by regenerating the baseline:\n" +
        "  UPDATE_CYRILLIC_BASELINE=1 npm test -- --run " +
        "src/tests/i18n/noHardcodedCyrillic.test.ts\n" +
        stale.join("\n"),
    ).toEqual([]);
  });
});
