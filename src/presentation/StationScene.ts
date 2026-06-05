import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import { SceneType, StationType } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { GearKind, type Gear } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import { ShipModule } from "@/domain/ShipModule";
import type { ModuleCategory } from "@/types";
import { logger } from "@/utils/logger";

interface StationContext {
  gameEngine?: GameEngine;
  station?: Station;
}

// ── Station metadata ─────────────────────────────────────────────────────────

const TYPE_LABEL: Record<StationType, string> = {
  [StationType.TRADE_POST]: "Торговый пост",
  [StationType.REPAIR_DOCK]: "Ремонтный узел",
  [StationType.MILITARY_BASE]: "Военная база",
  [StationType.RESEARCH_LAB]: "Исследовательская лаборатория",
};

const TYPE_COLOR: Record<StationType, number> = {
  [StationType.TRADE_POST]: 0xffcc44,
  [StationType.REPAIR_DOCK]: 0x44aaff,
  [StationType.MILITARY_BASE]: 0xff5544,
  [StationType.RESEARCH_LAB]: 0xcc88ff,
};

/** Services available per station type. */
const TYPE_SERVICES: Record<StationType, string[]> = {
  [StationType.TRADE_POST]: ["shop", "infoCenter", "repair", "refuel", "leave"],
  [StationType.REPAIR_DOCK]: ["repair", "refuel", "leave"],
  [StationType.MILITARY_BASE]: [
    "quests",
    "infoCenter",
    "repair",
    "refuel",
    "leave",
  ],
  [StationType.RESEARCH_LAB]: ["shop", "infoCenter", "refuel", "leave"],
};

const REPAIR_DISCOUNT: Record<StationType, number> = {
  [StationType.TRADE_POST]: 1.0,
  [StationType.REPAIR_DOCK]: 0.6, // 40 % cheaper
  [StationType.MILITARY_BASE]: 0.8,
  [StationType.RESEARCH_LAB]: 1.1,
};

// ── Gear bridging (same as EquipmentShopScene) ───────────────────────────────

function gearToModule(gear: Gear): ShipModule {
  return new ShipModule(
    gear.id,
    gear.kind as unknown as ModuleCategory,
    gear.name,
    { type: gear.kind.toLowerCase(), value: gear.techLevel * 10 },
    gear.techLevel,
  );
}

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

// ── Scene ────────────────────────────────────────────────────────────────────

type View = "main" | "shop";

