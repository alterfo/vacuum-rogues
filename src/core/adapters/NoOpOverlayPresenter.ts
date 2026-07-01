import type { IOverlayPresenter } from "@/core/ports/IOverlayPresenter";

/**
 * Headless fallback for {@link IOverlayPresenter}: used when GameEngine is
 * constructed without a renderer-backed presenter (unit tests, DI sites that
 * predate the port). Every call is a silent no-op, matching the pre-port
 * behavior where `showErrorModal`/`showGameOutcomeScreen`/etc. all early-out
 * on `if (!this.renderer) return;`.
 */
export class NoOpOverlayPresenter implements IOverlayPresenter {
  showError(): void {}
  clearModal(): void {}
  showLoading(): void {}
  hideLoading(): void {}
  showGameOutcome(): void {}
}
