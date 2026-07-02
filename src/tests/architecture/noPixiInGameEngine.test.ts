/**
 * Layer guard for the `IOverlayPresenter` extraction (plan 20260701, Phase 2
 * Task 8). `src/systems/` must never depend on `src/presentation/` or import
 * `pixi.js` directly — `GameEngine.ts` used to violate this by building modal/
 * loading/outcome overlays with `Graphics`/`Text` straight from `pixi.js`. That
 * UI now lives behind `IOverlayPresenter` (`core/ports/`), implemented by
 * `presentation/OverlayPresenter.ts`. This guard keeps the import gone, mirroring
 * `noOnnxRuntime.test.ts`'s pattern for the ONNX removal. It also covers the
 * Phase 2 extraction targets (`DayTickController`/`EndgameController`/
 * `FlightPositionTracker`/`FlightSessionState`) — each holds a reference to
 * `IOverlayPresenter` or GameEngine-owned state and is subject to the same rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GUARDED_PATHS = [
  resolve(__dirname, "..", "..", "systems", "GameEngine.ts"),
  resolve(__dirname, "..", "..", "systems", "DayTickController.ts"),
  resolve(__dirname, "..", "..", "systems", "EndgameController.ts"),
  resolve(__dirname, "..", "..", "systems", "FlightPositionTracker.ts"),
  resolve(__dirname, "..", "..", "systems", "FlightSessionState.ts"),
];

/** Extract every module specifier from a real import/export/require statement. */
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

describe("src/systems/*.ts never imports pixi.js", () => {
  it.each(GUARDED_PATHS)(
    "%s has no static or dynamic pixi.js import",
    (path) => {
      const source = readFileSync(path, "utf8");
      const offenders = importSpecifiers(source).filter(isPixiImport);
      expect(
        offenders,
        `${path} (systems/) must not import pixi.js — route UI through ` +
          "IOverlayPresenter (core/ports/IOverlayPresenter.ts), implemented by " +
          "presentation/OverlayPresenter.ts.",
      ).toHaveLength(0);
    },
  );
});
