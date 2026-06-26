import { Container, Graphics, Text } from "pixi.js";
import { UiButton } from "../ui/UiButton";
import { isTouchLayoutActive } from "../ui/responsiveLayout";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { Faction } from "@/types/faction";
import { SystemMiniMap } from "../SystemMiniMap";
import { QuestJournalUI } from "../QuestJournalUI";
import { HelpPanel } from "../ui/HelpPanel";
import { helpFor } from "@/systems/onboarding/helpContent";
import { buildPlanetTooltipLines } from "@/utils/planetTooltip";
import type { LandingDenialReason } from "@/systems/galaxy/landingAccess";
import { formatGameDate, formatGameTimestamp } from "@/utils/gameCalendar";
import { scaledFont } from "@/utils/fontScale";
import {
  AccessibilityPanel,
  ACCESSIBILITY_PANEL_HEIGHT,
} from "../ui/AccessibilityPanel";
import { GAME_BALANCE } from "@/config/balance";
import { logger } from "@/utils/logger";
import type { FlightModule } from "./FlightModule";

/** Touch «✕» cancel button width (px) and the gap to the left of Play. */
const CANCEL_BTN_W = 56;
const CANCEL_BTN_GAP = 8;

/**
 * Owns the in-flight HUD: the static instruction/date text, the quest-journal and
 * star-map buttons, the Play/Pause + speed buttons, the ♿ accessibility button,
 * the system mini-map, the bottom-left mini-log, transient toasts and hover
 * tooltips. Extracted from {@link SpaceFlightScene} as a {@link FlightModule}.
 * (The former ⚙ settings panel — speed/font/language/neural — moved to the main
 * menu in Task 8; only the ♿ a11y quick-toggle remains a bottom-left HUD panel.)
 *
 * The scene stays the Controller / Information Expert: button presses fan out
 * through the public callbacks ({@link onPlayPause}, {@link onSpeedCycle},
 * {@link onStarMap}, {@link onMiniMapPan}, {@link onMiniMapReturn},
 * {@link onQuestNavigate}) so the HUD never reaches back into the scene class
 * (Low Coupling / DIP). State the button labels need is pushed in via
 * {@link setTurnRunning}; the day counter reads straight from the injected
 * {@link GameEngine}, so no `setDayCount` push is needed, and game speed is the
 * HUD's own concern (it owns the index + label) pushed *out* via
 * {@link onSpeedCycle}.
 *
 * The mini-map *object* lives here (created/destroyed with the rest of the HUD),
 * but its per-frame refresh stays in the scene — it reads route + camera + world
 * state — and reaches the radar via {@link miniMap} (matches the Task 9
 * `updateSystemMiniMap` decision). Likewise {@link setCameraDebug} lets the
 * scene's camera loop drive the debug read-out the HUD owns.
 */
export class FlightHud implements FlightModule {
  private readonly renderer: Renderer;
  private readonly gameEngine: GameEngine | null;
  private readonly uiLayer: Container;

  private uiContainer: Container | null = null;
  // Current date display (top-left).
  private dayCounterText: Text | null = null;
  // Optional fractional "day of turn" source pushed by the scene so the date
  // read-out shows sub-day progress within a turn (gameDays + distance/wait
  // fraction); without it the counter falls back to the whole-day `gameDays`.
  private dayProvider: (() => number) | null = null;
  // Star-map button (top-right) — repositioned on resize.
  private backButton: Text | null = null;
  // Camera debug read-out (development only); the scene's camera loop sets its text.
  private cameraDebugText: Text | null = null;

  // Play / Pause turn control (bottom-centre).
  private playPauseButton: UiButton | null = null;
  // Touch-only cancel/«✕» button (left of Play) — the on-screen equivalent of the
  // Esc key, only built on a touch layout (`docs/plans/20260625-mobile-adaptation.md`
  // Task 3). Null on desktop, so the desktop HUD is byte-for-byte unchanged.
  private cancelButton: UiButton | null = null;
  // Latest turn state pushed by the scene; drives the Play/Pause label.
  private turnRunning = false;

  // Speed button: cycles through GAME_BALANCE.gameSpeedMultipliers (1×/2×/4×).
  private speedButton: UiButton | null = null;
  private speedIndex = 0;

  // Accessibility button (♿) + toggled accessibility panel (palette /
  // reduced-motion / key remap; bottom-left HUD). The former ⚙ settings panel
  // (speed/font/language/neural) moved to the main menu — see MainMenuScene —
  // so this in-the-moment a11y aid is the only bottom-left HUD panel now
  // (`docs/plans/20260625-accessibility-pass.md`, Task 4;
  // `docs/plans/20260626-playtest-bugs-pause-help-infocenter-i18n.md`, Task 8).
  private accessibilityButton: UiButton | null = null;
  private accessibilityPanel: Container | null = null;
  private accessibilityPanelComp: AccessibilityPanel | null = null;

  // In-flight system menu (top-left [МЕНЮ] button) + its toggled panel. Always
  // reachable so the player can load a save or quit from any dead-end — a
  // general escape hatch, not a fragile "stuck" auto-detect.
  private systemMenuPanel: Container | null = null;
  // Confirm sub-panel raised by «Загрузить сохранение» (guards against losing the
  // current run). Torn down together with the menu by {@link closeSystemMenu}.
  private systemMenuConfirmPanel: Container | null = null;
  // Whether «Загрузить сохранение» is offered. Pushed by the scene from
  // `saveManager.hasSave()` via {@link setLoadSaveEnabled}; the menu reads it at
  // build time. Default true — a take-off autosave almost always exists in
  // flight — so the action only goes dim when there is genuinely no save.
  private loadSaveEnabled = true;

  // [?] help overlay (toggled by the [?] Text button in uiContainer).
  private helpOverlay: Container | null = null;

  // System mini-map / radar (bottom-right). The scene drives its per-frame
  // refresh via {@link miniMap}.
  private systemMiniMap: SystemMiniMap | null = null;

  // Quest Journal UI (toggled by the [КВЕСТЫ] button / J key).
  private questJournalUI: QuestJournalUI | null = null;
  // The journal's contextual-help panel (opened by its «?» button). One at a time.
  private questHelpPanel: HelpPanel | null = null;

  // Transient on-screen feedback (toast) and its auto-clear timer.
  private toast: Text | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Hover tooltip: planets (immediate) and NPC ships (300 ms delay).
  private tooltipText: Text | null = null;
  private tooltipContainer: Container | null = null;
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;

  // Mini-log (B5): last 5 game events in the bottom-left corner.
  private miniLogContainer: Container | null = null;
  private miniLogEntries: Array<{ textObj: Text; elapsed: number }> = [];
  private readonly MINI_LOG_DURATION = 5000;
  private readonly MINI_LOG_FADE_MS = 1000;

