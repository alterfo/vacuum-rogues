import { logger } from "@/utils/logger";
import {
  resolveFlightAction,
  currentKeymap,
  type FlightKeymap,
} from "@/presentation/input/keymap";

/**
 * Everything the flight-scene key router needs to act on a keypress. The scene
 * builds this from its live members on each event, so the handler stays a pure
 * function of (event, context) — testable without the PixiJS scene and keeping
 * the SpaceFlightScene controller small (input routing extracted, mirroring the
 * other `flight/` modules).
 */
export interface FlightKeyContext {
  combatPause: {
    paused: boolean;
    resume(): void;
    /**
     * Begin a fresh combat round before resuming (mirrors the overlay's own
     * «Продолжить» button, `combatPauseUi.ts` onResume) — optional so tests
     * that don't model round-based combat can omit it. Without this, Escape
     * (and the touch «✕» button, which replays this same action) would leave
     * `CombatModule.roundComplete` stuck `true`, silently blocking fire for
     * both sides for the rest of the engagement.
     */
    beginCombatRound?(): void;
  };
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
    /**
     * True while the exploration-encounter choice prompt is open; `close` walks
     * away from it (the neutral "leave" — no payoff, no fight). Optional so
     * callers/tests that don't model encounters can omit them.
     */
    isEncounterPromptOpen?: boolean;
    closeEncounterPrompt?(): void;
  };
  hud: {
    isQuestJournalOpen(): boolean;
    closeQuestJournal(): void;
    toggleQuestJournal(): void;
    /**
     * True while the bottom-left ♿ accessibility panel is open. (The name is
     * retained from when this also covered the ⚙ settings panel, which moved to
     * the main menu in the 20260626 playtest pass; only the accessibility panel
     * remains in flight.) Optional so callers/tests that don't model it can omit
     * it. Esc closes it via {@link closeModals}; Space is suppressed behind it.
     */
    isSettingsPanelOpen?(): boolean;
    closeModals?(): void;
    /**
     * True while the in-flight system menu or its load-confirm sub-panel is open.
     * Optional so existing callers/tests that don't model the menu can omit it
     * (the `?.()` guard then reads falsy). Mirrors the mouse-click
     * `isBlockingModalOpen` guard so Esc/Space treat it like every other modal.
     */
    isSystemModalOpen?(): boolean;
    closeSystemMenu?(): void;
    showMessage(text: string, color: number): void;
  };
  planetManager: { hasInfoPanel: boolean; closeInfoPanel(): void };
  plannedRoute: { x: number; y: number } | null;
  isTurnRunning: boolean;
  clearPlannedRoute(): void;
  executeRouteTo(x: number, y: number): void;
  openInventory(): void;
  /**
   * The tactical pause-and-plan loop (`CombatPlanningController`, Task 14.5a).
   * Optional so existing callers/tests that don't model it can omit it — the
   * `runTurn` guard below then falls through to the pre-existing route-turn
   * behavior unchanged. While `isPlanning`, `confirm()` takes priority over the
   * ordinary route-turn path (planning freezes the sim outside of
   * `isTurnRunning`, so the usual `ctx.isTurnRunning` guard would otherwise make
   * Space a no-op during a fight).
   */
  combatPlanning?: { isPlanning: boolean; confirm(): void };
  /**
   * The active action→key bindings used to resolve the event to an action.
   * Optional so existing callers/tests that don't model remapping can omit it —
   * the handler then reads the live `currentKeymap()` (the persisted player
   * bindings, defaulting to the historical Escape/Space/j/i mapping). The
   * keyboard behaviour is identical to the old hard-coded routing under the
   * defaults; rebinding only changes which key fires which action.
   */
  keymap?: FlightKeymap;
}

/**
 * Route a flight-scene keydown. The event is first resolved to a high-level
 * action via the persisted keymap (`ctx.keymap ?? currentKeymap()`), so the keys
 * below are the *defaults* — a player can rebind any of them:
 * - `cancel` (Escape) closes the top open panel (combat pause → encounter →
 *   contact → journal → planet info → ♿ accessibility → system menu), else
 *   cancels a planned route.
 * - `runTurn` (Space) runs the planned turn (the keyboard equivalent of the
 *   confirming second click); guarded so a held key, a combat pause, an
 *   already-running turn, or an open contact/journal/planet-info/accessibility/
 *   system-menu panel can't fire `executeRouteTo`. No route → no-op + hint.
 * - `journal` (j) toggles the quest journal; `inventory` (i) opens the inventory.
 */
export function handleFlightKey(
  event: KeyboardEvent,
  ctx: FlightKeyContext,
): void {
  const action = resolveFlightAction(event, ctx.keymap ?? currentKeymap());
  if (action === "cancel") {
    if (ctx.combatPause.paused) {
      ctx.combatPause.beginCombatRound?.();
      ctx.combatPause.resume();
    } else if (ctx.npcManager.isEncounterPromptOpen)
      ctx.npcManager.closeEncounterPrompt?.();
    else if (ctx.npcManager.isContactPanelOpen)
      ctx.npcManager.closeContactPanel();
    else if (ctx.hud.isQuestJournalOpen()) ctx.hud.closeQuestJournal();
    else if (ctx.planetManager.hasInfoPanel) ctx.planetManager.closeInfoPanel();
    else if (ctx.hud.isSettingsPanelOpen?.()) ctx.hud.closeModals?.();
    else if (ctx.hud.isSystemModalOpen?.()) ctx.hud.closeSystemMenu?.();
    else if (ctx.plannedRoute) {
      ctx.clearPlannedRoute();
      ctx.hud.showMessage("Маршрут отменён", 0xffaa00);
    }
    return;
  }
  if (action === "runTurn") {
    event.preventDefault(); // Space would otherwise scroll the page
    if (event.repeat) return;
    // Tactical planning confirm ("Ход") takes priority — checked before the
    // ordinary route-turn guard below, since planning freezes the sim
    // independently of `isTurnRunning` (Task 14.5a).
    if (ctx.combatPlanning?.isPlanning) {
      ctx.combatPlanning.confirm();
      return;
    }
    if (ctx.combatPause.paused || ctx.isTurnRunning) return;
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
      ctx.hud.isSettingsPanelOpen?.() ||
      ctx.hud.isSystemModalOpen?.()
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
  if (action === "journal") {
    if (!ctx.combatPause.paused) ctx.hud.toggleQuestJournal();
  } else if (action === "inventory") {
    if (!ctx.combatPause.paused) ctx.openInventory();
  }
}
