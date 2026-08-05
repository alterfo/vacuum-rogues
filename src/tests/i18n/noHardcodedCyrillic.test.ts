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
const PROJECT_ROOT = resolve(HERE, "../../..");
const BASELINE_PATH = resolve(HERE, "cyrillicBaseline.json");

type Baseline = Record<string, number>;

const backlogs: FileBacklog[] = scanFiles(DEFAULT_SCAN_ROOTS, PROJECT_ROOT);
const byFile = new Map(backlogs.map((b) => [b.file, b]));

const current: Baseline = {};
for (const b of backlogs) current[b.file] = b.hits.length;

function stableStringify(counts: Baseline): string {
  const sorted: Baseline = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

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
