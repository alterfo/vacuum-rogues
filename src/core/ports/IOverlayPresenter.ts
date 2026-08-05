export interface IOverlayPresenter {
  showError(message: string, onDismiss?: () => void): void;
  showLoading(text: string): void;
  hideLoading(): void;
  showGameOutcome(
    win: boolean,
    handlers: { onRestart: () => void; onNewGamePlus?: () => void },
  ): void;
  dismissAll(): void;
}
