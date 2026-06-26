/**
 * Pure Cyrillic-literal scanner core (`docs/plans/20260625-localization-i18n.md`).
 *
 * Walks a TypeScript source string and reports Cyrillic found **inside string
 * literals only**, skipping comments (line + block) — Russian prose in comments
 * is fine; only player-facing literals are migration backlog.
 *
 * This lives in `src/` (not `tools/`) so BOTH the migration tracker
 * (`tools/i18n/extract.ts`, which re-exports it) and the in-suite
 * "migrated scenes hold no inline literal" guard (`src/tests/i18n/`) share one
 * implementation — a `tools/` module can't be imported from `src/` (the build's
 * `rootDir: src`), but a `tools/` script importing `src/` is fine.
 */

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
