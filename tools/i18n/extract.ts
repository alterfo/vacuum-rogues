/**
 * i18n extraction scanner — a **migration tracker** for the RU → EN localization
 * (`docs/plans/20260625-localization-i18n.md`).
 *
 * The game's UI started as hardcoded Russian; strings migrate onto `t(...)` keys
 * scene-by-scene. This scanner lists the **remaining inline Cyrillic string
 * literals** so the backlog is visible and shrinks measurably as scenes migrate.
 *
 * Design:
 *   - `findCyrillicLiterals(source)` is the **pure** core — a tiny char-level
 *     state machine that walks the source, SKIPPING comments (line + block) and
 *     reporting only Cyrillic inside actual string literals (`'…'`, `"…"`,
 *     `` `…` ``). Comments are usually explanatory Russian and must NOT count as
 *     backlog; only player-facing literals do.
 *   - `scanFiles(roots, projectRoot)` walks the `.ts` files under the given
 *     roots, skips the i18n dictionaries themselves (their Cyrillic VALUES are
 *     intentional) and `*.test.ts`, and aggregates the hits.
 *   - The CLI prints a per-file count summary (descending) + a grand total.
 *
 * Lives under `tools/` (not `src/`) so it stays out of the build graph; its test
 * is `tools/i18n/extract.test.ts` (importing a `tools/` module from `src/` would
 * violate the build's `rootDir: src`).
 *
 * Usage:
 *   npx tsx tools/i18n/extract.ts                  # scan default roots
 *   npx tsx tools/i18n/extract.ts src/presentation # scan a specific root
 *   npx tsx tools/i18n/extract.ts --list           # list every hit (file:line)
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The scanner core (pure string walker + the `node:fs` file walker) lives in
// `src/i18n/cyrillicLiterals.ts` so the in-suite guards (migrated-scenes +
// `noHardcodedCyrillic` ratchet) share one implementation — a `tools/` module
// can't be imported from `src/` (the build's `rootDir: src`), but this `tools/`
// script importing `src/` is fine (tools are outside the build graph). This
// file is now just the CLI front-end + a convenience re-export.
import {
  DEFAULT_SCAN_ROOTS,
  findCyrillicLiterals,
  isExcluded,
  scanFiles,
  totalHits,
  type CyrillicHit,
  type FileBacklog,
} from "../../src/i18n/cyrillicLiterals";

export {
  DEFAULT_SCAN_ROOTS,
  findCyrillicLiterals,
  isExcluded,
  scanFiles,
  totalHits,
};
export type { CyrillicHit, FileBacklog };

function main(): void {
  const argv = process.argv.slice(2);
  const list = argv.includes("--list");
  const roots = argv.filter((a) => !a.startsWith("--"));
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const scanRoots = roots.length > 0 ? roots : DEFAULT_SCAN_ROOTS;

  const backlogs = scanFiles(scanRoots, projectRoot);
  const total = totalHits(backlogs);

  process.stdout.write(
    `i18n backlog: ${total} inline Cyrillic literal(s) in ` +
      `${backlogs.length} file(s) under [${scanRoots.join(", ")}]\n\n`,
  );

  for (const b of backlogs) {
    process.stdout.write(`  ${String(b.hits.length).padStart(4)}  ${b.file}\n`);
    if (list) {
      for (const h of b.hits) {
        const preview =
          h.text.length > 60 ? `${h.text.slice(0, 57)}…` : h.text;
        process.stdout.write(`        ${h.line}: ${preview}\n`);
      }
    }
  }
}

// Run only when invoked directly (tsx), not when imported by tests.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
