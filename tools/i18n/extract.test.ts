/**
 * i18n extraction scanner test (Task 2) — guards the migration tracker.
 *
 * Covers the pure `findCyrillicLiterals` (finds Cyrillic in string literals,
 * ignores comments + ASCII-only literals, handles every quote style) and the
 * filesystem walker `scanFiles` (reports a backlog from a temp source tree,
 * skipping the i18n dicts + test files).
 *
 * Lives under `tools/` (not `src/tests/`) like the other tool tests
 * (`tools/optimize-assets.test.ts`) — importing a `tools/` module from `src/`
 * would violate the build's `rootDir: src`. Vitest's `tools/**` glob (see
 * `vitest.config.ts`) picks it up so it runs with the suite.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_ROOTS,
  findCyrillicLiterals,
  isExcluded,
  scanFiles,
  totalHits,
  type FileBacklog,
} from "./extract";

describe("findCyrillicLiterals — pure scanner", () => {
  it("finds a Cyrillic string literal in code", () => {
    const hits = findCyrillicLiterals(`const label = "Назад";`);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("Назад");
    expect(hits[0].line).toBe(1);
  });

  it("ignores Cyrillic inside line comments", () => {
    expect(findCyrillicLiterals(`// это комментарий\nconst x = 1;`)).toEqual([]);
  });

  it("ignores Cyrillic inside block comments (and counts lines past them)", () => {
    const src = `/* блок\n   комментарий */\nconst label = "Привет";`;
    const hits = findCyrillicLiterals(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("Привет");
    expect(hits[0].line).toBe(3);
  });

  it("ignores ASCII-only literals", () => {
    expect(findCyrillicLiterals(`const x = "Back"; const y = 'OK';`)).toEqual([]);
  });

  it("handles single, double, and template quotes", () => {
    const src = "const a = 'Да'; const b = \"Нет\"; const c = `Старт`;";
    const texts = findCyrillicLiterals(src).map((h) => h.text);
    expect(texts).toEqual(["Да", "Нет", "Старт"]);
  });

  it("honours escaped quotes inside a literal", () => {
    const hits = findCyrillicLiterals(`const s = "Он сказал \\"Привет\\"";`);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("Привет");
  });

  it("reports the line of multi-literal source correctly", () => {
    const src = `const a = "Один";\nconst b = "Два";`;
    const hits = findCyrillicLiterals(src);
    expect(hits.map((h) => h.line)).toEqual([1, 2]);
  });

  it("attaches the supplied file name to each hit", () => {
    const hits = findCyrillicLiterals(`"Привет"`, "src/foo.ts");
    expect(hits[0].file).toBe("src/foo.ts");
  });
});

describe("isExcluded", () => {
  it("excludes the i18n dictionaries and test/decl files", () => {
    expect(isExcluded("src/i18n/ru.ts")).toBe(true);
    expect(isExcluded("src/presentation/Foo.test.ts")).toBe(true);
    expect(isExcluded("src/types/index.d.ts")).toBe(true);
  });

  it("does not exclude a normal scene file", () => {
    expect(isExcluded("src/presentation/PlanetScene.ts")).toBe(false);
  });
});

describe("scanFiles — backlog over a temp source tree", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "i18n-scan-"));
    mkdirSync(join(root, "src", "presentation"), { recursive: true });
    mkdirSync(join(root, "src", "i18n"), { recursive: true });

    // Two scene files with Cyrillic literals (the backlog).
    writeFileSync(
      join(root, "src", "presentation", "A.ts"),
      `const t1 = "Купить"; const t2 = "Продать"; // продаём\n`,
    );
    writeFileSync(
      join(root, "src", "presentation", "B.ts"),
      `const t = "Назад";\nconst n = 42; // только ASCII в коде\n`,
    );
    // The i18n dict — Cyrillic values are intentional, must be skipped.
    writeFileSync(
      join(root, "src", "i18n", "ru.ts"),
      `export const ru = { "common.back": "Назад" };\n`,
    );
    // A test file — must be skipped.
    writeFileSync(
      join(root, "src", "presentation", "A.test.ts"),
      `it("renders", () => { expect("Купить").toBeTruthy(); });\n`,
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the backlog, sorted by hit count, skipping dicts + tests", () => {
    const backlogs = scanFiles(["src/presentation", "src/i18n"], root);
    const files = backlogs.map((b: FileBacklog) => b.file);

    // A.ts (2 hits) before B.ts (1 hit); dict + test excluded entirely.
    expect(files).toEqual(["src/presentation/A.ts", "src/presentation/B.ts"]);
    expect(backlogs[0].hits).toHaveLength(2);
    expect(backlogs[1].hits).toHaveLength(1);
    expect(totalHits(backlogs)).toBe(3);
  });

  it("returns an empty backlog for a missing root", () => {
    expect(scanFiles(["src/does-not-exist"], root)).toEqual([]);
  });
});

describe("scanFiles — against the real repo (smoke / migration tracker)", () => {
  it("the default roots still hold an un-migrated backlog (Task 3 pending)", () => {
    // Project root is two levels up from tools/i18n/.
    const projectRoot = join(__dirname, "..", "..");
    const backlogs = scanFiles(DEFAULT_SCAN_ROOTS, projectRoot);
    // Nothing migrated yet beyond settings/common → the backlog is non-empty,
    // proving the scanner actually surfaces inline literals to migrate.
    expect(totalHits(backlogs)).toBeGreaterThan(0);
  });
});
