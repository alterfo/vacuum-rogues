import type {
  CombatAction,
  CombatResult,
  EncounterResult,
  TerrainConfig,
} from "@/types";
import type { PlayerShip } from "@/domain/PlayerShip";
import type { EnemyShip } from "@/domain/EnemyShip";
import type { TacticalEncounter } from "@/domain/TacticalEncounter";
import { Possessed } from "@/domain/Possessed";
import type { ShipModule } from "@/domain/ShipModule";
import { HexGrid } from "@/domain/HexGrid";
import { TacticalEncounter as TacticalEncounterClass } from "@/domain/TacticalEncounter";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { logger } from "@/utils/logger";

export interface TacticalAI {
  decideAction(
    encounter: TacticalEncounter,
    entityId: string,
  ): Promise<CombatAction>;
}

export class RuleBasedTacticalAI implements TacticalAI {
  async decideAction(
    encounter: TacticalEncounter,
    entityId: string,
  ): Promise<CombatAction> {
    const entity = encounter.turnOrder.find((e) => e.id === entityId);
    if (!entity) return { type: "WAIT" };

    // Simple rule-based AI: if HP low, try to retreat; otherwise attack
    const enemy = encounter.enemies.find((e) => e.id === entityId);
    if (enemy && enemy.hullHP < enemy.hullHP * 0.3) {
      return { type: "MOVE", target: { q: 0, r: 0 } };
    }

    return { type: "ATTACK", target: { q: 4, r: 4 } };
  }
}

export class CombatSystem {
  public encounter: TacticalEncounter | null = null;
  public grid: HexGrid;
  private aiController: TacticalAI;

  constructor(_qualityProfile: AdaptiveQualityProfile) {
    this.grid = new HexGrid(9, 9);
    this.aiController = new RuleBasedTacticalAI();
  }

  startCombat(
    playerShip: PlayerShip,
    enemies: EnemyShip[],
    terrain: TerrainConfig,
  ): TacticalEncounter {
    if (enemies.length > 6) {
      throw new GameBusinessException(
        "TOO_MANY_ENEMIES",
        `Maximum 6 enemies allowed. Received ${enemies.length}.`,
        { enemyCount: enemies.length },
      );
    }

    this.grid = new HexGrid(9, 9);

    // Apply terrain
    for (const coord of terrain.obstacles) {
      const tile = this.grid.getTile(coord);
      if (tile) tile.type = "ASTEROID" as import("@/types").TileType;
    }
    for (const coord of terrain.cover) {
      const tile = this.grid.getTile(coord);
      if (tile) {
        tile.type = "DEBRIS" as import("@/types").TileType;
        tile.coverBonus = 20;
      }
    }
    for (const coord of terrain.nebulae) {
      const tile = this.grid.getTile(coord);
      if (tile) {
        tile.type = "NEBULA" as import("@/types").TileType;
        tile.accuracyPenalty = 20;
      }
    }

    // Place player and enemies on opposite edges
    const playerTile = this.grid.getTile({ q: 1, r: 4 });
    if (playerTile) playerTile.occupant = playerShip;

    enemies.forEach((enemy, index) => {
      const tile = this.grid.getTile({ q: 7, r: 2 + index });
      if (tile) tile.occupant = enemy;
    });

    const encounter = new TacticalEncounterClass(
      `enc_${Date.now()}`,
      this.grid,
      playerShip,
      enemies,
    );
    encounter.start();
    this.encounter = encounter;

    logger.info(`Combat started with ${enemies.length} enemies`);
    return encounter;
  }

