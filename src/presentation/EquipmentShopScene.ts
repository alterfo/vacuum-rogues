import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType, PlanetType } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { GearKind, type Gear } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import { ShipModule } from "@/domain/ShipModule";
import type { ModuleCategory } from "@/types";
import { logger } from "@/utils/logger";

interface ShopContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

/** Derive tech level from planet type (higher-tech worlds carry rarer gear). */
function techLevelForPlanet(type: PlanetType): number {
  switch (type) {
    case PlanetType.INDUSTRIAL:
      return 4;
    case PlanetType.HABITAT:
      return 3;
    default:
      return 2;
  }
}

/** Map GearKind to the Russian label shown in the kind-badge column. */
const KIND_LABEL: Record<GearKind, string> = {
  [GearKind.HULL]: "Корпус",
  [GearKind.WEAPON]: "Оружие",
  [GearKind.EQUIPMENT]: "Снаряжение",
};

const KIND_COLOR: Record<GearKind, number> = {
  [GearKind.HULL]: 0x88ccff,
  [GearKind.WEAPON]: 0xff8888,
  [GearKind.EQUIPMENT]: 0x88ffcc,
};

/**
 * Bridge a Gear catalog item to the legacy ShipModule stored in inventory.
 * The full equip-to-slot system (ShipLoadout integration) comes in a later
 * slice; for now buying just puts an item in the player's module inventory.
 */
function gearToModule(gear: Gear): ShipModule {
  return new ShipModule(
    gear.id,
    gear.kind as unknown as ModuleCategory,
    gear.name,
    { type: gear.kind.toLowerCase(), value: gear.techLevel * 10 },
    gear.techLevel,
  );
}

/** Build a one-line stat summary for a gear item (shown on hover / detail). */
function gearStatLine(gear: Gear): string {
  if (gear.kind === GearKind.HULL) {
    return `HP: ${gear.hp}  Слоты: ${gear.slots}  Трюм: ${gear.cargo}`;
  }
  if (gear.kind === GearKind.WEAPON) {
    return `Урон: ${gear.damage}  Дальность: ${gear.range}`;
  }
  return `Мощность: ${gear.potency}`;
}

/**
 * Equipment shop scene (EPIC-007 / Feature 12): browse and purchase gear from
 * a planet's deterministic inventory. Credits are deducted immediately; bought
 * items land in player.inventory.modules (equip-to-slot comes in a later slice).
 */
