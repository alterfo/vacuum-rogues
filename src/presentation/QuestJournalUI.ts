import { Container, Graphics } from "pixi.js";
import { t } from "@/i18n/i18n";
import { scaledText } from "./ui/scaledText";
import { scaledFont } from "@/utils/fontScale";
import {
  layoutQuestCard,
  estimateWrappedLines,
  lineStepFor,
  MIN_CARD_HEIGHT,
  type QuestCardMetrics,
} from "./ui/questCardLayout";
import type { IQuestService } from "@/core/ports/IQuestService";
import type { Quest } from "@/domain/Quest";
import { logger } from "@/utils/logger";
import { questTypeLabel } from "@/presentation/JobBoardPanel";
import { QuestType } from "@/types";
import { ScrollableList } from "@/presentation/ui/ScrollableList";
import {
  questDestination,
  questRouteAction,
  type QuestDestination,
  type QuestDestinationGalaxyLike,
} from "@/systems/quests/questDestination";

const PENDING_TOP_PAD = 8;
const PENDING_TITLE_GAP = 4;
const PENDING_RETURN_GAP = 2;
const PENDING_BOTTOM_PAD = 12;
const PENDING_MIN_CARD_HEIGHT = 80;
const PENDING_CARD_GAP = 10;

export class QuestJournalUI {
  public readonly container: Container;
  private readonly questManager: IQuestService;
  private readonly panelWidth: number = 600;
  private readonly panelHeight: number = 500;
  private readonly onClose: () => void;
  private readonly onNavigateToObjective?: (locationId: string) => void;
  private readonly currentDay: number;
  private readonly resolveName: (id: string) => string;
  private readonly cargoCarried: ((itemType: string) => number) | undefined;
  private readonly galaxy: QuestDestinationGalaxyLike | undefined;
  private readonly currentSystemId: string;
  private activeList: ScrollableList<Quest> | null = null;

  private readonly onShowHelp: (() => void) | undefined;

  constructor(
    questManager: IQuestService,
    screenWidth: number,
    screenHeight: number,
    onClose: () => void,
    onNavigateToObjective?: (locationId: string) => void,
    currentDay = 0,
    resolveName?: (id: string) => string,
    cargoCarried?: (itemType: string) => number,
    galaxy?: QuestDestinationGalaxyLike,
    currentSystemId = "",
    onShowHelp?: () => void,
  ) {
    this.questManager = questManager;
    this.onClose = onClose;
    this.onNavigateToObjective = onNavigateToObjective;
    this.currentDay = currentDay;
    this.resolveName = resolveName ?? ((id) => id);
    this.cargoCarried = cargoCarried;
    this.galaxy = galaxy;
    this.currentSystemId = currentSystemId;
    this.onShowHelp = onShowHelp;
    this.container = new Container();

    this.container.x = (screenWidth - this.panelWidth) / 2;
    this.container.y = (screenHeight - this.panelHeight) / 2;

    this.render();
  }

