import type {
  IPlayerService,
  PlayerSettings,
} from "@/core/ports/IPlayerService";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionRegistry } from "@/systems/FactionRegistry";
import { logger } from "@/utils/logger";

/**
 * Service responsible for Player lifecycle.
 * Follows Information Expert: knows how to assemble a Player with all dependencies.
 * Follows SRP: only player creation and management, no rendering or saving logic.
 */
export class PlayerService implements IPlayerService {
  private player: Player | null = null;

  createPlayer(settings: PlayerSettings): Player {
    const factionBonus = FactionRegistry.getBonus(settings.factionType);
    const skillTree = new SkillTree([]);
    const inventory = new Inventory();

    // Base stats modified by faction bonus
    const baseHull = 100;
    const baseShields = 50;
    const baseEnergy = 100;
    const baseSpeed = 1.0;
    const baseEvasion = 0.8;

    const hullBonus = factionBonus.shipBonus.armor ?? 1.0;
    const shieldBonus = factionBonus.shipBonus.shield ?? 1.0;
    const speedBonus = factionBonus.shipBonus.speed ?? 1.0;

    this.player = new Player(
      "player",
      settings.captainName ?? "Captain",
      settings.factionType,
      0,
      1,
      skillTree,
      {},
      { activeQuests: [], completedQuests: [] },
      { entries: [] },
      settings.startingMoney ?? 1000,
      new PlayerShip(
        "Ranger-1",
        "Ranger-1",
        Math.round(baseHull * hullBonus),
        Math.round(baseHull * hullBonus),
        Math.round(baseShields * shieldBonus),
        Math.round(baseShields * shieldBonus),
        baseEnergy,
        baseEnergy,
        baseSpeed * speedBonus,
        baseEvasion,
        settings.factionType,
      ),
      inventory,
      "",
    );

    logger.info(
      `PlayerService: created player "${this.player.name}" with faction ${settings.factionType}`,
    );
    return this.player;
  }

  getPlayer(): Player | null {
    return this.player;
  }

  updatePlayer(player: Player): void {
    this.player = player;
  }

  deletePlayer(): void {
    this.player = null;
  }
}
