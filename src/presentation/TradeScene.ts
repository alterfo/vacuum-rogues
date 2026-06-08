import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType, ResourceType } from "@/types";
import { TradeSystem } from "@/systems/TradeSystem";
import { logger } from "@/utils/logger";
import { GAME_BALANCE } from "@/config/balance";

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
  /** Per-resource quantity selector state (persists across refresh). */
  private readonly tradeQty = new Map<ResourceType, number>();
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

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
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
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
    backdrop.eventMode = "static";
    this.mainContainer.addChild(backdrop);

    const panelW = 800;
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
    this.addText("Ресурс", panelX + 20, top, 12, 0xaaaaaa);
    this.addText("Покупка", panelX + 195, top, 12, 0xaaaaaa);
    this.addText("Продажа", panelX + 280, top, 12, 0xaaaaaa);
    this.addText("В трюме", panelX + 365, top, 12, 0xaaaaaa);
    this.addText("Кол-во", panelX + 445, top, 12, 0xaaaaaa);

    const player = this.gameEngine.player;
    const totalCargo = player.inventory.resources.reduce(
      (sum, r) => sum + r.amount,
      0,
    );
    const cargoCapacity = player.ship.cargoCapacity;
    const freeHold = Math.max(0, cargoCapacity - totalCargo);

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

      // Qty caps
      const maxBuyQty = Math.max(
        1,
        Math.min(
          buyPrice > 0 ? Math.floor(player.credits / buyPrice) : 99,
          freeHold,
        ),
      );
      const maxSellQty = Math.max(1, owned);
      const qty = Math.max(
        1,
        Math.min(
          this.tradeQty.get(resource) ?? 1,
          Math.max(maxBuyQty, maxSellQty),
        ),
      );
      this.tradeQty.set(resource, qty);

      this.addText(
        TradeScene.RESOURCE_NAMES[resource] ?? resource,
        panelX + 20,
        y,
        13,
        0xffffff,
      );
      this.addText(`${buyPrice}`, panelX + 195, y, 13, 0xffcc66);
      this.addText(`${sellPrice}`, panelX + 280, y, 13, 0x66ccff);
      this.addText(
        `${owned}`,
        panelX + 365,
        y,
        13,
        owned > 0 ? 0x00ff88 : 0xaaaaaa,
      );

      // Quantity selector: [-] qty [+] [Макс]
      const maxQty = Math.max(maxBuyQty, maxSellQty);
      this.addQtySelector(resource, qty, maxQty, panelX + 440, y - 2);

      // Deal indicators: compare current price against base (galaxy average)
      const basePrice = this.tradeSystem.getBasePrice(resource);
      const threshold = GAME_BALANCE.tradeDealThreshold;
      const isBuyDeal = buyPrice < basePrice * (1 - threshold);
      const isSellDeal = sellPrice > basePrice * (1 + threshold);

      // Buy button
      const buyBtn = this.createButton(
        "Купить",
        panelX + 558,
        y - 4,
        80,
        24,
        0x004488,
      );
      buyBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        this.trade(resource, true);
      });
      if (isBuyDeal) {
        const star = new Text({
          text: "★",
          style: { fontFamily: "Courier New", fontSize: 10, fill: 0x00ff44 },
        });
        star.x = 72;
        star.y = 1;
        star.eventMode = "none";
        buyBtn.addChild(star);
      }
      this.mainContainer!.addChild(buyBtn);

      // Sell button — disabled when owned === 0
      const canSell = owned > 0;
      const sellBtn = this.createButton(
        "Продать",
        panelX + 648,
        y - 4,
        80,
        24,
        canSell ? 0x884400 : 0x222222,
      );
      if (canSell) {
        sellBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.trade(resource, false);
        });
        sellBtn.cursor = "pointer";
        if (isSellDeal) {
          const star = new Text({
            text: "★",
            style: { fontFamily: "Courier New", fontSize: 10, fill: 0xffcc00 },
          });
          star.x = 72;
          star.y = 1;
          star.eventMode = "none";
          sellBtn.addChild(star);
        }
      } else {
        sellBtn.cursor = "default";
        sellBtn.eventMode = "none";
      }
      this.mainContainer!.addChild(sellBtn);

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
      "[Esc] — выход",
      panelX + 20,
      panelY + panelH - 38,
      11,
      0x777777,
    );
  }

  private addQtySelector(
    resource: ResourceType,
    qty: number,
    maxQty: number,
    x: number,
    y: number,
  ): void {
    if (!this.mainContainer) return;

    const btnW = 22;
    const btnH = 22;

    // [-] button
    const minusBtn = new Container();
    minusBtn.x = x;
    minusBtn.y = y;
    minusBtn.eventMode = "static";
    minusBtn.cursor = "pointer";
    const minusBg = new Graphics();
    minusBg.rect(0, 0, btnW, btnH);
    minusBg.fill({ color: 0x332200, alpha: 0.9 });
    minusBg.stroke({ color: 0x996600, width: 1 });
    minusBtn.addChild(minusBg);
    const minusLbl = new Text({
      text: "−",
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0xffcc44 },
    });
    minusLbl.anchor.set(0.5);
    minusLbl.x = btnW / 2;
    minusLbl.y = btnH / 2;
    minusLbl.eventMode = "none";
    minusBtn.addChild(minusLbl);
    minusBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      const cur = this.tradeQty.get(resource) ?? 1;
      this.tradeQty.set(resource, Math.max(1, cur - 1));
      this.refresh();
    });
    this.mainContainer.addChild(minusBtn);

    // qty label
    const qtyLbl = new Text({
      text: String(qty),
      style: { fontFamily: "Courier New", fontSize: 13, fill: 0xffffff },
    });
    qtyLbl.anchor.set(0.5, 0);
    qtyLbl.x = x + btnW + 18;
    qtyLbl.y = y + 2;
    qtyLbl.eventMode = "none";
    this.mainContainer.addChild(qtyLbl);

    // [+] button
    const plusBtn = new Container();
    plusBtn.x = x + btnW + 36;
    plusBtn.y = y;
    plusBtn.eventMode = "static";
    plusBtn.cursor = "pointer";
    const plusBg = new Graphics();
    plusBg.rect(0, 0, btnW, btnH);
    plusBg.fill({ color: 0x002233, alpha: 0.9 });
    plusBg.stroke({ color: 0x006699, width: 1 });
    plusBtn.addChild(plusBg);
    const plusLbl = new Text({
      text: "+",
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0x44ccff },
    });
    plusLbl.anchor.set(0.5);
    plusLbl.x = btnW / 2;
    plusLbl.y = btnH / 2;
    plusLbl.eventMode = "none";
    plusBtn.addChild(plusLbl);
    plusBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      const cur = this.tradeQty.get(resource) ?? 1;
      this.tradeQty.set(resource, cur + 1);
      this.refresh();
    });
    this.mainContainer.addChild(plusBtn);

    // [Макс] button — sets qty to maximum affordable/holdable amount
    const maxBtn = new Container();
    maxBtn.x = x + btnW + 36 + btnW + 4;
    maxBtn.y = y;
    maxBtn.eventMode = "static";
    maxBtn.cursor = "pointer";
    const maxBg = new Graphics();
    maxBg.rect(0, 0, 28, btnH);
    maxBg.fill({ color: 0x1a1a44, alpha: 0.9 });
    maxBg.stroke({ color: 0x4444aa, width: 1 });
    maxBtn.addChild(maxBg);
    const maxLbl = new Text({
      text: "М",
      style: { fontFamily: "Courier New", fontSize: 12, fill: 0x8888ff },
    });
    maxLbl.anchor.set(0.5);
    maxLbl.x = 14;
    maxLbl.y = btnH / 2;
    maxLbl.eventMode = "none";
    maxBtn.addChild(maxLbl);
    maxBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.tradeQty.set(resource, maxQty);
      this.refresh();
    });
    maxBtn.on("pointerover", () => {
      maxBg.clear();
      maxBg.rect(0, 0, 28, btnH);
      maxBg.fill({ color: 0x2a2a66, alpha: 1.0 });
      maxBg.stroke({ color: 0x6666cc, width: 1 });
    });
    maxBtn.on("pointerout", () => {
      maxBg.clear();
      maxBg.rect(0, 0, 28, btnH);
      maxBg.fill({ color: 0x1a1a44, alpha: 0.9 });
      maxBg.stroke({ color: 0x4444aa, width: 1 });
    });
    this.mainContainer.addChild(maxBtn);
  }

  private trade(resource: ResourceType, isBuy: boolean): void {
    if (!this.gameEngine || !this.gameEngine.player || !this.planet) return;
    const qty = this.tradeQty.get(resource) ?? 1;
    let toast: { message: string; color: number };
    try {
      const result = this.tradeSystem.executeTrade(
        this.gameEngine.player,
        this.planet,
        resource,
        qty,
        isBuy,
      );
      const name = TradeScene.RESOURCE_NAMES[resource] ?? resource;
      if (result.success) {
        const verb = isBuy ? "Куплено" : "Продано";
        toast = {
          message: `${verb}: ${qty}×${name} за ${result.finalPrice} кр.`,
          color: 0x00ff88,
        };
        this.gameEngine?.audio.playSfx("buy").catch(() => {});
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
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
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
    this.toastTimeout = setTimeout(() => {
      this.toastTimeout = null;
      if (!toast.destroyed) toast.destroy();
    }, 3000);
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

  /** E2E helper: buy qty units of resource; returns true if all purchases succeeded */
  e2eBuyItem(resource: ResourceType, qty: number): boolean {
    for (let i = 0; i < qty; i++) {
      this.trade(resource, true);
    }
    return (this.gameEngine?.player?.credits ?? 0) >= 0;
  }
}
