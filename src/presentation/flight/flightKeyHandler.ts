import { logger } from "@/utils/logger";
import {
  resolveFlightAction,
  currentKeymap,
  type FlightKeymap,
} from "@/presentation/input/keymap";

export interface FlightKeyContext {
  combatPause: {
    paused: boolean;
    resume(): void;
    beginCombatRound?(): void;
  };
  npcManager: {
    isContactPanelOpen: boolean;
    closeContactPanel(): void;
    hasOpenModal?(): boolean;
    isEncounterPromptOpen?: boolean;
    closeEncounterPrompt?(): void;
  };
  hud: {
    isQuestJournalOpen(): boolean;
    closeQuestJournal(): void;
    toggleQuestJournal(): void;
    isSettingsPanelOpen?(): boolean;
    closeModals?(): void;
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
  combatPlanning?: { isPlanning: boolean; confirm(): void };
  keymap?: FlightKeymap;
}

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
    const modalOpen =
      (ctx.npcManager.hasOpenModal?.() ?? ctx.npcManager.isContactPanelOpen) ||
      ctx.hud.isQuestJournalOpen() ||
      ctx.planetManager.hasInfoPanel ||
      ctx.hud.isSettingsPanelOpen?.() ||
      ctx.hud.isSystemModalOpen?.();
    if (ctx.combatPlanning?.isPlanning) {
      if (!modalOpen) ctx.combatPlanning.confirm();
      return;
    }
    if (ctx.combatPause.paused || ctx.isTurnRunning) return;
    if (modalOpen) return;
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
