/**
 * Common contract for all SpaceFlightScene sub-modules.
 *
 * SpaceFlightScene is decomposed into focused FlightModule implementations
 * (background, star, asteroids, orbits, route, player ship, NPCs, planets, HUD).
 * Each module owns its own DisplayObjects and state; SpaceFlightScene acts as
 * the Controller that creates the modules, wires their callbacks, and drives
 * their lifecycle.
 *
 * Lifecycle:
 *   1. `initialize()` — build all DisplayObjects once when the scene is set up.
 *   2. `update(dt, bgElapsed)` — advance per-frame animation.
 *   3. `destroy()` — tear down all DisplayObjects and listeners.
 */
export interface FlightModule {
  /** Called once when the scene is set up. */
  initialize(): void;
  /** Called every animation frame. bgElapsed is the scene's animation clock (ms). */
  update(dt: number, bgElapsed: number): void;
  /** Tear down all DisplayObjects and listeners. */
  destroy(): void;
}
