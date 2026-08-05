import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface CyrillicHit {
  file: string;
  line: number;
  text: string;
}

export const CYRILLIC = /[Ѐ-ӿ]/;

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

    if (c === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2; // skip the closing `*/`
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const startLine = line;
      i++;
      let buf = "";
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
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

export const DEFAULT_SCAN_ROOTS = [
  "src/presentation",
  "src/systems",
  "src/ai",
] as const;

export function isExcluded(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return (
    p.includes("/i18n/") ||
    p.startsWith("i18n/") ||
    p.endsWith(".test.ts") ||
    p.endsWith(".d.ts")
  );
}

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

export interface FileBacklog {
  file: string;
  hits: CyrillicHit[];
}

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

export function totalHits(backlogs: FileBacklog[]): number {
  return backlogs.reduce((sum, b) => sum + b.hits.length, 0);
}
