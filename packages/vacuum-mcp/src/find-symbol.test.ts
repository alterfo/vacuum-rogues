/**
 * Tests run against the real vacuum-mcp source tree itself — so the package
 * acts as its own integration fixture.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { findSymbol, findSymbolText, findTestsFor } from "./find-symbol.js";

const ROOT = resolve(import.meta.dirname, "..");
// Search inside the package's own src/ directory
const OPTS = { searchDirs: ["src"] };

describe("findSymbol", () => {
  it("finds an exported function and returns its full body", () => {
    const matches = findSymbol("findSymbol", ROOT, OPTS);
    expect(matches.length).toBeGreaterThan(0);
    const m = matches[0];
    expect(m.text).toContain("function findSymbol");
    expect(m.text).toContain("SymbolMatch[]");
    expect(m.endLine).toBeGreaterThan(m.startLine + 5);
  });

  it("returns file path and line range", () => {
    const matches = findSymbol("findSymbol", ROOT, OPTS);
    expect(matches[0].file).toMatch(/find-symbol\.ts$/);
    expect(matches[0].startLine).toBeGreaterThan(0);
  });

  it("returns empty array for unknown symbol", () => {
    expect(findSymbol("__NoSuchSymbol__", ROOT, OPTS)).toHaveLength(0);
  });

  it("rejects invalid identifiers", () => {
    expect(() => findSymbol("foo-bar", ROOT, OPTS)).toThrow(/not a valid identifier/);
  });

  it("finds interface declaration", () => {
    const matches = findSymbol("SymbolMatch", ROOT, OPTS);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].text).toContain("interface SymbolMatch");
  });

  it("finds type alias", () => {
    const matches = findSymbol("SupportedLang", ROOT, OPTS);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].text).toContain("SupportedLang");
  });
});

describe("findSymbolText", () => {
  it("formats result as 'file:start-end\\nbody'", () => {
    const text = findSymbolText("findSymbol", ROOT, OPTS);
    expect(text).toMatch(/find-symbol\.ts:\d+-\d+/);
    expect(text).toContain("function findSymbol");
  });

  it("returns error message for invalid identifier", () => {
    const text = findSymbolText("123bad", ROOT, OPTS);
    expect(text).toContain("not a valid identifier");
  });

  it("returns not-found message for missing symbol", () => {
    const text = findSymbolText("__Missing__", ROOT, OPTS);
    expect(text).toContain("no declaration found");
  });
});

describe("findTestsFor", () => {
  it("finds this test file for find-symbol.ts", () => {
    const results = findTestsFor("src/find-symbol.ts", ROOT);
    expect(results.some((f) => f.includes("find-symbol.test"))).toBe(true);
  });

  it("returns empty for non-existent source", () => {
    expect(findTestsFor("src/nonexistent.ts", ROOT)).toHaveLength(0);
  });
});
