import type { FactionType, GameMode } from "@/types";

export interface NewGamePlusConfig {
  creditCarryFraction: number;
  creditCarryCap: number;
}

export const DEFAULT_NEW_GAME_PLUS_CONFIG: NewGamePlusConfig = {
  creditCarryFraction: 0.5,
  creditCarryCap: 50000,
};

export interface NewGamePlusCarry {
  credits: number;
  rank: number;
  factionType: FactionType;
  gameMode: GameMode;
}

export interface NewGamePlusSource {
  credits: number;
  rank: number;
  faction: FactionType;
  gameMode: GameMode;
}

export function nextCycleGameMode(mode: GameMode): GameMode {
  switch (mode) {
    case "GOD":
      return "NORMAL";
    case "NORMAL":
      return "HARD";
    case "HARD":
    default:
      return "HARD";
  }
}

export function newGamePlusCarry(
  source: NewGamePlusSource,
  config: NewGamePlusConfig = DEFAULT_NEW_GAME_PLUS_CONFIG,
): NewGamePlusCarry {
  const scaled = Math.floor(
    Math.max(0, source.credits) * config.creditCarryFraction,
  );
  const credits = Math.max(0, Math.min(scaled, config.creditCarryCap));
  return {
    credits,
    rank: Math.max(0, source.rank),
    factionType: source.faction,
    gameMode: nextCycleGameMode(source.gameMode),
  };
}