export class StationScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private station: Station | null = null;
  private mainContainer: Container | null = null;
  private view: View = "main";
  private shopListings: GearListing[] = [];
  private shopScroll = 0;
  private readonly ROW_H = 50;
  private readonly VISIBLE_ROWS = 9;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private toast: Text | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  initialize(context?: object): void {
    const ctx = context as StationContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.station = ctx?.station ?? null;

    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    if (this.station && this.hasService("shop")) {
      this.buildShopInventory();
    }

    this.render();

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    logger.info(`StationScene: docked at ${this.station?.name}`);
  }

  update(_dt: number): void {}

  destroy(): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.mainContainer) {
      this.renderer.uiLayer.removeChild(this.mainContainer);
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }
    this.toast = null;
    this.gameEngine = null;
    this.station = null;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private hasService(service: string): boolean {
    if (!this.station) return false;
    return TYPE_SERVICES[this.station.type].includes(service);
  }

  private buildShopInventory(): void {
    const galaxy = this.gameEngine?.galaxy;
    const station = this.station;
    if (!galaxy || !station) return;

    // Research labs carry higher-tech gear only (minTechLevel 3)
    const techMin = station.type === StationType.RESEARCH_LAB ? 3 : 1;
    const priceFactor = station.type === StationType.RESEARCH_LAB ? 1.1 : 1.0;

    const allListings = generateShop({
      systemId: station.id,
      planetId: station.id,
      seed: galaxy.id,
      day: galaxy.gameDays,
      priceFactor,
    });
    this.shopListings = allListings.filter((l) => l.gear.techLevel >= techMin);
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.mainContainer) return;
    this.mainContainer.removeChildren();
    this.toast = null;

    if (this.view === "shop") {
      this.renderShop();
    } else {
      this.renderMain();
    }
  }

  private renderMain(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Backdrop
    const bg = new Graphics();
    bg.rect(0, 0, sw, sh);
    bg.fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    this.mainContainer!.addChild(bg);

    // Panel
    const PW = Math.min(600, sw - 40);
    const PH = Math.min(560, sh - 60);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH);
    panel.fill({ color: 0x080818, alpha: 1 });
    panel.stroke({ color: 0x334455, width: 1 });
    this.mainContainer!.addChild(panel);

    // Type badge
    const stationType = this.station?.type ?? StationType.TRADE_POST;
    const color = TYPE_COLOR[stationType];

    const badge = new Graphics();
    badge.rect(PX + 16, PY + 14, 10, 10);
    badge.fill({ color });
    this.mainContainer!.addChild(badge);

    const typeLabel = new Text({
      text: TYPE_LABEL[stationType],
      style: { fontSize: 11, fill: color, fontFamily: "monospace" },
    });
    typeLabel.x = PX + 34;
    typeLabel.y = PY + 14;
    typeLabel.eventMode = "none";
    this.mainContainer!.addChild(typeLabel);

    // Station name
    const title = new Text({
      text: this.station?.name ?? "Станция",
      style: { fontSize: 20, fill: 0xeeeeff, fontFamily: "monospace" },
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 38;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    // Separator
    const sep = new Graphics();
    sep.rect(PX + 16, PY + 72, PW - 32, 1);
    sep.fill({ color: 0x223344 });
    this.mainContainer!.addChild(sep);

    // Stats row: hull / fuel / credits
    this.renderStatsRow(PX, PY + 82, PW);

    // Service buttons
    const services = this.station ? TYPE_SERVICES[this.station.type] : [];
    const BTN_W = PW - 80;
    const BTN_H = 38;
    const btnX = PX + 40;
    let btnY = PY + 130;

    for (const svc of services) {
      const { label, color: btnColor } = this.serviceButton(svc);
      const btn = new Text({
        text: `[ ${label} ]`,
        style: { fontSize: 15, fill: btnColor, fontFamily: "monospace" },
      });
      btn.anchor.set(0.5, 0.5);
      btn.x = btnX + BTN_W / 2;
      btn.y = btnY + BTN_H / 2;
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointerdown", (e) => {
        e.stopPropagation();
        void this.executeService(svc);
      });
      btn.on("pointerover", () => {
        btn.alpha = 0.7;
      });
      btn.on("pointerout", () => {
        btn.alpha = 1;
      });
      this.mainContainer!.addChild(btn);
      btnY += BTN_H + 4;
    }

    // Toast slot (re-attached on render)
    this.addToastSlot(PX, PY, PW, PH);
  }

  private renderStatsRow(px: number, y: number, pw: number): void {
    const player = this.gameEngine?.player;
    if (!player) return;

    const hullPct = Math.round(
      (player.ship.hullHP / player.ship.maxHull) * 100,
    );
    const fuelPct = Math.round(
      (player.ship.energy / player.ship.maxEnergy) * 100,
    );
    const credits = player.credits;

    const statsText = new Text({
      text: `Корпус: ${hullPct}%   Топливо: ${fuelPct}%`,
      style: { fontSize: 12, fill: 0x6688aa, fontFamily: "monospace" },
    });
    statsText.x = px + 20;
    statsText.y = y;
    statsText.eventMode = "none";
    this.mainContainer!.addChild(statsText);

    const credText = new Text({
      text: `${credits.toLocaleString("ru")} ₡`,
      style: { fontSize: 12, fill: 0xffcc44, fontFamily: "monospace" },
    });
    credText.anchor.set(1, 0);
    credText.x = px + pw - 20;
    credText.y = y;
    credText.eventMode = "none";
    this.mainContainer!.addChild(credText);
  }

  private serviceButton(svc: string): { label: string; color: number } {
    const discount = this.station ? REPAIR_DISCOUNT[this.station.type] : 1.0;
    const player = this.gameEngine?.player;
    const ship = player?.ship;

    switch (svc) {
      case "repair": {
        const missing = ship ? ship.maxHull - ship.hullHP : 0;
        const cost = Math.ceil(missing * 8 * discount);
        return {
          label: missing > 0 ? `Ремонт  (${cost} ₡)` : "Корпус в норме",
          color: missing > 0 ? 0x88ff88 : 0x445566,
        };
      }
      case "refuel": {
        const missing = ship ? ship.maxEnergy - ship.energy : 0;
        const cost = Math.ceil(missing * 2 * discount);
        return {
          label: missing > 0 ? `Заправка  (${cost} ₡)` : "Баки полны",
          color: missing > 0 ? 0x44aaff : 0x445566,
        };
      }
      case "shop":
        return { label: "Магазин снаряжения", color: 0x44ddff };
      case "infoCenter":
        return { label: "Инфоцентр", color: 0x66bbff };
      case "quests":
        return { label: "Задания", color: 0xffee66 };
      case "leave":
        return { label: "Отстыковаться  Esc", color: 0xff6655 };
      default:
        return { label: svc, color: 0x888888 };
    }
  }

  private async executeService(svc: string): Promise<void> {
    switch (svc) {
      case "repair":
        this.doRepair();
        break;
      case "refuel":
        this.doRefuel();
        break;
      case "shop":
        this.view = "shop";
        this.render();
        break;
      case "infoCenter":
        // Info center needs a planet context; show inline message for now
        this.showToast("Инфоцентр недоступен без планетарной базы", 0xff8844);
        break;
      case "quests":
        this.showToast("Задания выдаются только на военных базах", 0xffcc44);
        break;
      case "leave":
        await this.undock();
        break;
    }
  }

  private doRepair(): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    const ship = player.ship;
    const missing = ship.maxHull - ship.hullHP;
    if (missing <= 0) {
      this.showToast("Корпус уже в норме", 0x445566);
      return;
    }
    const discount = this.station ? REPAIR_DISCOUNT[this.station.type] : 1.0;
    const cost = Math.ceil(missing * 8 * discount);
    if (player.credits < cost) {
      this.showToast(`Нужно ${cost} ₡ — недостаточно средств`, 0xff5544);
      return;
    }
    player.credits -= cost;
    ship.hullHP = ship.maxHull;
    this.showToast(`Корпус восстановлен за ${cost} ₡`, 0x44ff88);
    this.render();
  }

  private doRefuel(): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    const ship = player.ship;
    const missing = ship.maxEnergy - ship.energy;
    if (missing <= 0) {
      this.showToast("Баки уже полны", 0x445566);
      return;
    }
    const discount = this.station ? REPAIR_DISCOUNT[this.station.type] : 1.0;
    const cost = Math.ceil(missing * 2 * discount);
    if (player.credits < cost) {
      this.showToast(`Нужно ${cost} ₡ — недостаточно средств`, 0xff5544);
      return;
    }
    player.credits -= cost;
    ship.energy = ship.maxEnergy;
    this.showToast(`Топливо пополнено за ${cost} ₡`, 0x44aaff);
    this.render();
  }

  private async undock(): Promise<void> {
    if (!this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
    });
  }

  // ── shop sub-view ─────────────────────────────────────────────────────────

  private renderShop(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh);
    bg.fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    this.mainContainer!.addChild(bg);

    const PW = Math.min(760, sw - 40);
    const PH = sh - 60;
    const PX = (sw - PW) / 2;
    const PY = 20;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH);
    panel.fill({ color: 0x080818, alpha: 1 });
    panel.stroke({ color: 0x334455, width: 1 });
    this.mainContainer!.addChild(panel);

    // Header
    const title = new Text({
      text: "[ МАГАЗИН СНАРЯЖЕНИЯ ]",
      style: { fontSize: 18, fill: 0x44ddff, fontFamily: "monospace" },
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 12;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    const playerCredits = this.gameEngine?.player?.credits ?? 0;
    const credits = new Text({
      text: `${playerCredits.toLocaleString("ru")} ₡`,
      style: { fontSize: 13, fill: 0xffcc44, fontFamily: "monospace" },
    });
    credits.anchor.set(1, 0);
    credits.x = PX + PW - 14;
    credits.y = PY + 14;
    credits.eventMode = "none";
    this.mainContainer!.addChild(credits);

    const LIST_Y = PY + 46;
    const LIST_H = PH - 86;
    const PAD = 14;

    const clampedScroll = Math.max(
      0,
      Math.min(
        this.shopScroll,
        Math.max(0, this.shopListings.length - this.VISIBLE_ROWS),
      ),
    );
    this.shopScroll = clampedScroll;

    const visible = this.shopListings.slice(
      clampedScroll,
      clampedScroll + this.VISIBLE_ROWS,
    );

    const mask = new Graphics();
    mask.rect(PX + PAD, LIST_Y, PW - PAD * 2, LIST_H);
    mask.fill({ color: 0xffffff });

    const listContainer = new Container();
    listContainer.mask = mask;
    this.mainContainer!.addChild(mask);
    this.mainContainer!.addChild(listContainer);

    const ownedIds =
      this.gameEngine?.player?.inventory.modules.map((m) => m.id) ?? [];

    for (const [i, listing] of visible.entries()) {
      const y = LIST_Y + i * this.ROW_H;
      const isOwned = ownedIds.includes(listing.gear.id);
      const canAfford = playerCredits >= listing.price;

      const rowBg = new Graphics();
      rowBg.rect(PX + PAD, y + 2, PW - PAD * 2, this.ROW_H - 4);
      rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
      listContainer.addChild(rowBg);

      // Kind badge
      const kindBadge = new Text({
        text: KIND_LABEL[listing.gear.kind],
        style: {
          fontSize: 11,
          fill: KIND_COLOR[listing.gear.kind],
          fontFamily: "monospace",
        },
      });
      kindBadge.x = PX + PAD + 6;
      kindBadge.y = y + 8;
      kindBadge.eventMode = "none";
      listContainer.addChild(kindBadge);

      // Tech level
      const tech = new Text({
        text: `T${listing.gear.techLevel}`,
        style: { fontSize: 11, fill: 0x556677, fontFamily: "monospace" },
      });
      tech.x = PX + PAD + 74;
      tech.y = y + 8;
      tech.eventMode = "none";
      listContainer.addChild(tech);

      // Name
      const name = new Text({
        text: listing.gear.name,
        style: { fontSize: 13, fill: 0xddeeff, fontFamily: "monospace" },
      });
      name.x = PX + PAD + 6;
      name.y = y + 26;
      name.eventMode = "none";
      listContainer.addChild(name);

      // Price
      const price = new Text({
        text: `${listing.price} ₡`,
        style: {
          fontSize: 13,
          fill: canAfford ? 0xffcc44 : 0x664433,
          fontFamily: "monospace",
        },
      });
      price.anchor.set(1, 0);
      price.x = PX + PW - PAD - 110;
      price.y = y + 16;
      price.eventMode = "none";
      listContainer.addChild(price);

      // Buy button
      const buyLabel = isOwned ? "Есть" : canAfford ? "[Купить]" : "Мало₡";
      const buyColor = isOwned ? 0x448844 : canAfford ? 0x44ff88 : 0x554433;
      const buyBtn = new Text({
        text: buyLabel,
        style: { fontSize: 13, fill: buyColor, fontFamily: "monospace" },
      });
      buyBtn.anchor.set(1, 0.5);
      buyBtn.x = PX + PW - PAD - 8;
      buyBtn.y = y + this.ROW_H / 2;
      if (!isOwned && canAfford) {
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
      listContainer.addChild(buyBtn);
    }

    // Back button
    const back = new Text({
      text: "[ ← Назад ]",
      style: { fontSize: 14, fill: 0x88ccff, fontFamily: "monospace" },
    });
    back.anchor.set(0.5, 1);
    back.x = PX + PW / 2;
    back.y = PY + PH - 10;
    back.eventMode = "static";
    back.cursor = "pointer";
    back.on("pointerdown", (e) => {
      e.stopPropagation();
      this.view = "main";
      this.render();
    });
    back.on("pointerover", () => {
      back.alpha = 0.7;
    });
    back.on("pointerout", () => {
      back.alpha = 1;
    });
    this.mainContainer!.addChild(back);
  }

  private buyItem(listing: GearListing): void {
    const player = this.gameEngine?.player;
    if (!player || player.credits < listing.price) return;
    player.credits -= listing.price;
    player.inventory.addItem(gearToModule(listing.gear));
    this.showToast(`Куплено: ${listing.gear.name}`, 0x44ff88);
    this.render();
  }

  // ── toast ─────────────────────────────────────────────────────────────────

  private addToastSlot(px: number, py: number, pw: number, ph: number): void {
    const toast = new Text({
      text: "",
      style: { fontSize: 13, fill: 0x44ff88, fontFamily: "monospace" },
    });
    toast.anchor.set(0.5, 1);
    toast.x = px + pw / 2;
    toast.y = py + ph - 40;
    toast.alpha = 0;
    toast.eventMode = "none";
    this.toast = toast;
    this.mainContainer!.addChild(toast);
  }

  private showToast(msg: string, color: number): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    if (this.toast) {
      this.toast.text = msg;
      (this.toast.style as { fill: number }).fill = color;
      this.toast.alpha = 1;
      this.toastTimeout = setTimeout(() => {
        if (this.toast) this.toast.alpha = 0;
      }, 2500);
    }
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (this.view === "shop") {
        this.view = "main";
        this.render();
      } else {
        void this.undock();
      }
      return;
    }
    if (this.view === "shop") {
      if (e.key === "ArrowUp") this.scrollShop(-1);
      if (e.key === "ArrowDown") this.scrollShop(1);
    }
  }

  private scrollShop(delta: number): void {
    this.shopScroll = Math.max(
      0,
      Math.min(
        this.shopScroll + delta,
        Math.max(0, this.shopListings.length - this.VISIBLE_ROWS),
      ),
    );
    this.render();
  }
}
