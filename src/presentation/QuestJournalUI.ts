import { Container, Graphics, Text } from "pixi.js";
import type { IQuestService } from "@/core/ports/IQuestService";
import type { Quest } from "@/domain/Quest";
import { logger } from "@/utils/logger";
import { TYPE_LABEL } from "@/presentation/JobBoardPanel";

/**
 * Quest Journal UI - displays active and completed quests with progress
 * Accessible via "J" key or UI button
 */
export class QuestJournalUI {
  public readonly container: Container;
  private readonly questManager: IQuestService;
  private readonly panelWidth: number = 600;
  private readonly panelHeight: number = 500;
  private readonly onClose: () => void;
  private readonly onNavigateToObjective?: (locationId: string) => void;
  private readonly currentDay: number;

  constructor(
    questManager: IQuestService,
    screenWidth: number,
    screenHeight: number,
    onClose: () => void,
    onNavigateToObjective?: (locationId: string) => void,
    currentDay = 0,
  ) {
    this.questManager = questManager;
    this.onClose = onClose;
    this.onNavigateToObjective = onNavigateToObjective;
    this.currentDay = currentDay;
    this.container = new Container();

    // Center panel on screen
    this.container.x = (screenWidth - this.panelWidth) / 2;
    this.container.y = (screenHeight - this.panelHeight) / 2;

    this.render();
  }

  /**
   * Render the journal panel with all quests
   */
  private render(): void {
    // Semi-transparent overlay backdrop
    const backdrop = new Graphics();
    backdrop.rect(-1000, -1000, 3000, 3000);
    backdrop.fill({ color: 0x000000, alpha: 0.7 });
    // playtest3 F6: every click inside the journal — empty backdrop AND the
    // panel/labels — used to bubble to the stage route-planning handler (which
    // closed the modal or planned a route behind it). eventMode="static" makes
    // the backdrop a hit target but does NOT stop bubbling on its own
    // (CLAUDE.md Rule 2). The fix makes the backdrop the single full-screen
    // catch-all: it swallows every pointer event, and all non-button content
    // (panel, labels, card backgrounds) is eventMode="none" so clicks fall
    // through to it (Rule 3). Only the close/navigate buttons stay interactive.
    backdrop.eventMode = "static";
    const swallow = (event: { stopPropagation: () => void }): void => {
      event.stopPropagation();
    };
    backdrop.on("pointerdown", swallow);
    backdrop.on("pointerup", swallow);
    backdrop.on("pointertap", swallow);
    this.container.addChild(backdrop);

    // Main panel background — non-interactive so clicks fall through to the
    // catch-all backdrop instead of bubbling to the stage.
    const panel = new Graphics();
    panel.rect(0, 0, this.panelWidth, this.panelHeight);
    panel.fill({ color: 0x1a1a2e, alpha: 0.95 });
    panel.stroke({ color: 0x00ffff, width: 2 });
    panel.eventMode = "none";
    this.container.addChild(panel);

    // Title
    const titleText = new Text({
      text: "ЖУРНАЛ КВЕСТОВ",
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ffff,
        fontWeight: "bold",
      },
    });
    titleText.x = 20;
    titleText.y = 15;
    titleText.eventMode = "none";
    this.container.addChild(titleText);

    // Close button
    const closeBtn = this.createCloseButton();
    closeBtn.x = this.panelWidth - 30;
    closeBtn.y = 15;
    this.container.addChild(closeBtn);

    // Active quests section
    const activeQuests = this.questManager.getActiveQuests();
    let nextSectionY = this.renderActiveQuests(activeQuests, 60);
    nextSectionY += 10;

    // Completed quests section (if any)
    const completedQuestIds = this.questManager.getCompletedQuestIds();
    if (completedQuestIds.length > 0) {
      this.renderCompletedQuestsSection(completedQuestIds, nextSectionY);
      nextSectionY += 80;
    }

    // Expired/failed quests section (if any)
    const expiredQuests = this.questManager.getExpiredQuests?.() ?? [];
    if (expiredQuests.length > 0) {
      this.renderExpiredQuestsSection(expiredQuests, nextSectionY);
    }

