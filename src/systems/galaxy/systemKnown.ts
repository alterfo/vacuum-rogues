import type { Player } from "@/domain/Player";
import type { Galaxy } from "@/domain/Galaxy";

export function isSystemKnown(
  player: Player,
  galaxy: Galaxy,
  systemId: string,
): boolean {
  if (player.hasVisited(systemId)) return true;
  const system = galaxy.systems.find((s) => s.id === systemId);
  return system?.explored === true;
}
