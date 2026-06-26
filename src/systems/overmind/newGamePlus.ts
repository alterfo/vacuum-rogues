import type { FactionType, GameMode } from "@/types";

/**
 * New-Game+ carry-over (pure).
 *
 * After the player wins the Overmind endgame arc (breaks the core / eradicates
 * the front, `advanceOvermind` → status `"won"`), the victory screen offers a
 * **New Game+**: a fresh galaxy on a tougher cycle that carries forward a
 * *chosen subset* of the won captain's progress — a capped slice of credits,
 * their rank (veteran status persists) and faction, and a one-notch-harder
 * difficulty.
 *
 * Deliberately a small, pure transform with **no new persisted field**: the
 * carry maps onto values the new-game path already seeds (startingMoney, rank,
 * faction, gameMode), so NG+ needs no schema/migration/save bump. The engine
 * (`GameEngine.startNewGamePlus`) captures this from the won player *before* the
 * reset and replays it when the fresh player is created.
 */

export interface NewGamePlusConfig {
  /** Fraction of the won game's credits carried into the next cycle. */
  creditCarryFraction: number;
  /** Absolute cap on carried credits (whole credits — a head-start, not a free win). */
  creditCarryCap: number;
}

/**
 * Default NG+ tuning. Mirrored into `balance.ts` so the carry is tunable in one
 * place; kept here so the pure transform has a sensible standalone default.
 */
export const DEFAULT_NEW_GAME_PLUS_CONFIG: NewGamePlusConfig = {
  creditCarryFraction: 0.5,
  creditCarryCap: 50000,
};

/** The subset of progress carried into a New Game+ cycle. */
export interface NewGamePlusCarry {
  /** Credits seeded into the next cycle (a capped slice of the won game's). */
  credits: number;
  /** Rank carried forward — the won captain keeps their veteran standing. */
  rank: number;
  /** Faction the won captain flew; the NG+ run defaults to it. */
  factionType: FactionType;
  /** Difficulty the next cycle runs at — one notch tougher (capped at HARD). */
  gameMode: GameMode;
}

/** The won-player fields the carry is computed from (structural, test-friendly). */
export interface NewGamePlusSource {
  credits: number;
  rank: number;
  faction: FactionType;
  gameMode: GameMode;
}

/**
 * Difficulty escalation per NG+ cycle: each completed run ratchets the next one
 * one notch toward HARD, so NG+ is a *tougher* cycle (the arc's whole point).
 * GOD is a sandbox, so winning it graduates the player to a real NORMAL run;
 * HARD is the ceiling and stays HARD.
 */
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

/**
 * Compute the NG+ carry-over from a won player. Credits are a capped fraction
 * (a head-start, never the won pile in full); rank/faction carry verbatim;
 * difficulty escalates one notch. Pure — no engine/galaxy/DOM coupling.
 */
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
