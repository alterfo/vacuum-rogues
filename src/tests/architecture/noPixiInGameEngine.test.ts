import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SYSTEMS_ROOT = resolve(__dirname, "..", "..", "systems");

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

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

function isPixiImport(spec: string): boolean {
  return (
    spec === "pixi.js" ||
    spec.startsWith("pixi.js/") ||
    spec.startsWith("@pixi/")
  );
}

describe("src/systems/**/*.ts never imports pixi.js", () => {
  it("no file under src/systems/ has a static or dynamic pixi.js import", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SYSTEMS_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(source).filter(isPixiImport)) {
        offenders.push(`${relative(SYSTEMS_ROOT, file)} imports "${spec}"`);
      }
    }
    expect(
      offenders,
      "systems/ must not import pixi.js — route UI through IOverlayPresenter " +
        "(core/ports/IOverlayPresenter.ts), implemented by " +
        `presentation/OverlayPresenter.ts.\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });
});
