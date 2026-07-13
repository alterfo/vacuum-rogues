/**
 * Port bridging GameEngine's save/load paths to the DEV-only live autopilot
 * (`src/tests/playtest/letsplay/AutopilotController`) without letting that
 * dev-only test tree leak into the production `systems/` layer.
 *
 * `GameEngine` only ever sees this interface: it reads the current engagement
 * flag at save time (`isEngaged`) and asks the provider to re-engage after a
 * save is loaded (`resume`). The single concrete implementation (backed by the
 * real `AutopilotController`) is constructed and injected from
 * `src/dev/devAutopilot.ts`, itself reachable only through `main.ts`'s
 * `if (import.meta.env.DEV)` dynamic-import chunk. In production (and in tests
 * that don't inject it) a {@link NoOpAutopilotStateProvider} stands in.
 *
 * Mirrors the `IOverlayPresenter` pattern named in root `CLAUDE.md`, applied to
 * a `systems/` → dev-only-tree boundary instead of `systems/` → `presentation/`.
 */
export interface IAutopilotStateProvider {
  /**
   * Whether the live autopilot is currently engaged. Read by
   * `GameEngine.saveGame` and persisted as `SaveState.autopilotEngaged`.
   */
  isEngaged(): boolean;
  /**
   * Called at the tail of `GameEngine.loadGame` with the loaded save's
   * `autopilotEngaged` flag. The dev implementation re-engages the autopilot
   * when `engaged` is `true`; a no-op otherwise. Must never throw — a load
   * must succeed even if resume can't (e.g. hook not yet installed at boot).
   */
  resume(engaged: boolean): void;
}
