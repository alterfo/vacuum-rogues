import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType, ResourceType } from "@/types";
import { TradeSystem } from "@/systems/TradeSystem";
import { logger } from "@/utils/logger";

interface TradeContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

/**
 * Trade Scene - buy and sell resources at a planet's market.
 * Reached from PlanetScene via the "Маркет" button. Uses TradeSystem for
 * pricing and transaction logic; returns to the originating planet on close.
 */
export class TradeScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private readonly tradeSystem = new TradeSystem();
  private mainContainer: Container | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  private static readonly RESOURCE_NAMES: Record<string, string> = {
    FUEL: "Топливо",
    METALS: "Металлы",
    CRYSTALS: "Кристаллы",
    ORGANICS: "Органика",
    ARTIFACTS: "Артефакты",
    WEAPONS: "Оружие",
    MEDICINE: "Медикаменты",
    ELECTRONICS: "Электроника",
    LUXURY: "Роскошь",
    DATA_CORES: "Ядра данных",
  };

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as TradeContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;

    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);
    this.render();

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    logger.info(`TradeScene initialized at ${this.planet?.name ?? "unknown"}`);
  }

  update(_deltaTime: number): void {}

  destroy(): void {
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }
    this.renderer.clearGameLayer();
    this.gameEngine = null;
    this.planet = null;
    logger.info("TradeScene destroyed");
  }

  private render(): void {
    if (
      !this.mainContainer ||
      !this.gameEngine ||
      !this.gameEngine.player ||
      !this.planet
    )
      return;

    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, screenW, screenH);
    backdrop.fill({ color: 0x000000, alpha: 0.85 });
    backdrop.eventMode = "static"; // block clicks behind the panel
    this.mainContainer.addChild(backdrop);

    const panelW = 760;
    const panelH = 600;
    const panelX = (screenW - panelW) / 2;
    const panelY = (screenH - panelH) / 2;

    const panel = new Graphics();
    panel.rect(panelX, panelY, panelW, panelH);
    panel.fill({ color: 0x1a1a2e, alpha: 0.98 });
    panel.stroke({ color: 0xffaa00, width: 3 });
    this.mainContainer.addChild(panel);

    this.addText(
      `МАРКЕТ — ${this.planet.name}`,
      panelX + 20,
      panelY + 15,
      20,
      0xffaa00,
      true,
    );
    this.addText(
      `Кредиты: ${this.gameEngine.player.credits}`,
      panelX + panelW - 240,
      panelY + 18,
      16,
      0x00ff88,
      true,
    );

    // Column headers
    const top = panelY + 55;
    this.addText("Ресурс", panelX + 20, top, 12, 0x888888);
    this.addText("Покупка", panelX + 230, top, 12, 0x888888);
    this.addText("Продажа", panelX + 330, top, 12, 0x888888);
    this.addText("В трюме", panelX + 430, top, 12, 0x888888);

    const player = this.gameEngine.player;

    let y = top + 28;
    for (const resource of Object.values(ResourceType)) {
      const buyPrice = this.tradeSystem.getBuyPrice(
        this.planet,
        resource,
        player,
      );
      const sellPrice = this.tradeSystem.getSellPrice(
        this.planet,
        resource,
        player,
      );
      const owned =
        player.inventory.resources.find((r) => r.type === resource)?.amount ??
        0;

      this.addText(
        TradeScene.RESOURCE_NAMES[resource] ?? resource,
        panelX + 20,
        y,
        13,
        0xffffff,
      );
      this.addText(`${buyPrice}`, panelX + 230, y, 13, 0xffcc66);
      this.addText(`${sellPrice}`, panelX + 330, y, 13, 0x66ccff);
      this.addText(
        `${owned}`,
        panelX + 430,
        y,
        13,
        owned > 0 ? 0x00ff88 : 0x666666,
      );

      const buyBtn = this.createButton(
        "Купить",
        panelX + 510,
        y - 4,
        90,
        24,
        0x004488,
      );
      buyBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        this.trade(resource, true);
      });
      this.mainContainer.addChild(buyBtn);

      const sellBtn = this.createButton(
        "Продать",
        panelX + 615,
        y - 4,
        90,
        24,
        0x884400,
      );
      sellBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        this.trade(resource, false);
      });
      this.mainContainer.addChild(sellBtn);

      y += 44;
    }

    // Close / leave button
    const closeBtn = this.createButton(
      "Покинуть маркет",
      panelX + panelW - 200,
      panelY + panelH - 45,
      180,
      30,
      0x660000,
    );
    closeBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.close();
    });
    this.mainContainer.addChild(closeBtn);

    this.addText(
      "1 единица за нажатие • [Esc] — выход",
      panelX + 20,
      panelY + panelH - 38,
      11,
      0x777777,
    );
  }

  private trade(resource: ResourceType, isBuy: boolean): void {
    if (!this.gameEngine || !this.gameEngine.player || !this.planet) return;
    let toast: { message: string; color: number };
    try {
      const result = this.tradeSystem.executeTrade(
        this.gameEngine.player,
        this.planet,
        resource,
        1,
        isBuy,
      );
      const name = TradeScene.RESOURCE_NAMES[resource] ?? resource;
      if (result.success) {
        const verb = isBuy ? "Куплено" : "Продано";
        toast = {
          message: `${verb}: ${name} за ${result.finalPrice} кр.`,
          color: 0x00ff88,
        };
        if (isBuy) {
          this.markContrabandIfIllegal(resource);
        } else {
          this.unmarkContrabandIfSold(resource);
        }
      } else {
        toast = {
          message: this.localizeMessage(result.message),
          color: 0xff5555,
        };
      }
    } catch (error) {
      logger.error("Trade failed:", error);
      toast = { message: "Сделка не удалась", color: 0xff5555 };
    }
    // Rebuild the panel with updated prices/balances first, then show the
    // feedback toast on top of the fresh container so it isn't wiped.
    this.refresh();
    this.showToast(toast.message, toast.color);
  }

  private localizeMessage(message: string | undefined): string {
    switch (message) {
      case "Insufficient credits.":
        return "Недостаточно кредитов";
      case "Not enough resources to sell.":
        return "Нечего продавать";
      default:
        return message ?? "Сделка не удалась";
    }
  }

  private refresh(): void {
    if (!this.mainContainer) return;
    this.mainContainer.destroy({ children: true });
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);
    this.render();
  }

  private showToast(message: string, color: number): void {
    if (!this.mainContainer) return;
    const screenW = this.renderer.app.screen.width;
    const toast = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: color,
        fontWeight: "bold",
      },
    });
    toast.anchor.set(0.5, 0);
    toast.x = screenW / 2;
    toast.y = 30;
    toast.eventMode = "none";
    this.mainContainer.addChild(toast);
    // Toast persists until the next refresh, which rebuilds the container.
  }

  private markContrabandIfIllegal(resource: ResourceType): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const system = this.gameEngine.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    if (!system) return;
    const illegal = !this.tradeSystem.isLegal(resource, system.politicalSystem);
    if (illegal) {
      const player = this.gameEngine.player;
      if (!player.contrabandGoods.includes(resource as string)) {
        player.contrabandGoods.push(resource as string);
      }
    }
  }

  private unmarkContrabandIfSold(resource: ResourceType): void {
    if (!this.gameEngine?.player) return;
    const stack = this.gameEngine.player.inventory.resources.find(
      (r) => r.type === resource,
    );
    if (!stack || stack.amount === 0) {
      const player = this.gameEngine.player;
      player.contrabandGoods = player.contrabandGoods.filter(
        (g) => g !== (resource as string),
      );
    }
  }

  private async close(): Promise<void> {
    if (!this.gameEngine) return;
    logger.info("Leaving market");
    await this.gameEngine.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.close();
    }
  }

  private addText(
    text: string,
    x: number,
    y: number,
    size: number,
    color: number,
    bold = false,
  ): void {
    if (!this.mainContainer) return;
    const t = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: size,
        fill: color,
        fontWeight: bold ? "bold" : "normal",
      },
    });
    t.x = x;
    t.y = y;
    t.eventMode = "none"; // labels never intercept clicks
    this.mainContainer.addChild(t);
  }

  private createButton(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    bgColor: number,
  ): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";

    const bg = new Graphics();
    bg.rect(0, 0, width, height);
    bg.fill({ color: bgColor, alpha: 0.9 });
    bg.stroke({ color: 0x00ffff, width: 1 });
    btn.addChild(bg);

    const label = new Text({
      text,
      style: { fontFamily: "Courier New", fontSize: 12, fill: 0xffffff },
    });
    label.anchor.set(0.5);
    label.x = width / 2;
    label.y = height / 2;
    label.eventMode = "none";
    btn.addChild(label);

    btn.on("pointerover", () => {
      bg.clear();
      bg.rect(0, 0, width, height);
      bg.fill({ color: bgColor, alpha: 1.0 });
      bg.stroke({ color: 0x00ffff, width: 2 });
    });
    btn.on("pointerout", () => {
      bg.clear();
      bg.rect(0, 0, width, height);
      bg.fill({ color: bgColor, alpha: 0.9 });
      bg.stroke({ color: 0x00ffff, width: 1 });
    });

    return btn;
  }
}