  private render(): void {
    const backdrop = new Graphics();
    backdrop.rect(-1000, -1000, 3000, 3000);
    backdrop.fill({ color: 0x000000, alpha: 0.7 });
    backdrop.eventMode = "static";
    const swallow = (event: { stopPropagation: () => void }): void => {
      event.stopPropagation();
    };
    backdrop.on("pointerdown", swallow);
    backdrop.on("pointerup", swallow);
    backdrop.on("pointertap", swallow);
    this.container.addChild(backdrop);

    const panel = new Graphics();
    panel.rect(0, 0, this.panelWidth, this.panelHeight);
    panel.fill({ color: 0x1a1a2e, alpha: 0.95 });
    panel.stroke({ color: 0x00ffff, width: 2 });
    panel.eventMode = "none";
    this.container.addChild(panel);

    const titleText = scaledText("ЖУРНАЛ КВЕСТОВ", 18, 0x00ffff, {
      rawColor: true,
      fontWeight: "bold",
    });
    titleText.x = 20;
    titleText.y = 15;
    titleText.eventMode = "none";
    this.container.addChild(titleText);

    const closeBtn = this.createCloseButton();
    closeBtn.x = this.panelWidth - 30;
    closeBtn.y = 15;
    this.container.addChild(closeBtn);

    if (this.onShowHelp) {
      const helpBtn = this.createHelpButton();
      helpBtn.x = this.panelWidth - 58;
      helpBtn.y = 15;
      this.container.addChild(helpBtn);
    }

    const activeQuests = this.questManager.getActiveQuests();
    let nextSectionY = this.renderActiveQuests(activeQuests, 60);
    nextSectionY += 10;

    const pendingReturnQuests =
      this.questManager.getPendingReturnQuests?.() ?? [];
    if (pendingReturnQuests.length > 0) {
      nextSectionY = this.renderPendingReturnSection(
        pendingReturnQuests,
        nextSectionY,
      );
      nextSectionY += 10;
    }

    const completedQuestIds = this.questManager.getCompletedQuestIds();
    if (completedQuestIds.length > 0) {
      this.renderCompletedQuestsSection(completedQuestIds, nextSectionY);
      nextSectionY += 80;
    }

    const expiredQuests = this.questManager.getExpiredQuests?.() ?? [];
    if (expiredQuests.length > 0) {
      this.renderExpiredQuestsSection(expiredQuests, nextSectionY);
    }

    if (
      activeQuests.length === 0 &&
      pendingReturnQuests.length === 0 &&
      completedQuestIds.length === 0 &&
      expiredQuests.length === 0
    ) {
      const emptyText = scaledText(
        "У вас пока нет квестов.\nПосетите планету и поговорите с губернатором!",
        14,
        0xaaaaaa,
        { rawColor: true, align: "center" },
      );
      emptyText.anchor.set(0.5);
      emptyText.x = this.panelWidth / 2;
      emptyText.y = this.panelHeight / 2;
      emptyText.eventMode = "none";
      this.container.addChild(emptyText);
    }
  }

  private renderActiveQuests(quests: Quest[], startY: number): number {
    const sectionTitle = scaledText("АКТИВНЫЕ КВЕСТЫ", 14, 0xffaa00, {
      rawColor: true,
      fontWeight: "bold",
    });
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    const CARD_GAP = 10;
    const maxBoxHeight = quests.reduce(
      (max, q) => Math.max(max, this.cardBoxHeight(q)),
      MIN_CARD_HEIGHT,
    );
    const cardStep = maxBoxHeight + CARD_GAP;
    const cardsTop = startY + 30;
    const fitCount = Math.max(
      1,
      Math.floor((this.panelHeight - startY - 30) / cardStep),
    );

    if (quests.length <= fitCount) {
      let yOffset = cardsTop;
      for (const quest of quests) {
        const questUI = this.createQuestCard(quest, yOffset);
        this.container.addChild(questUI);
        yOffset += cardStep;
      }
      return yOffset;
    }

    const viewportHeight = fitCount * cardStep;
    this.activeList = new ScrollableList<Quest>({
      x: 0,
      y: cardsTop,
      width: this.panelWidth,
      height: viewportHeight,
      itemHeight: cardStep,
      items: quests,
      renderItem: (quest) => this.createQuestCard(quest, 0),
      enableDrag: false,
    });
    this.container.addChild(this.activeList.container);
    return cardsTop + viewportHeight;
  }

  private cardMetrics(): QuestCardMetrics {
    return {
      fontSizePx: scaledFont(13),
      titleWrapWidth: this.panelWidth - 160,
      bodyWrapWidth: this.panelWidth - 220,
    };
  }

