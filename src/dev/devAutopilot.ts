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
 * The minimal structural slice of the installed autopilot hook this seam needs:
 * the engaged getter (read at save time) and `start()` (to re-engage on resume).
 * Kept structural so this prod module never imports the dev engine's concrete
 * `AutopilotWindowHook` type.
 */
export interface AutopilotHookHandle {
  readonly engaged: boolean;
  start(): void;
}

/**
 * The shape of the dev-only hook module loaded lazily in a DEV build. Kept as a
 * structural type here so this prod module never imports the dev engine.
 */
export interface AutopilotHookModule {
  installAutopilotHook(engine: GameEngine): AutopilotHookHandle;
}

/**
 * Attach the dev autopilot hook — but only in a DEV build. When `isDev` is false
 * this returns immediately and `load` is **never called**, so nothing dev-only is
 * loaded or attached (the hook is absent). When true it loads the hook module and
 * installs it over the live engine, routing any load/install fault to `onError`
 * instead of throwing (a missing dev chunk must never break boot).
 *
 * After installing the hook it wires the autopilot-resume seam so a save written
 * while the autopilot was engaged auto-resumes on reload:
 *  - **Injects the real {@link IAutopilotStateProvider}** (backed by the just-
 *    installed hook) via `engine.setAutopilotStateProvider`. This covers the
 *    *continue / in-game-load* paths: `loadGame`'s tail `resume(engaged)` call
 *    now reaches the real provider and re-engages when the loaded save was
 *    engaged.
 *  - **Boot catch-up**: the boot auto-load (`loadGame("auto")` inside
 *    `initialize`) resolves *before* this hook exists, so its tail `resume` hit
 *    the headless no-op and did nothing. Read the cached flag via
 *    `engine.getLoadedAutopilotEngaged()` once here and `start()` if it was
 *    `true`, replaying that one missed resume.
 */
export function attachDevAutopilot(
  isDev: boolean,
  engine: GameEngine,
  load: () => Promise<AutopilotHookModule>,
  onError: (err: unknown) => void = () => {},
): void {
  if (!isDev) return;
  void load()
    .then((mod) => {
      const hook = mod.installAutopilotHook(engine);
      // Inject the real provider so the continue / in-game-load paths resume.
      engine.setAutopilotStateProvider({
        isEngaged: () => hook.engaged,
        resume: (engaged: boolean) => {
          if (engaged) hook.start();
        },
      });
      // Boot catch-up: the boot auto-load ran before this hook existed, so replay
      // its resume now that the hook is present.
      if (engine.getLoadedAutopilotEngaged() === true) hook.start();
    })
    .catch(onError);
}