  // --- Callbacks the scene wires in its initialize() (DIP: the HUD fans button
  // presses out to the scene without depending on the concrete scene class). ---
  /** Play/Pause turn control pressed. */
  onPlayPause: (() => void) | null = null;
  /** Speed cycled; the HUD owns the index + label, the scene applies `scale` to physics. */
  onSpeedCycle: ((scale: number) => void) | null = null;
  /** Star-map button pressed (the scene persists ship pos + transitions). */
  onStarMap: (() => void) | null = null;
  /** A quest objective was chosen in the journal (the scene plots the route). */
  onQuestNavigate: ((locationId: string) => void) | null = null;
  /** Radar drag-to-pan: focus the main view on a world point. */
  onMiniMapPan: ((worldX: number, worldY: number) => void) | null = null;
  /** Radar centre button: smoothly return the camera to the ship. */
  onMiniMapReturn: (() => void) | null = null;
  /**
   * Font size (S/M/L) was changed in the ⚙ panel. The scene restyles the
   * text-bearing flight modules in place (no SPACE_FLIGHT re-init) — the HUD must
   * NOT transition the scene itself (playtest4 A, DIP).
   */
  onFontScaleChange: (() => void) | null = null;
  /**
   * The colourblind ПАЛИТРА was changed in the ♿ panel. The scene re-applies the
   * active palette to the live world (NPC ship hulls + radar dots) in place — the
   * "palette does nothing" fix (playtest bug pass 2, Task 4) — without a scene
   * rebuild, mirroring {@link onFontScaleChange} (DIP: the HUD never reaches into
   * the world modules itself).
   */
  onPaletteChange: (() => void) | null = null;
  /** [I] inventory shortcut button was pressed. */
  onInventory: (() => void) | null = null;
  /**
   * Touch «✕» cancel button pressed — the on-screen equivalent of the Esc key.
   * The scene wires it to the *same* action Escape runs (close the top open
   * surface, else cancel a planned route). Only built on a touch layout.
   */
  onCancel: (() => void) | null = null;
  /**
   * «Загрузить сохранение» pressed in the in-flight system menu. The scene
   * confirms then loads the `"auto"` slot (the dead-end recovery path).
   */
  onLoadSave: (() => void) | null = null;
  /**
   * «Сохранения» pressed in the in-flight system menu — opens the full
   * save/load screen (named manual slots: save / overwrite / delete / load).
   * The scene transitions to {@link SceneType.SAVE_LOAD} with `returnTo`
   * SPACE_FLIGHT so closing the screen drops the player back into flight.
   */
  onOpenSaveLoad: (() => void) | null = null;
  /** «В главное меню» pressed in the in-flight system menu. */
  onMainMenu: (() => void) | null = null;
  /**
   * «Сообщить отзыв» pressed in the in-flight system menu. The scene captures
   * live context (scene, in-game day, galaxy seed) and opens the prefilled
   * GitHub Issue Form — the high-value in-session feedback path.
   */
  onFeedback: (() => void) | null = null;
  /**
   * Fired when the in-flight system menu panel opens. The scene uses it to
   * refresh save availability (`saveManager.hasSave()`) → {@link setLoadSaveEnabled},
   * so «Загрузить сохранение» reflects a save that may have landed after init
   * (the take-off autosave runs after `transitionTo` initialises the scene).
   */
  onSystemMenuOpen: (() => void) | null = null;

