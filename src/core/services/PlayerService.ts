import type {
  IPlayerService,
  PlayerSettings,
} from "@/core/ports/IPlayerService";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { RaceRegistry } from "@/systems/RaceRegistry";
import { logger } from "@/utils/logger";

/**
 * Service responsible for Player lifecycle.
 * Follows Information Expert: knows how to assemble a Player with all dependencies.
 * Follows SRP: only player creation and management, no rendering or saving logic.
 */
export class PlayerService implements IPlayerService {
  private player: Player | null = null;

  createPlayer(settings: PlayerSettings): Player {
    const race = RaceRegistry.getRace(settings.raceType);
    const skillTree = new SkillTree([]);
    const inventory = new Inventory();

    this.player = new Player(
      "player",
      settings.captainName ?? "Captain",
      race,
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
        race.shipBaseline.hullHP,
        race.shipBaseline.hullHP,
        race.shipBaseline.shields,
        race.shipBaseline.shields,
        race.shipBaseline.energy,
        race.shipBaseline.energy,
        race.shipBaseline.speed,
        race.shipBaseline.evasion,
        race,
      ),
      inventory,
      "",
    );

    logger.info(
      `PlayerService: created player "${this.player.name}" with race ${race.name}`,
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
