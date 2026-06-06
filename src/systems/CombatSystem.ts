import type {
  CombatAction,
  CombatResult,
  EncounterResult,
  TerrainConfig,
} from "@/types";
import { EncounterState } from "@/types";
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
import { CombatAI } from "@/systems/combat/CombatAI";
import { GEAR_CATALOG, GearKind } from "@/systems/equipment/GearCatalog";
import { ShipModule as ShipModuleClass } from "@/domain/ShipModule";
import type { ModuleCategory } from "@/types";

export interface CombatRewardResult {
  creditsGained: number;
  loot: ShipModule[];
}

export class CombatSystem {
  public encounter: TacticalEncounter | null = null;
  public grid: HexGrid;
  private combatAI: CombatAI;

  constructor(_qualityProfile: AdaptiveQualityProfile) {
    this.grid = new HexGrid(9, 9);
    this.combatAI = new CombatAI();
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
      this.encounter.state !== EncounterState.IN_PROGRESS
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

    // Validate move action
    if (action.type === "MOVE" && action.target) {
      const tile = this.grid.getTile(action.target);
      if (!tile || tile.occupant) {
        throw new GameBusinessException(
          "INVALID_HEX_MOVE",
          "Target tile is invalid or occupied.",
        );
      }
    }

    let damageDealt = 0;

    if (action.type === "ATTACK") {
      const rawDamage = Math.floor(Math.random() * 20) + 5;
      const target = this.encounter.enemies.find((e) => e.hullHP > 0);
      if (target) {
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

    const result = this.checkEndConditions();
    if (result.outcome !== EncounterState.IN_PROGRESS) {
      return {
        success: true,
        damageDealt,
        damageTaken: 0,
        xpGained: result.xpGained,
        loot: result.loot as ShipModule[],
        message: result.message,
      };
    }

    return {
      success: true,
      damageDealt,
      damageTaken: 0,
      message: "Action executed.",
    };
  }

  /**
   * Execute all enemy turns until it's the player's turn again (or combat ends).
   * Returns the accumulated damage dealt to the player.
   */
  async executeEnemyTurns(): Promise<{
    damageTaken: number;
    result: EncounterResult | null;
  }> {
    if (
      !this.encounter ||
      this.encounter.state !== EncounterState.IN_PROGRESS
    ) {
      return { damageTaken: 0, result: null };
    }

    let damageTaken = 0;

    // Process all enemy turns until it's the player's turn again
    while (
      this.encounter.state === EncounterState.IN_PROGRESS &&
      this.encounter.turnOrder[this.encounter.currentEntityIndex]?.id !==
        this.encounter.playerShip.id
    ) {
      const currentEntity =
        this.encounter.turnOrder[this.encounter.currentEntityIndex];
      if (!currentEntity) break;

      const enemy = this.encounter.enemies.find(
        (e) => e.id === currentEntity.id,
      );
      if (!enemy || enemy.hullHP <= 0) {
        // Skip dead enemies
        this.encounter.processTurn(currentEntity, { type: "WAIT" });
        continue;
      }

      const action = this.combatAI.decide(enemy, this.encounter, this.grid);

      // Apply Possessed special abilities
      if (enemy instanceof Possessed) {
        if (enemy.neuroShock.currentCooldown <= 0) {
          (enemy.neuroShock as { currentCooldown: number }).currentCooldown =
            enemy.neuroShock.cooldown;
        }
      }

      // Apply attack damage to player
      if (action.type === "ATTACK") {
        const rawDamage =
          Math.floor(Math.random() * enemy.damage * 0.5) +
          Math.floor(enemy.damage * 0.5);
        const player = this.encounter.playerShip;
        if (player.shields > 0) {
          const absorbed = Math.min(player.shields, rawDamage);
          player.shields -= absorbed;
          player.hullHP -= rawDamage - absorbed;
        } else {
          player.hullHP -= rawDamage;
        }
        damageTaken += rawDamage;
      } else if (action.type === "MOVE" && action.target) {
        // Apply grid movement
        this.applyGridMove(enemy, action.target);
      }

      this.encounter.processTurn(currentEntity, action);

      const endResult = this.checkEndConditions();
      if (endResult.outcome !== EncounterState.IN_PROGRESS) {
        return { damageTaken, result: endResult };
      }
    }

    return { damageTaken, result: null };
  }

  /** @deprecated Use executeEnemyTurns() instead. Kept for backward compatibility. */
  async processEnemyTurn(): Promise<CombatAction> {
    if (
      !this.encounter ||
      this.encounter.state !== EncounterState.IN_PROGRESS
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

    const enemy = this.encounter.enemies.find((e) => e.id === currentEntity.id);

    let action: CombatAction = { type: "WAIT" };
    if (enemy) {
      action = this.combatAI.decide(enemy, this.encounter, this.grid);

      if (action.type === "ATTACK") {
        const rawDamage =
          Math.floor(Math.random() * enemy.damage * 0.5) +
          Math.floor(enemy.damage * 0.5);
        const player = this.encounter.playerShip;
        if (player.shields > 0) {
          const absorbed = Math.min(player.shields, rawDamage);
          player.shields -= absorbed;
          player.hullHP -= rawDamage - absorbed;
        } else {
          player.hullHP -= rawDamage;
        }
      } else if (action.type === "MOVE" && action.target) {
        this.applyGridMove(enemy, action.target);
      }
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

    // Player loss: HP drops to 0 → set to 1 (retreat, ship damaged)
    if (this.encounter.playerShip.hullHP <= 0) {
      this.encounter.playerShip.hullHP = 1;
      this.encounter.state = EncounterState.PLAYER_LOST;
      return {
        outcome: EncounterState.PLAYER_LOST,
        xpGained: 0,
        loot: [],
        message: "Поражение — корабль поврежден.",
      };
    }

    // Player victory: all enemies destroyed
    if (this.encounter.enemies.every((e) => e.hullHP <= 0)) {
      this.encounter.state = EncounterState.PLAYER_WON;
      const rewards = this.resolveVictory(this.encounter.enemies);
      return {
        outcome: EncounterState.PLAYER_WON,
        xpGained: rewards.creditsGained,
        loot: rewards.loot,
        message: `Победа! +${rewards.creditsGained} ₡${rewards.loot.length > 0 ? ` + ${rewards.loot[0].name}` : ""}`,
      };
    }

    return {
      outcome: EncounterState.IN_PROGRESS,
      xpGained: 0,
      loot: [],
      message: "Combat continues...",
    };
  }

  /**
   * Calculate victory rewards: credits based on enemy tech levels,
   * plus a 30% equipment drop chance per enemy.
   */
  resolveVictory(enemies: EnemyShip[]): CombatRewardResult {
    let creditsGained = 0;
    const loot: ShipModule[] = [];

    for (const enemy of enemies) {
      creditsGained += enemy.techLevel * 50;

      if (Math.random() < 0.3) {
        const drop = this.rollLootDrop(enemy.techLevel);
        if (drop) loot.push(drop);
      }
    }

    return { creditsGained, loot };
  }

  private rollLootDrop(techLevel: number): ShipModule | null {
    const candidates = GEAR_CATALOG.filter(
      (g) => g.kind !== GearKind.HULL && g.techLevel <= techLevel + 1,
    );
    if (candidates.length === 0) return null;

    const gear = candidates[Math.floor(Math.random() * candidates.length)];
    return new ShipModuleClass(
      gear.id,
      gear.kind as unknown as ModuleCategory,
      gear.name,
      { type: gear.kind.toLowerCase(), value: gear.techLevel * 10 },
      gear.techLevel,
    );
  }

  private applyGridMove(
    enemy: EnemyShip,
    target: import("@/types").AxialCoord,
  ): void {
    const targetTile = this.grid.getTile(target);
    if (!targetTile || targetTile.occupant) return;

    // Clear the enemy from its current tile
    for (let r = 0; r < this.grid.height; r++) {
      for (let q = 0; q < this.grid.width; q++) {
        if (this.grid.tiles[r][q].occupant === enemy) {
          this.grid.tiles[r][q].occupant = null;
          break;
        }
      }
    }
    targetTile.occupant = enemy;
  }
}
