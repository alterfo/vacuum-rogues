import { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type {
  IGalaxyService,
  IPlayerService,
  IQuestService,
  IOverlayPresenter,
} from "@/core/ports";
import { BankingService } from "@/systems/banking/BankingService";
import { FlightSessionState } from "@/systems/FlightSessionState";
import { MusicDriver } from "@/systems/audio/musicDriver";
import { HullAlarm } from "@/systems/audio/sfxCues";
import { FactionType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import {
  newGamePlusCarry,
  type NewGamePlusCarry,
} from "@/systems/overmind/newGamePlus";
import { logger } from "@/utils/logger";

/**
 * Everything {@link EndgameController} needs from `GameEngine` — pure state
 * accessors for fields GameEngine still owns, direct references to stable
 * subsystem instances, and single-purpose scene-transition closures (mirroring
 * {@link import("./DayTickController").DayTickControllerDeps}'s
 * `transitionToWinScreen`) so the controller never has to reconstruct a
 * `{ gameEngine: this }` context itself.
 */
export interface EndgameControllerDeps {
  getPlayer: () => Player | null;
  setPlayer: (player: Player | null) => void;
  setPlayerLoadout: (loadout: ShipLoadout | null) => void;
  getGalaxy: () => Galaxy | null;
  setGalaxy: (galaxy: Galaxy) => void;
  galaxyService: IGalaxyService;
  playerService: IPlayerService;
  questManager: IQuestService;
  bankingService: BankingService;
  sessionState: FlightSessionState;
  music: MusicDriver;
  hullAlarm: HullAlarm;
  clearFlightPositions: () => void;
  clearCombatStateProvider: () => void;
  overlay: IOverlayPresenter;
  hasRenderer: () => boolean;
  getPlayerDeathCallback: () => (() => void) | undefined;
  transitionToMainMenu: () => Promise<void>;
  transitionToSpaceFlight: () => Promise<void>;
  transitionToGameOver: () => Promise<void>;
  transitionToRaceSelection: () => Promise<void>;
}

/**
 * Owns the endgame one-shot guards (outcome overlay, win-screen, player-death,
 * staged New Game+ carry) and the win/loss/death/reset flows extracted from
 * `GameEngine` (Phase 2 Task 10). `GameEngine` keeps every public method
 * (`checkWinCondition`/`showGameOutcomeScreen`/`startNewGamePlus`/
 * `triggerPlayerDeath`/`restartNewGame`) as a thin forwarder — external callers
 * (NpcShipManager, scenes, DayTickController) are unaffected.
 */
export class EndgameController {
  /**
   * One-shot guard for the Overmind endgame outcome overlay (win OR loss). Set
   * by the overlay itself so the sticky `won`/`lost` arc status re-running each
   * EOD — and the in-flight core-kill win path — only ever shows it once.
   */
  private _outcomeShown = false;
  private _winScreenShown = false;
  /** One-shot guard so player death fires the game-over flow exactly once. */
  private _playerDeathShown = false;
  /**
   * Carry-over staged by {@link startNewGamePlus} for the next fresh game: the
   * new-game creation path in `GameEngine.transitionTo` consumes it (once) to
   * seed the fresh player's credits/rank/faction/difficulty. Null for a plain
   * new game.
   */
  pendingNewGamePlus: NewGamePlusCarry | null = null;

  constructor(private readonly deps: EndgameControllerDeps) {}

  isOutcomeShown(): boolean {
    return this._outcomeShown;
  }
  isWinScreenShown(): boolean {
    return this._winScreenShown;
  }
  markWinScreenShown(): void {
    this._winScreenShown = true;
  }
  /** Re-arms the death guard on load, so a restored checkpoint can die again. */
  resetPlayerDeathGuard(): void {
    this._playerDeathShown = false;
  }

  /**
   * Returns true when the player meets the win condition: rank >= 2
   * ("Ветеран") AND reputation > 50 with at least 3 factions.
   */
  checkWinCondition(): boolean {
    const player = this.deps.getPlayer();
    if (!player) return false;
    const VETERAN_RANK = 2;
    if ((player.rank ?? 0) < VETERAN_RANK) return false;
    const factions = Object.values(FactionType);
    const allied = factions.filter((f) => (player.reputation[f] ?? 0) > 50);
    return allied.length >= 3;
  }

  /**
   * Show a full-screen win or loss overlay with a "Начать заново" button (and,
   * on a win, a "Новая игра+" button that carries a subset of progress into a
   * tougher cycle). Called when the player destroys the OVERMIND core / the arc
   * status reaches `won` (win) or the arc reaches `lost` (OVERMIND consumes the
   * galaxy).
   *
   * Idempotent: the first call sets {@link _outcomeShown} and subsequent calls
   * no-op, so the sticky `won`/`lost` arc status re-running each EOD — and the
   * in-flight core-kill win path firing alongside the next EOD — only ever
   * shows the screen once. The overlay is drawn over the current scene (no
   * terminal scene transition), so it never triggers the autosave-clobber an
   * autosaving GAME_OVER scene would.
   */
  showGameOutcomeScreen(win: boolean): void {
    if (this._outcomeShown) return;
    this._outcomeShown = true;
    // Persist a win into the arc state so it survives a flight-autosave / reload:
    // liberate the (now-destroyed) core system so the boss prompt won't re-trigger
    // on re-entry, and flip the arc status to the sticky `won` so a later EOD can't
    // drift an already-won galaxy to `lost`. Idempotent — the EOD-driven win path
    // (coreBroken/eradicated) already has both done; the in-flight core-kill path
    // (NpcShipManager.handleInFlightDeath) relies on this to persist its victory.
    const galaxy = this.deps.getGalaxy();
    if (win && galaxy) {
      if (galaxy.overmindCoreSystemId) {
        galaxy.tryLiberate(galaxy.overmindCoreSystemId);
      }
      galaxy.overmindArc.status = "won";
    }

    this.deps.overlay.showGameOutcome(win, {
      // «Начать заново» — a full reset (new galaxy, fresh captain) back to the menu.
      onRestart: () => {
        this.generateDefaultGameState()
          .then(() => this.deps.transitionToMainMenu())
          .catch((e) =>
            logger.error("Transition after game outcome failed:", e),
          );
      },
      // On a victory, offer New Game+ (carry a subset of progress into a tougher
      // cycle) above the plain restart.
      onNewGamePlus: win
        ? () => {
            this.startNewGamePlus().catch((e) =>
              logger.error("New Game+ start failed:", e),
            );
          }
        : undefined,
    });
  }

  /**
   * Start a New Game+ from the victory screen: a fresh galaxy on a tougher cycle
   * that carries a *chosen subset* of the won captain's progress (a capped slice
   * of credits, their rank + faction, and a one-notch-harder difficulty —
   * {@link newGamePlusCarry}). The carry is captured BEFORE the reset and staged
   * on {@link pendingNewGamePlus}; the new-game creation path in
   * `GameEngine.transitionTo` consumes it once when the fresh player is built.
   *
   * No new persisted field: the carry maps onto values the new-game path already
   * seeds (startingMoney/rank/faction/gameMode), so NG+ needs no schema/migration.
   */
  async startNewGamePlus(): Promise<void> {
    const player = this.deps.getPlayer();
    const carry = player
      ? newGamePlusCarry(
          {
            credits: player.credits,
            rank: player.rank,
            faction: player.faction,
            gameMode: player.gameMode,
          },
          {
            creditCarryFraction:
              GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_FRACTION,
            creditCarryCap: GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_CAP,
          },
        )
      : null;
    await this.generateDefaultGameState();
    // Stage AFTER the reset (generateDefaultGameState nulls the player) so the
    // fresh new-game build picks it up.
    this.pendingNewGamePlus = carry;
    await this.deps.transitionToSpaceFlight();
  }

  /**
   * Player ship destroyed in flight combat → game over. Fires the death flow
   * exactly once (one-shot `_playerDeathShown` guard): a stray later shot the
   * same frame is a no-op. Crucially this does NOT touch the `"auto"` takeoff
   * autosave — that save is the checkpoint the GAME_OVER screen rolls back to,
   * so death must be non-destructive to it.
   *
   * Production drives the terminal GAME_OVER transition here. The transition is
   * renderer-guarded so the headless death-detection tests (no renderer) still
   * exercise the idempotent guard + the death callback seam without
   * `transitionTo` throwing.
   */
  triggerPlayerDeath(): void {
    if (this._playerDeathShown) return;
    this._playerDeathShown = true;
    logger.warn("Player ship destroyed — triggering game over");
    this.deps.getPlayerDeathCallback()?.();
    if (this.deps.hasRenderer()) {
      this.deps
        .transitionToGameOver()
        .catch((e) => logger.error("Game-over transition failed:", e));
    }
  }

  /**
   * «Начать заново» from the GAME_OVER screen: start a completely fresh game.
   * Mirrors the new-game modal path — it MUST reset game state
   * (`generateDefaultGameState`: null the player, regenerate the galaxy, clear the
   * win/death guards) BEFORE entering race selection. Without the reset the dead
   * player survives, so the SPACE_FLIGHT new-game guard (`!this.player`) never
   * fires and race-selection would drop the player back into the old galaxy
   * with the destroyed ship instead of a fresh start.
   */
  async restartNewGame(): Promise<void> {
    await this.generateDefaultGameState();
    await this.deps.transitionToRaceSelection();
  }

  async generateDefaultGameState(): Promise<void> {
    this.deps.setPlayer(null);
    this.deps.setPlayerLoadout(null);
    this._outcomeShown = false;
    this._winScreenShown = false;
    this._playerDeathShown = false;
    // Clear any New Game+ carry that was staged but never consumed (e.g. a
    // SPACE_FLIGHT transition that threw before the new-game branch nulled it).
    // startNewGamePlus re-stages *after* this reset, so NG+ is unaffected; a
    // plain «Новая игра» now never inherits a stale carry's credits/rank.
    this.pendingNewGamePlus = null;
    this.deps.playerService.deletePlayer();
    // Full reset for a fresh game: clear quests, the banking ledger and the
    // persisted/transient flight position so «Новая игра» never inherits the
    // prior in-session game's quests, credits or ship location (playtest
    // 2026-06-23). The new player's account is re-seeded when it's created.
    this.deps.questManager.restoreState([], []);
    this.deps.bankingService.resetLedger();
    this.deps.clearFlightPositions();
    this.deps.sessionState.resetForNewSession();
    // Clear adaptive-audio state so a fresh game never inherits a stale combat
    // hold or a still-armed low-hull alarm from the prior in-session game.
    this.deps.clearCombatStateProvider();
    this.deps.music.reset();
    this.deps.hullAlarm.reset();
    const seed = `SR_${Date.now()}`;
    const galaxy = await this.deps.galaxyService.generate(seed, 30);
    this.deps.setGalaxy(galaxy);
    logger.info(`Generated default game state with seed: ${seed}`);
  }
}
