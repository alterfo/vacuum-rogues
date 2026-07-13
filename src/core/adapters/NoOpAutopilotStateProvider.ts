import type { IAutopilotStateProvider } from "@/core/ports/IAutopilotStateProvider";

/**
 * Headless fallback for {@link IAutopilotStateProvider}: the default when
 * GameEngine is constructed without the DEV-only autopilot provider (production
 * bundle, unit tests, legacy DI sites). `isEngaged()` is always `false` so no
 * save ever persists a spurious engaged flag, and `resume()` is a silent no-op.
 * Mirrors {@link NoOpOverlayPresenter}.
 */
export class NoOpAutopilotStateProvider implements IAutopilotStateProvider {
  isEngaged(): boolean {
    return false;
  }
  resume(): void {}
}
