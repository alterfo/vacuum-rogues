/**
 * Partial-observability predicate: has the player "discovered" a star system?
 *
 * A system is **known** if it has been revealed on the star-map
 * (`StarSystem.explored`, set by `Galaxy.revealSystem`/`revealWithinHops`) **or**
 * physically flown into (`Player.hasVisited`). Pure — no I/O, no mutation — so it
 * can gate any surface (e.g. the InfoCenter trade margins) that must respect what
 * the player can actually know.
 */
import type { Player } from "@/domain/Player";
import type { Galaxy } from "@/domain/Galaxy";

/** True when `systemId` is explored on the star-map or has been visited. Unknown / missing ids are not known. */
export function isSystemKnown(
  player: Player,
  galaxy: Galaxy,
  systemId: string,
): boolean {
  if (player.hasVisited(systemId)) return true;
  const system = galaxy.systems.find((s) => s.id === systemId);
  return system?.explored === true;
}
