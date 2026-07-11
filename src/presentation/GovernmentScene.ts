import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { StarSystem } from "@/domain/StarSystem";
import { SceneType, QuestType } from "@/types";
import { logger } from "@/utils/logger";
import { JobBoardPanel } from "./JobBoardPanel";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { factionColor as resolveFactionColor } from "./ui/palette";
import { Faction } from "@/types/faction";
import { factionDisplayLabel } from "@/config/factionConfig";
import {
  governorOfferLine,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";
import { getRepLabel, getRepColor } from "@/utils/reputationUtils";

interface GovernmentContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

// Reputation tier thresholds matching PlanetScene / Player logic
export type RepTier = "hostile" | "neutral" | "ally";

export function getRepTier(rep: number): RepTier {
  if (rep < -30) return "hostile";
  if (rep > 0) return "ally";
  return "neutral";
}

const DIALOGUE_LINES: Record<RepTier, string[]> = {
  hostile: [
    "Убирайтесь с моей планеты.",
    "Ваше присутствие здесь нежелательно.",
    "Мы следим за каждым вашим шагом.",
    "Считайте это последним предупреждением.",
  ],
  neutral: [
    "Добро пожаловать на нашу планету.",
    "Мы предлагаем широкий спектр услуг для путешественников.",
    "Если вам нужна помощь — обратитесь к представителям администрации.",
    "Торговля и порядок — наши приоритеты.",
    "Ваша репутация пока ничем не примечательна.",
  ],
  ally: [
    "Рады видеть вас снова, капитан!",
    "Наши ресурсы в вашем распоряжении.",
    "Вы верный друг нашей фракции.",
    "Особые задания доступны вам в первую очередь.",
    "Честь служить вместе с вами.",
  ],
};

export function getDialogueLines(tier: RepTier): string[] {
  return DIALOGUE_LINES[tier];
}

const ECONOMY_RU: Record<string, string> = {
  AGRICULTURAL: "Аграрная",
  INDUSTRIAL: "Промышленная",
  MIXED: "Смешанная",
};

const POLITICAL_RU: Record<string, string> = {
  ANARCHY: "Анархия",
  DICTATORSHIP: "Диктатура",
  MONARCHY: "Монархия",
  REPUBLIC: "Республика",
  DEMOCRACY: "Демократия",
};

function deterministicPopulation(planetId: string): number {
  let hash = 0;
  for (let i = 0; i < planetId.length; i++) {
    hash = (hash * 31 + planetId.charCodeAt(i)) >>> 0;
  }
  return 100_000 + (hash % 9_900_000);
}

export class GovernmentScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private uiContainer: Container | null = null;
  private jobBoardPanel: JobBoardPanel | null = null;
  private toastTimers: ReturnType<typeof setTimeout>[] = [];
  /** Teardown for the contextual-help layer (first-time hint + «?» button). */
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as GovernmentContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.buildUI();
    this.mountHelp();
    logger.info(`GovernmentScene: ${this.planet?.name ?? "unknown"}`);
  }

  /**
   * Wire contextual help (first-time auto-hint + always-available «?» reopen).
   * Mounted on `renderer.stage` so it sits above the panel and survives the
   * scene's UI rebuilds.
   */
  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "GOVERNMENT",
    );
  }

  update(_dt: number): void {}

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    this.closeJobBoard();
    for (const t of this.toastTimers) clearTimeout(t);
    this.toastTimers = [];
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.uiContainer = null;
    this.gameEngine = null;
    this.planet = null;
  }

  private buildUI(): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x000510, alpha: 0.97 });
    this.renderer.gameLayer.addChild(bg);

    const ui = new Container();
    this.uiContainer = ui;

    const system = this.findSystem();
    const faction = system?.ownerFaction ?? "INDEPENDENT";
    const factionName = factionDisplayLabel(faction);
    const factionColor = resolveFactionColor(faction as Faction);
    const economyLabel = ECONOMY_RU[system?.economyType ?? ""] ?? "—";
    const politicalLabel = POLITICAL_RU[system?.politicalSystem ?? ""] ?? "—";
    const population = this.planet
      ? deterministicPopulation(this.planet.id)
      : 0;

    const rep = this.gameEngine?.player?.getReputation(faction) ?? 0;
    const tier = getRepTier(rep);
    const repLabel = getRepLabel(rep);
    const repColor = getRepColor(rep);

    let y = h * 0.07;

    // Heading: planet name
    const titleText = new Text({
      text: `Губернатор: ${this.planet?.name ?? "Неизвестно"}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 26,
        fill: factionColor,
        fontWeight: "bold",
        align: "center",
      },
    });
    titleText.anchor.set(0.5, 0);
    titleText.x = w / 2;
    titleText.y = y;
    titleText.eventMode = "none";
    ui.addChild(titleText);
    y += 46;

    // Separator
    const sep = new Graphics();
    sep.rect(w * 0.15, y, w * 0.7, 1);
    sep.fill({ color: factionColor, alpha: 0.4 });
    ui.addChild(sep);
    y += 12;

    // Info block
    const infoLines: Array<{ label: string; value: string; color: number }> = [
      { label: "Фракция:", value: factionName, color: factionColor },
      { label: "Экономика:", value: economyLabel, color: 0x88ccff },
      { label: "Политика:", value: politicalLabel, color: 0xffcc88 },
      {
        label: "Население:",
        value: population.toLocaleString("ru"),
        color: 0xcccccc,
      },
      {
        label: "Репутация:",
        value: `${repLabel} (${rep >= 0 ? "+" : ""}${rep})`,
        color: repColor,
      },
    ];

    for (const { label, value, color } of infoLines) {
      const row = new Container();

      const lbl = new Text({
        text: label,
        style: { fontFamily: "Courier New", fontSize: 14, fill: 0x889aaa },
      });
      lbl.eventMode = "none";
      lbl.x = w * 0.2;
      lbl.y = 0;
      row.addChild(lbl);

      const val = new Text({
        text: value,
        style: {
          fontFamily: "Courier New",
          fontSize: 14,
          fill: color,
          fontWeight: "bold",
        },
      });
      val.eventMode = "none";
      val.x = w * 0.2 + 160;
      val.y = 0;
      row.addChild(val);

      row.y = y;
      ui.addChild(row);
      y += 24;
    }

    y += 16;

    // Dialogue lines panel
    const lines = getDialogueLines(tier);
    const panelH = lines.length * 22 + 24;
    const panelBg = new Graphics();
    panelBg.rect(w * 0.15, y, w * 0.7, panelH);
    panelBg.fill({ color: 0x08101e, alpha: 0.9 });
    panelBg.stroke({ color: factionColor, width: 1, alpha: 0.3 });
    ui.addChild(panelBg);

    const dialogueHeader = new Text({
      text: `[ ${factionName} — Губернатор ]`,
      style: {
        fontFamily: "Courier New",
        fontSize: 12,
        fill: factionColor,
        fontWeight: "bold",
      },
    });
    dialogueHeader.eventMode = "none";
    dialogueHeader.x = w * 0.15 + 10;
    dialogueHeader.y = y + 6;
    ui.addChild(dialogueHeader);

    let dlgY = y + 26;
    for (const line of lines) {
      const dlgText = new Text({
        text: `» ${line}`,
        style: { fontFamily: "Courier New", fontSize: 13, fill: 0xddeeff },
      });
      dlgText.eventMode = "none";
      dlgText.x = w * 0.15 + 14;
      dlgText.y = dlgY;
      ui.addChild(dlgText);
      dlgY += 22;
    }

    y += panelH + 24;

    // Governor's first-person quest offers (Task 7): the same quests the board
    // lists, but framed as in-character dialogue with an inline accept button.
    y = this.addGovernorOffers(ui, w, y, factionColor);

    // Job board button
    this.addButton(ui, "[ Доска заданий ]", w / 2, y, 0xffee66, () =>
      this.openJobBoard(),
    );
    y += 44;

    // Back button
    this.addButton(ui, "[ Назад ]", w / 2, y, 0xb4b4b4, () => this.goBack());

    this.renderer.uiLayer.addChild(ui);
  }

  /**
   * Render up to 3 of the planet's available quests as first-person governor
   * dialogue offers (Task 7), each with an inline "Взять" button. The full board
   * remains reachable via the "Доска заданий" button below. Returns the next y.
   */
  private addGovernorOffers(
    ui: Container,
    w: number,
    topY: number,
    factionColor: number,
  ): number {
    if (!this.gameEngine || !this.planet) return topY;
    const quests = this.gameEngine.getQuestBoard(this.planet.id).slice(0, 3);
    if (quests.length === 0) return topY;

    let y = topY;
    const header = new Text({
      text: "Губернатор предлагает:",
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fill: factionColor,
        fontWeight: "bold",
      },
    });
    header.eventMode = "none";
    header.x = w * 0.15;
    header.y = y;
    ui.addChild(header);
    y += 24;

    for (const q of quests) {
      const line = governorOfferLine(q);
      const truncated = line.length > 64 ? line.slice(0, 63) + "…»" : line;
      const offer = new Text({
        text: `» ${truncated}`,
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: 0xddeeff,
          wordWrap: true,
          wordWrapWidth: w * 0.5,
        },
      });
      offer.eventMode = "none";
      offer.x = w * 0.15 + 6;
      offer.y = y;
      ui.addChild(offer);

      // Inline accept button on the right of the offer line.
      this.addButton(ui, "[ Взять ]", w * 0.82, y + 8, 0x00ff88, () =>
        this.acceptJob(q),
      );
      y += 32;
    }
    return y + 8;
  }

  private addButton(
    parent: Container,
    label: string,
    cx: number,
    cy: number,
    color: number,
    onClick: () => void,
  ): void {
    const t = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: color,
        fontWeight: "bold",
      },
    });
    t.anchor.set(0.5);
    t.x = cx;
    t.y = cy;
    t.eventMode = "static";
    t.cursor = "pointer";
    t.on("pointerdown", (e) => {
      e.stopPropagation();
      onClick();
    });
    t.on("pointerover", () => {
      t.alpha = 0.7;
    });
    t.on("pointerout", () => {
      t.alpha = 1;
    });
    parent.addChild(t);
  }

  private openJobBoard(): void {
    if (!this.gameEngine || !this.planet) {
      this.showToast("Заданий нет", 0xffaa44);
      return;
    }
    this.closeJobBoard();
    const quests = this.gameEngine.getQuestBoard(this.planet.id);
    const { width, height } = this.renderer.app.screen;
    const activeQuests = this.gameEngine.questManager.getActiveQuests();
    const activeCount = activeQuests.length;
    const currentDay = this.gameEngine.galaxy?.gameDays ?? 0;
    const acceptedIds = new Set<string>([
      ...activeQuests.map((q) => q.id),
      ...this.gameEngine.questManager.getCompletedQuestIds(),
    ]);
    this.jobBoardPanel = new JobBoardPanel(
      quests,
      width,
      height,
      {
        onAccept: (q) => this.acceptJob(q),
        onClose: () => this.closeJobBoard(),
      },
      activeCount,
      acceptedIds,
      activeQuests,
      currentDay,
    );
    this.renderer.uiLayer.addChild(this.jobBoardPanel.container);
  }

  private acceptJob(q: GeneratedQuest): void {
    if (!this.gameEngine || !this.planet) return;

    if (q.template.type === QuestType.TEXT_ADVENTURE) {
      // scriptId is stored in targetObjectId; fall back to template id for legacy entries
      const scriptId = q.template.targetObjectId ?? q.template.id;
      const accepted = this.gameEngine.acceptBoardQuest(q, this.planet.id);
      this.closeJobBoard();
      this.gameEngine
        .startTextQuest(
          scriptId,
          undefined,
          SceneType.GOVERNMENT,
          {
            gameEngine: this.gameEngine,
            planet: this.planet,
          },
          accepted?.id,
        )
        .catch((e) =>
          logger.error("GovernmentScene: text quest transition failed", e),
        );
      return;
    }

    const accepted = this.gameEngine.acceptBoardQuest(q, this.planet.id);
    if (accepted) {
      this.showToast(`Задание принято: ${q.template.title}`, 0x00ff88);
      this.openJobBoard(); // refresh board
    } else {
      this.showToast("Не удалось принять задание", 0xffaa00);
    }
  }

  private closeJobBoard(): void {
    const panel = this.jobBoardPanel;
    this.jobBoardPanel = null;
    if (panel) {
      this.renderer?.uiLayer?.removeChild(panel.container);
      panel.destroy();
    }
  }

  private async goBack(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private showToast(text: string, color: number): void {
    const existing = this.uiContainer?.getChildByLabel?.("gov-toast");
    if (existing) existing.destroy();

    const toast = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 15,
        fill: color,
        fontWeight: "bold",
        align: "center",
      },
    });
    toast.label = "gov-toast";
    toast.anchor.set(0.5);
    toast.x = this.renderer.app.screen.width / 2;
    toast.y = this.renderer.app.screen.height - 40;
    toast.eventMode = "none";
    this.uiContainer?.addChild(toast);

    const handle = setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
      this.toastTimers = this.toastTimers.filter((t) => t !== handle);
    }, 2500);
    this.toastTimers.push(handle);
  }

  private findSystem(): StarSystem | undefined {
    if (!this.gameEngine?.galaxy || !this.planet) return undefined;
    return this.gameEngine.galaxy.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
  }
}