  constructor(
    renderer: Renderer,
    gameEngine: GameEngine | null,
    uiLayer: Container,
  ) {
    this.renderer = renderer;
    this.gameEngine = gameEngine;
    this.uiLayer = uiLayer;
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  /** Build the whole HUD. Call after the UI layer has been cleared. */
  initialize(): void {
    this.createUI();
    if (this.gameEngine) {
      this.gameEngine.questExpiryCallback = (msg) =>
        this.showMessage(msg, 0xff4444);
      this.gameEngine.questPendingReturnCallback = (msg) =>
        this.showMessage(msg, 0xffdd44);
    }
  }

  /** Refresh the per-frame HUD read-outs (button label, date, mini-log fade). */
  update(deltaTime: number, _bgElapsed: number): void {
    this.updatePlayPauseButton();
    this.updateDayCounter();
    this.updateMiniLog(deltaTime);
  }

  destroy(): void {
    if (this.gameEngine) {
      this.gameEngine.questExpiryCallback = undefined;
      this.gameEngine.questPendingReturnCallback = undefined;
    }
    // Buttons live on uiContainer (torn down by clearUILayer); drop the refs.
    this.backButton = null;
    this.playPauseButton = null;
    this.cancelButton = null;
    this.speedButton = null;
    this.speedIndex = 0;
    this.accessibilityButton = null;
    this.closeAccessibilityPanel();
    this.closeSystemMenu();
    if (this.helpOverlay) {
      this.helpOverlay.destroy({ children: true });
      this.helpOverlay = null;
    }
    // Transient toast + its timer.
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }
    // Tooltip.
    this.hideTooltip();
    // Mini-log.
    for (const e of this.miniLogEntries) e.textObj.destroy();
    this.miniLogEntries = [];
    this.miniLogContainer = null;
    // Quest journal (+ its help panel).
    this.closeQuestJournalHelp();
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
    }
    // Mini-map.
    if (this.systemMiniMap) {
      this.systemMiniMap.destroy();
      this.systemMiniMap = null;
    }
    this.cameraDebugText = null;
    this.dayCounterText = null;
    this.dayProvider = null;
    this.uiContainer = null;
    this.turnRunning = false;
  }

  /**
   * Restyle the HUD's text at the current font scale WITHOUT a scene re-init
   * (Task 1): tear down the HUD's own display objects and rebuild them via
   * {@link createUI}, which reads {@link scaledFont} at text-creation time. The
   * world (planets/ships/asteroids/backdrop) is untouched — only the HUD's text
   * (day counter, buttons, mini-log, radar) is recreated at the new size. The
   * live turn state survives the rebuild; the game speed is re-seeded by
   * {@link createUI} via {@link restoreGameSpeed}.
   */
  refreshFontScale(): void {
    const wasTurnRunning = this.turnRunning;
    this.teardownUI();
    this.createUI();
    // createUI seeds a fresh Play/Pause button → re-apply the live turn state so
    // the label/colour matches (createUI defaults it to the paused look).
    this.setTurnRunning(wasTurnRunning);
  }

  /**
   * Destroy the HUD's own display objects (everything {@link createUI} builds) so
   * {@link refreshFontScale} can rebuild them at a new scale. Unlike
   * {@link destroy} this keeps the engine callbacks + persistent state and leaves
   * any transient overlays the player has open (toast, tooltip, quest journal,
   * help overlay) alone — they read {@link scaledFont} when next opened.
   */
  private teardownUI(): void {
    this.closeAccessibilityPanel();
    this.closeSystemMenu();
    // Speed + a11y buttons mount on the UI layer directly (not uiContainer), so
    // destroy their containers explicitly. UiButton has no destroy() of its own.
    if (this.speedButton) {
      this.speedButton.container.destroy({ children: true });
      this.speedButton = null;
    }
    if (this.accessibilityButton) {
      this.accessibilityButton.container.destroy({ children: true });
      this.accessibilityButton = null;
    }
    // Mini-log entries are children of miniLogContainer → destroyed with it.
    this.miniLogEntries = [];
    if (this.miniLogContainer) {
      this.miniLogContainer.destroy({ children: true });
      this.miniLogContainer = null;
    }
    if (this.systemMiniMap) {
      this.systemMiniMap.destroy();
      this.systemMiniMap = null;
    }
    if (this.uiContainer) {
      this.uiContainer.destroy({ children: true });
      this.uiContainer = null;
    }
    // These live on the now-destroyed uiContainer — drop the dangling refs.
    this.backButton = null;
    this.playPauseButton = null;
    this.cancelButton = null;
    this.cameraDebugText = null;
    this.dayCounterText = null;
  }

  // ---------------------------------------------------------------------------
  // State the scene pushes / reads
  // ---------------------------------------------------------------------------

  /** Push the turn state so the Play/Pause button shows the right label/colour. */
  setTurnRunning(running: boolean): void {
    this.turnRunning = running;
    this.updatePlayPauseButton();
  }

  /** The system mini-map (radar) — the scene drives its per-frame refresh. */
  get miniMap(): SystemMiniMap | null {
    return this.systemMiniMap;
  }

  /** Set the camera debug read-out (development only; driven by the scene). */
  setCameraDebug(zoom: number, panX: number, panY: number): void {
    if (this.cameraDebugText) {
      this.cameraDebugText.text = `Камера: Zoom ${zoom.toFixed(2)} | Pan (${panX.toFixed(0)}, ${panY.toFixed(0)})`;
    }
  }

  /**
   * Place the camera read-out beside the radar: its right edge hugs the
   * minimap's left edge (playtest2 finding ④ — independent absolute offsets
   * let the radar cover the text). Requires anchor (1, 0) on the text.
   */
  private positionCameraDebugText(
    screenWidth: number,
    screenHeight: number,
  ): void {
    if (!this.cameraDebugText) return;
    const mapLeft = this.systemMiniMap?.container.x ?? screenWidth - 220;
    this.cameraDebugText.x = mapLeft - 12;
    this.cameraDebugText.y = screenHeight - 30;
  }

  /** Re-anchor the screen-edge HUD after the window/canvas resizes. */
  reposition(w: number, h: number): void {
    if (this.backButton) {
      this.backButton.x = w - 220;
      this.backButton.y = 20;
    }
    if (this.toast) {
      this.toast.x = w / 2;
    }
    if (this.playPauseButton) {
      this.playPauseButton.x = w / 2 - 70;
      this.playPauseButton.y = h - 54;
    }
    if (this.cancelButton && this.playPauseButton) {
      this.cancelButton.x =
        this.playPauseButton.x - CANCEL_BTN_W - CANCEL_BTN_GAP;
      this.cancelButton.y = this.playPauseButton.y;
    }
    this.systemMiniMap?.reposition(w, h);
    // After the radar settles, re-derive the camera hint from its bounds.
    this.positionCameraDebugText(w, h);

    if (this.speedButton) {
      this.speedButton.x = w - 20 - 52;
      this.speedButton.y = h - 248;
    }

    if (this.accessibilityButton) {
      this.accessibilityButton.y = h - 162;
    }
    if (this.accessibilityPanel && this.accessibilityButton) {
      this.accessibilityPanel.y = Math.max(
        8,
        this.accessibilityButton.y - ACCESSIBILITY_PANEL_HEIGHT - 4,
      );
    }

    if (this.miniLogContainer) {
      this.miniLogContainer.y = h - 105;
    }
    if (this.dayCounterText) {
      this.dayCounterText.y = 50;
    }
    if (this.systemMenuPanel) {
      const b = this.systemMenuPanel.getLocalBounds();
      this.systemMenuPanel.x = Math.round((w - b.width) / 2);
      this.systemMenuPanel.y = Math.round((h - b.height) / 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Modal / journal queries the scene mediates outside-clicks through
  // ---------------------------------------------------------------------------

  /**
   * True while the bottom-left ♿ accessibility panel is open. The former ⚙
   * settings panel moved to the main menu (see MainMenuScene), so this now
   * tracks only the accessibility panel — the query name is retained because
   * the flight key router + locked tests key on it. Esc closes it (via
   * {@link closeModals}) and Space is suppressed behind it.
   */
  isSettingsPanelOpen(): boolean {
    return this.accessibilityPanel !== null;
  }

  /** True while the in-flight system menu is open. */
  isSystemMenuOpen(): boolean {
    return this.systemMenuPanel !== null;
  }

  /**
   * True while the system menu OR its load-confirm sub-panel is open. The scene's
   * outside-click / wheel / Space-launch guards treat both as one blocking modal
   * (the confirm replaces the menu, so only ever one is up at a time).
   */
  isSystemModalOpen(): boolean {
    return (
      this.systemMenuPanel !== null || this.systemMenuConfirmPanel !== null
    );
  }

  /** True while «Загрузить сохранение» is offered (a save exists to load). */
  isLoadSaveEnabled(): boolean {
    return this.loadSaveEnabled;
  }

  /**
   * Push save availability into the menu (the scene computes it from the async
   * `saveManager.hasSave()`). When it flips while the menu is open, rebuild the
   * panel so «Загрузить сохранение» switches between the live action and the
   * dimmed "no save" hint — a no-op when the value is unchanged.
   */
  setLoadSaveEnabled(enabled: boolean): void {
    if (this.loadSaveEnabled === enabled) return;
    this.loadSaveEnabled = enabled;
    if (this.systemMenuPanel) {
      this.closeSystemMenu();
      this.toggleSystemMenu();
    }
  }

  /** True while the quest journal is open. */
  isQuestJournalOpen(): boolean {
    return this.questJournalUI !== null;
  }

  /** True while the quest journal is open *and* visible (E2E helper). */
  isQuestJournalVisible(): boolean {
    return (
      this.questJournalUI !== null && this.questJournalUI.container.visible
    );
  }

  /** True while the [?] help overlay is open. */
  isHelpOverlayOpen(): boolean {
    return this.helpOverlay !== null;
  }

  /** Toggle the semi-transparent [?] help overlay listing all flight controls. */
  toggleHelpOverlay(): void {
    if (this.helpOverlay) {
      this.helpOverlay.destroy({ children: true });
      this.helpOverlay = null;
      return;
    }
    const overlay = new Container();
    overlay.eventMode = "static";
    overlay.on("pointerdown", (e: { stopPropagation: () => void }) =>
      e.stopPropagation(),
    );

    const padding = 12;
    const hints = new Text({
      text: [
        "ЛКМ — курс",
        "Shift+ЛКМ — прицелиться",
        "ПКМ — панорама",
        "Колесико — зум",
        "[J] — Журнал квестов",
        "[I] — Инвентарь",
      ].join("\n"),
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0xddeeff,
        lineHeight: scaledFont(20),
      },
    });
    hints.x = padding;
    hints.y = padding;
    hints.eventMode = "none";

    const bg = new Graphics();
    bg.roundRect(
      0,
      0,
      hints.width + padding * 2,
      hints.height + padding * 2,
      6,
    ).fill({ color: 0x050e18, alpha: 0.88 });
    bg.roundRect(
      0,
      0,
      hints.width + padding * 2,
      hints.height + padding * 2,
      6,
    ).stroke({ color: 0x334455, width: 1 });
    bg.eventMode = "none";

    overlay.addChild(bg);
    overlay.addChild(hints);
    overlay.x = 20;
    overlay.y = 165;

    this.uiLayer.addChild(overlay);
    this.helpOverlay = overlay;
  }

  /** Close the quest journal immediately (Escape key handling). */
  closeQuestJournal(): void {
    this.closeQuestJournalHelp();
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
      logger.info("Quest journal closed");
    }
  }

  /**
   * Close any open HUD modal (quest journal, settings panel) on an outside
   * click. Destruction is deferred to a microtask because this runs from the
   * stage pointerdown handler that is mid-dispatch over the panel's children.
   */
  closeModals(): void {
    this.closeQuestJournalHelp();
    const journal = this.questJournalUI;
    this.questJournalUI = null;
    if (journal) queueMicrotask(() => journal.destroy());
    if (this.accessibilityPanel) {
      const ap = this.accessibilityPanel;
      const comp = this.accessibilityPanelComp;
      this.accessibilityPanel = null;
      this.accessibilityPanelComp = null;
      // Same deferred-destroy guard as the settings panel; the component
      // teardown also disposes any in-progress rebind key capture.
      queueMicrotask(() => {
        if (!ap.destroyed) {
          if (comp) comp.destroy();
          else ap.destroy({ children: true });
        }
      });
    }
    if (this.systemMenuPanel) {
      const mp = this.systemMenuPanel;
      this.systemMenuPanel = null;
      queueMicrotask(() => {
        if (!mp.destroyed) mp.destroy({ children: true });
      });
    }
    if (this.systemMenuConfirmPanel) {
      const cp = this.systemMenuConfirmPanel;
      this.systemMenuConfirmPanel = null;
      queueMicrotask(() => {
        if (!cp.destroyed) cp.destroy({ children: true });
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private createUI(): void {
    this.uiContainer = new Container();
    // Container uses default eventMode ('auto') - it won't block clicks since it has no handlers
    // Child elements with eventMode='static' will receive events

    // Camera debug display (development only). Right-edge anchored: the text
    // grows leftward as pan values widen, so it can never extend under the
    // minimap. Positioned from the minimap's bounds once the radar exists.
    if (__DEBUG__) {
      this.cameraDebugText = new Text({
        text: "Камера: Zoom 1.00 | Pan (0, 0)",
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(12),
          fill: 0xff00ff,
        },
      });
      this.cameraDebugText.anchor.set(1, 0);
      this.cameraDebugText.eventMode = "none";
      this.uiContainer.addChild(this.cameraDebugText);
    }

    // Current date display
    this.dayCounterText = new Text({
      text: formatGameDate(this.gameEngine?.galaxy?.gameDays ?? 0),
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0x00ffff,
      },
    });
    this.dayCounterText.x = 20;
    this.dayCounterText.y = 50;
    this.uiContainer.addChild(this.dayCounterText);

    // Quest Journal button
    const questBtn = new Text({
      text: "[КВЕСТЫ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    questBtn.x = 20;
    questBtn.y = 80;
    questBtn.eventMode = "static";
    questBtn.cursor = "pointer";
    questBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      logger.info("Quest journal button clicked");
      this.toggleQuestJournal();
    });
    questBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      questBtn.alpha = 0.7;
    });
    questBtn.on("pointerout", () => {
      questBtn.alpha = 1;
    });
    this.uiContainer.addChild(questBtn);

    // Inventory shortcut button [I]
    const invBtn = new Text({
      text: "[I]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    invBtn.x = 20;
    invBtn.y = 110;
    invBtn.eventMode = "static";
    invBtn.cursor = "pointer";
    invBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      this.onInventory?.();
    });
    invBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      invBtn.alpha = 0.7;
    });
    invBtn.on("pointerout", () => {
      invBtn.alpha = 1;
    });
    this.uiContainer.addChild(invBtn);

    // Help toggle button [?]
    const helpBtn = new Text({
      text: "[?]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0x88ccff,
        fontWeight: "bold" as const,
      },
    });
    helpBtn.x = 20;
    helpBtn.y = 140;
    helpBtn.eventMode = "static";
    helpBtn.cursor = "pointer";
    helpBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      this.toggleHelpOverlay();
    });
    helpBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      helpBtn.alpha = 0.7;
    });
    helpBtn.on("pointerout", () => {
      helpBtn.alpha = 1;
    });
    this.uiContainer.addChild(helpBtn);

    // System menu button [МЕНЮ] — top-left, opens the always-available in-flight
    // system menu (Продолжить / Загрузить сохранение / В главное меню) so the
    // player can recover from any dead-end (e.g. stranded, <30% hull, broke).
    const menuBtn = new Text({
      text: "[МЕНЮ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    menuBtn.x = 20;
    menuBtn.y = 20;
    menuBtn.eventMode = "static";
    menuBtn.cursor = "pointer";
    menuBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      this.toggleSystemMenu();
    });
    menuBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      menuBtn.alpha = 0.7;
    });
    menuBtn.on("pointerout", () => {
      menuBtn.alpha = 1;
    });
    this.uiContainer.addChild(menuBtn);

    // Star map button
    const backBtn = new Text({
      text: "[МЕЖЗВЕЗДНАЯ КАРТА]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    backBtn.x = this.renderer.app.screen.width - 220;
    backBtn.y = 20;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      logger.info("Star map button clicked");
      this.onStarMap?.();
    });

    backBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      backBtn.alpha = 0.7;
    });
    backBtn.on("pointerout", () => {
      backBtn.alpha = 1;
    });

    this.uiContainer.addChild(backBtn);
    this.backButton = backBtn;

    // Play / Pause turn control (bottom-centre). Play runs the planned turn;
    // while moving it becomes Pause, which ends the turn at the next day segment.
    const PLAY_BTN_W = 140;
    const PLAY_BTN_H = 36;
    const playBtn = new UiButton(
      "",
      "▶ ХОД",
      "success",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.onPlayPause?.();
      },
      PLAY_BTN_W,
      PLAY_BTN_H,
    );
    playBtn.x = this.renderer.app.screen.width / 2 - PLAY_BTN_W / 2;
    playBtn.y = this.renderer.app.screen.height - PLAY_BTN_H - 18;
    playBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
    });
    // Pin the pointer cursor explicitly so scene-level cursor updates
    // (updateInteractiveCursors) can never reset the Ход button to "default"
    // — it only ever touches planet/NPC sprites, but this is belt-and-suspenders.
    playBtn.container.cursor = "pointer";
    this.uiContainer.addChild(playBtn.container);
    this.playPauseButton = playBtn;

    // Touch «✕» cancel button — only on a touch layout (the Esc key's on-screen
    // twin). Placed just left of Play; the scene fans it through onCancel to the
    // same action Escape runs. Lives on uiContainer so teardown destroys it too.
    if (isTouchLayoutActive()) {
      const cancelBtn = new UiButton(
        "",
        "✕",
        "danger",
        (event) => {
          event.stopPropagation();
          this.gameEngine?.audio?.playUiClick();
          this.onCancel?.();
        },
        CANCEL_BTN_W,
        PLAY_BTN_H,
      );
      cancelBtn.x = playBtn.x - CANCEL_BTN_W - CANCEL_BTN_GAP;
      cancelBtn.y = playBtn.y;
      cancelBtn.container.cursor = "pointer";
      this.uiContainer.addChild(cancelBtn.container);
      this.cancelButton = cancelBtn;
    }

    this.uiLayer.addChild(this.uiContainer);

    // Mini-log (B5): bottom-left panel showing the last 5 game events.
    this.miniLogContainer = new Container();
    this.miniLogContainer.eventMode = "none";
    this.miniLogContainer.x = 20;
    this.miniLogContainer.y = this.renderer.app.screen.height - 105;
    this.uiLayer.addChild(this.miniLogContainer);

    // Create mini-map. Dragging on it pans the main view (it no longer falls
    // through as a navigation click).
    this.systemMiniMap = new SystemMiniMap(
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );
    this.systemMiniMap.setPanHandler((worldX, worldY) =>
      this.onMiniMapPan?.(worldX, worldY),
    );
    this.systemMiniMap.setReturnCameraHandler(() => this.onMiniMapReturn?.());
    this.uiLayer.addChild(this.systemMiniMap.container);
    this.positionCameraDebugText(
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );

    // Speed button: cycles 1×/2×/4× — placed above the minimap (bottom-right).
    const SPEED_BTN_W = 52;
    const SPEED_BTN_H = 28;
    const speedBtn = new UiButton(
      "",
      "1×",
      "neutral",
      (event) => {
        event.stopPropagation();
        this.cycleGameSpeed();
      },
      SPEED_BTN_W,
      SPEED_BTN_H,
    );
    speedBtn.x = this.renderer.app.screen.width - 20 - SPEED_BTN_W;
    speedBtn.y = this.renderer.app.screen.height - 220 - SPEED_BTN_H;
    this.uiLayer.addChild(speedBtn.container);
    this.speedButton = speedBtn;

    // Accessibility button (♿) — bottom-left, above the mini-log — opens the
    // palette / reduced-motion / key-remap panel (accessibility pass, Task 4).
    // The former ⚙ settings panel moved to the main menu (Task 8), so the ♿
    // button now sits where the ⚙ gear used to be.
    const ACC_BTN_W = 36;
    const ACC_BTN_H = 32;
    const accBtn = new UiButton(
      "♿",
      "",
      "neutral",
      (event) => {
        event.stopPropagation();
        this.toggleAccessibilityPanel();
      },
      ACC_BTN_W,
      ACC_BTN_H,
    );
    accBtn.x = 20;
    accBtn.y = this.renderer.app.screen.height - 130 - ACC_BTN_H;
    this.uiLayer.addChild(accBtn.container);
    this.accessibilityButton = accBtn;

    // Adopt the game-speed the player chose before this (re)build so it survives
    // a land/take-off or star-map round-trip instead of resetting to 1× (F3).
    this.restoreGameSpeed();
  }

  /**
   * Toggle the Accessibility panel (palette / reduced-motion / key remap,
   * accessibility pass Task 4). Tracked as {@link accessibilityPanel} so the
   * Esc-close / outside-click wiring (via {@link isSettingsPanelOpen}/
   * {@link closeModals}) covers it. Every control writes through its own
   * browser-level pref (palette/reduced-motion/keymap `localStorage`) — no new
   * save field. (The former ⚙ settings panel that shared this bottom-left
   * anchor moved to the main menu — see MainMenuScene — so this is now the only
   * bottom-left HUD panel.)
   */
  private toggleAccessibilityPanel(): void {
    if (this.accessibilityPanel) {
      this.closeAccessibilityPanel();
      return;
    }
    if (!this.accessibilityButton) return;

    const panel = new AccessibilityPanel({
      // Re-apply the new palette to the live world at once (NPC hulls + radar) —
      // the scene wires this; without it a palette change in flight "does
      // nothing" until the next scene rebuild (playtest bug pass 2, Task 4).
      onPaletteChange: () => this.onPaletteChange?.(),
      onRequestClose: () => this.closeAccessibilityPanel(),
    });
    this.accessibilityPanelComp = panel;
    const c = panel.container;
    c.x = this.accessibilityButton.x;
    c.y = Math.max(
      8,
      this.accessibilityButton.y - ACCESSIBILITY_PANEL_HEIGHT - 4,
    );
    this.uiLayer.addChild(c);
    this.accessibilityPanel = c;
  }

  /** Tear down the accessibility panel if open (idempotent). */
  private closeAccessibilityPanel(): void {
    if (this.accessibilityPanelComp) {
      this.accessibilityPanelComp.destroy();
      this.accessibilityPanelComp = null;
      this.accessibilityPanel = null;
      return;
    }
    if (this.accessibilityPanel) {
      this.accessibilityPanel.destroy({ children: true });
      this.accessibilityPanel = null;
    }
  }

  /**
   * Toggle the in-flight system menu — a centred modal panel with «Продолжить»
   * (close), «Загрузить сохранение» (→ {@link onLoadSave}) and «В главное меню»
   * (→ {@link onMainMenu}). Always reachable so the player can escape any
   * dead-end; the scene wires the load/quit callbacks (DIP).
   */
  toggleSystemMenu(): void {
    // The confirm sub-panel is a child state of the open menu; if either surface
    // is up, [МЕНЮ] closes the whole modal rather than stacking a second menu
    // panel over an open confirm (closeSystemMenu tears down both).
    if (this.systemMenuPanel || this.systemMenuConfirmPanel) {
      this.closeSystemMenu();
      return;
    }

    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;
    const PAD = 16;
    const TITLE_H = 34;
    const BTN_H = 40;
    const GAP = 10;
    const HINT_H = 18;
    const panelW = 300;
    // Продолжить · Сохранения · Загрузить · Сообщить отзыв · В главное меню
    // (5 buttons, 4 gaps). The disabled «Загрузить» variant adds a one-line
    // "no save" hint beneath it.
    const panelH =
      PAD +
      TITLE_H +
      5 * BTN_H +
      4 * GAP +
      PAD +
      (this.loadSaveEnabled ? 0 : HINT_H);
    const btnW = panelW - PAD * 2;

    const panel = new Container();
    panel.eventMode = "static";
    // Swallow clicks on the panel so the scene's outside-click handler doesn't
    // close it from under the player (mirrors the settings panel).
    panel.on("pointerdown", (e) => e.stopPropagation());

    const bg = new Graphics();
    bg.roundRect(0, 0, panelW, panelH, 8).fill({
      color: 0x0a1520,
      alpha: 0.96,
    });
    bg.roundRect(0, 0, panelW, panelH, 8).stroke({ color: 0x334455, width: 1 });
    panel.addChild(bg);

    const title = new Text({
      text: "СИСТЕМНОЕ МЕНЮ",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(16),
        fill: 0x00ccff,
        fontWeight: "bold" as const,
      },
    });
    title.anchor.set(0.5, 0);
    title.x = panelW / 2;
    title.y = PAD;
    title.eventMode = "none";
    panel.addChild(title);

    let btnY = PAD + TITLE_H;

    const resumeBtn = new UiButton(
      "",
      "Продолжить",
      "success",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.closeSystemMenu();
      },
      btnW,
      BTN_H,
    );
    resumeBtn.x = PAD;
    resumeBtn.y = btnY;
    panel.addChild(resumeBtn.container);
    btnY += BTN_H + GAP;

    // «Сохранения» — open the full save/load screen (named manual slots:
    // save / overwrite / delete / load). Always available (you can always save
    // a live game), unlike the autosave-only «Загрузить сохранение» below.
    const savesBtn = new UiButton(
      "",
      "Сохранения",
      "primary",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.onOpenSaveLoad?.();
      },
      btnW,
      BTN_H,
    );
    savesBtn.x = PAD;
    savesBtn.y = btnY;
    panel.addChild(savesBtn.container);
    btnY += BTN_H + GAP;

    if (this.loadSaveEnabled) {
      const loadBtn = new UiButton(
        "",
        "Загрузить сохранение",
        "primary",
        (event) => {
          event.stopPropagation();
          this.gameEngine?.audio?.playUiClick();
          this.onLoadSave?.();
        },
        btnW,
        BTN_H,
      );
      loadBtn.x = PAD;
      loadBtn.y = btnY;
      panel.addChild(loadBtn.container);
      btnY += BTN_H + GAP;
    } else {
      // No save to load: render an inert, dimmed button + a hint so the action
      // reads as unavailable rather than a dead click (dead-end gating, Task 3).
      const loadBtn = new UiButton(
        "",
        "Загрузить сохранение",
        "neutral",
        () => {},
        btnW,
        BTN_H,
      );
      loadBtn.x = PAD;
      loadBtn.y = btnY;
      loadBtn.container.eventMode = "none";
      loadBtn.container.cursor = "default";
      loadBtn.container.alpha = 0.5;
      panel.addChild(loadBtn.container);
      btnY += BTN_H;

      const hint = new Text({
        text: "Нет сохранения",
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(12),
          fill: 0x99a8ba,
        },
      });
      hint.anchor.set(0.5, 0);
      hint.x = panelW / 2;
      hint.y = btnY + 1;
      hint.eventMode = "none";
      panel.addChild(hint);
      btnY += HINT_H + GAP;
    }

    const feedbackBtn = new UiButton(
      "",
      "Сообщить отзыв",
      "primary",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.onFeedback?.();
      },
      btnW,
      BTN_H,
    );
    feedbackBtn.x = PAD;
    feedbackBtn.y = btnY;
    panel.addChild(feedbackBtn.container);
    btnY += BTN_H + GAP;

    const mainMenuBtn = new UiButton(
      "",
      "В главное меню",
      "danger",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.onMainMenu?.();
      },
      btnW,
      BTN_H,
    );
    mainMenuBtn.x = PAD;
    mainMenuBtn.y = btnY;
    panel.addChild(mainMenuBtn.container);

    panel.x = Math.round((screenW - panelW) / 2);
    panel.y = Math.round((screenH - panelH) / 2);
    this.uiLayer.addChild(panel);
    this.systemMenuPanel = panel;
    // Let the scene re-check save availability now the menu is up (the autosave
    // may have landed since init). A flip rebuilds the panel via setLoadSaveEnabled.
    this.onSystemMenuOpen?.();
  }

  /**
   * Raise a confirm sub-panel over «Загрузить сохранение» — loading the autosave
   * discards the current run, so guard it. «Да» closes the panel and runs
   * `onConfirm` (the scene's `loadGame("auto")`); «Отмена» just dismisses. The
   * menu panel is closed first so the two never overlap; the confirm is torn
   * down with the menu by {@link closeSystemMenu}.
   */
  showSystemMenuConfirm(onConfirm: () => void): void {
    this.closeSystemMenu(); // drop the menu (and any stale confirm) underneath

    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;
    const PAD = 16;
    const MSG_H = 56;
    const BTN_H = 40;
    const GAP = 10;
    const panelW = 320;
    const panelH = PAD + MSG_H + BTN_H + PAD;
    const btnW = (panelW - PAD * 2 - GAP) / 2;

    const panel = new Container();
    panel.eventMode = "static";
    panel.on("pointerdown", (e) => e.stopPropagation());

    const bg = new Graphics();
    bg.roundRect(0, 0, panelW, panelH, 8).fill({
      color: 0x0a1520,
      alpha: 0.96,
    });
    bg.roundRect(0, 0, panelW, panelH, 8).stroke({ color: 0x334455, width: 1 });
    panel.addChild(bg);

    const msg = new Text({
      text: "Загрузить сохранение?\nТекущий прогресс будет потерян.",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xdde6ee,
        align: "center" as const,
        wordWrap: true,
        wordWrapWidth: panelW - PAD * 2,
      },
    });
    msg.anchor.set(0.5, 0);
    msg.x = panelW / 2;
    msg.y = PAD;
    msg.eventMode = "none";
    panel.addChild(msg);

    const btnY = PAD + MSG_H;

    const yesBtn = new UiButton(
      "",
      "Да",
      "primary",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.closeSystemMenuConfirm();
        onConfirm();
      },
      btnW,
      BTN_H,
    );
    yesBtn.x = PAD;
    yesBtn.y = btnY;
    panel.addChild(yesBtn.container);

    const cancelBtn = new UiButton(
      "",
      "Отмена",
      "neutral",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.closeSystemMenuConfirm();
      },
      btnW,
      BTN_H,
    );
    cancelBtn.x = PAD + btnW + GAP;
    cancelBtn.y = btnY;
    panel.addChild(cancelBtn.container);

    panel.x = Math.round((screenW - panelW) / 2);
    panel.y = Math.round((screenH - panelH) / 2);
    this.uiLayer.addChild(panel);
    this.systemMenuConfirmPanel = panel;
  }

  /** Close + destroy the load confirm sub-panel (idempotent). */
  closeSystemMenuConfirm(): void {
    if (this.systemMenuConfirmPanel) {
      this.systemMenuConfirmPanel.destroy({ children: true });
      this.systemMenuConfirmPanel = null;
    }
  }

  /** True while the load confirm sub-panel is open (test/lifecycle hook). */
  isSystemMenuConfirmOpen(): boolean {
    return this.systemMenuConfirmPanel !== null;
  }

  /** Close + destroy the in-flight system menu panel + confirm (idempotent). */
  closeSystemMenu(): void {
    if (this.systemMenuPanel) {
      this.systemMenuPanel.destroy({ children: true });
      this.systemMenuPanel = null;
    }
    this.closeSystemMenuConfirm();
  }

  /** Cycle game speed through 1×/2×/4× and update the button label + physics. */
  private cycleGameSpeed(): void {
    const steps = GAME_BALANCE.gameSpeedMultipliers;
    this.speedIndex = (this.speedIndex + 1) % steps.length;
    this.applyGameSpeed(steps[this.speedIndex]);
  }

  /**
   * Restore the persisted game-speed when the HUD is (re)built: every
   * SPACE_FLIGHT re-init (land/take-off, star map) makes a fresh HUD, which used
   * to drop back to 1×. We seed {@link speedIndex} + the button label from the
   * scene-surviving {@link GameEngine.gameSpeedMultiplier} and re-apply it to
   * physics so the choice sticks (playtest3 F3). Unknown multiplier → 1×.
   */
  private restoreGameSpeed(): void {
    const steps = GAME_BALANCE.gameSpeedMultipliers;
    const persisted = this.gameEngine?.gameSpeedMultiplier ?? 1;
    const idx = steps.findIndex((s) => s === persisted);
    this.speedIndex = idx >= 0 ? idx : 0;
    this.applyGameSpeed(steps[this.speedIndex]);
  }

  /**
   * Apply a multiplier everywhere it matters: the button label, the durable
   * store on the GameEngine (so it outlives this HUD), and the physics via
   * {@link onSpeedCycle}. Shared by the user cycle and the on-rebuild restore.
   */
  private applyGameSpeed(scale: number): void {
    if (this.speedButton) this.speedButton.setLabel(`${scale}×`);
    if (this.gameEngine) this.gameEngine.gameSpeedMultiplier = scale;
    this.onSpeedCycle?.(scale);
  }

  /** Toggle quest journal UI. */
  toggleQuestJournal(): void {
    if (this.questJournalUI) {
      // Close journal (+ its help panel)
      this.closeQuestJournalHelp();
      this.questJournalUI.destroy();
      this.questJournalUI = null;
      logger.info("Quest journal closed");
    } else {
      // Open journal
      if (this.gameEngine?.questManager) {
        this.questJournalUI = new QuestJournalUI(
          this.gameEngine.questManager,
          this.renderer.app.screen.width,
          this.renderer.app.screen.height,
          () => {
            this.questJournalUI?.destroy();
            this.questJournalUI = null;
          },
          (locationId: string) => this.onQuestNavigate?.(locationId),
          this.gameEngine.galaxy?.gameDays ?? 0,
          (id: string) => this.resolveQuestLocationName(id),
          (itemType: string) => {
            const stack = this.gameEngine?.player?.inventory.resources.find(
              (r) => r.type === itemType,
            );
            return stack?.amount ?? 0;
          },
          this.gameEngine.galaxy ?? undefined,
          this.gameEngine.player?.currentSystemId ?? "",
          () => this.openQuestJournalHelp(),
        );
        this.uiLayer.addChild(this.questJournalUI.container);
        logger.info("Quest journal opened");
      }
    }
  }

  /**
   * Open the quest journal's contextual-help panel (its «?» button). Mounts the
   * shared {@link HelpPanel} above the journal on the UI layer; «Понятно»/«✕»
   * close it. Idempotent — a second click while open is ignored.
   */
  private openQuestJournalHelp(): void {
    if (this.questHelpPanel) return;
    const panel = new HelpPanel(this.renderer, helpFor("quest-journal"), () =>
      this.closeQuestJournalHelp(),
    );
    this.questHelpPanel = panel;
    this.uiLayer.addChild(panel.container);
  }

  /** Tear down the journal help panel if open. */
  private closeQuestJournalHelp(): void {
    if (!this.questHelpPanel) return;
    this.uiLayer.removeChild(this.questHelpPanel.container);
    this.questHelpPanel.destroy();
    this.questHelpPanel = null;
  }

  /**
   * Resolve a quest's system or planet id to a human-readable name so the
   * journal shows "Альдебаран" rather than raw ids like "sys_3" /
   * "planet_Альдебаран_0". Falls back to the id when nothing matches.
   */
  private resolveQuestLocationName(id: string): string {
    const galaxy = this.gameEngine?.galaxy;
    if (!galaxy) return id;
    for (const system of galaxy.systems) {
      if (system.id === id) return system.name;
      const planet = system.planets.find((p) => p.id === id);
      if (planet) return planet.name;
    }
    return id;
  }

  // ---------------------------------------------------------------------------
  // Per-frame read-outs
  // ---------------------------------------------------------------------------

  /**
   * Push the scene's fractional "day of turn" so the date read-out reflects
   * sub-day progress (a short turn no longer looks frozen). Pass `null` to fall
   * back to the whole-day `galaxy.gameDays`.
   */
  setDayProvider(provider: (() => number) | null): void {
    this.dayProvider = provider;
  }

  /** Update day counter UI text (date + sub-day clock). */
  private updateDayCounter(): void {
    if (!this.dayCounterText) return;
    const day = this.dayProvider
      ? this.dayProvider()
      : (this.gameEngine?.galaxy?.gameDays ?? null);
    if (day === null) return;
    this.dayCounterText.text = formatGameTimestamp(day);
  }

  /** Refresh the Play/Pause button label/colour to match the turn state. */
  private updatePlayPauseButton(): void {
    if (!this.playPauseButton) return;
    if (this.turnRunning) {
      this.playPauseButton.setLabel("⏸ ПАУЗА");
      this.playPauseButton.setAccentColor(0xffcc00);
    } else {
      // ХОД is always available — with a course it flies it, without one it runs
      // a wait turn (US-070 #5), so the button is always shown active.
      this.playPauseButton.setLabel("▶ ХОД");
      this.playPauseButton.setAccentColor(0x00ff88);
    }
  }

  // ---------------------------------------------------------------------------
  // Toast / tooltip / mini-log
  // ---------------------------------------------------------------------------

  /**
   * Transient on-screen feedback near the top-centre of the view (button
   * actions, warnings). Replaces any current toast.
   */
  showMessage(text: string, color = 0x00ffff): void {
    this.addMiniLogEntry(text);
    this.gameEngine?.audio?.playToast();
    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    const t = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(15),
        fill: color,
        fontWeight: "bold",
        align: "center",
        stroke: { color: 0x000000, width: 4 },
      },
    });
    t.anchor.set(0.5, 0);
    t.x = this.renderer.app.screen.width / 2;
    t.y = 90;
    t.eventMode = "none";
    this.toast = t;
    this.uiLayer.addChild(t);
    this.toastTimer = setTimeout(() => {
      if (this.toast) {
        this.toast.destroy();
        this.toast = null;
      }
      this.toastTimer = null;
    }, 3200);
  }

  /** Show a delayed hover tooltip near the cursor (B1). 300 ms delay before it appears. */
  showTooltip(text: string, screenX: number, screenY: number): void {
    this.hideTooltip();
    this.tooltipTimer = setTimeout(() => {
      this.tooltipTimer = null;
      const t = new Text({
        text,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 3 },
        },
      });
      t.eventMode = "none";
      t.x = Math.min(
        screenX + 16,
        this.renderer.app.screen.width - t.width - 8,
      );
      t.y = screenY - 24;
      this.tooltipText = t;
      this.uiLayer.addChild(t);
    }, 300);
  }

  /**
   * Show an immediate rich planet tooltip (name, habitability, faction, capture,
   * and — when supplied — the land-access denial so an un-landable planet reads
   * as occupied on hover, before any landing attempt).
   */
  showPlanetTooltip(
    planet: Planet,
    systemFaction: Faction,
    screenX: number,
    screenY: number,
    landingDenial: LandingDenialReason | null = null,
  ): void {
    this.hideTooltip();

    const lines = buildPlanetTooltipLines(
      planet,
      systemFaction,
      (faction) => this.gameEngine?.player?.getReputation(faction) ?? 0,
      landingDenial,
    );

    // Build container
    const padding = 8;
    const lineHeight = 18;
    const fontSize = scaledFont(13);

    const container = new Container();
    container.eventMode = "none";

    const textNodes: Text[] = lines.map((line, i) => {
      const t = new Text({
        text: line.text,
        style: {
          fontFamily: "Courier New",
          fontSize,
          fill: line.color,
        },
      });
      t.eventMode = "none";
      t.x = padding;
      t.y = padding + i * lineHeight;
      return t;
    });

    // Measure content area after creating texts
    const maxWidth = Math.max(...textNodes.map((t) => t.width));
    const totalHeight = padding * 2 + lines.length * lineHeight;

    const bg = new Graphics();
    bg.roundRect(0, 0, maxWidth + padding * 2, totalHeight, 4);
    bg.fill({ color: 0x000000, alpha: 0.75 });
    bg.eventMode = "none";

    container.addChild(bg);
    for (const t of textNodes) container.addChild(t);

    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;
    container.x = Math.min(screenX + 16, screenW - maxWidth - padding * 2 - 8);
    container.y = Math.max(
      8,
      Math.min(screenY - totalHeight / 2, screenH - totalHeight - 8),
    );

    this.tooltipContainer = container;
    this.uiLayer.addChild(container);
  }

  /** Cancel any pending tooltip and destroy the visible one. */
  hideTooltip(): void {
    if (this.tooltipTimer !== null) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
    if (this.tooltipText) {
      this.tooltipText.destroy();
      this.tooltipText = null;
    }
    if (this.tooltipContainer) {
      this.tooltipContainer.destroy({ children: true });
      this.tooltipContainer = null;
    }
  }

  /** Push a line to the mini-log (B5); keeps only the last 5 entries. */
  private addMiniLogEntry(text: string): void {
    if (!this.miniLogContainer) return;
    const lineH = 18;
    // Remove oldest if full.
    if (this.miniLogEntries.length >= 5) {
      const oldest = this.miniLogEntries.shift()!;
      oldest.textObj.destroy();
      for (const e of this.miniLogEntries) e.textObj.y -= lineH;
    }
    const textObj = new Text({
      text: `> ${text}`,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(11),
        fill: 0x88ccff,
      },
    });
    textObj.eventMode = "none";
    textObj.y = this.miniLogEntries.length * lineH;
    this.miniLogContainer.addChild(textObj);
    this.miniLogEntries.push({ textObj, elapsed: 0 });
  }

  /** Advance mini-log timers; fade out and remove expired entries each frame. */
  private updateMiniLog(deltaTime: number): void {
    const lineH = 18;
    for (const entry of this.miniLogEntries) {
      entry.elapsed += deltaTime;
      const fadeStart = this.MINI_LOG_DURATION - this.MINI_LOG_FADE_MS;
      if (entry.elapsed >= fadeStart) {
        const t =
          (entry.elapsed - fadeStart) / (this.MINI_LOG_DURATION - fadeStart);
        entry.textObj.alpha = Math.max(0, 1 - t);
      }
    }
    // Remove expired entries (oldest first).
    while (
      this.miniLogEntries.length > 0 &&
      this.miniLogEntries[0].elapsed >= this.MINI_LOG_DURATION
    ) {
      const removed = this.miniLogEntries.shift()!;
      removed.textObj.destroy();
      for (const e of this.miniLogEntries) e.textObj.y -= lineH;
    }
  }
}
