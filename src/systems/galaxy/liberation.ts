import { Faction } from "@/types/faction";
import { NpcRole, NpcState } from "@/types";

export interface LiberationShipView {
  currentSystemId: string;
  state: NpcState;
  faction: Faction;
  role: NpcRole;
}

export interface LiberationGalaxyView {
  isHostileSystem(systemId: string): boolean;
  readonly npcShips: ReadonlyArray<LiberationShipView>;
}

export function isLiberationBlocker(
  ship: Pick<LiberationShipView, "faction" | "role">,
): boolean {
  return ship.faction === Faction.OVERMIND || ship.role === NpcRole.PIRATE;
}

export function hostileShipsPresent(
  ships: ReadonlyArray<LiberationShipView>,
  systemId: string,
): number {
  let count = 0;
  for (const n of ships) {
    if (n.currentSystemId !== systemId) continue;
    if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
    if (isLiberationBlocker(n)) count++;
  }
  return count;
}

export function canPlayerLiberate(
  view: LiberationGalaxyView,
  systemId: string,
): boolean {
  return (
    view.isHostileSystem(systemId) &&
    hostileShipsPresent(view.npcShips, systemId) === 0
  );
}
