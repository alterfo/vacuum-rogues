import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { RANK_LABELS } from "@/config/balance";
import { logger } from "@/utils/logger";

interface WinContext {
  gameEngine?: GameEngine;
}

export class WinScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private container: Container | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as WinContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;

    this.container = new Container();
    this.renderer.uiLayer.addChild(this.container);
    this.render();
    logger.info("WinScene initialized");
  }

  update(_dt: number): void {}

  destroy(): void {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.gameEngine = null;
  }

  private render(): void {
    if (!this.container) return;
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x000510, alpha: 1 });
    bg.eventMode = "static";
    this.container.addChild(bg);

    this.addText("ПОБЕДА!", w / 2, h * 0.18, 48, 0xffdd44, true, true);
    this.addText(
      "Вы заслужили легенду.",
      w / 2,
      h * 0.28,
      20,
      0xcccccc,
      false,
      true,
    );

    const player = this.gameEngine?.player;
    const galaxy = this.gameEngine?.galaxy;

    if (player && galaxy) {
      const rankName = RANK_LABELS[player.rank] ?? `Ранг ${player.rank}`;
      const days = galaxy.gameDays;

      const factions = [
        "BASTIONS",
        "SYNDICATE",
        "OUTLANDERS",
        "PROGRESSORS",
        "PARADOXES",
      ];
      const FACTION_RU: Record<string, string> = {
        OUTLANDERS: "Окраинники",
        BASTIONS: "Бастион",
        SYNDICATE: "Синдикат",
        PARADOXES: "Парадокс",
        PROGRESSORS: "Прогрессоры",
      };
      const repLines = factions
        .map((f) => {
          const rep = player.reputation[f] ?? 0;
          return `${FACTION_RU[f] ?? f}: ${rep >= 0 ? "+" : ""}${rep}`;
        })
        .join("   ");

      const stats = [
        `Ранг: ${rankName}`,
        `Кредиты: ${player.credits.toLocaleString("ru")} ₡`,
        `Дней в пути: ${days}`,
        `Репутация: ${repLines}`,
      ];

      let sy = h * 0.38;
      for (const line of stats) {
        this.addText(line, w / 2, sy, 16, 0x88ccff, false, true);
        sy += 32;
      }
    }

    const btn = this.makeButton(
      "В главное меню",
      w / 2 - 120,
      h * 0.78,
      240,
      40,
    );
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.goToMainMenu();
    });
    this.container.addChild(btn);
  }

  private goToMainMenu(): void {
    if (!this.gameEngine) return;
    this.gameEngine
      .transitionTo(SceneType.MAIN_MENU, { gameEngine: this.gameEngine })
      .catch((e) =>
        logger.error("WinScene: transition to main menu failed", e),
      );
  }

  private addText(
    text: string,
    x: number,
    y: number,
    size: number,
    color: number,
    bold: boolean,
    centered: boolean,
  ): void {
    if (!this.container) return;
    const t = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: size,
        fill: color,
        fontWeight: bold ? "bold" : "normal",
        align: centered ? "center" : "left",
      },
    });
    t.eventMode = "none";
    if (centered) {
      t.anchor.set(0.5, 0);
    }
    t.x = x;
    t.y = y;
    this.container.addChild(t);
  }

  private makeButton(
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x004422, alpha: 0.9 });
    bg.stroke({ color: 0x00ff88, width: 2 });
    btn.addChild(bg);

    const lbl = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ff88,
        fontWeight: "bold",
      },
    });
    lbl.anchor.set(0.5);
    lbl.x = w / 2;
    lbl.y = h / 2;
    lbl.eventMode = "none";
    btn.addChild(lbl);

    btn.on("pointerover", () => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: 0x006633, alpha: 1 });
      bg.stroke({ color: 0x00ffaa, width: 2 });
    });
    btn.on("pointerout", () => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: 0x004422, alpha: 0.9 });
      bg.stroke({ color: 0x00ff88, width: 2 });
    });

    return btn;
  }
}
