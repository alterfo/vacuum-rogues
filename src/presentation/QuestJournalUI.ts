import { Container, Graphics, Text } from "pixi.js";
import type { IQuestService } from "@/core/ports/IQuestService";
import type { Quest } from "@/domain/Quest";
import { logger } from "@/utils/logger";

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

  constructor(
    questManager: IQuestService,
    screenWidth: number,
    screenHeight: number,
    onClose: () => void,
    onNavigateToObjective?: (locationId: string) => void,
  ) {
    this.questManager = questManager;
    this.onClose = onClose;
    this.onNavigateToObjective = onNavigateToObjective;
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
    backdrop.eventMode = "static"; // Block clicks behind
    this.container.addChild(backdrop);

    // Main panel background
    const panel = new Graphics();
    panel.rect(0, 0, this.panelWidth, this.panelHeight);
    panel.fill({ color: 0x1a1a2e, alpha: 0.95 });
    panel.stroke({ color: 0x00ffff, width: 2 });
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
    this.container.addChild(titleText);

    // Close button
    const closeBtn = this.createCloseButton();
    closeBtn.x = this.panelWidth - 30;
    closeBtn.y = 15;
    this.container.addChild(closeBtn);

    // Active quests section
    const activeQuests = this.questManager.getActiveQuests();
    this.renderActiveQuests(activeQuests, 60);

    // Completed quests section (if any)
    const completedQuestIds = this.questManager.getCompletedQuestIds();
    if (completedQuestIds.length > 0) {
      this.renderCompletedQuestsSection(completedQuestIds, 300);
    }

    // Empty state if no quests
    if (activeQuests.length === 0 && completedQuestIds.length === 0) {
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
      this.container.addChild(emptyText);
    }
  }

  /**
   * Render active quests list
   */
  private renderActiveQuests(quests: Quest[], startY: number): void {
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
    this.container.addChild(sectionTitle);

    let yOffset = startY + 30;
    for (const quest of quests) {
      const questUI = this.createQuestCard(quest, yOffset);
      this.container.addChild(questUI);
      yOffset += 120; // Space for each quest card
    }
  }

  /**
   * Create a card displaying quest information
   */
  private createQuestCard(quest: Quest, yPos: number): Container {
    const card = new Container();
    card.y = yPos;

    // Card background
    const bg = new Graphics();
    bg.rect(20, 0, this.panelWidth - 40, 100);
    bg.fill({ color: 0x16213e, alpha: 0.8 });
    bg.stroke({ color: quest.isCompleted ? 0x00ff00 : 0x888888, width: 1 });
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
    card.addChild(titleText);

    // Quest type
    const typeText = new Text({
      text: `[${quest.type}]`,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0x888888,
      },
    });
    typeText.x = this.panelWidth - 120;
    typeText.y = 10;
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
      card.addChild(objText);

      // Add "Navigate" button for VISIT_LOCATION objectives
      if (
        !objective.completed &&
        objective.type === "VISIT_LOCATION" &&
        objective.locationId &&
        objective.locationId !== "any_planet" &&
        this.onNavigateToObjective
      ) {
        const navBtn = this.createNavigateButton(objective.locationId);
        navBtn.x = this.panelWidth - 170;
        navBtn.y = objY - 2;
        card.addChild(navBtn);
      }

      objY += 18;
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
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.container.destroy({ children: true });
    logger.info("QuestJournalUI destroyed");
  }
}
