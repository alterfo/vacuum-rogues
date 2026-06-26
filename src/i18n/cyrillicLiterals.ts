/**
 * Pure Cyrillic-literal scanner core (`docs/plans/20260625-localization-i18n.md`).
 *
 * Walks a TypeScript source string and reports Cyrillic found **inside string
 * literals only**, skipping comments (line + block) — Russian prose in comments
 * is fine; only player-facing literals are migration backlog.
 *
 * This lives in `src/` (not `tools/`) so BOTH the migration tracker
 * (`tools/i18n/extract.ts`, which re-exports it) and the in-suite guards
 * (`src/tests/i18n/` — the migrated-scenes hard-zero guard AND the
 * `noHardcodedCyrillic` ratchet) share one implementation — a `tools/` module
 * can't be imported from `src/` (the build's `rootDir: src`), but a `tools/`
 * script importing `src/` is fine. The filesystem walker `scanFiles` lives here
 * too (not just the pure string scanner) for the same reason: the src-side
 * ratchet test needs it but cannot reach into `tools/`. It is **test/tool-only**
 * — no production module imports this file, so the `node:fs` dependency never
 * enters the browser bundle.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
export const CYRILLIC = /[Ѐ-ӿ]/;

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

/**
 * Default roots to scan — the player-facing layers where UI strings live. Other
 * roots can be passed explicitly on the CLI / to {@link scanFiles}.
 */
export const DEFAULT_SCAN_ROOTS = [
  "src/presentation",
  "src/systems",
  "src/ai",
] as const;

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
