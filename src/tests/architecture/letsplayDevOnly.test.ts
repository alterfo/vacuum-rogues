import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Task 4 of the dev-only letsplay engine: **enforce dev-only — never in prod.**
 *
 * The letsplay engine (`src/tests/playtest/letsplay/`) plays the game as the
 * player against the *real* `GameEngine`, so it imports freely from production
 * `@/...` modules. That direction is fine — production never imports *it*. This
 * guard locks that one-way street in two ways:
 *
 *  1. **No production module imports the letsplay engine.** We scan every `.ts`
 *     under `src/` *except* `src/tests/**` (the prod surface = the import graph
 *     reachable from `src/main.ts`; nothing under `src/tests/` is bundled), and
 *     assert none of them statically imports anything resolving into the
 *     letsplay engine dir. If this stays green, `npm run build` can never pull
 *     the engine into the prod bundle.
 *  2. **The engine does not statically import `onnxruntime-web`.** This started
 *     as a bundle guard (a static import would add a bundleable edge). Since the
 *     pure-TS MLP drop (`docs/plans/20260625-pure-ts-mlp-drop-onnx.md`) the ONNX
 *     runtime is gone entirely, and `noOnnxRuntime.test.ts` is now the authority
 *     banning **every** `onnxruntime*` import across `src/**` — static *and*
 *     dynamic. This guard stays as the narrower belt over the letsplay dir.
 *     (The `staticSpecifiers` helper extracts only static specifiers by design;
 *     the dynamic-`import()` assertion below pins that helper contract, not a
 *     permission to use a dynamic ONNX import.)
 *
 * The dev-only **autopilot** (Task 4 of `docs/plans/20260625-dev-autopilot.md`)
 * reuses that same one-way street: its live applier + controller + hook all live
 * under the letsplay dir, so guard (1) already keeps any *static* prod import out.
 * Two extra guards lock the autopilot's wiring, which has the only sanctioned
 * production reference into the dev engine:
 *  3. **The prod seam (`src/dev/devAutopilot.ts`) imports nothing from the dev
 *     engine** — static *or* dynamic. It is a pure injectable gate (the engine
 *     loader is passed in), so it can never pull the dev engine into the graph.
 *  4. **The single dynamic `import()` into the letsplay dir is `main.ts`-only and
 *     `import.meta.env.DEV`-gated**, so Vite/Rollup dead-code-eliminate the dev
 *     chunk from the prod bundle entirely.
 */

const SRC_ROOT = resolve(__dirname, "..", "..");
const TESTS_DIR = join(SRC_ROOT, "tests");
const LETSPLAY_DIR = join(SRC_ROOT, "tests", "playtest", "letsplay");
/** The one production seam that wires the dev autopilot in (Task 4). */
const DEV_AUTOPILOT = join(SRC_ROOT, "dev", "devAutopilot.ts");
/** The only module allowed a (DEV-gated) dynamic import into the dev engine. */
const MAIN_TS = join(SRC_ROOT, "main.ts");

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

/** Production `.ts`: everything under `src/` that is NOT under `src/tests/`. */
function productionTsFiles(): string[] {
  return collectTsFiles(SRC_ROOT).filter((f) => !f.startsWith(TESTS_DIR + sep));
}

/**
 * Extract the *static* module specifiers from a file: `import ... from "x"`,
 * `export ... from "x"`, and bare `import "x"`. Deliberately ignores dynamic
 * `import("x")` — those are runtime-gated and allowed for the dev-only ONNX seam.
 */
function staticSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // `import ... from "x"` / `export ... from "x"`. The clause between the keyword
  // and `from` routinely spans multiple lines (named imports one-per-line — the
  // codebase's default style), so the body class must include newlines. It is
  // bounded by the statement terminator `;` (or the next statement) instead of
  // `\n`, otherwise a multi-line import slips past the guard entirely.
  const re =
    /(?:^|[\n;])\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]);
  // bare side-effect imports: import "x";
  const bare = /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g;
  while ((m = bare.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

/**
 * Extract the *dynamic* `import("x")` specifiers from a file (the complement of
 * {@link staticSpecifiers}). The dev autopilot's only sanctioned production
 * reference into the dev engine is one such dynamic import in `main.ts`, written
 * inside an `import.meta.env.DEV` block so Vite/Rollup drop the dev chunk from the
 * prod bundle. This helper lets the guards below reason about that one edge.
 */
function dynamicSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

/** True if `spec` (resolved from `fromFile`) lands inside the letsplay dir. */
function resolvesIntoLetsplay(fromFile: string, spec: string): boolean {
  const resolved = resolveSpecifier(fromFile, spec);
  return resolved !== null && (resolved + sep).startsWith(LETSPLAY_DIR + sep);
}

/** Resolve a specifier to an absolute path, or null for a bare package import. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return join(SRC_ROOT, spec.slice(2));
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolve(dirname(fromFile), spec);
  }
  return null; // bare package (pixi.js, zod, onnxruntime-web, …)
}

describe("letsplay engine is dev-only (never in prod)", () => {
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

  it("the dev autopilot prod seam imports nothing from the engine (static or dynamic)", () => {
    // `src/dev/devAutopilot.ts` is the lone *production* module that wires the
    // dev-only autopilot in. It must stay a pure injectable gate: it takes the
    // engine `load`er as a parameter and contains NO import literal — static or
    // dynamic — of the dev engine, so it can never pull the autopilot (and with
    // it the agent core) into the prod graph itself. The real `import(...)` loader
    // lives at the DEV-gated `main.ts` call site (guarded below).
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

  it("the only production dynamic import of the engine is main.ts, DEV-gated", () => {
    // The autopilot's sole sanctioned production reference into the dev engine is
    // a dynamic `import('./tests/playtest/letsplay/installAutopilotHook')`. It is
    // allowed ONLY in `main.ts` and ONLY when preceded by an `import.meta.env.DEV`
    // gate — that is what lets Vite/Rollup dead-code-eliminate the dev chunk so
    // the prod bundle stays autopilot-free.
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
            `${rel} dynamically imports the dev engine ` +
              `(only main.ts may, DEV-gated)`,
          );
        } else if (source.lastIndexOf("import.meta.env.DEV", m.index) === -1) {
          offenders.push(
            `${rel} dynamic-imports the dev engine without a preceding ` +
              `import.meta.env.DEV gate (would ship in the prod bundle)`,
          );
        }
      }
    }
    expect(
      offenders,
      `Dev-engine dynamic imports must be main.ts-only and DEV-gated:\n` +
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
    // Regression: the body between the keyword and `from` spans multiple lines
    // in the codebase's default named-import style. An earlier matcher excluded
    // newlines (`[^;\n]`), so a multi-line `import … from "onnxruntime-web"` or a
    // multi-line import of a letsplay module slipped past BOTH guards while they
    // stayed green. These must all be detected; the dynamic import must not.
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
    // Single-line static import still caught.
    expect(staticSpecifiers(`import x from "onnxruntime-web";`)).toContain(
      "onnxruntime-web",
    );
    // Dev-only dynamic import is still (correctly) ignored.
    expect(
      staticSpecifiers(`const ort = await import("onnxruntime-web");`),
    ).toEqual([]);
  });

  it("dynamicSpecifiers extracts import() targets but ignores static imports", () => {
    // Pins the complement helper the autopilot guards rely on: a dynamic
    // `import("x")` is captured, while a static `import ... from "x"` is not.
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
    // Sanity: the scan above is only meaningful if the dir is actually present.
    // Includes the dev-autopilot modules (Task 4) so the guard provably covers
    // the live applier, controller, and hook — not just the original agent core.
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
