/**
 * Dev-only autopilot — the production-surface gate (Task 3).
 *
 * The autopilot brain + live applier live wholly under `src/tests/` (dev-only,
 * never bundled — enforced by `letsplayDevOnly.test.ts`). This tiny module is the
 * one *production* seam that wires them in, and it is deliberately inert in a
 * non-DEV build: {@link attachDevAutopilot} only loads + attaches the hook when
 * `isDev` is true, so the prod bundle never gets the autopilot at runtime.
 *
 * Bundle hygiene is two-layered:
 *  - **Runtime gate (this file):** `if (!isDev) return` — the test-observable
 *    contract that a non-DEV build attaches nothing. Pure + fully injectable (the
 *    `load`er is passed in, so this module contains *no* `@/tests/...` import
 *    literal — static or dynamic — and can never pull the dev engine into the
 *    graph itself).
 *  - **Build-time exclusion (the call site in `main.ts`):** the real
 *    `() => import('./tests/playtest/letsplay/installAutopilotHook')` loader is
 *    written inside an `if (import.meta.env.DEV)` block, which Vite/Rollup
 *    dead-code-eliminates in production — so the dev chunk is never emitted.
 */
import type { GameEngine } from "@/systems/GameEngine";

/**
 * The shape of the dev-only hook module loaded lazily in a DEV build. Kept as a
 * structural type here so this prod module never imports the dev engine.
 */
export interface AutopilotHookModule {
  installAutopilotHook(engine: GameEngine): unknown;
}

/**
 * Attach the dev autopilot hook — but only in a DEV build. When `isDev` is false
 * this returns immediately and `load` is **never called**, so nothing dev-only is
 * loaded or attached (the hook is absent). When true it loads the hook module and
 * installs it over the live engine, routing any load/install fault to `onError`
 * instead of throwing (a missing dev chunk must never break boot).
 */
export function attachDevAutopilot(
  isDev: boolean,
  engine: GameEngine,
  load: () => Promise<AutopilotHookModule>,
  onError: (err: unknown) => void = () => {},
): void {
  if (!isDev) return;
  void load()
    .then((mod) => mod.installAutopilotHook(engine))
    .catch(onError);
}
