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
import { formatGameDate } from "@/utils/gameCalendar";
import { scaledFont } from "@/utils/fontScale";
import { GAME_BALANCE } from "@/config/balance";
import { logger } from "@/utils/logger";
import { t } from "@/i18n/i18n";
import type { FlightModule } from "./FlightModule";
import { starMapButtonRect } from "./starMapButton";

const CANCEL_BTN_W = 56;
const CANCEL_BTN_GAP = 8;
const PLAY_BTN_W = 140;
const PLAY_BTN_H = 36;
const BOTTOM_LEFT_LANE_W = 104;

export class FlightHud implements FlightModule {
  private readonly renderer: Renderer;
  private readonly gameEngine: GameEngine | null;
  private readonly uiLayer: Container;

  private uiContainer: Container | null = null;
  private dayCounterText: Text | null = null;
  private dayProvider: (() => number) | null = null;
  private backButton: UiButton | null = null;
  private starMapTooltip: Text | null = null;

  private playPauseButton: UiButton | null = null;
  private cancelButton: UiButton | null = null;
  private turnRunning = false;

  private speedButton: UiButton | null = null;
  private speedIndex = 0;

  private menuButtonText: Text | null = null;
  private systemMenuPanel: Container | null = null;
  private systemMenuConfirmPanel: Container | null = null;
  private loadSaveEnabled = true;

  private helpOverlay: Container | null = null;

  private systemMiniMap: SystemMiniMap | null = null;

  private questJournalUI: QuestJournalUI | null = null;
  private questHelpPanel: HelpPanel | null = null;

  private toast: Text | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private tooltipText: Text | null = null;
  private tooltipContainer: Container | null = null;
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;

  private miniLogContainer: Container | null = null;
  private miniLogEntries: Array<{ textObj: Text; elapsed: number }> = [];
  private readonly MINI_LOG_DURATION = 5000;
  private readonly MINI_LOG_FADE_MS = 1000;

  onPlayPause: (() => void) | null = null;
  onSpeedCycle: ((scale: number) => void) | null = null;
  onStarMap: (() => void) | null = null;
  onQuestNavigate: ((locationId: string) => void) | null = null;
  onMiniMapPan: ((worldX: number, worldY: number) => void) | null = null;
  onMiniMapReturn: (() => void) | null = null;
  onFontScaleChange: (() => void) | null = null;
  onInventory: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onLoadSave: (() => void) | null = null;
  onOpenSaveLoad: (() => void) | null = null;
  onMainMenu: (() => void) | null = null;
  onFeedback: (() => void) | null = null;
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