    // Empty state if no quests at all
    if (
      activeQuests.length === 0 &&
      completedQuestIds.length === 0 &&
      expiredQuests.length === 0
    ) {
      const emptyText = new Text({
        text: "У вас пока нет квестов.\nПосетите планету и поговорите с губернатором!",
        style: {
          fontFamily: "Courier New",
          fontSize: 14,
          fill: 0xaaaaaa,
          align: "center",
        },
      });
      emptyText.anchor.set(0.5);
      emptyText.x = this.panelWidth / 2;
      emptyText.y = this.panelHeight / 2;
      emptyText.eventMode = "none";
      this.container.addChild(emptyText);
    }
  }

  /**
   * Render active quests list
   */
  private renderActiveQuests(quests: Quest[], startY: number): number {
    const sectionTitle = new Text({
      text: "АКТИВНЫЕ КВЕСТЫ",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    const cardStep = 140;
    const maxVisible = Math.floor((this.panelHeight - startY - 30) / cardStep);
    const visible = quests.slice(0, maxVisible);
    const overflow = quests.length - visible.length;

    let yOffset = startY + 30;
    for (const quest of visible) {
      const questUI = this.createQuestCard(quest, yOffset);
      this.container.addChild(questUI);
      yOffset += cardStep;
    }

    if (overflow > 0) {
      const moreText = new Text({
        text: `+${overflow} ещё...`,
        style: { fontFamily: "Courier New", fontSize: 11, fill: 0x888888 },
      });
      moreText.x = 20;
      moreText.y = yOffset;
      moreText.eventMode = "none";
      this.container.addChild(moreText);
      yOffset += 20;
    }

    return yOffset;
  }

  /**
   * Create a card displaying quest information
   */
  private createQuestCard(quest: Quest, yPos: number): Container {
    const card = new Container();
    card.y = yPos;

    // Card background — non-interactive so clicks fall through to the backdrop.
    const bg = new Graphics();
    bg.rect(20, 0, this.panelWidth - 40, 130);
    bg.fill({ color: 0x16213e, alpha: 0.8 });
    bg.stroke({ color: quest.isCompleted ? 0x00ff00 : 0x888888, width: 1 });
    bg.eventMode = "none";
    card.addChild(bg);

    // Quest title
    const titleText = new Text({
      text: quest.title,
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fill: quest.isCompleted ? 0x00ff00 : 0xffffff,
        fontWeight: "bold",
      },
    });
    titleText.x = 30;
    titleText.y = 10;
    titleText.eventMode = "none";
    card.addChild(titleText);

    // Quest type
    const typeText = new Text({
      text: `[${TYPE_LABEL[quest.type] ?? quest.type}]`,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0x888888,
      },
    });
    typeText.x = this.panelWidth - 120;
    typeText.y = 10;
    typeText.eventMode = "none";
    card.addChild(typeText);

    // Objectives
    let objY = 35;
    for (const objective of quest.objectives) {
      const objText = new Text({
        text: `${objective.completed ? "✓" : "○"} ${objective.description}: ${objective.currentAmount}/${objective.targetAmount}`,
        style: {
          fontFamily: "Courier New",
          fontSize: 11,
          fill: objective.completed ? 0x00ff00 : 0xaaaaaa,
        },
      });
      objText.x = 40;
      objText.y = objY;
      objText.eventMode = "none";
      card.addChild(objText);

      // Add "Navigate" button for VISIT_LOCATION and VISIT_SYSTEM objectives
      const navTargetId =
        !objective.completed && this.onNavigateToObjective
          ? objective.type === "VISIT_LOCATION" &&
            objective.locationId &&
            objective.locationId !== "any_planet"
            ? objective.locationId
            : objective.type === "VISIT_SYSTEM" && objective.targetSystemId
              ? objective.targetSystemId
              : null
          : null;
      if (navTargetId) {
        const navBtn = this.createNavigateButton(navTargetId);
        navBtn.x = this.panelWidth - 170;
        navBtn.y = objY - 2;
        card.addChild(navBtn);
      }

      objY += 18;
    }

    // Reward summary — more journal detail (credits / xp / items / reputation).
    const r = quest.reward;
    const parts: string[] = [];
    if (r?.credits) parts.push(`${r.credits} кр`);
    if (r?.experience) parts.push(`${r.experience} опыт`);
    for (const it of r?.items ?? []) parts.push(`${it.amount}×${it.type}`);
    if (r?.reputationDelta) {
      parts.push(`${r.reputationDelta > 0 ? "+" : ""}${r.reputationDelta} реп`);
    }
    const rewardText = new Text({
      text: `Награда: ${parts.length ? parts.join(", ") : "—"}`,
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0xffcc66 },
    });
    rewardText.x = 40;
    rewardText.y = objY + 2;
    rewardText.eventMode = "none";
    card.addChild(rewardText);

    // Highlights row: derive from available Quest fields (system, issuer planet).
    const questHighlights: Array<{
      label: string;
      value: string;
      color: number;
    }> = [];
    if (quest.targetSystemId) {
      questHighlights.push({
        label: "Система",
        value: quest.targetSystemId,
        color: 0x66ffcc,
      });
    }
    if (quest.planetId && quest.planetId !== "unknown") {
      questHighlights.push({
        label: "Выдан",
        value: quest.planetId,
        color: 0xaaaaaa,
      });
    }
    if (questHighlights.length > 0) {
      const hTagSpacing = 150;
      let hx = 40;
      for (const hl of questHighlights) {
        if (hx > this.panelWidth - 60) break;
        const tagT = new Text({
          text: `[${hl.label}: ${hl.value}]`,
          style: { fontFamily: "Courier New", fontSize: 9, fill: hl.color },
        });
        tagT.x = hx;
        tagT.y = objY + 20;
        tagT.eventMode = "none";
        card.addChild(tagT);
        hx += hTagSpacing;
      }
    }

    // Remaining days warning for quests with an approaching deadline.
    if (quest.deadline > 0 && this.currentDay > 0) {
      const remaining = quest.getRemainingDays(this.currentDay);
      if (remaining < 5) {
        const daysLabel = new Text({
          text: `⚠ осталось ${remaining} дн.`,
          style: {
            fontFamily: "Courier New",
            fontSize: 11,
            fill: 0xffaa00,
            fontWeight: "bold",
          },
        });
        daysLabel.x = this.panelWidth - 180;
        daysLabel.y = objY + 2;
        daysLabel.eventMode = "none";
        card.addChild(daysLabel);
      }
    }

    return card;
  }

  /**
   * Create "Navigate to objective" button
   */
  private createNavigateButton(locationId: string): Container {
    const btn = new Container();

    const btnBg = new Graphics();
    btnBg.rect(0, 0, 120, 16);
    btnBg.fill({ color: 0x444400, alpha: 0.8 });
    btnBg.stroke({ color: 0xffff00, width: 1 });
    btn.addChild(btnBg);

    const btnText = new Text({
      text: "→ Лететь к цели",
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0xffff00,
      },
    });
    btnText.x = 5;
    btnText.y = 2;
    btnText.eventMode = "none";
    btn.addChild(btnText);

    btn.eventMode = "static";
    btn.cursor = "pointer";

    btn.on("pointerdown", (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      if (this.onNavigateToObjective) {
        this.onNavigateToObjective(locationId);
        this.onClose(); // Close journal after navigation
      }
    });

    btn.on("pointerover", () => {
      btnBg.clear();
      btnBg.rect(0, 0, 120, 16);
      btnBg.fill({ color: 0x666600, alpha: 1.0 });
      btnBg.stroke({ color: 0xffff00, width: 2 });
    });

    btn.on("pointerout", () => {
      btnBg.clear();
      btnBg.rect(0, 0, 120, 16);
      btnBg.fill({ color: 0x444400, alpha: 0.8 });
      btnBg.stroke({ color: 0xffff00, width: 1 });
    });

    return btn;
  }

  /**
   * Render expired/failed quests section
   */
  private renderExpiredQuestsSection(quests: Quest[], startY: number): void {
    const sectionTitle = new Text({
      text: `ПРОВАЛЕНО / ПРОСРОЧЕНО (${quests.length})`,
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fill: 0xff4444,
        fontWeight: "bold",
      },
    });
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    let yOffset = startY + 22;
    for (const quest of quests) {
      const row = new Text({
        text: `✗ ${quest.title} — просрочено`,
        style: { fontFamily: "Courier New", fontSize: 11, fill: 0x888888 },
      });
      row.x = 30;
      row.y = yOffset;
      row.eventMode = "none";
      this.container.addChild(row);
      yOffset += 16;
    }
  }

  /**
   * Render completed quests section
   */
  private renderCompletedQuestsSection(
    questIds: string[],
    startY: number,
  ): void {
    const sectionTitle = new Text({
      text: `ЗАВЕРШЁННЫЕ КВЕСТЫ (${questIds.length})`,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0x00ff00,
        fontWeight: "bold",
      },
    });
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    // Show count instead of full list to save space
    const completedText = new Text({
      text: "Вы завершили несколько квестов!\nПродолжайте исследовать галактику.",
      style: {
        fontFamily: "Courier New",
        fontSize: 12,
        fill: 0x888888,
      },
    });
    completedText.x = 20;
    completedText.y = startY + 30;
    completedText.eventMode = "none";
    this.container.addChild(completedText);
  }

  /**
   * Create close button
   */
  private createCloseButton(): Container {
    const closeBtn = new Container();
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";

    const closeBg = new Graphics();
    closeBg.rect(0, 0, 20, 20);
    closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    closeBtn.addChild(closeBg);

    const closeText = new Text({
      text: "X",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    closeText.x = 5;
    closeText.y = 2;
    closeBtn.addChild(closeText);

    closeBtn.on("pointerdown", (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info("Quest journal closed");
      this.onClose();
    });

    closeBtn.on("pointerover", () => {
      closeBg.clear();
      closeBg.rect(0, 0, 20, 20);
      closeBg.fill({ color: 0xff4444, alpha: 1.0 });
    });

    closeBtn.on("pointerout", () => {
      closeBg.clear();
      closeBg.rect(0, 0, 20, 20);
      closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    });

    return closeBtn;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Idempotent: the journal is closed via a deferred microtask (see
    // FlightHud.closeModals) which may run after the scene's clearUILayer() has
    // already destroyed this container — destroying it twice throws.
    if (this.container.destroyed) return;
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.container.destroy({ children: true });
    logger.info("QuestJournalUI destroyed");
  }
}
