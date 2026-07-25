/**
 * Why a ship can't launch, derived from its loadout stats.
 *
 * Canon §11.4 gates take-off on BOTH an engine and a fuel tank; `derivedStats`
 * collapses the two into a single `canTakeOff` boolean, which loses *which one*
 * is missing. Both hub scenes (`StationScene.undock` / `PlanetScene.takeOff`)
 * historically blamed a missing engine unconditionally, so an empty/absent fuel
 * tank produced the wrong message. This pure resolver recovers the real cause
 * from the already-exposed derived fields so the UI can name it correctly.
 *
 * The two proxies are exact by construction in `ShipLoadout.derivedStats`:
 *   - `speed` is 0 iff no engine is installed (`hasEngine ? bestEngineSpeed : 0`,
 *     and any real engine yields a positive speed).
 *   - `fuelCapacity` is 0 iff no fuel tank is installed (each tank adds ≥ 50).
 */
export type LaunchDenialReason = "engine" | "fuel" | null;

/** Minimal slice of `DerivedStats` the launch gate depends on. */
export interface LaunchGateStats {
  readonly canTakeOff: boolean;
  readonly speed: number;
  readonly fuelCapacity: number;
}

/**
 * `null` when the ship can launch; otherwise the missing prerequisite. A missing
 * engine takes precedence over a missing tank (it is the more fundamental gap).
 */
export function launchDenialReason(stats: LaunchGateStats): LaunchDenialReason {
  if (stats.canTakeOff) return null;
  if (stats.speed <= 0) return "engine";
  return "fuel";
}
