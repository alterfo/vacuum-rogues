import type { Player } from "@/domain/Player";
import type { FactionType } from "@/types";

export interface PlayerSettings {
  captainName?: string;
  factionType: FactionType;
  startingMoney?: number;
}

export interface IPlayerService {
  createPlayer(settings: PlayerSettings): Player;
  getPlayer(): Player | null;
  updatePlayer(player: Player): void;
  deletePlayer(): void;
}
