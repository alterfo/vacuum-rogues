import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { StarSystem } from "@/domain/StarSystem";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";

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

const FACTION_RU: Record<string, string> = {
  OUTLANDERS: "Окраинники",
  BASTIONS: "Бастион",
  SYNDICATE: "Синдикат",
  PARADOXES: "Парадокс",
  PROGRESSORS: "Прогрессоры",
  INDEPENDENT: "Независимая",
  OVERMIND: "Сверхразум",
};

const FACTION_COLOR: Record<string, number> = {
  OUTLANDERS: 0xff6600,
  BASTIONS: 0xcc2222,
  SYNDICATE: 0x22cc22,
  PARADOXES: 0xaa22cc,
  PROGRESSORS: 0x2266ff,
  INDEPENDENT: 0x999999,
  OVERMIND: 0xff22cc,
};

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
    logger.info(`GovernmentScene: ${this.planet?.name ?? "unknown"}`);
  }

  update(_dt: number): void {}

  destroy(): void {
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
    const factionName = FACTION_RU[faction] ?? faction;
    const factionColor = FACTION_COLOR[faction] ?? 0x999999;
    const economyLabel = ECONOMY_RU[system?.economyType ?? ""] ?? "—";
    const politicalLabel = POLITICAL_RU[system?.politicalSystem ?? ""] ?? "—";
    const population = this.planet
      ? deterministicPopulation(this.planet.id)
      : 0;

    const rep = this.gameEngine?.player?.getReputation(faction) ?? 0;
    const tier = getRepTier(rep);
    const repLabel =
      tier === "hostile" ? "Враг" : tier === "ally" ? "Союзник" : "Нейтрал";
    const repColor =
      tier === "hostile" ? 0xff4444 : tier === "ally" ? 0x00ff88 : 0xaaaaaa;

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

    // Quests button
    this.addButton(ui, "[ Задания ]", w / 2, y, 0xffee66, () =>
      this.openQuests(),
    );
    y += 44;

    // Back button
    this.addButton(ui, "[ Назад ]", w / 2, y, 0x888888, () => this.goBack());

    this.renderer.uiLayer.addChild(ui);
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

  private openQuests(): void {
    // Job board is wired from PlanetScene — show stub until Task 16
    this.showToast("Заданий нет", 0xffaa44);
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

    setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
    }, 2500);
  }

  private findSystem(): StarSystem | undefined {
    if (!this.gameEngine?.galaxy || !this.planet) return undefined;
    return this.gameEngine.galaxy.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
  }
}