  initialize(): void {
    this.createUI();
    if (this.gameEngine) {
      this.gameEngine.questExpiryCallback = (msg) =>
        this.showMessage(msg, 0xff4444);
      this.gameEngine.questPendingReturnCallback = (msg) =>
        this.showMessage(msg, 0xffdd44);
    }
  }

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
    this.backButton = null;
    this.starMapTooltip = null;
    this.playPauseButton = null;
    this.cancelButton = null;
    this.speedButton = null;
    this.speedIndex = 0;
    this.closeSystemMenu();
    if (this.helpOverlay) {
      this.helpOverlay.destroy({ children: true });
      this.helpOverlay = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }
    this.hideTooltip();
    for (const e of this.miniLogEntries) e.textObj.destroy();
    this.miniLogEntries = [];
    this.miniLogContainer = null;
    this.closeQuestJournalHelp();
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
    }
    if (this.systemMiniMap) {
      this.systemMiniMap.destroy();
      this.systemMiniMap = null;
    }
    this.dayCounterText = null;
    this.dayProvider = null;
    this.menuButtonText = null;
    this.uiContainer = null;
    this.turnRunning = false;
  }

  refreshFontScale(): void {
    const wasTurnRunning = this.turnRunning;
    this.teardownUI();
    this.createUI();
    this.setTurnRunning(wasTurnRunning);
  }

  private teardownUI(): void {
    this.closeSystemMenu();
    if (this.speedButton) {
      this.speedButton.container.destroy({ children: true });
      this.speedButton = null;
    }
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
    this.backButton = null;
    this.starMapTooltip = null;
    this.playPauseButton = null;
    this.cancelButton = null;
    this.dayCounterText = null;
    this.menuButtonText = null;
  }

  setTurnRunning(running: boolean): void {
    this.turnRunning = running;
    this.updatePlayPauseButton();
  }

  get miniMap(): SystemMiniMap | null {
    return this.systemMiniMap;
  }

  reposition(w: number, h: number): void {
    if (this.backButton) {
      const starMapRect = starMapButtonRect(w);
      this.backButton.x = starMapRect.x;
      this.backButton.y = starMapRect.y;
      if (this.starMapTooltip) {
        this.starMapTooltip.x = starMapRect.x - 8;
        this.starMapTooltip.y = starMapRect.y + starMapRect.h / 2;
      }
    }
    if (this.toast) {
      this.toast.x = w / 2;
    }
    this.layoutTurnControls(w, h);
    this.systemMiniMap?.reposition(w, h);

    if (this.speedButton) {
      this.speedButton.x = w - 20 - 52;
      this.speedButton.y = h - 248;
    }

    if (this.miniLogContainer) {
      this.miniLogContainer.y = h - 180;
    }
    if (this.dayCounterText) {
      this.dayCounterText.y = 20;
    }
    if (this.menuButtonText) {
      this.menuButtonText.y = h - 40;
    }
    if (this.systemMenuPanel) {
      const b = this.systemMenuPanel.getLocalBounds();
      this.systemMenuPanel.x = Math.round((w - b.width) / 2);
      this.systemMenuPanel.y = Math.round((h - b.height) / 2);
    }
  }

  private layoutTurnControls(w: number, h: number): void {
    if (!this.playPauseButton) return;
    let playX = w / 2 - PLAY_BTN_W / 2;
    if (this.cancelButton) {
      playX = Math.max(
        playX,
        BOTTOM_LEFT_LANE_W + CANCEL_BTN_W + CANCEL_BTN_GAP,
      );
    }
    this.playPauseButton.x = playX;
    this.playPauseButton.y = h - PLAY_BTN_H - 18;
    if (this.cancelButton) {
      this.cancelButton.x = playX - CANCEL_BTN_W - CANCEL_BTN_GAP;
      this.cancelButton.y = this.playPauseButton.y;
    }
  }

  isSystemMenuOpen(): boolean {
    return this.systemMenuPanel !== null;
  }

  isSystemModalOpen(): boolean {
    return (
      this.systemMenuPanel !== null || this.systemMenuConfirmPanel !== null
    );
  }

  isLoadSaveEnabled(): boolean {
    return this.loadSaveEnabled;
  }

  setLoadSaveEnabled(enabled: boolean): void {
    if (this.loadSaveEnabled === enabled) return;
    this.loadSaveEnabled = enabled;
    if (this.systemMenuPanel) {
      this.closeSystemMenu();
      this.toggleSystemMenu();
    }
  }

  isQuestJournalOpen(): boolean {
    return this.questJournalUI !== null;
  }

  isQuestJournalVisible(): boolean {
    return (
      this.questJournalUI !== null && this.questJournalUI.container.visible
    );
  }

  isHelpOverlayOpen(): boolean {
    return this.helpOverlay !== null;
  }

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
    overlay.y = 135;

    this.uiLayer.addChild(overlay);
    this.helpOverlay = overlay;
  }

  closeQuestJournal(): void {
    this.closeQuestJournalHelp();
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
      logger.info("Quest journal closed");
    }
  }

  closeModals(): void {
    this.closeQuestJournalHelp();
    const journal = this.questJournalUI;
    this.questJournalUI = null;
    if (journal) queueMicrotask(() => journal.destroy());
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

  private mountIconTooltip(btn: Text, label: string, color: number): Text {
    const tip = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(12),
        fill: color,
      },
    });
    tip.anchor.set(0, 0.5);
    tip.eventMode = "none";
    tip.visible = false;
    const glyph14 = scaledFont(14);
    tip.x = btn.x + glyph14 * 3 * 0.6 + 8;
    tip.y = btn.y + glyph14 * 0.6;
    btn.on("pointerover", () => {
      tip.visible = true;
    });
    btn.on("pointerout", () => {
      tip.visible = false;
    });
    this.uiContainer?.addChild(tip);
    return tip;
  }

  private createUI(): void {
    this.uiContainer = new Container();

    this.dayCounterText = new Text({
      text: formatGameDate(this.gameEngine?.galaxy?.gameDays ?? 0),
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0x00ffff,
      },
    });
    this.dayCounterText.x = 20;
    this.dayCounterText.y = 20;
    this.uiContainer.addChild(this.dayCounterText);

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
    questBtn.y = 50;
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
    invBtn.y = 80;
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
    this.mountIconTooltip(invBtn, t("flight.inventoryTooltip"), 0xffaa00);

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
    helpBtn.y = 110;
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
    this.mountIconTooltip(helpBtn, t("flight.helpTooltip"), 0x88ccff);

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
    menuBtn.y = this.renderer.app.screen.height - 40;
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
    this.menuButtonText = menuBtn;

    const starMapRect = starMapButtonRect(this.renderer.app.screen.width);
    const starMapLabel = t("flight.starMap");
    const backBtn = new UiButton(
      "★",
      "",
      0xffaa00,
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        logger.info("Star map button clicked");
        this.onStarMap?.();
      },
      starMapRect.w,
      starMapRect.h,
    );
    backBtn.x = starMapRect.x;
    backBtn.y = starMapRect.y;

    const starMapTooltip = new Text({
      text: starMapLabel,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(12),
        fill: 0xffaa00,
      },
    });
    starMapTooltip.anchor.set(1, 0.5);
    starMapTooltip.eventMode = "none";
    starMapTooltip.visible = false;
    starMapTooltip.x = starMapRect.x - 8;
    starMapTooltip.y = starMapRect.y + starMapRect.h / 2;

    backBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      starMapTooltip.visible = true;
    });
    backBtn.on("pointerout", () => {
      starMapTooltip.visible = false;
    });

    this.uiContainer.addChild(backBtn.container);
    this.uiContainer.addChild(starMapTooltip);
    this.backButton = backBtn;
    this.starMapTooltip = starMapTooltip;

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
    playBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
    });
    playBtn.container.cursor = "pointer";
    this.uiContainer.addChild(playBtn.container);
    this.playPauseButton = playBtn;
    this.layoutTurnControls(
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );

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
      cancelBtn.container.cursor = "pointer";
      this.uiContainer.addChild(cancelBtn.container);
      this.cancelButton = cancelBtn;
      this.layoutTurnControls(
        this.renderer.app.screen.width,
        this.renderer.app.screen.height,
      );
    }

    this.uiLayer.addChild(this.uiContainer);

    this.miniLogContainer = new Container();
    this.miniLogContainer.eventMode = "none";
    this.miniLogContainer.x = 20;
    this.miniLogContainer.y = this.renderer.app.screen.height - 180;
    this.uiLayer.addChild(this.miniLogContainer);

    this.systemMiniMap = new SystemMiniMap(
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );
    this.systemMiniMap.setPanHandler((worldX, worldY) =>
      this.onMiniMapPan?.(worldX, worldY),
    );
    this.systemMiniMap.setReturnCameraHandler(() => this.onMiniMapReturn?.());
    this.uiLayer.addChild(this.systemMiniMap.container);

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

    this.restoreGameSpeed();
  }

  toggleSystemMenu(): void {
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
    this.onSystemMenuOpen?.();
  }

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

  closeSystemMenuConfirm(): void {
    if (this.systemMenuConfirmPanel) {
      this.systemMenuConfirmPanel.destroy({ children: true });
      this.systemMenuConfirmPanel = null;
    }
  }

  isSystemMenuConfirmOpen(): boolean {
    return this.systemMenuConfirmPanel !== null;
  }

  closeSystemMenu(): void {
    if (this.systemMenuPanel) {
      this.systemMenuPanel.destroy({ children: true });
      this.systemMenuPanel = null;
    }
    this.closeSystemMenuConfirm();
  }

  private cycleGameSpeed(): void {
    const steps = GAME_BALANCE.gameSpeedMultipliers;
    this.speedIndex = (this.speedIndex + 1) % steps.length;
    this.applyGameSpeed(steps[this.speedIndex]);
  }

  private restoreGameSpeed(): void {
    const steps = GAME_BALANCE.gameSpeedMultipliers;
    const persisted =
      this.gameEngine?.gameSpeedMultiplier ?? GAME_BALANCE.gameSpeedDefault;
    const idx = steps.findIndex((s) => s === persisted);
    this.speedIndex = idx >= 0 ? idx : 0;
    this.applyGameSpeed(steps[this.speedIndex]);
  }

  private applyGameSpeed(scale: number): void {
    if (this.speedButton) this.speedButton.setLabel(`${scale}×`);
    if (this.gameEngine) this.gameEngine.gameSpeedMultiplier = scale;
    this.onSpeedCycle?.(scale);
  }

  setGameSpeed(scale: number): void {
    const steps = GAME_BALANCE.gameSpeedMultipliers;
    const idx = steps.findIndex((s) => s === scale);
    if (idx < 0) return;
    this.speedIndex = idx;
    this.applyGameSpeed(steps[this.speedIndex]);
  }

  toggleQuestJournal(): void {
    if (this.questJournalUI) {
      this.closeQuestJournalHelp();
      this.questJournalUI.destroy();
      this.questJournalUI = null;
      logger.info("Quest journal closed");
    } else {
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

  private openQuestJournalHelp(): void {
    if (this.questHelpPanel) return;
    const panel = new HelpPanel(this.renderer, helpFor("quest-journal"), () =>
      this.closeQuestJournalHelp(),
    );
    this.questHelpPanel = panel;
    this.uiLayer.addChild(panel.container);
  }

  private closeQuestJournalHelp(): void {
    if (!this.questHelpPanel) return;
    this.uiLayer.removeChild(this.questHelpPanel.container);
    this.questHelpPanel.destroy();
    this.questHelpPanel = null;
  }

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

  setDayProvider(provider: (() => number) | null): void {
    this.dayProvider = provider;
  }

  private updateDayCounter(): void {
    if (!this.dayCounterText) return;
    const day = this.dayProvider
      ? this.dayProvider()
      : (this.gameEngine?.galaxy?.gameDays ?? null);
    if (day === null) return;
    this.dayCounterText.text = formatGameDate(day);
  }

  private updatePlayPauseButton(): void {
    if (!this.playPauseButton) return;
    if (this.turnRunning) {
      this.playPauseButton.setLabel("⏸ ПАУЗА");
      this.playPauseButton.setAccentColor(0xffcc00);
    } else {
      this.playPauseButton.setLabel("▶ ХОД");
      this.playPauseButton.setAccentColor(0x00ff88);
    }
  }

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

  setMiniLogVisible(visible: boolean): void {
    if (this.miniLogContainer) this.miniLogContainer.visible = visible;
  }

  private addMiniLogEntry(text: string): void {
    if (!this.miniLogContainer) return;
    const lineH = 18;
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