  processPlayerAction(action: CombatAction): CombatResult {
    if (
      !this.encounter ||
      this.encounter.state !==
        ("IN_PROGRESS" as import("@/types").EncounterState)
    ) {
      throw new GameBusinessException(
        "COMBAT_NOT_ACTIVE",
        "No active combat encounter.",
      );
    }

    const currentEntity =
      this.encounter.turnOrder[this.encounter.currentEntityIndex];
    if (!currentEntity || currentEntity.id !== this.encounter.playerShip.id) {
      throw new GameBusinessException(
        "NOT_PLAYER_TURN",
        "It is not the player's turn.",
      );
    }

    // Validate action
    if (action.type === "MOVE" && action.target) {
      const tile = this.grid.getTile(action.target);
      if (!tile || tile.occupant) {
        throw new GameBusinessException(
          "INVALID_HEX_MOVE",
          "Target tile is invalid or occupied.",
        );
      }
    }

    // Apply action
    let damageDealt = 0;
    const damageTaken = 0;

    if (action.type === "ATTACK") {
      const rawDamage = Math.floor(Math.random() * 20) + 5;
      const target = this.encounter.enemies[0];
      if (target) {
        // Shields absorb incoming damage before hull (Task 8).
        if (target.shields > 0) {
          const absorbed = Math.min(target.shields, rawDamage);
          target.shields -= absorbed;
          target.hullHP -= rawDamage - absorbed;
        } else {
          target.hullHP -= rawDamage;
        }
        damageDealt = rawDamage;
      }
    }

    this.encounter.processTurn(currentEntity, action);

    // Check end conditions
    const result = this.checkEndConditions();
    if (
      result.outcome !== ("IN_PROGRESS" as import("@/types").EncounterState)
    ) {
      return {
        success: true,
        damageDealt,
        damageTaken,
        xpGained: result.xpGained,
        loot: result.loot as ShipModule[],
        message: result.message,
      };
    }

    return {
      success: true,
      damageDealt,
      damageTaken,
      message: "Action executed.",
    };
  }

  async processEnemyTurn(): Promise<CombatAction> {
    if (
      !this.encounter ||
      this.encounter.state !==
        ("IN_PROGRESS" as import("@/types").EncounterState)
    ) {
      throw new GameBusinessException(
        "COMBAT_NOT_ACTIVE",
        "No active combat encounter.",
      );
    }

    const currentEntity =
      this.encounter.turnOrder[this.encounter.currentEntityIndex];
    if (!currentEntity || currentEntity.id === this.encounter.playerShip.id) {
      throw new GameBusinessException(
        "NOT_ENEMY_TURN",
        "It is not the enemy turn.",
      );
    }

    const action = await this.aiController.decideAction(
      this.encounter,
      currentEntity.id,
    );

    // Apply Possessed special abilities
    const enemy = this.encounter.enemies.find((e) => e.id === currentEntity.id);
    if (enemy instanceof Possessed) {
      if (enemy.neuroShock.currentCooldown <= 0) {
        // Apply neuro shock
        (enemy.neuroShock as { currentCooldown: number }).currentCooldown =
          enemy.neuroShock.cooldown;
      }
      // Check assimilation range
    }

    this.encounter.processTurn(currentEntity, action);
    this.checkEndConditions();

    return action;
  }

  checkEndConditions(): EncounterResult {
    if (!this.encounter) {
      throw new GameBusinessException(
        "COMBAT_NOT_ACTIVE",
        "No active combat encounter.",
      );
    }

    // Player loss
    if (this.encounter.playerShip.hullHP <= 0) {
      this.encounter.state = "PLAYER_LOST" as import("@/types").EncounterState;
      return {
        outcome: "PLAYER_LOST" as import("@/types").EncounterState,
        xpGained: 0,
        loot: [],
        message: "Your ship has been destroyed.",
      };
    }

    // Player win
    if (this.encounter.enemies.every((e) => e.hullHP <= 0)) {
      this.encounter.state = "PLAYER_WON" as import("@/types").EncounterState;
      const xpGained = this.encounter.enemies.length * 100;
      const loot: ShipModule[] = [];
      // 20% drop chance per enemy
      if (Math.random() < 0.2) {
        // Add placeholder loot
      }
      return {
        outcome: "PLAYER_WON" as import("@/types").EncounterState,
        xpGained,
        loot,
        message: "Combat victorious!",
      };
    }

    return {
      outcome: "IN_PROGRESS" as import("@/types").EncounterState,
      xpGained: 0,
      loot: [],
      message: "Combat continues...",
    };
  }
}
