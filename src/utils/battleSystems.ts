import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";

export interface BattleShip {
  systemId: string;
  hostile: boolean;
  faction: Faction;
  role?: NpcRole;
}

function isHostileSide(ship: BattleShip): boolean {
  return (
    ship.hostile === true ||
    ship.faction === Faction.OVERMIND ||
    ship.role === NpcRole.PIRATE
  );
}

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
