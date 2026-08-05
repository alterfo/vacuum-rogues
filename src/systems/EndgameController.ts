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
import { GAME_BALANCE } from "@/config/balance";
import {
  newGamePlusCarry,
  type NewGamePlusCarry,
} from "@/systems/overmind/newGamePlus";
import { logger } from "@/utils/logger";

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

export class EndgameController {
  private _outcomeShown = false;
  private _winScreenShown = false;
  private _playerDeathShown = false;
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
  resetPlayerDeathGuard(): void {
    this._playerDeathShown = false;
  }

  showGameOutcomeScreen(win: boolean): void {
    if (this._outcomeShown) return;
    this._outcomeShown = true;
    const galaxy = this.deps.getGalaxy();
    if (win && galaxy) {
      if (galaxy.overmindCoreSystemId) {
        galaxy.tryLiberate(galaxy.overmindCoreSystemId, "player");
      }
      galaxy.overmindArc.status = "won";
    }

    this.deps.overlay.showGameOutcome(win, {
      onRestart: () => {
        this.generateDefaultGameState()
          .then(() => this.deps.transitionToMainMenu())
          .catch((e) =>
            logger.error("Transition after game outcome failed:", e),
          );
      },
      onNewGamePlus: win
        ? () => {
            this.startNewGamePlus().catch((e) =>
              logger.error("New Game+ start failed:", e),
            );
          }
        : undefined,
    });
  }

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
    this.pendingNewGamePlus = carry;
    await this.deps.transitionToSpaceFlight();
  }

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
    this.pendingNewGamePlus = null;
    this.deps.playerService.deletePlayer();
    this.deps.questManager.restoreState([], []);
    this.deps.bankingService.resetLedger();
    this.deps.clearFlightPositions();
    this.deps.sessionState.resetForNewSession();
    this.deps.clearCombatStateProvider();
    this.deps.music.reset();
    this.deps.hullAlarm.reset();
    const seed = `SR_${Date.now()}`;
    const galaxy = await this.deps.galaxyService.generate(seed, 30);
    this.deps.setGalaxy(galaxy);
    logger.info(`Generated default game state with seed: ${seed}`);
  }
}
