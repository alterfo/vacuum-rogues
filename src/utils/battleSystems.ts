import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";

/**
 * Minimal live-NPC-ship shape the battle detector needs. Decoupled from the
 * full {@link NpcShip} so the helper stays pure (no domain/PixiJS imports beyond
 * the {@link Faction}/{@link NpcRole} enums) and unit-tests cleanly.
 */
export interface BattleShip {
  /** System the ship is currently in. */
  systemId: string;
  /** True when the ship is openly hostile (garrison/pirate/attacked). */
  hostile: boolean;
  /** The ship's faction. {@link Faction.OVERMIND} always counts as hostile. */
  faction: Faction;
  /**
   * The ship's role. {@link NpcRole.PIRATE} always counts as hostile — regular
   * wandering pirates spawn with `hostile === false` but are still the hostile
   * side of any fight (matches `NpcSimulator.countGarrisonPresent`). Optional so
   * older callers/tests that pre-date role-based detection still construct.
   */
  role?: NpcRole;
}

/**
 * A ship on the hostile side of a fight: flagged hostile, an Overmind ship, or a
 * pirate. The pirate-role check catches the regular wandering-pirate population
 * (faction OUTLANDERS, `hostile === false`) that drives most off-screen raids —
 * without it those pirates would be miscounted as the friendly side.
 */
function isHostileSide(ship: BattleShip): boolean {
  return (
    ship.hostile === true ||
    ship.faction === Faction.OVERMIND ||
    ship.role === NpcRole.PIRATE
  );
}

/**
 * Pure detector: given the live NPC ships, return the set of system ids that
 * currently hold a *live fight* — at least one hostile (pirate/Overmind) ship
 * AND at least one friendly/Ranger (non-hostile) ship sharing the same system.
 *
 * This is the source for the half-red/half-green star-map battle marker. It is
 * purely a projection of the transient live-ship set: render-only, no
 * persistence and no save changes.
 */
export function systemsWithActiveBattle(
  ships: readonly BattleShip[],
): Set<string> {
  const hostileSystems = new Set<string>();
  const friendlySystems = new Set<string>();

  for (const ship of ships) {
    if (isHostileSide(ship)) hostileSystems.add(ship.systemId);
    else friendlySystems.add(ship.systemId);
  }

  const battle = new Set<string>();
  for (const id of hostileSystems) {
    if (friendlySystems.has(id)) battle.add(id);
  }
  return battle;
}
