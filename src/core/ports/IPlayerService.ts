import type { Player } from "@/domain/Player";
import type { RaceType } from "@/types";

/**
 * Settings required to create a new player.
 */
export interface PlayerSettings {
  captainName?: string;
  raceType: RaceType;
  startingMoney?: number;
}

/**
 * Port for player lifecycle management.
 * Follows Information Expert: PlayerService knows how to create and manage Player.
 */
export interface IPlayerService {
  createPlayer(settings: PlayerSettings): Player;
  getPlayer(): Player | null;
  updatePlayer(player: Player): void;
  deletePlayer(): void;
}
