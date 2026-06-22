// Build identity surfaced into beta-feedback diagnostics.
//
// `__BUILD_VERSION__` / `__BUILD_SHA__` are Vite/Vitest `define` replacements
// (see `vite.config.ts`). They are substituted as string literals at build
// time. Reads are `typeof`-guarded so the module never throws in a runtime
// where a define is absent (e.g. a bare Node import or a missing CI env) — the
// guard yields the `'dev'` fallback instead of a ReferenceError.

export interface BuildInfo {
  readonly version: string;
  readonly sha: string;
}

function readVersion(): string {
  const v =
    typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : undefined;
  return typeof v === "string" && v.length > 0 ? v : "dev";
}

function readSha(): string {
  const v = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : undefined;
  return typeof v === "string" && v.length > 0 ? v : "dev";
}

/** Current build's `{ version, sha }`, each falling back to `'dev'`. */
export function buildInfo(): BuildInfo {
  return { version: readVersion(), sha: readSha() };
}

/**
 * Human-readable one-liner for the build, e.g. `v0.1.0 (a1b2c3d)`.
 * Accepts an injected {@link BuildInfo} so callers/tests can format any build;
 * defaults to the live build globals.
 */
export function formatBuildLine(info: BuildInfo = buildInfo()): string {
  return `v${info.version} (${info.sha})`;
}
