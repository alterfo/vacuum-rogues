import type { IOverlayPresenter } from "@/core/ports/IOverlayPresenter";

export class NoOpOverlayPresenter implements IOverlayPresenter {
  showError(): void {}
  showLoading(): void {}
  hideLoading(): void {}
  showGameOutcome(): void {}
  dismissAll(): void {}
}
