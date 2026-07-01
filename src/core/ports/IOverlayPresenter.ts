/**
 * Port for the full-screen modal/loading/outcome overlays GameEngine drives
 * (error modal, loading spinner, win/loss screen). Keeps `systems/` free of a
 * `pixi.js` import — the concrete renderer-backed implementation lives in
 * `presentation/`; GameEngine only ever sees this interface.
 */
export interface IOverlayPresenter {
  /**
   * Full-screen error message. If `onDismiss` is provided, a "Новая игра"
   * button is shown that clears the modal and invokes it; otherwise the modal
   * has no interactive element.
   */
  showError(message: string, onDismiss?: () => void): void;
  clearModal(): void;
  showLoading(text: string): void;
  hideLoading(): void;
  /** Full-screen win/loss overlay with restart (+ New Game+ on a win) buttons. */
  showGameOutcome(
    win: boolean,
    handlers: { onRestart: () => void; onNewGamePlus?: () => void },
  ): void;
}
