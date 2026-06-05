import type { Player } from "@/domain/Player";
import type { FactionType } from "@/types";

/**
 * Service responsible for Player lifecycle
 */
export interface PlayerSettings {
  captainName?: string;
  factionType: FactionType;
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
