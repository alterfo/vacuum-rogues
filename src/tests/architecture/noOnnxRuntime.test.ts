import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC_ROOT = resolve(__dirname, "..", "..");

const SCAN_EXCLUDE = new Set([
  resolve(__dirname, "noOnnxRuntime.test.ts"),
  resolve(__dirname, "letsplayDevOnly.test.ts"),
]);

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
