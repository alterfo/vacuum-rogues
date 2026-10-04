import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC_ROOT = resolve(__dirname, "..", "..");
const TESTS_DIR = join(SRC_ROOT, "tests");
const LETSPLAY_DIR = join(SRC_ROOT, "tests", "playtest", "letsplay");
const DEV_AUTOPILOT = join(SRC_ROOT, "dev", "devAutopilot.ts");
const MAIN_TS = join(SRC_ROOT, "main.ts");
const TOOLS_AI_DIR = resolve(SRC_ROOT, "..", "tools", "ai");

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

function resolvesIntoLetsplay(fromFile: string, spec: string): boolean {
  const resolved = resolveSpecifier(fromFile, spec);
  return resolved !== null && (resolved + sep).startsWith(LETSPLAY_DIR + sep);
}

function resolvesIntoToolsAi(fromFile: string, spec: string): boolean {
  const resolved = resolveSpecifier(fromFile, spec);
  return resolved !== null && (resolved + sep).startsWith(TOOLS_AI_DIR + sep);
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join(SRC_ROOT, spec.slice(2));
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolve(dirname(fromFile), spec);
  }
  return null; // bare package (pixi.js, zod, onnxruntime-web, …)
}

describe("letsplay engine is never statically bundled; prod loads it lazily on demand", () => {
  it("no production module imports anything from the letsplay engine dir", () => {
    const offenders: string[] = [];
    for (const file of productionTsFiles()) {
      const source = readFileSync(file, "utf8");
      for (const spec of staticSpecifiers(source)) {
        if (resolvesIntoLetsplay(file, spec)) {
          offenders.push(`${relative(SRC_ROOT, file)} imports "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      `Production modules must never import the letsplay engine ` +
        `(it would pull it into the prod bundle):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no production module imports the offline LLM judge tooling (tools/ai)", () => {
    const offenders: string[] = [];
    for (const file of productionTsFiles()) {
      const source = readFileSync(file, "utf8");
      for (const spec of [
        ...staticSpecifiers(source),
        ...dynamicSpecifiers(source),
      ]) {
        if (resolvesIntoToolsAi(file, spec)) {
          offenders.push(`${relative(SRC_ROOT, file)} imports "${spec}"`);
        }
      }
    }
    expect(
      offenders,
      `Production modules must never import the offline LLM judge tooling ` +
        `(tools/ai) — it is a dev-only paid deep sweep, not a bundled gate:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the dev autopilot prod seam imports nothing from the engine (static or dynamic)", () => {
    const source = readFileSync(DEV_AUTOPILOT, "utf8");
    const offenders: string[] = [];
    for (const spec of [
      ...staticSpecifiers(source),
      ...dynamicSpecifiers(source),
    ]) {
      if (resolvesIntoLetsplay(DEV_AUTOPILOT, spec)) {
        offenders.push(`devAutopilot.ts imports "${spec}"`);
      }
    }
    expect(
      offenders,
      `The autopilot prod seam must never reference the dev engine directly ` +
        `(pass the loader in instead):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the only production dynamic import of the engine is main.ts, behind the lazy seam", () => {
    const offenders: string[] = [];
    for (const file of productionTsFiles()) {
      const source = readFileSync(file, "utf8");
      const re = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        if (!resolvesIntoLetsplay(file, m[1])) continue;
        const rel = relative(SRC_ROOT, file);
        if (file !== MAIN_TS) {
          offenders.push(
            `${rel} dynamically imports the engine (only main.ts may)`,
          );
        } else if (!/attachAutopilot\s*\(/.test(source)) {
          offenders.push(
            `${rel} dynamic-imports the engine but never hands it to the ` +
              `lazy attachAutopilot seam (it would load at boot)`,
          );
        }
      }
    }
    expect(
      offenders,
      `Engine dynamic imports must be main.ts-only and go through the lazy attachAutopilot seam:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the letsplay engine does not statically import onnxruntime-web", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(LETSPLAY_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const spec of staticSpecifiers(source)) {
        if (spec === "onnxruntime-web" || spec.startsWith("onnxruntime")) {
          offenders.push(
            `${relative(SRC_ROOT, file)} statically imports "${spec}"`,
          );
        }
      }
    }
    expect(
      offenders,
      `The neural policy must load ONNX via a dev-only dynamic import(); ` +
        `a static import would add a bundleable edge:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("staticSpecifiers catches multi-line imports (no false-green hole)", () => {
    expect(
      staticSpecifiers(
        `import {\n  InferenceSession,\n  Tensor,\n} from "onnxruntime-web";`,
      ),
    ).toContain("onnxruntime-web");
    expect(
      staticSpecifiers(
        `export {\n  observe,\n} from "@/tests/playtest/letsplay/observe";`,
      ),
    ).toContain("@/tests/playtest/letsplay/observe");
    expect(staticSpecifiers(`import x from "onnxruntime-web";`)).toContain(
      "onnxruntime-web",
    );
    expect(
      staticSpecifiers(`const ort = await import("onnxruntime-web");`),
    ).toEqual([]);
  });

  it("dynamicSpecifiers extracts import() targets but ignores static imports", () => {
    expect(
      dynamicSpecifiers(
        `() => import('./tests/playtest/letsplay/installAutopilotHook')`,
      ),
    ).toEqual(["./tests/playtest/letsplay/installAutopilotHook"]);
    expect(
      dynamicSpecifiers(`const ort = await import("onnxruntime-web");`),
    ).toEqual(["onnxruntime-web"]);
    expect(dynamicSpecifiers(`import { x } from "./static-only";`)).toEqual([]);
  });

  it("the letsplay engine dir exists and contains the engine modules", () => {
    const names = readdirSync(LETSPLAY_DIR);
    expect(names).toEqual(
      expect.arrayContaining([
        "observe.ts",
        "PlayerPolicy.ts",
        "HeuristicPolicy.ts",
        "PlayerAgent.ts",
        "LiveApplier.ts",
        "AutopilotController.ts",
        "installAutopilotHook.ts",
      ]),
    );
  });
});
