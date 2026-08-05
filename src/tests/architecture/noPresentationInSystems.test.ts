import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SYSTEMS_ROOT = resolve(__dirname, "..", "..", "systems");

const ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
  "GameEngine.ts": new Set([
    "@/presentation/GameScene",
    "@/presentation/Renderer",
    "@/presentation/textures",
  ]),
};

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

function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, dq, sq, tq) => (dq || sq || tq ? match : ""),
  );
}

function importSpecifiers(rawSource: string): string[] {
  const source = stripComments(rawSource);
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

function isPresentationImport(spec: string): boolean {
  return (
    spec === "@/presentation" ||
    spec.startsWith("@/presentation/") ||
    /(^|\/)\.\.\/presentation(\/|$)/.test(spec)
  );
}

describe("src/systems/**/*.ts never imports src/presentation/ (except the pinned allowlist)", () => {
  it("has no unsanctioned systems/ → presentation/ import", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SYSTEMS_ROOT)) {
      const rel = relative(SYSTEMS_ROOT, file).split("\\").join("/");
      const allowed = ALLOWLIST[rel];
      for (const spec of importSpecifiers(readFileSync(file, "utf8")).filter(
        isPresentationImport,
      )) {
        if (!allowed?.has(spec)) {
          offenders.push(`${rel} imports "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      "systems/ must not import presentation/ (dependency rule: engine-core ← " +
        "presentation). Route the capability through a port in core/ports with a " +
        "no-op fallback — see docs/architecture/SEAMS.md.\n" +
        offenders.join("\n"),
    ).toHaveLength(0);
  });

  it("keeps every pinned allowlist entry live (no stale exceptions)", () => {
    const stale: string[] = [];
    for (const [rel, specs] of Object.entries(ALLOWLIST)) {
      const source = readFileSync(join(SYSTEMS_ROOT, rel), "utf8");
      const present = new Set(importSpecifiers(source));
      for (const spec of specs) {
        if (!present.has(spec))
          stale.push(`${rel} no longer imports "${spec}"`);
      }
    }
    expect(
      stale,
      "Stale ALLOWLIST entries — remove them so the guard stays tight.\n" +
        stale.join("\n"),
    ).toHaveLength(0);
  });
});
