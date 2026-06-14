import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { gearById, type Gear } from "@/systems/equipment/GearCatalog";
import { KIND_LABEL } from "@/systems/equipment/GearBridge";
import { logger } from "@/utils/logger";
import { SceneType } from "@/types";

/**
 * Inventory Scene — read-only view of the ship: canonical GearCatalog loadout
 * (hull + installed gear + derived stats) and resources/credits.
 *
 * The legacy `ship.modules` / `inventory.modules` system is inert (F6,
 * letsplay 2026-06-10) and deliberately NOT rendered here. NOTE: no production
 * flow installs into `gameEngine.playerLoadout` yet — shop purchases still
 * land in the legacy inventory (F6 known gap, CLAUDE.md), so this view shows
 * the starter (or save-restored) loadout until shops are canonicalized.
 * Accessible via "I" key from SpaceFlightScene or StarMapScene.
 */
export class InventoryScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private mainContainer: Container | null = null;

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: { gameEngine: GameEngine }): void {
    if (!context?.gameEngine) {
      throw new Error("InventoryScene requires gameEngine in context");
    }

    this.gameEngine = context.gameEngine;
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();

    // Add keyboard listener for closing inventory
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    logger.info("InventoryScene initialized");
  }

  update(_deltaTime: number): void {
    // Inventory is static, no updates needed
  }

  destroy(): void {
    // Remove keyboard listener
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }

    // Destroy containers
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }

    this.gameEngine = null;

    logger.info("InventoryScene destroyed");
  }

  /**
   * Render the entire inventory UI
   */
  private render(): void {
    if (!this.mainContainer || !this.gameEngine) return;

    const screenWidth = this.renderer.app.screen.width;
    const screenHeight = this.renderer.app.screen.height;

    // Semi-transparent backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, screenWidth, screenHeight);
    backdrop.fill({ color: 0x000000, alpha: 0.8 });
    backdrop.eventMode = "static"; // Block clicks behind
    this.mainContainer.addChild(backdrop);

    // Main panel
    const panelWidth = 900;
    const panelHeight = 600;
    const panelX = (screenWidth - panelWidth) / 2;
    const panelY = (screenHeight - panelHeight) / 2;

    const panel = new Graphics();
    panel.rect(panelX, panelY, panelWidth, panelHeight);
    panel.fill({ color: 0x1a1a2e, alpha: 0.98 });
    panel.stroke({ color: 0x00ffff, width: 3 });
    this.mainContainer.addChild(panel);

    // Title
    const title = new Text({
      text: "ИНВЕНТАРЬ И ОБОРУДОВАНИЕ",
      style: {
        fontFamily: "Courier New",
        fontSize: 20,
        fill: 0x00ffff,
        fontWeight: "bold",
      },
    });
    title.x = panelX + 20;
    title.y = panelY + 15;
    this.mainContainer.addChild(title);

    // Close button
    this.createCloseButton(panelX + panelWidth - 40, panelY + 15);

    // Ship stats panel (left side)
    this.renderShipStats(panelX + 20, panelY + 60);

    // Installed gear from the canonical loadout (right side)
    this.renderLoadoutGear(panelX + 330, panelY + 60);

    // Resources display (bottom)
    this.renderResources(panelX + 20, panelY + panelHeight - 100);
  }

  /**
   * Render ship statistics. Hull capacity, shields, speed and slot usage come
   * from the canonical loadout's derived stats; live values (current HP,
   * shields, energy, evasion) come from the ship state. GameEngine initializes
   * a loadout on both new game and load, so it is always present here.
   */
  private renderShipStats(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player)
      return;
    const stats = this.gameEngine.playerLoadout?.derivedStats();
    if (!stats) return;

    const ship = this.gameEngine.player.ship;

    const statsTitle = new Text({
      text: "КОРАБЛЬ",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    statsTitle.x = x;
    statsTitle.y = y;
    this.mainContainer.addChild(statsTitle);

    const lines = [
      `Название: ${ship.name}`,
      ``,
      // Live HP/shields can't exceed the loadout-derived capacities (the
      // legacy ship fields may carry stale values from before the gear was
      // canonical).
      `Корпус: ${Math.min(ship.hullHP, stats.maxHull)}/${stats.maxHull}`,
      `Щиты: ${Math.min(ship.shields, stats.shields)}/${stats.shields}`,
      `Энергия: ${ship.energy}/${ship.maxEnergy}`,
      // px/ms, same unit and format as the NPC contact panel
      `Скорость: ${stats.speed.toFixed(2)}`,
      `Уворот: ${ship.evasion}`,
      `Слоты: ${stats.slotsUsed}/${stats.slotsTotal}`,
      `Трюм: ${stats.cargo}`,
    ];

    let yOffset = y + 30;
    for (const line of lines) {
      const statText = new Text({
        text: line,
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: 0xaaaaaa,
        },
      });
      statText.x = x;
      statText.y = yOffset;
      this.mainContainer.addChild(statText);
      yOffset += 18;
    }
  }

  /**
   * Render the hull and installed gear from the canonical GearCatalog loadout
   * (read-only — gear is managed in the equipment shop).
   */
  private renderLoadoutGear(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer) return;

    const sectionTitle = new Text({
      text: "УСТАНОВЛЕННОЕ ОБОРУДОВАНИЕ",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    sectionTitle.x = x;
    sectionTitle.y = y;
    this.mainContainer.addChild(sectionTitle);

    const loadout = this.gameEngine.playerLoadout;
    if (!loadout) return; // unreachable: GameEngine always initializes a loadout

    // Hull card first, then each installed gear item
    const items: Gear[] = [loadout.hull];
    for (const id of loadout.installedGearIds()) {
      const gear = gearById(id);
      if (gear) items.push(gear);
    }

    // At most 5 cards fit between the section title and the resources row at
    // the panel bottom (cards are 60px on a 70px step); large hulls hold up to
    // 9 items, so show an explicit overflow count instead of silent truncation.
    const MAX_CARDS = 5;
    let yOffset = y + 35;
    for (const gear of items.slice(0, MAX_CARDS)) {
      this.renderGearCard(x, yOffset, gear);
      yOffset += 70;
    }
    if (items.length > MAX_CARDS) {
      const more = new Text({
        text: `…и ещё ${items.length - MAX_CARDS} — полный список в магазине оборудования`,
        style: {
          fontFamily: "Courier New",
          fontSize: 11,
          fill: 0x8888aa,
        },
      });
      more.x = x;
      more.y = yOffset;
      this.mainContainer.addChild(more);
      yOffset += 18;
    }

    const hint = new Text({
      text: "Покупка и установка — в магазине оборудования",
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0x555577,
      },
    });
    hint.x = x;
    hint.y = yOffset + 5;
    this.mainContainer.addChild(hint);
  }

  /**
   * Render a single read-only gear card (name, kind, tech level)
   */
  private renderGearCard(x: number, y: number, gear: Gear): void {
    if (!this.mainContainer) return;

    const card = new Container();
    card.x = x;
    card.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, 540, 60);
    bg.fill({ color: 0x16213e, alpha: 0.8 });
    bg.stroke({ color: 0x555555, width: 1 });
    card.addChild(bg);

    const name = new Text({
      text: gear.name,
      style: {
        fontFamily: "Courier New",
        fontSize: 12,
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    name.eventMode = "none";
    name.x = 10;
    name.y = 10;
    card.addChild(name);

    const meta = new Text({
      text: `[${KIND_LABEL[gear.kind]}]  Тех. уровень: ${gear.techLevel}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0x888888,
      },
    });
    meta.eventMode = "none";
    meta.x = 10;
    meta.y = 32;
    card.addChild(meta);

    this.mainContainer.addChild(card);
  }

  /**
   * Render resources display
   */
  private renderResources(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player)
      return;

    const resourcesTitle = new Text({
      text: "РЕСУРСЫ",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    resourcesTitle.x = x;
    resourcesTitle.y = y;
    this.mainContainer.addChild(resourcesTitle);

    const resources = this.gameEngine.player.inventory.resources;
    const credits = this.gameEngine.player.credits;

    let resourceText = `Кредиты: ${credits}`;
    if (resources.length > 0) {
      resourceText +=
        "  |  " + resources.map((r) => `${r.type}: ${r.amount}`).join("  |  ");
    }

    const resText = new Text({
      text: resourceText,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    resText.x = x;
    resText.y = y + 25;
    this.mainContainer.addChild(resText);
  }

  /**
   * Create close button
   */
  private createCloseButton(x: number, y: number): void {
    if (!this.mainContainer) return;

    const closeBtn = new Container();
    closeBtn.x = x;
    closeBtn.y = y;
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";

    const closeBg = new Graphics();
    closeBg.rect(0, 0, 25, 25);
    closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    closeBtn.addChild(closeBg);

    const closeText = new Text({
      text: "X",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    closeText.x = 7;
    closeText.y = 2;
    closeBtn.addChild(closeText);

    closeBtn.on("pointerdown", () => {
      this.closeInventory();
    });

    closeBtn.on("pointerover", () => {
      closeBg.clear();
      closeBg.rect(0, 0, 25, 25);
      closeBg.fill({ color: 0xff4444, alpha: 1.0 });
    });

    closeBtn.on("pointerout", () => {
      closeBg.clear();
      closeBg.rect(0, 0, 25, 25);
      closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    });

    this.mainContainer.addChild(closeBtn);
  }

  /**
   * Close inventory and return to previous scene
   */
  private async closeInventory(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info("Closing inventory");
    const shipPos = this.gameEngine.lastFlightShipPos ?? undefined;
    await this.gameEngine.transitionTo(
      SceneType.SPACE_FLIGHT,
      shipPos ? { preserveShipPos: shipPos } : undefined,
    );
  }

  /**
   * Handle keyboard input
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "i" || event.key === "I" || event.key === "Escape") {
      this.closeInventory();
    }
  }
}