  private buildCardContent(quest: Quest): {
    objectives: Array<{
      text: string;
      completedOrReady: boolean;
      navTargetId: string | null;
    }>;
    rewardLine: string;
    highlights: Array<{ label: string; value: string; color: number }>;
    courierDest: QuestDestination | null;
  } {
    const hasVisitObjective = quest.objectives.some(
      (o) => o.type === "VISIT_LOCATION" || o.type === "VISIT_SYSTEM",
    );
    const courierDest = hasVisitObjective
      ? null
      : this.activeDestination(quest);
    const courierNavId = courierDest ? this.routeNavId(courierDest) : null;

    const objectives = quest.objectives.map((objective) => {
      let displayAmount = objective.currentAmount;
      let isReadyToDeliver = false;
      if (
        objective.type === "COLLECT_ITEM" &&
        objective.itemType &&
        this.cargoCarried &&
        !objective.completed
      ) {
        const carried = this.cargoCarried(objective.itemType);
        displayAmount = Math.min(carried, objective.targetAmount);
        isReadyToDeliver = carried >= objective.targetAmount;
      }
      const completedOrReady = objective.completed || isReadyToDeliver;
      const suffix = isReadyToDeliver ? " — ✓ сдать" : "";
      const text = `${completedOrReady ? "✓" : "○"} ${objective.description}: ${displayAmount}/${objective.targetAmount}${suffix}`;

      const navTargetId =
        !objective.completed && this.onNavigateToObjective
          ? objective.type === "VISIT_LOCATION" &&
            objective.locationId &&
            objective.locationId !== "any_planet"
            ? objective.locationId
            : objective.type === "VISIT_SYSTEM" && objective.targetSystemId
              ? objective.targetSystemId
              : objective.type === "COLLECT_ITEM" && courierNavId
                ? courierNavId
                : objective.type === "DEFEAT_ENEMY"
                  ? (courierNavId ?? quest.targetSystemId)
                  : null
          : null;
      return { text, completedOrReady, navTargetId };
    });

    const r = quest.reward;
    const parts: string[] = [];
    if (r?.credits) parts.push(`${r.credits} кр`);
    if (r?.experience) parts.push(`${r.experience} опыт`);
    for (const it of r?.items ?? []) parts.push(`${it.amount}×${it.type}`);
    if (r?.reputationDelta) {
      parts.push(`${r.reputationDelta > 0 ? "+" : ""}${r.reputationDelta} реп`);
    }
    const rewardLine = `Награда: ${parts.length ? parts.join(", ") : "—"}`;

    const highlights: Array<{ label: string; value: string; color: number }> =
      [];
    if (quest.targetSystemId) {
      highlights.push({
        label: "Система",
        value: this.resolveName(quest.targetSystemId),
        color: 0x66ffcc,
      });
    }
    if (quest.planetId && quest.planetId !== "unknown") {
      const planetLabel =
        quest.type === QuestType.TEXT_ADVENTURE ? "Планета" : "Выдан";
      highlights.push({
        label: planetLabel,
        value: this.resolveName(quest.planetId),
        color: quest.type === QuestType.TEXT_ADVENTURE ? 0x66ffcc : 0xaaaaaa,
      });
    }
    if (
      courierDest &&
      quest.targetPlanetId &&
      quest.targetPlanetId !== quest.planetId
    ) {
      highlights.push({
        label: "Куда",
        value: this.resolveName(quest.targetPlanetId),
        color: 0x66ffcc,
      });
    }

    return { objectives, rewardLine, highlights, courierDest };
  }

  private cardBoxHeight(quest: Quest): number {
    const content = this.buildCardContent(quest);
    const layout = layoutQuestCard(
      {
        title: quest.title,
        objectives: content.objectives.map((o) => o.text),
        rewardLine: content.rewardLine,
        hasHighlights: content.highlights.length > 0,
      },
      this.cardMetrics(),
    );
    return Math.max(MIN_CARD_HEIGHT, layout.contentHeight);
  }

