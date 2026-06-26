import { Container, Graphics } from "pixi.js";
import { scaledText } from "./ui/scaledText";
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
  // Maps a planet/system id to a human-readable display name; falls back to the
  // raw id when no resolver is supplied (e.g. in unit tests).
  private readonly resolveName: (id: string) => string;
  // Returns how many units of a given itemType the player currently carries.
  // Used to show live cargo progress for COLLECT_ITEM objectives instead of the
  // frozen currentAmount (which is never incremented in production).
  private readonly cargoCarried: ((itemType: string) => number) | undefined;
  // Structural galaxy view used to NAME the system a pending-return quest sends
  // the player back to (the issuer planet's system). Undefined in unit tests /
  // before the galaxy is wired — the system suffix is then simply omitted.
  private readonly galaxy: QuestDestinationGalaxyLike | undefined;
  // The player's current system id, fed to `questDestination` so the resolved
  // descriptor's `sameSystem` is correct (used by the plot-route button).
  private readonly currentSystemId: string;
  // Scrollable region wrapping the active quests when they overflow the panel
  // (replaces the old slice + dead "+N ещё" label). Null while everything fits.
  // Owns a window-level wheel listener that destroy() must tear down.
  private activeList: ScrollableList<Quest> | null = null;

  // Opens the contextual-help panel for the journal (the «?» button). Undefined
  // in unit tests / when no help is wired — the «?» button is then omitted.
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
    const titleText = scaledText("ЖУРНАЛ КВЕСТОВ", 18, 0x00ffff, {
      rawColor: true,
      fontWeight: "bold",
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

    // Contextual-help «?» button, left of the close button. Only when wired.
    if (this.onShowHelp) {
      const helpBtn = this.createHelpButton();
      helpBtn.x = this.panelWidth - 58;
      helpBtn.y = 15;
      this.container.addChild(helpBtn);
    }

    // Active quests section
    const activeQuests = this.questManager.getActiveQuests();
    let nextSectionY = this.renderActiveQuests(activeQuests, 60);
    nextSectionY += 10;

    // Pending-return quests section (between active and completed)
    const pendingReturnQuests =
      this.questManager.getPendingReturnQuests?.() ?? [];
    if (pendingReturnQuests.length > 0) {
      nextSectionY = this.renderPendingReturnSection(
        pendingReturnQuests,
        nextSectionY,
      );
      nextSectionY += 10;
    }

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

  /**
   * Render active quests list
   */
  private renderActiveQuests(quests: Quest[], startY: number): number {
    const sectionTitle = scaledText("АКТИВНЫЕ КВЕСТЫ", 14, 0xffaa00, {
      rawColor: true,
      fontWeight: "bold",
    });
    sectionTitle.x = 20;
    sectionTitle.y = startY;
    sectionTitle.eventMode = "none";
    this.container.addChild(sectionTitle);

    const cardStep = 140;
    const cardsTop = startY + 30;
    // How many cards fit in the space the active section is allotted. Matches the
    // old `maxVisible` formula so the layout below the section is unchanged.
    const fitCount = Math.max(
      1,
      Math.floor((this.panelHeight - startY - 30) / cardStep),
    );

    if (quests.length <= fitCount) {
      // Everything fits — render the cards directly (no scroll, no truncation).
      let yOffset = cardsTop;
      for (const quest of quests) {
        const questUI = this.createQuestCard(quest, yOffset);
        this.container.addChild(questUI);
        yOffset += cardStep;
      }
      return yOffset;
    }

    // Overflow: wrap ALL active quests in a scrollable region so every one is
    // reachable by scrolling — replacing the old `slice` + non-interactive
    // "+N ещё..." dead-end. Drag is disabled on purpose: a dragging content
    // container is an eventMode="static" hit target whose pointerdown does not
    // stopPropagation, which would re-open the playtest3 F6 click-through (the
    // modal relies on non-button content falling through to the catch-all
    // backdrop). Scroll is wheel-driven here.
    const viewportHeight = fitCount * cardStep;
    this.activeList = new ScrollableList<Quest>({
      x: 0,
      y: cardsTop,
      width: this.panelWidth,
      height: viewportHeight,
      itemHeight: cardStep,
      items: quests,
      // The list positions each row by index; build the card at a local origin.
      renderItem: (quest) => this.createQuestCard(quest, 0),
      enableDrag: false,
    });
    this.container.addChild(this.activeList.container);
    return cardsTop + viewportHeight;
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
    bg.stroke({ color: quest.isCompleted ? 0x00ff00 : 0xb4b4b4, width: 1 });
    bg.eventMode = "none";
    card.addChild(bg);

    // Quest title
    const titleText = scaledText(
      quest.title,
      13,
      quest.isCompleted ? 0x00ff00 : 0xffffff,
      { rawColor: true, fontWeight: "bold" },
    );
    titleText.x = 30;
    titleText.y = 10;
    titleText.eventMode = "none";
    card.addChild(titleText);

    // Quest type
    const typeText = scaledText(
      `[${questTypeLabel(quest.type)}]`,
      13,
      0xb4b4b4,
      { rawColor: true },
    );
    typeText.x = this.panelWidth - 120;
    typeText.y = 10;
    typeText.eventMode = "none";
    card.addChild(typeText);

    // A local courier run («Местный подряд») has only a COLLECT_ITEM objective —
    // no VISIT objective to host the "→ Лететь к цели" button — yet its goods go
    // to a concrete NEIGHBOUR planet (`targetPlanetId`). Resolve that destination
    // so the cargo objective can offer a route to the neighbour. Cross-system
    // deliveries already route via their own VISIT_LOCATION objective, so skip
    // those (they keep the existing per-objective button).
    const hasVisitObjective = quest.objectives.some(
      (o) => o.type === "VISIT_LOCATION" || o.type === "VISIT_SYSTEM",
    );
    const courierDest = hasVisitObjective
      ? null
      : this.activeDestination(quest);
    const courierNavId = courierDest ? this.routeNavId(courierDest) : null;

    // Objectives
    let objY = 35;
    for (const objective of quest.objectives) {
      // For COLLECT_ITEM objectives use live cargo count from the resolver
      // (production never emits COLLECT_ITEM progress events, so currentAmount
      // stays frozen at 0 without this).
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
      const objText = scaledText(
        `${completedOrReady ? "✓" : "○"} ${objective.description}: ${displayAmount}/${objective.targetAmount}${suffix}`,
        13,
        completedOrReady ? 0x00ff00 : 0xaaaaaa,
        { rawColor: true },
      );
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
              : objective.type === "COLLECT_ITEM" && courierNavId
                ? courierNavId
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
    const rewardText = scaledText(
      `Награда: ${parts.length ? parts.join(", ") : "—"}`,
      13,
      0xffcc66,
      { rawColor: true },
    );
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
        value: this.resolveName(quest.targetSystemId),
        color: 0x66ffcc,
      });
    }
    if (quest.planetId && quest.planetId !== "unknown") {
      // For text-adventure quests the issuer planet IS the completion planet.
      const planetLabel =
        quest.type === QuestType.TEXT_ADVENTURE ? "Планета" : "Выдан";
      questHighlights.push({
        label: planetLabel,
        value: this.resolveName(quest.planetId),
        color: quest.type === QuestType.TEXT_ADVENTURE ? 0x66ffcc : 0xaaaaaa,
      });
    }
    // Name the delivery NEIGHBOUR (a «Местный подряд» courier target) so the
    // player sees WHERE the goods go — distinct from the issuer ("Выдан"). Only
    // for the in-system courier case (cross-system deliveries already name their
    // target system above, and route via their VISIT_LOCATION objective).
    if (
      courierDest &&
      quest.targetPlanetId &&
      quest.targetPlanetId !== quest.planetId
    ) {
      questHighlights.push({
        label: "Куда",
        value: this.resolveName(quest.targetPlanetId),
        color: 0x66ffcc,
      });
    }
    if (questHighlights.length > 0) {
      const hTagSpacing = 150;
      let hx = 40;
      for (const hl of questHighlights) {
        if (hx > this.panelWidth - 60) break;
        const tagT = scaledText(`[${hl.label}: ${hl.value}]`, 11, hl.color, {
          rawColor: true,
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
        const daysLabel = scaledText(
          `⚠ осталось ${remaining} дн.`,
          13,
          0xffaa00,
          { rawColor: true, fontWeight: "bold" },
        );
        daysLabel.x = this.panelWidth - 180;
        daysLabel.y = objY + 2;
        daysLabel.eventMode = "none";
        card.addChild(daysLabel);
      }
    }

    return card;
  }

  /**
   * Resolve where an ACTIVE contract sends the goods — the concrete
   * `targetPlanetId` (a «Местный подряд» neighbour) within `targetSystemId`.
   * Returns the {@link questDestination} descriptor, or null when no galaxy is
   * wired (unit tests) or the quest names no concrete target planet — so the
   * caller falls back to system-level / no route.
   */
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

  /**
   * The id the route dispatch sends for a resolved destination: the planet id
   * when same-system + concrete (in-system approach), else the system id
   * (star-map warp) — mirrors {@link questRouteAction}, so the navigation seam
   * (`SpaceFlightScene.navigateToQuestObjective`) can resolve it.
   */
  private routeNavId(dest: QuestDestination): string {
    const action = questRouteAction(dest);
    return action.kind === "approach-planet"
      ? action.planetId
      : action.systemId;
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

  /**
   * Render "return to issuer" pending-reward section
   */
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

    const cardStep = 90;
    let yOffset = startY + 30;
    for (const quest of quests) {
      const card = this.createPendingReturnCard(quest, yOffset);
      this.container.addChild(card);
      yOffset += cardStep;
    }

    return yOffset;
  }

  /**
   * Resolve the destination a pending-return quest sends the player back to:
   * the issuer planet (`quest.planetId`) and the system that hosts it. Returns
   * the {@link questDestination} descriptor (system name + sameSystem, reused by
   * the plot-route button), or null when no galaxy is wired (unit tests) or the
   * issuer planet can't be located in it.
   */
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

  /**
   * Create a compact card for a pending-return quest
   */
  private createPendingReturnCard(quest: Quest, yPos: number): Container {
    const card = new Container();
    card.y = yPos;

    const bg = new Graphics();
    bg.rect(20, 0, this.panelWidth - 40, 80);
    bg.fill({ color: 0x1a1500, alpha: 0.9 });
    bg.stroke({ color: 0xffcc00, width: 1 });
    bg.eventMode = "none";
    card.addChild(bg);

    const titleText = scaledText(quest.title, 13, 0xffff88, {
      rawColor: true,
      fontWeight: "bold",
    });
    titleText.x = 30;
    titleText.y = 8;
    titleText.eventMode = "none";
    card.addChild(titleText);

    const typeText = scaledText(
      `[${questTypeLabel(quest.type)}]`,
      13,
      0xb4b4b4,
      { rawColor: true },
    );
    typeText.x = this.panelWidth - 120;
    typeText.y = 8;
    typeText.eventMode = "none";
    card.addChild(typeText);

    // Return-to-issuer prompt in yellow — name the system the issuer planet
    // sits in (so the player knows WHERE to fly, not just which planet).
    const issuerPlanetId =
      quest.planetId && quest.planetId !== "unknown"
        ? this.resolveName(quest.planetId)
        : "?";
    const dest = this.returnDestination(quest);
    const systemSuffix = dest ? ` — система ${dest.systemName}` : "";
    const returnText = scaledText(
      `↩ Вернитесь в ${issuerPlanetId}${systemSuffix}`,
      12,
      0xffcc00,
      { rawColor: true, fontWeight: "bold" },
    );
    returnText.x = 30;
    returnText.y = 30;
    returnText.eventMode = "none";
    card.addChild(returnText);

    // Reward summary
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
    rewardText.y = 50;
    rewardText.eventMode = "none";
    card.addChild(rewardText);

    // "Выдан: X" highlight rendered yellow (target color)
    if (quest.planetId && quest.planetId !== "unknown") {
      const issuedTag = scaledText(
        `[Выдан: ${this.resolveName(quest.planetId)}]`,
        11,
        0xffcc00,
        { rawColor: true },
      );
      issuedTag.x = this.panelWidth - 200;
      issuedTag.y = 50;
      issuedTag.eventMode = "none";
      card.addChild(issuedTag);
    }

    // «Проложить маршрут»: dispatch the pure route action onto the existing
    // flight routing seam (in-system planet approach vs. star-map warp). Only
    // shown when the destination resolves (galaxy wired + issuer planet found)
    // and a navigate hook is present — otherwise there is no target to route to.
    if (dest && this.onNavigateToObjective) {
      const routeBtn = this.createPlotRouteButton(dest);
      routeBtn.x = this.panelWidth - 175;
      routeBtn.y = 26;
      card.addChild(routeBtn);
    }

    return card;
  }

  /**
   * Build the «Проложить маршрут» (plot-route) button for a resolved
   * destination. On click it runs {@link questRouteAction} and dispatches the
   * chosen id to the existing `onNavigateToObjective` route hook:
   * - `approach-planet` → the planet id (the flight scene plots an in-system
   *   route to it);
   * - `warp-to-system` → the system id (the flight scene opens the star-map
   *   warp toward that system).
   * Both reuse `SpaceFlightScene.navigateToQuestObjective` — no new navigation.
   */
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

  /**
   * Render expired/failed quests section
   */
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

  /**
   * Render completed quests section
   */
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

    // Show count instead of full list to save space
    const completedText = scaledText(
      "Вы завершили несколько квестов!\nПродолжайте исследовать галактику.",
      12,
      0xb4b4b4,
      { rawColor: true },
    );
    completedText.x = 20;
    completedText.y = startY + 30;
    completedText.eventMode = "none";
    this.container.addChild(completedText);
  }

  /**
   * Create the contextual-help «?» button — opens the journal's help panel via
   * the injected `onShowHelp` hook (FlightHud mounts the shared HelpPanel).
   */
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

  /**
   * Clean up resources
   */
  destroy(): void {
    // Tear down the active-quests scroll region first so its window-level wheel
    // listener is detached (container.destroy alone cannot remove it). Pixi's
    // destroy is idempotent, so a later container.destroy({children:true}) won't
    // double-free the already-removed list container.
    if (this.activeList) {
      this.activeList.destroy();
      this.activeList = null;
    }
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
