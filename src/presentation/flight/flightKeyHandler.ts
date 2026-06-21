import { logger } from "@/utils/logger";

/**
 * Everything the flight-scene key router needs to act on a keypress. The scene
 * builds this from its live members on each event, so the handler stays a pure
 * function of (event, context) — testable without the PixiJS scene and keeping
 * the SpaceFlightScene controller small (input routing extracted, mirroring the
 * other `flight/` modules).
 */
export interface FlightKeyContext {
  combatPause: { paused: boolean; resume(): void };
  npcManager: {
    isContactPanelOpen: boolean;
    closeContactPanel(): void;
    /**
     * True while ANY manager-owned blocking modal is open — the NPC contact
     * panel *or* the OVERMIND-core overlay. Mirrors
     * `SpaceFlightScene.isBlockingModalOpen` (`npcManager.hasOpenModal()`), so
     * the Space launch guard suppresses the same surfaces the mouse route-plan
     * guard does. Optional: callers/tests that only model the contact panel may
     * omit it, in which case the guard falls back to `isContactPanelOpen`.
     */
    hasOpenModal?(): boolean;
  };
  hud: {
    isQuestJournalOpen(): boolean;
    closeQuestJournal(): void;
    toggleQuestJournal(): void;
    isSettingsPanelOpen?(): boolean;
    closeModals?(): void;
    showMessage(text: string, color: number): void;
  };
  planetManager: { hasInfoPanel: boolean; closeInfoPanel(): void };
  plannedRoute: { x: number; y: number } | null;
  isTurnRunning: boolean;
  clearPlannedRoute(): void;
  executeRouteTo(x: number, y: number): void;
  openInventory(): void;
}

/**
 * Route a flight-scene keydown:
 * - Escape closes the top open panel (combat pause → contact → journal → planet
 *   info → settings), else cancels a planned route.
 * - Space runs the planned turn (the keyboard equivalent of the confirming
 *   second click); guarded so a held key, a combat pause, an already-running
 *   turn, or an open contact/journal/planet-info/settings panel can't fire
 *   `executeRouteTo`. No route → no-op + hint.
 * - j toggles the quest journal; i opens the inventory.
 */
export function handleFlightKey(
  event: KeyboardEvent,
  ctx: FlightKeyContext,
): void {
  if (event.key === "Escape") {
    if (ctx.combatPause.paused) ctx.combatPause.resume();
    else if (ctx.npcManager.isContactPanelOpen)
      ctx.npcManager.closeContactPanel();
    else if (ctx.hud.isQuestJournalOpen()) ctx.hud.closeQuestJournal();
    else if (ctx.planetManager.hasInfoPanel) ctx.planetManager.closeInfoPanel();
    else if (ctx.hud.isSettingsPanelOpen?.()) ctx.hud.closeModals?.();
    else if (ctx.plannedRoute) {
      ctx.clearPlannedRoute();
      ctx.hud.showMessage("Маршрут отменён", 0xffaa00);
    }
    return;
  }
  if (event.key === " " || event.code === "Space") {
    event.preventDefault(); // Space would otherwise scroll the page
    if (event.repeat || ctx.combatPause.paused || ctx.isTurnRunning) return;
    // Don't launch the turn behind an open modal — the contact panel, the
    // OVERMIND-core overlay, the quest journal, planet-info, or the settings
    // panel must be dismissed first, otherwise the ship flies off while the
    // panel still demands a choice. `hasOpenModal()` covers both
    // manager-owned overlays (contact panel + OVERMIND core); fall back to
    // `isContactPanelOpen` when a caller doesn't model it. Mirrors the
    // mouse-click route-plan guard `isBlockingModalOpen`.
    if (
      (ctx.npcManager.hasOpenModal?.() ?? ctx.npcManager.isContactPanelOpen) ||
      ctx.hud.isQuestJournalOpen() ||
      ctx.planetManager.hasInfoPanel ||
      ctx.hud.isSettingsPanelOpen?.()
    )
      return;
    if (ctx.plannedRoute) {
      ctx.executeRouteTo(ctx.plannedRoute.x, ctx.plannedRoute.y);
      logger.info(
        `▶️ Space: executing planned route to (${ctx.plannedRoute.x.toFixed(0)}, ${ctx.plannedRoute.y.toFixed(0)})`,
      );
    } else {
      ctx.hud.showMessage("Проложите маршрут", 0xffaa00);
    }
    return;
  }
  if (event.key === "j" || event.key === "J") {
    if (!ctx.combatPause.paused) ctx.hud.toggleQuestJournal();
  } else if (event.key === "i" || event.key === "I") {
    if (!ctx.combatPause.paused) ctx.openInventory();
  }
}