  private createQuestCard(quest: Quest, yPos: number): Container {
    const card = new Container();
    card.y = yPos;

    const metrics = this.cardMetrics();
    const content = this.buildCardContent(quest);
    const layout = layoutQuestCard(
      {
        title: quest.title,
        objectives: content.objectives.map((o) => o.text),
        rewardLine: content.rewardLine,
        hasHighlights: content.highlights.length > 0,
      },
      metrics,
    );
    const boxHeight = Math.max(MIN_CARD_HEIGHT, layout.contentHeight);

    const bg = new Graphics();
    bg.rect(20, 0, this.panelWidth - 40, boxHeight);
    bg.fill({ color: 0x16213e, alpha: 0.8 });
    bg.stroke({ color: quest.isCompleted ? 0x00ff00 : 0xb4b4b4, width: 1 });
    bg.eventMode = "none";
    card.addChild(bg);

    const titleText = scaledText(
      quest.title,
      13,
      quest.isCompleted ? 0x00ff00 : 0xffffff,
      {
        rawColor: true,
        fontWeight: "bold",
        wordWrap: true,
        wordWrapWidth: metrics.titleWrapWidth,
        breakWords: true,
      },
    );
    titleText.x = 30;
    titleText.y = layout.titleY;
    titleText.eventMode = "none";
    card.addChild(titleText);

    const typeText = scaledText(
      `[${questTypeLabel(quest.type)}]`,
      13,
      0xb4b4b4,
      { rawColor: true },
    );
    typeText.x = this.panelWidth - 120;
    typeText.y = layout.titleY;
    typeText.eventMode = "none";
    card.addChild(typeText);

    content.objectives.forEach((objective, i) => {
      const objY = layout.objectiveYs[i];
      const objText = scaledText(
        objective.text,
        13,
        objective.completedOrReady ? 0x00ff00 : 0xaaaaaa,
        {
          rawColor: true,
          wordWrap: true,
          wordWrapWidth: metrics.bodyWrapWidth,
          breakWords: true,
        },
      );
      objText.x = 40;
      objText.y = objY;
      objText.eventMode = "none";
      card.addChild(objText);

      if (objective.navTargetId) {
        const navBtn = this.createNavigateButton(objective.navTargetId);
        navBtn.x = this.panelWidth - 170;
        navBtn.y = objY - 2;
        card.addChild(navBtn);
      }
    });

    const rewardText = scaledText(content.rewardLine, 13, 0xffcc66, {
      rawColor: true,
      wordWrap: true,
      wordWrapWidth: metrics.bodyWrapWidth,
      breakWords: true,
    });
    rewardText.x = 40;
    rewardText.y = layout.rewardY;
    rewardText.eventMode = "none";
    card.addChild(rewardText);

    if (content.highlights.length > 0) {
      const hTagSpacing = 150;
      let hx = 40;
      for (const hl of content.highlights) {
        if (hx > this.panelWidth - 60) break;
        const tagT = scaledText(`[${hl.label}: ${hl.value}]`, 11, hl.color, {
          rawColor: true,
        });
        tagT.x = hx;
        tagT.y = layout.highlightsY;
        tagT.eventMode = "none";
        card.addChild(tagT);
        hx += hTagSpacing;
      }
    }

    if (quest.deadline > 0 && this.currentDay > 0) {
      const remaining = quest.getRemainingDays(this.currentDay);
      if (remaining < 5) {
        const daysLabel = scaledText(
          `⚠ осталось ${remaining} дн.`,
          13,
          0xffaa00,
          { rawColor: true, fontWeight: "bold" },
        );
        daysLabel.x = this.panelWidth - 180;
        daysLabel.y = layout.rewardY;
        daysLabel.eventMode = "none";
        card.addChild(daysLabel);
      }
    }

    return card;
  }

  private activeDestination(quest: Quest): QuestDestination | null {
    if (!this.galaxy || !quest.targetPlanetId || !quest.targetSystemId) {
      return null;
    }
    return questDestination(
      {
        targetSystemId: quest.targetSystemId,
        targetPlanetId: quest.targetPlanetId,
      },
      this.galaxy,
      this.currentSystemId,
    );
  }