export class EquipmentShopScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private mainContainer: Container | null = null;
  private listContainer: Container | null = null;
  private creditsText: Text | null = null;
  private listings: GearListing[] = [];
  private scrollOffset = 0;
  private readonly ROW_H = 52;
  private readonly VISIBLE_ROWS = 9;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as ShopContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;

    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.buildShopInventory();
    this.render();

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    logger.info(
      `EquipmentShopScene: ${this.listings.length} items at ${this.planet?.name}`,
    );
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
    this.listContainer = null;
    this.creditsText = null;
    this.gameEngine = null;
    this.planet = null;
  }

  private buildShopInventory(): void {
    if (!this.gameEngine?.galaxy || !this.planet) return;
    const system = this.gameEngine.galaxy.systems.find(
      (s) => s.id === this.gameEngine!.player?.currentSystemId,
    );
    this.listings = generateShop({
      systemId: system?.id ?? "unknown",
      planetId: this.planet.id,
      seed: this.gameEngine.galaxy.id,
      day: this.gameEngine.galaxy.gameDays,
      priceFactor: techLevelForPlanet(this.planet.type) >= 4 ? 0.9 : 1.0,
    });
  }

  private render(): void {
    if (!this.mainContainer) return;
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, sw, sh);
    backdrop.fill({ color: 0x000000, alpha: 0.88 });
    backdrop.eventMode = "static";
    this.mainContainer.addChild(backdrop);

    const PW = Math.min(820, sw - 40);
    const PH = Math.min(580, sh - 40);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH);
    panel.fill({ color: 0x050f1a });
    panel.stroke({ width: 1, color: 0x1a4060 });
    this.mainContainer.addChild(panel);

    // Header bar
    const header = new Graphics();
    header.rect(PX, PY, PW, 44);
    header.fill({ color: 0x081828 });
    this.mainContainer.addChild(header);

    const title = new Text({
      text: `МАГАЗИН СНАРЯЖЕНИЯ — ${this.planet?.name ?? ""}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0x00ccff,
        fontWeight: "bold",
      },
    });
    title.eventMode = "none";
    title.x = PX + 14;
    title.y = PY + 14;
    this.mainContainer.addChild(title);

    const credits = this.gameEngine?.player?.credits ?? 0;
    this.creditsText = new Text({
      text: `${credits.toLocaleString("ru")} ₡`,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffee55,
        fontWeight: "bold",
      },
    });
    this.creditsText.eventMode = "none";
    this.creditsText.anchor.set(1, 0);
    this.creditsText.x = PX + PW - 14;
    this.creditsText.y = PY + 14;
    this.mainContainer.addChild(this.creditsText);

    // Column headers
    this.renderColumnHeaders(PX, PY + 44, PW);

    // Scrollable item list
    const listMask = new Graphics();
    listMask.rect(PX, PY + 64, PW, this.VISIBLE_ROWS * this.ROW_H);
    listMask.fill({ color: 0xffffff });
    this.mainContainer.addChild(listMask);

    this.listContainer = new Container();
    this.listContainer.mask = listMask;
    this.mainContainer.addChild(this.listContainer);

    this.renderRows(PX, PY + 64, PW);

    // Scroll buttons
    this.addScrollButtons(
      PX + PW - 28,
      PY + 64,
      this.VISIBLE_ROWS * this.ROW_H,
    );

    // Back button
    const back = new Text({
      text: "[ НАЗАД ]",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xaaaaaa,
        fontWeight: "bold",
      },
    });
    back.anchor.set(0.5);
    back.x = PX + PW / 2;
    back.y = PY + PH - 22;
    back.eventMode = "static";
    back.cursor = "pointer";
    back.on("pointerdown", (e) => {
      e.stopPropagation();
      this.goBack();
    });
    back.on("pointerover", () => {
      back.alpha = 0.7;
    });
    back.on("pointerout", () => {
      back.alpha = 1;
    });
    this.mainContainer.addChild(back);

    // Scroll wheel
    backdrop.on("wheel", (e) => {
      this.scroll(e.deltaY > 0 ? 1 : -1);
    });
  }

  private renderColumnHeaders(x: number, y: number, w: number): void {
    const cols = [
      { text: "ПРЕДМЕТ", relX: 0.01 },
      { text: "ТИП", relX: 0.52 },
      { text: "Т.ЛВЛ", relX: 0.68 },
      { text: "ЦЕНА", relX: 0.78 },
    ];
    for (const col of cols) {
      const t = new Text({
        text: col.text,
        style: {
          fontFamily: "Courier New",
          fontSize: 11,
          fill: 0x446688,
        },
      });
      t.eventMode = "none";
      t.x = x + w * col.relX;
      t.y = y + 4;
      this.mainContainer!.addChild(t);
    }
    const divider = new Graphics();
    divider.rect(x, y + 20, w, 1);
    divider.fill({ color: 0x1a3050 });
    this.mainContainer!.addChild(divider);
  }

  private renderRows(startX: number, startY: number, w: number): void {
    if (!this.listContainer) return;
    this.listContainer.removeChildren();

    const playerCredits = this.gameEngine?.player?.credits ?? 0;
    const ownedIds = new Set(
      this.gameEngine?.player?.inventory.modules.map((m) => m.id) ?? [],
    );

    for (let i = 0; i < this.listings.length; i++) {
      const listing = this.listings[i];
      const gear = listing.gear;
      const rowY = startY + i * this.ROW_H - this.scrollOffset * this.ROW_H;
      const canAfford = playerCredits >= listing.price;
      const alreadyOwned = ownedIds.has(gear.id);

      const rowBg = new Graphics();
      rowBg.rect(startX, rowY, w - 30, this.ROW_H - 2);
      rowBg.fill({ color: i % 2 === 0 ? 0x060e18 : 0x050b14 });
      this.listContainer.addChild(rowBg);

      // Name + stat line
      const nameText = new Text({
        text: gear.name,
        style: {
          fontFamily: "Courier New",
          fontSize: 13,
          fill: alreadyOwned ? 0x447744 : canAfford ? 0xddeeff : 0x667788,
          fontWeight: "bold",
        },
      });
      nameText.eventMode = "none";
      nameText.x = startX + w * 0.01;
      nameText.y = rowY + 6;
      this.listContainer.addChild(nameText);

      const statText = new Text({
        text: gearStatLine(gear),
        style: {
          fontFamily: "Courier New",
          fontSize: 10,
          fill: 0x445566,
        },
      });
      statText.eventMode = "none";
      statText.x = startX + w * 0.01;
      statText.y = rowY + 25;
      this.listContainer.addChild(statText);

      // Kind badge
      const kindText = new Text({
        text: KIND_LABEL[gear.kind],
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: KIND_COLOR[gear.kind],
        },
      });
      kindText.eventMode = "none";
      kindText.x = startX + w * 0.52;
      kindText.y = rowY + 16;
      this.listContainer.addChild(kindText);

      // Tech level
      const techText = new Text({
        text: `T${gear.techLevel}`,
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: 0x8899aa,
        },
      });
      techText.eventMode = "none";
      techText.x = startX + w * 0.68;
      techText.y = rowY + 16;
      this.listContainer.addChild(techText);

      // Price
      const priceText = new Text({
        text: `${listing.price.toLocaleString("ru")}₡`,
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: canAfford ? 0xffee55 : 0x556655,
        },
      });
      priceText.eventMode = "none";
      priceText.x = startX + w * 0.78;
      priceText.y = rowY + 16;
      this.listContainer.addChild(priceText);

      // Buy button
      const btnLabel = alreadyOwned ? "Есть" : canAfford ? "[Купить]" : "Мало₡";
      const buyBtn = new Text({
        text: btnLabel,
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: alreadyOwned ? 0x447744 : canAfford ? 0x00ff88 : 0x445544,
          fontWeight: "bold",
        },
      });
      buyBtn.x = startX + w * 0.89;
      buyBtn.y = rowY + 16;

      if (canAfford && !alreadyOwned) {
        buyBtn.eventMode = "static";
        buyBtn.cursor = "pointer";
        buyBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.buyItem(listing);
        });
        buyBtn.on("pointerover", () => {
          buyBtn.alpha = 0.7;
        });
        buyBtn.on("pointerout", () => {
          buyBtn.alpha = 1;
        });
      } else {
        buyBtn.eventMode = "none";
      }
      this.listContainer.addChild(buyBtn);
    }
  }

  private addScrollButtons(x: number, y: number, totalH: number): void {
    const upBtn = new Text({
      text: "▲",
      style: { fontFamily: "Courier New", fontSize: 16, fill: 0x446688 },
    });
    upBtn.x = x;
    upBtn.y = y;
    upBtn.eventMode = "static";
    upBtn.cursor = "pointer";
    upBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.scroll(-1);
    });
    this.mainContainer!.addChild(upBtn);

    const downBtn = new Text({
      text: "▼",
      style: { fontFamily: "Courier New", fontSize: 16, fill: 0x446688 },
    });
    downBtn.x = x;
    downBtn.y = y + totalH - 20;
    downBtn.eventMode = "static";
    downBtn.cursor = "pointer";
    downBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.scroll(1);
    });
    this.mainContainer!.addChild(downBtn);
  }

  private scroll(dir: number): void {
    const maxScroll = Math.max(0, this.listings.length - this.VISIBLE_ROWS);
    this.scrollOffset = Math.max(
      0,
      Math.min(maxScroll, this.scrollOffset + dir),
    );
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const PW = Math.min(820, sw - 40);
    const PH = Math.min(580, sh - 40);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;
    this.renderRows(PX, PY + 64, PW);
  }

  private buyItem(listing: GearListing): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    if (player.credits < listing.price) return;

    player.credits -= listing.price;
    player.inventory.addItem(gearToModule(listing.gear));

    logger.info(
      `Bought ${listing.gear.name} for ${listing.price} credits (balance: ${player.credits})`,
    );

    // Update credits display and re-render rows so affordability badges update.
    if (this.creditsText) {
      this.creditsText.text = `${player.credits.toLocaleString("ru")} ₡`;
    }
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const PW = Math.min(820, sw - 40);
    const PY = (sh - Math.min(580, sh - 40)) / 2;
    this.renderRows((sw - PW) / 2, PY + 64, PW);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") this.goBack();
    if (e.key === "ArrowDown") this.scroll(1);
    if (e.key === "ArrowUp") this.scroll(-1);
  }

  private async goBack(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }
}
