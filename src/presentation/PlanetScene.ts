import { GameScene } from "./GameScene";
import { Container, Graphics, Text } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";

interface PlanetContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

export class PlanetScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private uiContainer: Container | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  initialize(context?: object): void {
    const ctx = context as PlanetContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.createUI();
    logger.info(`PlanetScene: ${this.planet?.name}`);
  }

  update(_deltaTime: number): void {}

  destroy(): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.uiContainer = null;
    this.gameEngine = null;
    this.planet = null;
  }

  private createUI(): void {
    if (!this.planet) return;
    const ui = new Container();
    this.uiContainer = ui;
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x000510, alpha: 0.95 });
    this.renderer.gameLayer.addChild(bg);

    const planetGfx = new Graphics();
    planetGfx.circle(w / 2, h / 3, 60);
    planetGfx.fill({ color: this.planet.isHabitable ? 0x22aa44 : 0x888888 });
    this.renderer.gameLayer.addChild(planetGfx);

    const title = new Text({
      text: this.planet.name,
      style: {
        fontFamily: "Courier New",
        fontSize: 28,
        fill: 0x00ffff,
        fontWeight: "bold",
        align: "center",
      },
    });
    title.anchor.set(0.5);
    title.x = w / 2;
    title.y = h / 3 + 100;
    ui.addChild(title);

    const sub = new Text({
      text: `${this.getType(this.planet.type)} • ${this.planet.isHabitable ? "Обитаемая" : "Необитаемая"}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xaaaaaa,
        align: "center",
      },
    });
    sub.anchor.set(0.5);
    sub.x = w / 2;
    sub.y = h / 3 + 140;
    ui.addChild(sub);

    const buttons: { label: string; color: number; action: () => void }[] = [
      {
        label: "Губернатор",
        color: 0x00ff00,
        action: () => this.openGovernor(),
      },
      { label: "Гараж", color: 0x00aaff, action: () => this.openGarage() },
      { label: "Маркет", color: 0xffaa00, action: () => this.openMarket() },
      {
        label: "Исследования",
        color: 0xff00ff,
        action: () => this.openResearch(),
      },
      { label: "Взлёт", color: 0xff4444, action: () => this.takeOff() },
    ];

    const visible = this.planet.isHabitable
      ? buttons
      : buttons.filter((b) => b.label !== "Губернатор");
    let y = h / 2 + 40;
    for (const b of visible) {
      const t = new Text({
        text: `[ ${b.label} ]`,
        style: {
          fontFamily: "Courier New",
          fontSize: 18,
          fill: b.color,
          fontWeight: "bold",
        },
      });
      t.anchor.set(0.5);
      t.x = w / 2;
      t.y = y;
      t.eventMode = "static";
      t.cursor = "pointer";
      t.on("pointerdown", b.action);
      t.on("pointerover", () => {
        t.alpha = 0.7;
      });
      t.on("pointerout", () => {
        t.alpha = 1;
      });
      ui.addChild(t);
      y += 45;
    }

    this.renderer.uiLayer.addChild(ui);
  }

  private async openGovernor(): Promise<void> {
    if (!this.planet?.inhabitants[0] || !this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.DIALOGUE, {
      gameEngine: this.gameEngine,
      npc: this.planet.inhabitants[0],
      // Return to this planet (not space) when the conversation ends.
      returnScene: SceneType.PLANET,
      returnPlanet: this.planet,
    });
  }

  private openGarage(): void {
    if (!this.gameEngine?.player) return;
    const ship = this.gameEngine.player.ship;
    const missing = ship.maxHull - ship.hullHP;

    if (missing <= 0) {
      this.showMessage("Корпус уже в идеальном состоянии", 0x00ff88);
      return;
    }

    const cost = Math.ceil(missing * 2);
    if (this.gameEngine.player.credits < cost) {
      this.showMessage(
        `Недостаточно кредитов на ремонт (нужно ${cost})`,
        0xff5555,
      );
      return;
    }

    this.gameEngine.player.credits -= cost;
    ship.repair();
    logger.info(`Repaired for ${cost}`);
    this.showMessage(
      `Корпус восстановлен (+${missing}) за ${cost} кр.`,
      0x00ff88,
    );
  }

  private async openMarket(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.TRADE, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private openResearch(): void {
    // Research station is not implemented yet; give honest feedback instead of
    // silently swallowing the click.
    this.showMessage("Исследовательская станция пока в разработке", 0xffaa00);
  }

  private async takeOff(): Promise<void> {
    if (!this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
    });
  }

  /**
   * Show a transient feedback message near the bottom of the planet screen.
   */
  private showMessage(text: string, color: number): void {
    if (!this.uiContainer) return;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    const existing = this.uiContainer.getChildByLabel?.("planet-toast");
    if (existing) existing.destroy();

    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const toast = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: color,
        fontWeight: "bold",
        align: "center",
      },
    });
    toast.label = "planet-toast";
    toast.anchor.set(0.5);
    toast.x = w / 2;
    toast.y = h - 40;
    toast.eventMode = "none";
    this.uiContainer.addChild(toast);

    this.toastTimeout = setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
      this.toastTimeout = null;
    }, 3000);
  }

  private getType(type: string): string {
    const t: Record<string, string> = {
      TERRESTRIAL: "Земной",
      GAS_GIANT: "Газовый гигант",
      ICE: "Ледяной",
      VOLCANIC: "Вулканический",
      INDUSTRIAL: "Промышленный",
      HABITAT: "Обитаемый",
    };
    return t[type] ?? type;
  }
}
