import type { CombatAction, AxialCoord } from "@/types";
import type { EnemyShip } from "@/domain/EnemyShip";
import type { TacticalEncounter } from "@/domain/TacticalEncounter";
import type { HexGrid } from "@/domain/HexGrid";

export enum AIState {
  IDLE = "IDLE",
  ATTACK = "ATTACK",
  RETREAT = "RETREAT",
}

/** Rule-based AI for a single enemy ship in tactical combat. */
export class CombatAI {
  private states = new Map<string, AIState>();

  /** Decide the next action for an enemy. Returns MOVE, ATTACK, or WAIT. */
  decide(
    enemy: EnemyShip,
    encounter: TacticalEncounter,
    grid: HexGrid,
  ): CombatAction {
    const hpRatio = enemy.hullHP / enemy.maxHull;
    const state = hpRatio < 0.3 ? AIState.RETREAT : AIState.ATTACK;
    this.states.set(enemy.id, state);

    const enemyCoord = this.findEntityCoord(enemy, grid);
    const playerCoord = this.findEntityCoord(encounter.playerShip, grid);

    if (!enemyCoord || !playerCoord) {
      return { type: "WAIT" };
    }

    if (state === AIState.RETREAT) {
      return this.retreatAction(enemyCoord, playerCoord, grid);
    }
    return this.attackAction(enemyCoord, playerCoord, grid);
  }

  getState(enemyId: string): AIState {
    return this.states.get(enemyId) ?? AIState.IDLE;
  }

  private attackAction(
    enemyCoord: AxialCoord,
    playerCoord: AxialCoord,
    grid: HexGrid,
  ): CombatAction {
    if (hexDistance(enemyCoord, playerCoord) <= 1) {
      return { type: "ATTACK", target: playerCoord };
    }

    // Path toward an adjacent free tile next to the player (player's tile itself is occupied)
    let path: AxialCoord[] | null = null;
    for (const tile of grid.getNeighbors(playerCoord)) {
      if (!tile.occupant) {
        path = grid.findPath(enemyCoord, tile.coord);
        if (path && path.length > 1) break;
      }
    }

    if (path && path.length > 1) {
      const nextStep = path[1];
      const tile = grid.getTile(nextStep);
      if (tile && !tile.occupant) {
        return { type: "MOVE", target: nextStep };
      }
    }

    // Can't pathfind — attack from current position
    return { type: "ATTACK", target: playerCoord };
  }

  private retreatAction(
    enemyCoord: AxialCoord,
    playerCoord: AxialCoord,
    grid: HexGrid,
  ): CombatAction {
    const neighbors = grid.getNeighbors(enemyCoord);
    let bestTile = null;
    let bestDist = hexDistance(enemyCoord, playerCoord);

    for (const tile of neighbors) {
      if (!tile.occupant && tile.type !== "ASTEROID") {
        const dist = hexDistance(tile.coord, playerCoord);
        if (dist > bestDist) {
          bestDist = dist;
          bestTile = tile;
        }
      }
    }

    if (bestTile) {
      return { type: "MOVE", target: bestTile.coord };
    }
    return { type: "WAIT" };
  }

  private findEntityCoord(entity: unknown, grid: HexGrid): AxialCoord | null {
    for (let r = 0; r < grid.height; r++) {
      for (let q = 0; q < grid.width; q++) {
        if (grid.tiles[r][q].occupant === entity) {
          return { q, r };
        }
      }
    }
    return null;
  }
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}
