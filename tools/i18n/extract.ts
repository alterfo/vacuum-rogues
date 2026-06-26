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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A single inline Cyrillic string literal found in source. */
export interface CyrillicHit {
  /** Source file (as passed in / project-relative for `scanFiles`). */
  file: string;
  /** 1-based line where the literal opens. */
  line: number;
  /** The literal's content (without the surrounding quotes). */
  text: string;
}

/** Matches any Cyrillic code point (basic + supplement blocks). */
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Default roots to scan — the player-facing layers where UI strings live. Other
 * roots can be passed explicitly on the CLI.
 */
export const DEFAULT_SCAN_ROOTS = [
  "src/presentation",
  "src/systems",
  "src/ai",
] as const;

/**
 * Scan one source string for inline Cyrillic **string literals**, skipping
 * comments. Pure and deterministic — the unit-testable core of the scanner.
 *
 * The walker is a small state machine over characters so it correctly:
 *   - ignores `// line` and `/* block *\/` comments (Russian prose there is fine);
 *   - treats `'…'`, `"…"`, and `` `…` `` as literals and reports Cyrillic inside;
 *   - honours backslash escapes inside literals (so `\'` doesn't end a string).
 *
 * It is intentionally approximate (no full JS parse): a regex literal that
 * embeds a quote could be mis-read, but Cyrillic inside a regex is vanishingly
 * rare and this is a tracker, not a compiler.
 */
export function findCyrillicLiterals(
  source: string,
  file = "<source>",
): CyrillicHit[] {
  const hits: CyrillicHit[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // Line comment — consume to end of line.
    if (c === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    // Block comment — consume to the closing `*/`, counting newlines.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2; // skip the closing `*/`
      continue;
    }

    // String / template literal — capture content, honouring escapes.
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const startLine = line;
      i++;
      let buf = "";
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          // Escape: keep both chars, count an escaped newline.
          if (source[i + 1] === "\n") line++;
          buf += ch + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        if (ch === "\n") line++; // template literals may span lines
        buf += ch;
        i++;
      }
      if (CYRILLIC.test(buf)) hits.push({ file, line: startLine, text: buf });
      continue;
    }

    if (c === "\n") line++;
    i++;
  }

  return hits;
}

/** True for a path the scanner must skip (its own dicts / test files). */
export function isExcluded(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return (
    p.includes("/i18n/") ||
    p.startsWith("i18n/") ||
    p.endsWith(".test.ts") ||
    p.endsWith(".d.ts")
  );
}

/** Recursively collect `.ts` files under `dir` (absolute paths). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // missing root → nothing to scan
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** One file's contribution to the backlog. */
export interface FileBacklog {
  /** Project-relative path. */
  file: string;
  /** Cyrillic literals found in it. */
  hits: CyrillicHit[];
}

/**
 * Scan every `.ts` file under `roots` (resolved against `projectRoot`), skipping
 * excluded paths, and return per-file backlogs that have ≥1 hit, sorted by hit
 * count descending. Files are reported by their `projectRoot`-relative path.
 */
export function scanFiles(
  roots: readonly string[],
  projectRoot: string,
): FileBacklog[] {
  const backlogs: FileBacklog[] = [];
  for (const root of roots) {
    const absRoot = resolve(projectRoot, root);
    for (const abs of collectTsFiles(absRoot)) {
      const rel = relative(projectRoot, abs).replace(/\\/g, "/");
      if (isExcluded(rel)) continue;
      const hits = findCyrillicLiterals(readFileSync(abs, "utf8"), rel);
      if (hits.length > 0) backlogs.push({ file: rel, hits });
    }
  }
  backlogs.sort((a, b) => b.hits.length - a.hits.length);
  return backlogs;
}

/** Total number of Cyrillic literals across a backlog list. */
export function totalHits(backlogs: FileBacklog[]): number {
  return backlogs.reduce((sum, b) => sum + b.hits.length, 0);
}

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
