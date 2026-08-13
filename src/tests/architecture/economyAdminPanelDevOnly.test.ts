import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC_ROOT = resolve(__dirname, "..", "..");
const TESTS_DIR = join(SRC_ROOT, "tests");
const MAIN_TS = join(SRC_ROOT, "main.ts");
const PANEL_FILE = join(SRC_ROOT, "dev", "EconomyAdminPanel.ts");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function productionTsFiles(): string[] {
  return collectTsFiles(SRC_ROOT).filter((f) => !f.startsWith(TESTS_DIR + sep));
}

function staticSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:^|[\n;])\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]);
  const bare = /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g;
  while ((m = bare.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

function dynamicSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join(SRC_ROOT, spec.slice(2));
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolve(dirname(fromFile), spec);
  }
  return null;
}

function resolvesToPanel(fromFile: string, spec: string): boolean {
  const resolved = resolveSpecifier(fromFile, spec);
  if (resolved === null) return false;
  return resolved === PANEL_FILE || `${resolved}.ts` === PANEL_FILE;
}

describe("economy admin panel is dev-only (never in prod)", () => {
  it("the panel module exists", () => {
    expect(existsSync(PANEL_FILE)).toBe(true);
  });

  it("no production module other than main.ts references the panel", () => {
    const offenders: string[] = [];
    for (const file of productionTsFiles()) {
      if (file === MAIN_TS) continue;
      const source = readFileSync(file, "utf8");
      for (const spec of [
        ...staticSpecifiers(source),
        ...dynamicSpecifiers(source),
      ]) {
        if (resolvesToPanel(file, spec)) {
          offenders.push(`${relative(SRC_ROOT, file)} imports "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      `Only main.ts (DEV-gated, dynamic import) may reference the dev economy ` +
        `admin panel — it must never ship as a static production dependency:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("main.ts's reference to the panel is a DEV-gated dynamic import", () => {
    const source = readFileSync(MAIN_TS, "utf8");
    const offenders: string[] = [];

    for (const spec of staticSpecifiers(source)) {
      if (resolvesToPanel(MAIN_TS, spec)) {
        offenders.push(
          `main.ts statically imports "${spec}" (must be dynamic)`,
        );
      }
    }

    let found = false;
    const re = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (!resolvesToPanel(MAIN_TS, m[1])) continue;
      found = true;
      if (source.lastIndexOf("import.meta.env.DEV", m.index) === -1) {
        offenders.push(
          `main.ts dynamic-imports the panel without a preceding ` +
            `import.meta.env.DEV gate (would ship in the prod bundle)`,
        );
      }
    }

    expect(
      found,
      "main.ts should dynamically import the economy admin panel",
    ).toBe(true);
    expect(offenders).toEqual([]);
  });
});
