import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Dependency guard for the "drop onnxruntime-web" change
 * (`docs/plans/20260625-pure-ts-mlp-drop-onnx.md`, Task 3).
 *
 * The only neural nets this game needs are tiny feature-vector MLPs, now run by a
 * hand-written pure-TS forward pass (`src/tests/playtest/letsplay/mlp.ts`) over
 * weights shipped as a small JSON array. The heavyweight `onnxruntime-web` runtime
 * (wasm + Web Worker + IndexedDB model cache) and all the dead ONNX scaffolding
 * (`ONNXModelRegistry`, the inference worker, the adapters, the `IOnnxService`
 * port) were removed. This guard keeps them gone:
 *
 *  1. **No `src/**` module imports `onnxruntime-web`** — statically *or*
 *     dynamically. If this stays green, the runtime can never re-enter the bundle.
 *  2. **The removed ONNX modules stay deleted**, and `FallbackEngine` — the
 *     canonical rule-based engine — stays. The dialogue/quest-narration path runs
 *     on pure templates (`TemplateQuestNarrator`), not an ONNX session.
 */

const SRC_ROOT = resolve(__dirname, "..", "..");

/** This guard file + the letsplay dev-only guard both embed the literal
 *  "onnxruntime-web" in assertion text / test fixtures, not as real imports. */
const SCAN_EXCLUDE = new Set([
  resolve(__dirname, "noOnnxRuntime.test.ts"),
  resolve(__dirname, "letsplayDevOnly.test.ts"),
]);

/** Recursively collect every `.ts` file under `dir`, skipping `.d.ts`. */
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

/**
 * Extract every module specifier from a real import/export/require: static
 * `import ... from "x"`, bare `import "x"`, dynamic `import("x")`, and
 * `require("x")`. Comment mentions (`* onnxruntime-web …`) are not import
 * statements, so they never match.
 */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    // import ... from "x" / export ... from "x" (clause may span newlines)
    /(?:^|[\n;])\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
    // bare side-effect import "x"
    /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g,
    // dynamic import("x")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    // require("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("onnxruntime-web is fully removed", () => {
  it("no src/** module imports onnxruntime-web (static or dynamic)", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SRC_ROOT)) {
      if (SCAN_EXCLUDE.has(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(source)) {
        if (spec === "onnxruntime-web" || spec.startsWith("onnxruntime")) {
          offenders.push(`${relative(SRC_ROOT, file)} imports "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      `onnxruntime-web was dropped in favour of a pure-TS MLP — no module may ` +
        `import it again:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the dead ONNX scaffolding files stay deleted", () => {
    const removed = [
      "ai/ONNXModelRegistry.ts",
      "ai/ONNXModel.ts",
      "ai/SimpleONNXModel.ts",
      "ai/WebWorkerPool.ts",
      "ai/IndexedDBCache.ts",
      "ai/ModelManifest.ts",
      "ai/inference.worker.ts",
      "ai/adapters/OvermindAdapter.ts",
      "ai/adapters/PPOAdapter.ts",
      "ai/adapters/GRUAdapter.ts",
      "ai/adapters/T5DialogueAdapter.ts",
      "ai/adapters/VAEAdapter.ts",
      "core/adapters/ONNXAdapter.ts",
      "core/ports/IOnnxService.ts",
      "tests/mocks/MockOnnxService.ts",
    ];
    const stillPresent = removed.filter((p) =>
      existsSync(join(SRC_ROOT, ...p.split("/"))),
    );
    expect(stillPresent, `These ONNX modules should be gone`).toEqual([]);
  });

  it("FallbackEngine — the canonical rule engine — stays", () => {
    expect(existsSync(join(SRC_ROOT, "ai", "FallbackEngine.ts"))).toBe(true);
  });

  it("the production dependency manifest no longer lists onnxruntime-web", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(SRC_ROOT, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["onnxruntime-web"]).toBeUndefined();
  });
});