  private routeNavId(dest: QuestDestination): string {
    const action = questRouteAction(dest);
    return action.kind === "approach-planet"
      ? action.planetId
      : action.systemId;
  }

  private createNavigateButton(locationId: string): Container {
    const btn = new Container();

    const btnBg = new Graphics();
    btnBg.rect(0, 0, 120, 16);
    btnBg.fill({ color: 0x444400, alpha: 0.8 });
    btnBg.stroke({ color: 0xffff00, width: 1 });
    btn.addChild(btnBg);

    const btnText = scaledText("→ Лететь к цели", 10, 0xffff00, {
      rawColor: true,
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

  private renderPendingReturnSection(quests: Quest[], startY: number): number {
    const sectionTitle = scaledText(
      `ВЫПОЛНЕНО — ЗАБРАТЬ НАГРАДУ (${quests.length})`,
      14,
      0xffcc00,
      { rawColor: true, fontWeight: "bold" },
    );
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    let yOffset = startY + 30;
    for (const quest of quests) {
      const card = this.createPendingReturnCard(quest, yOffset);
      this.container.addChild(card);
      yOffset += this.pendingCardLayout(quest).boxHeight + PENDING_CARD_GAP;
    }

    return yOffset;
  }

  private pendingReturnLine(
    quest: Quest,
    dest: QuestDestination | null,
  ): string {
    const issuerPlanetId =
      quest.planetId && quest.planetId !== "unknown"
        ? this.resolveName(quest.planetId)
        : "?";
    const systemSuffix = dest ? ` — система ${dest.systemName}` : "";
    return `↩ Вернитесь в ${issuerPlanetId}${systemSuffix}`;
  }

  private pendingCardLayout(quest: Quest): {
    boxHeight: number;
    titleY: number;
    returnY: number;
    rewardY: number;
    returnLine: string;
    dest: QuestDestination | null;
  } {
    const m = this.cardMetrics();
    const line = lineStepFor(m.fontSizePx);
    const dest = this.returnDestination(quest);
    const returnLine = this.pendingReturnLine(quest, dest);

    const titleY = PENDING_TOP_PAD;
    const titleLines = estimateWrappedLines(
      quest.title,
      m.bodyWrapWidth,
      m.fontSizePx,
    );
    const returnY = titleY + titleLines * line + PENDING_TITLE_GAP;
    const returnLines = estimateWrappedLines(
      returnLine,
      m.bodyWrapWidth,
      m.fontSizePx,
    );
    const rewardY = returnY + returnLines * line + PENDING_RETURN_GAP;
    const boxHeight = Math.max(
      PENDING_MIN_CARD_HEIGHT,
      rewardY + line + PENDING_BOTTOM_PAD,
    );
    return { boxHeight, titleY, returnY, rewardY, returnLine, dest };
  }

  private returnDestination(quest: Quest): QuestDestination | null {
    if (!this.galaxy || !quest.planetId || quest.planetId === "unknown") {
      return null;
    }
    const issuerSystem = this.galaxy.systems.find((s) =>
      s.planets.some((p) => p.id === quest.planetId),
    );
    if (!issuerSystem) return null;
    return questDestination(
      { targetSystemId: issuerSystem.id, targetPlanetId: quest.planetId },
      this.galaxy,
      this.currentSystemId,
    );
  }

  private createPendingReturnCard(quest: Quest, yPos: number): Container {
    const card = new Container();
    card.y = yPos;

    const metrics = this.cardMetrics();
    const layout = this.pendingCardLayout(quest);
    const { dest } = layout;

    const bg = new Graphics();
    bg.rect(20, 0, this.panelWidth - 40, layout.boxHeight);
    bg.fill({ color: 0x1a1500, alpha: 0.9 });
    bg.stroke({ color: 0xffcc00, width: 1 });
    bg.eventMode = "none";
    card.addChild(bg);

    const titleText = scaledText(quest.title, 13, 0xffff88, {
      rawColor: true,
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: metrics.bodyWrapWidth,
      breakWords: true,
    });
    titleText.x = 30;
    titleText.y = layout.titleY;
    titleText.eventMode = "none";
    card.addChild(titleText);

    const typeText = scaledText(
      `[${questTypeLabel(quest.type)}]`,
      13,
      0xb4b4b4,
      { rawColor: true },
    );
    typeText.x = this.panelWidth - 120;
    typeText.y = layout.titleY;
    typeText.eventMode = "none";
    card.addChild(typeText);

    const returnText = scaledText(layout.returnLine, 12, 0xffcc00, {
      rawColor: true,
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: metrics.bodyWrapWidth,
      breakWords: true,
    });
    returnText.x = 30;
    returnText.y = layout.returnY;
    returnText.eventMode = "none";
    card.addChild(returnText);

    const r = quest.reward;
    const parts: string[] = [];
    if (r?.credits) parts.push(`${r.credits} кр`);
    if (r?.experience) parts.push(`${r.experience} опыт`);
    for (const it of r?.items ?? []) parts.push(`${it.amount}×${it.type}`);
    const rewardText = scaledText(
      `Награда: ${parts.length ? parts.join(", ") : "—"}`,
      13,
      0xffcc66,
      { rawColor: true },
    );
    rewardText.x = 30;
    rewardText.y = layout.rewardY;
    rewardText.eventMode = "none";
    card.addChild(rewardText);

    if (quest.planetId && quest.planetId !== "unknown") {
      const issuedTag = scaledText(
        `[Выдан: ${this.resolveName(quest.planetId)}]`,
        11,
        0xffcc00,
        { rawColor: true },
      );
      issuedTag.x = this.panelWidth - 200;
      issuedTag.y = layout.rewardY;
      issuedTag.eventMode = "none";
      card.addChild(issuedTag);
    }

    if (dest && this.onNavigateToObjective) {
      const routeBtn = this.createPlotRouteButton(dest);
      routeBtn.x = this.panelWidth - 175;
      routeBtn.y = layout.titleY + 18;
      card.addChild(routeBtn);
    }

    return card;
  }

  private createPlotRouteButton(dest: QuestDestination): Container {
    const btn = new Container();
    const width = 155;

    const btnBg = new Graphics();
    btnBg.rect(0, 0, width, 16);
    btnBg.fill({ color: 0x00332b, alpha: 0.9 });
    btnBg.stroke({ color: 0x66ffcc, width: 1 });
    btn.addChild(btnBg);

    const btnText = scaledText("⇒ Проложить маршрут", 10, 0x66ffcc, {
      rawColor: true,
    });
    btnText.x = 5;
    btnText.y = 2;
    btnText.eventMode = "none";
    btn.addChild(btnText);

    btn.eventMode = "static";
    btn.cursor = "pointer";

    btn.on("pointerdown", (event) => {
      event.stopPropagation(); // don't bubble to the stage route handler
      if (!this.onNavigateToObjective) return;
      const action = questRouteAction(dest);
      const targetId =
        action.kind === "approach-planet" ? action.planetId : action.systemId;
      this.onNavigateToObjective(targetId);
      this.onClose(); // close the journal after plotting
    });

    btn.on("pointerover", () => {
      btnBg.clear();
      btnBg.rect(0, 0, width, 16);
      btnBg.fill({ color: 0x005a4c, alpha: 1.0 });
      btnBg.stroke({ color: 0x66ffcc, width: 2 });
    });

    btn.on("pointerout", () => {
      btnBg.clear();
      btnBg.rect(0, 0, width, 16);
      btnBg.fill({ color: 0x00332b, alpha: 0.9 });
      btnBg.stroke({ color: 0x66ffcc, width: 1 });
    });

    return btn;
  }

  private renderExpiredQuestsSection(quests: Quest[], startY: number): void {
    const sectionTitle = scaledText(
      `ПРОВАЛЕНО / ПРОСРОЧЕНО (${quests.length})`,
      13,
      0xff4444,
      { rawColor: true, fontWeight: "bold" },
    );
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    let yOffset = startY + 22;
    for (const quest of quests) {
      const row = scaledText(`✗ ${quest.title} — просрочено`, 13, 0xb4b4b4, {
        rawColor: true,
      });
      row.x = 30;
      row.y = yOffset;
      row.eventMode = "none";
      this.container.addChild(row);
      yOffset += 16;
    }
  }

  private renderCompletedQuestsSection(
    questIds: string[],
    startY: number,
  ): void {
    const sectionTitle = scaledText(
      `ЗАВЕРШЁННЫЕ КВЕСТЫ (${questIds.length})`,
      14,
      0x00ff00,
      { rawColor: true, fontWeight: "bold" },
    );
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    const CARD_HEIGHT = 60;
    const CARD_GAP = 10;
    const availableHeight = this.panelHeight - startY - 30;
    const fitCount = Math.max(
      1,
      Math.floor(availableHeight / (CARD_HEIGHT + CARD_GAP)),
    );

    if (questIds.length <= fitCount) {
      let yOffset = startY + 30;
      for (const questId of questIds) {
        const row = scaledText(
          t("journal.questCompleted", { questId }),
          13,
          0xb4b4b4,
          {
            rawColor: true,
          },
        );
        row.x = 30;
        row.y = yOffset;
        row.eventMode = "none";
        this.container.addChild(row);
        yOffset += CARD_HEIGHT + CARD_GAP;
      }
    } else {
      const cardsTop = startY + 30;
      const viewportHeight = fitCount * (CARD_HEIGHT + CARD_GAP);

      const completedList = new ScrollableList<string>({
        x: 0,
        y: cardsTop,
        width: this.panelWidth,
        height: viewportHeight,
        itemHeight: CARD_HEIGHT + CARD_GAP,
        items: questIds,
        renderItem: (questId) => {
          const card = new Container();
          card.y = 0;
          const bg = new Graphics();
          bg.rect(20, 0, this.panelWidth - 40, CARD_HEIGHT);
          bg.fill({ color: 0x0a1a0a, alpha: 0.8 });
          bg.stroke({ color: 0x00ff00, width: 1, alpha: 0.3 });
          bg.eventMode = "none";
          card.addChild(bg);

          const row = scaledText(
            t("journal.questCompleted", { questId }),
            13,
            0xb4b4b4,
            {
              rawColor: true,
            },
          );
          row.x = 30;
          row.y = 15;
          row.eventMode = "none";
          card.addChild(row);

          return card;
        },
        enableDrag: false,
      });
      this.container.addChild(completedList.container);
    }
  }

  private createHelpButton(): Container {
    const helpBtn = new Container();
    helpBtn.eventMode = "static";
    helpBtn.cursor = "pointer";

    const bg = new Graphics();
    bg.rect(0, 0, 20, 20);
    bg.fill({ color: 0x004a5a, alpha: 0.9 });
    bg.stroke({ color: 0x00ffee, width: 1 });
    helpBtn.addChild(bg);

    const label = scaledText("?", 14, 0x00ffee, {
      rawColor: true,
      fontWeight: "bold",
    });
    label.x = 6;
    label.y = 2;
    label.eventMode = "none";
    helpBtn.addChild(label);

    helpBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.onShowHelp?.();
    });

    return helpBtn;
  }

  private createCloseButton(): Container {
    const closeBtn = new Container();
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";

    const closeBg = new Graphics();
    closeBg.rect(0, 0, 20, 20);
    closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    closeBtn.addChild(closeBg);

    const closeText = scaledText("X", 14, 0xffffff, {
      rawColor: true,
      fontWeight: "bold",
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

  destroy(): void {
    if (this.activeList) {
      this.activeList.destroy();
      this.activeList = null;
    }
    if (this.container.destroyed) return;
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.container.destroy({ children: true });
    logger.info("QuestJournalUI destroyed");
  }
}
