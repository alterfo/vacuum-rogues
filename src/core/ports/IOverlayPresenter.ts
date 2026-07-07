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
  showLoading(text: string): void;
  hideLoading(): void;
  /** Full-screen win/loss overlay with restart (+ New Game+ on a win) buttons. */
  showGameOutcome(
    win: boolean,
    handlers: { onRestart: () => void; onNewGamePlus?: () => void },
  ): void;
  /**
   * Tear down any open modal/loading overlay's own bookkeeping. Called by
   * `GameEngine.transitionTo` on every scene teardown, BEFORE the renderer's
   * blanket `clearUILayer()` destroys every UI-layer child indiscriminately —
   * without this, an overlay left open across a scene transition (or a page
   * reload / new-game reset) has its PixiJS objects destroyed out from under
   * the presenter, leaking destroyed-object references in its own tracking
   * arrays across scenes/sessions until the next `showError`/`showGameOutcome`
   * call happens to overwrite them (F4, three-year-campaign Task 16b).
   */
  dismissAll(): void;
}
