import { Container, Graphics, Text } from 'pixi.js';
import { GameScene } from './GameScene';
import type { Renderer } from './Renderer';
import type { GameEngine } from '@/systems/GameEngine';
import type { ShipModule } from '@/domain/ShipModule';
import { WeaponModule, ShieldModule, EngineModule } from '@/domain/ShipModule';
import { logger } from '@/utils/logger';

/**
 * Inventory Scene - displays ship equipment slots, inventory modules, and resources
 * Accessible via "I" key from SpaceFlightScene or StarMapScene
 */
export class InventoryScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private mainContainer: Container | null = null;
  private selectedModule: ShipModule | null = null;
  private selectedSlot: number | null = null;

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: { gameEngine: GameEngine }): void {
    if (!context?.gameEngine) {
      throw new Error('InventoryScene requires gameEngine in context');
    }

    this.gameEngine = context.gameEngine;
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();

    // Add keyboard listener for closing inventory
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener('keydown', this.boundKeyDown);

    logger.info('InventoryScene initialized');
  }

  update(_deltaTime: number): void {
    // Inventory is static, no updates needed
  }

  destroy(): void {
    // Remove keyboard listener
    if (this.boundKeyDown) {
      window.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }

    // Destroy containers
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }

    this.gameEngine = null;
    this.selectedModule = null;
    this.selectedSlot = null;

    logger.info('InventoryScene destroyed');
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
    backdrop.eventMode = 'static'; // Block clicks behind
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
      text: 'ИНВЕНТАРЬ И ОБОРУДОВАНИЕ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 20,
        fill: 0x00ffff,
        fontWeight: 'bold',
      },
    });
    title.x = panelX + 20;
    title.y = panelY + 15;
    this.mainContainer.addChild(title);

    // Close button
    this.createCloseButton(panelX + panelWidth - 40, panelY + 15);

    // Ship stats panel (left side)
    this.renderShipStats(panelX + 20, panelY + 60);

    // Equipment slots (center-left)
    this.renderEquipmentSlots(panelX + 250, panelY + 60);

    // Inventory modules (right side)
    this.renderInventoryModules(panelX + 500, panelY + 60);

    // Resources display (bottom)
    this.renderResources(panelX + 20, panelY + panelHeight - 100);
  }

  /**
   * Render ship statistics
   */
  private renderShipStats(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player) return;

    const ship = this.gameEngine.player.ship;

    const statsTitle = new Text({
      text: 'КОРАБЛЬ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: 'bold',
      },
    });
    statsTitle.x = x;
    statsTitle.y = y;
    this.mainContainer.addChild(statsTitle);

    const stats = [
      `Название: ${ship.name}`,
      ``,
      `Корпус: ${ship.hullHP}/${ship.maxHull}`,
      `Щиты: ${ship.shields}/${ship.maxShields}`,
      `Энергия: ${ship.energy}/${ship.maxEnergy}`,
      `Скорость: ${ship.speed}`,
      `Уворот: ${ship.evasion}`,
    ];

    let yOffset = y + 30;
    for (const stat of stats) {
      const statText = new Text({
        text: stat,
        style: {
          fontFamily: 'Courier New',
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
   * Render equipment slots (3 slots for modules)
   */
  private renderEquipmentSlots(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player) return;

    const slotsTitle = new Text({
      text: 'УСТАНОВЛЕННЫЕ МОДУЛИ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: 'bold',
      },
    });
    slotsTitle.x = x;
    slotsTitle.y = y;
    this.mainContainer.addChild(slotsTitle);

    const ship = this.gameEngine.player.ship;
    let yOffset = y + 35;

    for (let slot = 0; slot < 3; slot++) {
      const module = ship.modules[slot];
      this.renderSlotCard(x, yOffset, slot, module);
      yOffset += 130;
    }
  }

  /**
   * Render a single equipment slot card
   */
  private renderSlotCard(x: number, y: number, slot: number, module: ShipModule | null): void {
    if (!this.mainContainer || !this.gameEngine) return;

    const slotContainer = new Container();
    slotContainer.x = x;
    slotContainer.y = y;

    // Slot background
    const slotBg = new Graphics();
    slotBg.rect(0, 0, 220, 110);
    slotBg.fill({ color: module ? 0x16213e : 0x0a0a0a, alpha: 0.9 });
    slotBg.stroke({ color: this.selectedSlot === slot ? 0x00ffff : 0x444444, width: 2 });
    slotContainer.addChild(slotBg);

    // Slot label
    const slotLabel = new Text({
      text: `СЛОТ ${slot + 1}`,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0x888888,
        fontWeight: 'bold',
      },
    });
    slotLabel.x = 5;
    slotLabel.y = 5;
    slotContainer.addChild(slotLabel);

    if (module) {
      // Module name
      const moduleName = new Text({
        text: module.name,
        style: {
          fontFamily: 'Courier New',
          fontSize: 12,
          fill: 0xffffff,
          fontWeight: 'bold',
        },
      });
      moduleName.x = 10;
      moduleName.y = 25;
      slotContainer.addChild(moduleName);

      // Module stats
      const stats = this.getModuleStatsText(module);
      const statsText = new Text({
        text: stats,
        style: {
          fontFamily: 'Courier New',
          fontSize: 10,
          fill: 0xaaaaaa,
        },
      });
      statsText.x = 10;
      statsText.y = 45;
      slotContainer.addChild(statsText);

      // Unequip button
      const unequipBtn = this.createButton('Снять', 130, 75, 80, 25);
      unequipBtn.on('pointerdown', () => {
        this.unequipModule(slot);
      });
      slotContainer.addChild(unequipBtn);
    } else {
      // Empty slot message
      const emptyText = new Text({
        text: 'Пусто',
        style: {
          fontFamily: 'Courier New',
          fontSize: 12,
          fill: 0x555555,
        },
      });
      emptyText.x = 10;
      emptyText.y = 45;
      slotContainer.addChild(emptyText);

      // Equip button (only if module selected)
      if (this.selectedModule) {
        const equipBtn = this.createButton('Установить', 110, 75, 100, 25);
        equipBtn.on('pointerdown', () => {
          this.equipModuleToSlot(slot);
        });
        slotContainer.addChild(equipBtn);
      }
    }

    this.mainContainer.addChild(slotContainer);
  }

  /**
   * Render inventory modules list
   */
  private renderInventoryModules(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player) return;

    const inventoryTitle = new Text({
      text: 'МОДУЛИ В ИНВЕНТАРЕ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: 'bold',
      },
    });
    inventoryTitle.x = x;
    inventoryTitle.y = y;
    this.mainContainer.addChild(inventoryTitle);

    const modules = this.gameEngine.player.inventory.modules;

    if (modules.length === 0) {
      const emptyText = new Text({
        text: 'Инвентарь пуст',
        style: {
          fontFamily: 'Courier New',
          fontSize: 12,
          fill: 0x666666,
        },
      });
      emptyText.x = x;
      emptyText.y = y + 35;
      this.mainContainer.addChild(emptyText);
      return;
    }

    let yOffset = y + 35;
    for (const module of modules) {
      this.renderModuleCard(x, yOffset, module);
      yOffset += 90;

      // Stop if too many modules (add scrolling later)
      if (yOffset > y + 450) break;
    }
  }

  /**
   * Render a single module card in inventory
   */
  private renderModuleCard(x: number, y: number, module: ShipModule): void {
    if (!this.mainContainer) return;

    const moduleContainer = new Container();
    moduleContainer.x = x;
    moduleContainer.y = y;

    // Module background
    const moduleBg = new Graphics();
    moduleBg.rect(0, 0, 370, 75);
    moduleBg.fill({ color: 0x16213e, alpha: 0.8 });
    moduleBg.stroke({
      color: this.selectedModule?.id === module.id ? 0x00ffff : 0x555555,
      width: this.selectedModule?.id === module.id ? 2 : 1,
    });
    moduleBg.eventMode = 'static';
    moduleBg.cursor = 'pointer';
    moduleContainer.addChild(moduleBg);

    // Module name
    const moduleName = new Text({
      text: module.name,
      style: {
        fontFamily: 'Courier New',
        fontSize: 12,
        fill: 0xffffff,
        fontWeight: 'bold',
      },
    });
    moduleName.x = 10;
    moduleName.y = 10;
    moduleContainer.addChild(moduleName);

    // Module category
    const categoryText = new Text({
      text: `[${this.getCategoryRussian(module.category)}]`,
      style: {
        fontFamily: 'Courier New',
        fontSize: 10,
        fill: 0x888888,
      },
    });
    categoryText.x = 10;
    categoryText.y = 30;
    moduleContainer.addChild(categoryText);

    // Module stats
    const stats = this.getModuleStatsText(module);
    const statsText = new Text({
      text: stats,
      style: {
        fontFamily: 'Courier New',
        fontSize: 10,
        fill: 0xaaaaaa,
      },
    });
    statsText.x = 10;
    statsText.y = 48;
    moduleContainer.addChild(statsText);

    // Click to select
    moduleBg.on('pointerdown', () => {
      this.selectModule(module);
    });

    this.mainContainer.addChild(moduleContainer);
  }

  /**
   * Render resources display
   */
  private renderResources(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player) return;

    const resourcesTitle = new Text({
      text: 'РЕСУРСЫ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: 'bold',
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
        '  |  ' + resources.map((r) => `${r.type}: ${r.amount}`).join('  |  ');
    }

    const resText = new Text({
      text: resourceText,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    resText.x = x;
    resText.y = y + 25;
    this.mainContainer.addChild(resText);
  }

  /**
   * Select a module from inventory
   */
  private selectModule(module: ShipModule): void {
    this.selectedModule = module;
    this.selectedSlot = null; // Clear slot selection
    logger.info(`Selected module: ${module.name}`);

    // Re-render to update selection
    this.refresh();
  }

  /**
   * Equip selected module to a slot
   */
  private equipModuleToSlot(slot: number): void {
    if (!this.gameEngine || !this.gameEngine.player || !this.selectedModule) return;

    try {
      this.gameEngine.equipmentSystem.equipModule(
        this.gameEngine.player,
        this.selectedModule.id,
        slot,
      );
      this.selectedModule = null; // Clear selection
      this.refresh();
    } catch (error) {
      logger.error('Failed to equip module:', error);
    }
  }

  /**
   * Unequip module from a slot
   */
  private unequipModule(slot: number): void {
    if (!this.gameEngine || !this.gameEngine.player) return;

    try {
      this.gameEngine.equipmentSystem.unequipModule(this.gameEngine.player, slot);
      this.refresh();
    } catch (error) {
      logger.error('Failed to unequip module:', error);
    }
  }

  /**
   * Refresh the entire UI
   */
  private refresh(): void {
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = new Container();
      this.renderer.uiLayer.addChild(this.mainContainer);
      this.render();
    }
  }

  /**
   * Create close button
   */
  private createCloseButton(x: number, y: number): void {
    if (!this.mainContainer) return;

    const closeBtn = new Container();
    closeBtn.x = x;
    closeBtn.y = y;
    closeBtn.eventMode = 'static';
    closeBtn.cursor = 'pointer';

    const closeBg = new Graphics();
    closeBg.rect(0, 0, 25, 25);
    closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    closeBtn.addChild(closeBg);

    const closeText = new Text({
      text: 'X',
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0xffffff,
        fontWeight: 'bold',
      },
    });
    closeText.x = 7;
    closeText.y = 2;
    closeBtn.addChild(closeText);

    closeBtn.on('pointerdown', () => {
      this.closeInventory();
    });

    closeBtn.on('pointerover', () => {
      closeBg.clear();
      closeBg.rect(0, 0, 25, 25);
      closeBg.fill({ color: 0xff4444, alpha: 1.0 });
    });

    closeBtn.on('pointerout', () => {
      closeBg.clear();
      closeBg.rect(0, 0, 25, 25);
      closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    });

    this.mainContainer.addChild(closeBtn);
  }

  /**
   * Create a generic button
   */
  private createButton(text: string, x: number, y: number, width: number, height: number): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = y;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';

    const btnBg = new Graphics();
    btnBg.rect(0, 0, width, height);
    btnBg.fill({ color: 0x004488, alpha: 0.9 });
    btnBg.stroke({ color: 0x00ffff, width: 1 });
    btn.addChild(btnBg);

    const btnText = new Text({
      text: text,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0xffffff,
      },
    });
    btnText.x = (width - btnText.width) / 2;
    btnText.y = (height - btnText.height) / 2;
    btn.addChild(btnText);

    // Hover effects
    btn.on('pointerover', () => {
      btnBg.clear();
      btnBg.rect(0, 0, width, height);
      btnBg.fill({ color: 0x0066aa, alpha: 1.0 });
      btnBg.stroke({ color: 0x00ffff, width: 2 });
    });

    btn.on('pointerout', () => {
      btnBg.clear();
      btnBg.rect(0, 0, width, height);
      btnBg.fill({ color: 0x004488, alpha: 0.9 });
      btnBg.stroke({ color: 0x00ffff, width: 1 });
    });

    return btn;
  }

  /**
   * Get module stats as formatted text
   */
  private getModuleStatsText(module: ShipModule): string {
    if (module instanceof WeaponModule) {
      return `Урон: ${module.damage} | Дальность: ${module.range} | Энергия: ${module.energyCost}`;
    } else if (module instanceof ShieldModule) {
      return `Щиты: +${module.shieldBoost} | Перезарядка: ${module.rechargeRate}`;
    } else if (module instanceof EngineModule) {
      return `Скорость: +${module.speedBoost} | Уворот: +${module.evasionBoost}`;
    }
    return 'Неизвестный модуль';
  }

  /**
   * Get Russian translation for module category
   */
  private getCategoryRussian(category: string): string {
    const translations: Record<string, string> = {
      WEAPON: 'Оружие',
      SHIELD: 'Щит',
      ENGINE: 'Двигатель',
    };
    return translations[category] ?? category;
  }

  /**
   * Close inventory and return to previous scene
   */
  private async closeInventory(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info('Closing inventory');
    // Return to previous scene (stored in GameEngine)
    // For now, default to SPACE_FLIGHT
    await this.gameEngine.transitionTo('SPACE_FLIGHT' as any);
  }

  /**
   * Handle keyboard input
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'i' || event.key === 'I' || event.key === 'Escape') {
      this.closeInventory();
    }
  }
}
