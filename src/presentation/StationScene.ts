import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import { SceneType, StationType, type MicroModule } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import {
  MICRO_MODULES,
  GearKind,
  gearById,
  microModuleById,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  gearToModule,
  slotToBagModule,
  gearMicromoduleCategory,
  KIND_LABEL,
  KIND_COLOR,
  applyLoadoutHullToShip,
} from "@/systems/equipment/GearBridge";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import { logger } from "@/utils/logger";
import { RANK_THRESHOLDS, RANK_LABELS } from "@/config/balance";
import { ResearchUpgradePanel } from "./ResearchUpgradePanel";

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
  [StationType.CRAFT_CENTER]: "Центр крафта",
};

const TYPE_COLOR: Record<StationType, number> = {
  [StationType.TRADE_POST]: 0xffcc44,
  [StationType.REPAIR_DOCK]: 0x44aaff,
  [StationType.MILITARY_BASE]: 0xff5544,
  [StationType.RESEARCH_LAB]: 0xcc88ff,
  [StationType.CRAFT_CENTER]: 0xffaa22,
};

/** Services available per station type. */
const TYPE_SERVICES: Record<StationType, string[]> = {
  [StationType.TRADE_POST]: [
    "shop",
    "hangar",
    "infoCenter",
    "repair",
    "refuel",
    "leave",
  ],
  [StationType.REPAIR_DOCK]: ["hangar", "repair", "refuel", "leave"],
  [StationType.MILITARY_BASE]: [
    "quests",
    "rankPromotion",
    "infoCenter",
    "repair",
    "refuel",
    "leave",
  ],
  [StationType.RESEARCH_LAB]: [
    "shop",
    "research",
    "infoCenter",
    "refuel",
    "leave",
  ],
  [StationType.CRAFT_CENTER]: [
    "micromodules",
    "hangar",
    "repair",
    "refuel",
    "leave",
  ],
};

const REPAIR_DISCOUNT: Record<StationType, number> = {
  [StationType.TRADE_POST]: 1.0,
  [StationType.REPAIR_DOCK]: 0.6, // 40 % cheaper
  [StationType.MILITARY_BASE]: 0.8,
  [StationType.RESEARCH_LAB]: 1.1,
  [StationType.CRAFT_CENTER]: 1.0,
};

// ── Scene ────────────────────────────────────────────────────────────────────

type View =
  | "main"
  | "shop"
  | "hangar"
  | "micromodules"
  | "micromodule_apply"
  | "research";

/** The fitted loadout gear being micro-modded (for the apply sub-panel). */
interface MicromoduleApplyTarget {
  /** Slot index of the installed item receiving the micromodule (authoritative
   *  so the exact clicked copy is targeted with duplicate gear fitted). */
  slotIndex: number;
  /** Catalog gear id of that item — for display + category matching. */
  gearId: string;
}

const STATION_BRIBE_COST = 500;

export class StationScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private station: Station | null = null;
  private mainContainer: Container | null = null;
  private view: View = "main";
  private shopListings: GearListing[] = [];
  private micromoduleListings: MicroModule[] = [];
  private micromoduleApplyTarget: MicromoduleApplyTarget | null = null;
  private readonly equipment = new EquipmentSystem();
  private researchPanel: ResearchUpgradePanel | null = null;
  private shopScroll = 0;
  private readonly ROW_H = 50;
  private readonly VISIBLE_ROWS = 9;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private toast: Text | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Bribe paid this docking — gates are lifted for the duration of the visit. */
  private bribed = false;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  initialize(context?: object): void {
    const ctx = context as StationContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.station = ctx?.station ?? null;
    this.bribed = false;

    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    if (this.station && this.hasService("shop")) {
      this.buildShopInventory();
    }
    if (this.station?.type === StationType.CRAFT_CENTER) {
      this.buildMicromoduleListings();
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
    this.micromoduleApplyTarget = null;
    this.researchPanel = null;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private hasService(service: string): boolean {
    if (!this.station) return false;
    return TYPE_SERVICES[this.station.type].includes(service);
  }

  private buildMicromoduleListings(): void {
    // Craft centers sell a deterministic subset based on station id seed
    const seed = this.station?.id.charCodeAt(0) ?? 0;
    // Offer all 12 micromodules (full catalog at craft centers)
    this.micromoduleListings = [...MICRO_MODULES];
    // Shuffle deterministically so different stations have different order
    this.micromoduleListings.sort(
      (a, b) =>
        a.id.charCodeAt(seed % a.id.length) -
        b.id.charCodeAt(seed % b.id.length),
    );
  }

  private buildShopInventory(): void {
    const galaxy = this.gameEngine?.galaxy;
    const station = this.station;
    if (!galaxy || !station) return;

    // Find the star system that owns this station to read its tech level.
    const starSystem = galaxy.systems.find((s) =>
      s.stations.some((st) => st.id === station.id),
    );
    const systemTechLevel = starSystem?.techLevel ?? 1;

    // RESEARCH_LAB stations have access to one tier above the system level
    // (frontier research premium), capped at 8.
    const maxTechLevel =
      station.type === StationType.RESEARCH_LAB
        ? Math.min(8, systemTechLevel + 1)
        : systemTechLevel;
    const priceFactor = station.type === StationType.RESEARCH_LAB ? 1.1 : 1.0;

    this.shopListings = generateShop({
      systemId: station.id,
      planetId: station.id,
      seed: galaxy.id,
      day: galaxy.gameDays,
      priceFactor,
      maxTechLevel,
    });
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.mainContainer) return;
    this.mainContainer
      .removeChildren()
      .forEach((c) => c.destroy({ children: true }));
    this.toast = null;

    if (this.view === "shop") {
      this.renderShop();
    } else if (this.view === "hangar") {
      this.renderHangar();
    } else if (this.view === "micromodules") {
      this.renderMicromoduleShop();
    } else if (this.view === "micromodule_apply") {
      this.renderMicromoduleApplyPanel();
    } else if (this.view === "research") {
      this.renderResearch();
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

    if (!this.station) {
      const errMsg = new Text({
        text: "Ошибка: станция недоступна",
        style: { fontSize: 18, fill: 0xff4444, fontFamily: "monospace" },
      });
      errMsg.anchor.set(0.5, 0.5);
      errMsg.x = sw / 2;
      errMsg.y = sh / 2 - 30;
      errMsg.eventMode = "none";
      this.mainContainer!.addChild(errMsg);

      const backBtn = new Text({
        text: "[ Назад ]",
        style: { fontSize: 16, fill: 0x88ccff, fontFamily: "monospace" },
      });
      backBtn.anchor.set(0.5, 0.5);
      backBtn.x = sw / 2;
      backBtn.y = sh / 2 + 20;
      backBtn.eventMode = "static";
      backBtn.cursor = "pointer";
      backBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        if (this.gameEngine) {
          void this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
            gameEngine: this.gameEngine,
            fromStationId: this.station?.id,
          });
        }
      });
      this.mainContainer!.addChild(backBtn);
      return;
    }

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

    // Reputation gate: hostile faction blocks all services except undocking.
    const stationFaction = String(this.station?.faction ?? "INDEPENDENT");
    const player = this.gameEngine?.player;
    const isHostile =
      !this.bribed && (player?.isHostileTo(stationFaction) ?? false);

    // Service buttons
    const services = this.station ? TYPE_SERVICES[this.station.type] : [];
    const BTN_W = PW - 80;
    const BTN_H = 38;
    const btnX = PX + 40;
    let btnY = PY + 130;

    for (const svc of services) {
      const { label, color: btnColor } = this.serviceButton(svc);
      const blocked = isHostile && svc !== "leave";
      const btn = new Text({
        text: `[ ${label} ]`,
        style: {
          fontSize: 15,
          fill: blocked ? 0x445566 : btnColor,
          fontFamily: "monospace",
        },
      });
      btn.anchor.set(0.5, 0.5);
      btn.x = btnX + BTN_W / 2;
      btn.y = btnY + BTN_H / 2;
      if (blocked) {
        btn.eventMode = "none";
      } else {
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
      }
      this.mainContainer!.addChild(btn);
      btnY += BTN_H + 4;
    }

    // Bribe button when hostile to the station's faction.
    if (isHostile) {
      const brBtn = new Text({
        text: `[ Дать взятку (${STATION_BRIBE_COST} ₡) ]`,
        style: { fontSize: 14, fill: 0xffaa44, fontFamily: "monospace" },
      });
      brBtn.anchor.set(0.5, 0.5);
      brBtn.x = btnX + BTN_W / 2;
      brBtn.y = btnY + BTN_H / 2;
      brBtn.eventMode = "static";
      brBtn.cursor = "pointer";
      brBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        this.payStationBribe(stationFaction);
      });
      brBtn.on("pointerover", () => {
        brBtn.alpha = 0.7;
      });
      brBtn.on("pointerout", () => {
        brBtn.alpha = 1;
      });
      this.mainContainer!.addChild(brBtn);
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
      case "hangar":
        return { label: "Ангар / Оснастка", color: 0x88ddaa };
      case "infoCenter":
        return { label: "Инфоцентр", color: 0x66bbff };
      case "quests":
        return { label: "Задания", color: 0xffee66 };
      case "rankPromotion": {
        const player = this.gameEngine?.player;
        const rank = player?.rank ?? 0;
        const rankLabel = RANK_LABELS[rank] ?? "Легенда";
        return {
          label: `Звание: ${rankLabel} (${player?.killPoints ?? 0} очков)`,
          color: 0xff9944,
        };
      }
      case "micromodules":
        return { label: "Микромодули", color: 0xffaa22 };
      case "research":
        return { label: "Исследования", color: 0xcc88ff };
      case "leave":
        return { label: "Отстыковаться  Esc", color: 0xff6655 };
      default:
        return { label: svc, color: 0xb4b4b4 };
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
      case "hangar":
        this.view = "hangar";
        this.render();
        break;
      case "infoCenter":
        if (this.gameEngine && this.station) {
          await this.gameEngine.transitionTo(SceneType.INFO_CENTER, {
            gameEngine: this.gameEngine,
            station: this.station,
          });
        }
        break;
      case "quests":
        this.showToast("Задания выдаются только на военных базах", 0xffcc44);
        break;
      case "rankPromotion":
        this.doRankPromotion();
        break;
      case "micromodules":
        this.view = "micromodules";
        this.render();
        break;
      case "research":
        this.view = "research";
        this.render();
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

  private doRankPromotion(): void {
    const player = this.gameEngine?.player;
    if (!player) return;

    const currentRank = player.rank ?? 0;

    if (currentRank >= RANK_THRESHOLDS.length - 1) {
      this.showToast("Вы достигли максимального звания!", 0xffcc44);
      return;
    }

    const required = RANK_THRESHOLDS[currentRank + 1];
    if ((player.killPoints ?? 0) < required) {
      const needed = required - (player.killPoints ?? 0);
      this.showToast(
        `Нужно ещё ${needed} очков боёвки для повышения`,
        0x885522,
      );
      return;
    }

    player.rank = currentRank + 1;
    player.killPoints = 0;
    const newLabel = RANK_LABELS[player.rank] ?? "Легенда";
    logger.info(
      `Player promoted to rank ${player.rank} (${newLabel}) at station ${this.station?.name}`,
    );
    this.render();
    this.showToast(`Звание повышено: ${newLabel}! Поздравляем!`, 0xffaa44);
  }

  private payStationBribe(faction: string): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    if (player.credits < STATION_BRIBE_COST) {
      this.showToast(
        `Нужно ${STATION_BRIBE_COST} ₡ — недостаточно средств`,
        0xff5544,
      );
      return;
    }
    player.credits -= STATION_BRIBE_COST;
    this.bribed = true;
    logger.info(
      `StationScene: bribed staff at ${this.station?.name} (faction ${faction})`,
    );
    this.render();
    this.showToast("Взятка принята. Добро пожаловать.", 0xffaa44);
  }

  async goBack(): Promise<void> {
    await this.undock();
  }

  private async undock(): Promise<void> {
    if (!this.gameEngine) return;
    const loadoutStats = this.gameEngine.playerLoadout?.derivedStats();
    if (loadoutStats && !loadoutStats.canTakeOff) {
      this.showToast("Нет двигателя — отстыковка невозможна", 0xff4444);
      return;
    }
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      // Spawn beside the station we just left, not at the distant edge (Task 9).
      fromStationId: this.station?.id,
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
          this.buyItemWithTradeIn(listing);
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
    // Canonical path (dual-hull Task 3): a purchase lands directly in the
    // loadout when a slot is free; the legacy inventory bag is only a fallback
    // for a full (or absent) loadout until it is retired in Task 5.
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const installed = loadout
      ? this.equipment.installGear(loadout, listing.gear.id)
      : false;
    if (!installed) {
      player.inventory.addItem(gearToModule(listing.gear));
    }
    this.showToast(
      installed
        ? `Установлено: ${listing.gear.name}`
        : `Куплено: ${listing.gear.name}`,
      0x44ff88,
    );
    this.render();
  }

  private buyItemWithTradeIn(listing: GearListing): void {
    const loadout = this.gameEngine?.playerLoadout;
    const player = this.gameEngine?.player;
    if (!player || !loadout) {
      this.buyItem(listing);
      return;
    }

    let currentId: string | null = null;
    if (
      listing.gear.kind === GearKind.HULL &&
      loadout.hull.id !== listing.gear.id
    ) {
      currentId = loadout.hull.id;
    } else if (listing.gear.kind === GearKind.WEAPON) {
      currentId =
        loadout
          .installedGearIds()
          .find(
            (id) =>
              gearById(id)?.kind === GearKind.WEAPON && id !== listing.gear.id,
          ) ?? null;
    }

    if (!currentId) {
      this.buyItem(listing);
      return;
    }

    const currentGear = gearById(currentId);
    if (!currentGear) {
      this.buyItem(listing);
      return;
    }

    const tradeIn = Math.floor(currentGear.basePrice * 0.4);
    const delta = listing.price - tradeIn;
    this.showTradeInModal(listing, currentId, currentGear.name, tradeIn, delta);
  }

  private showTradeInModal(
    listing: GearListing,
    currentId: string,
    currentName: string,
    tradeIn: number,
    delta: number,
  ): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const player = this.gameEngine?.player;
    if (!player) return;

    const overlay = new Container();
    const shade = new Graphics();
    shade.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.75 });
    shade.eventMode = "static";
    overlay.addChild(shade);

    const PW = Math.min(480, sw - 60);
    const PH = 220;
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x080c18, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x445566, width: 1 });
    overlay.addChild(panel);

    const addText = (
      text: string,
      y: number,
      color: number,
      size = 13,
    ): void => {
      const t = new Text({
        text,
        style: { fontSize: size, fill: color, fontFamily: "monospace" },
      });
      t.anchor.set(0.5, 0);
      t.x = PX + PW / 2;
      t.y = PY + y;
      t.eventMode = "none";
      overlay.addChild(t);
    };

    addText("[ ЗАМЕНА СНАРЯЖЕНИЯ ]", 14, 0x44ddff, 15);
    addText(`Сдать: ${currentName}  →  +${tradeIn} ₡`, 50, 0xaaaaaa);
    addText(
      `Новый: ${listing.gear.name}  →  −${listing.price} ₡`,
      70,
      0xddeeff,
    );

    const canSwap = player.credits >= Math.max(0, delta);
    const swapLabel =
      delta > 0
        ? `Заменить (доплатить ${delta} ₡)`
        : `Заменить (получить ${-delta} ₡)`;
    const swapColor = canSwap ? 0x003311 : 0x331100;
    const swapTextColor = canSwap ? 0x44ff88 : 0x886644;

    const makeBtn = (
      label: string,
      yOff: number,
      bgColor: number,
      textColor: number,
      onClick: () => void,
      enabled = true,
    ): void => {
      const BW = PW - 60;
      const btn = new Container();
      btn.x = PX + 30;
      btn.y = PY + yOff;
      btn.eventMode = enabled ? "static" : "none";
      btn.cursor = "pointer";

      const bg = new Graphics();
      bg.rect(0, 0, BW, 34).fill({ color: bgColor, alpha: 0.9 });
      bg.rect(0, 0, BW, 34).stroke({ color: 0x556677, width: 1 });
      btn.addChild(bg);

      const lbl = new Text({
        text: label,
        style: { fontSize: 13, fill: textColor, fontFamily: "monospace" },
      });
      lbl.anchor.set(0.5, 0.5);
      lbl.x = BW / 2;
      lbl.y = 17;
      lbl.eventMode = "none";
      btn.addChild(lbl);

      btn.on("pointerdown", (e) => {
        e.stopPropagation();
        onClick();
      });
      btn.on("pointerover", () => {
        bg.alpha = 1;
      });
      btn.on("pointerout", () => {
        bg.alpha = 0.9;
      });
      overlay.addChild(btn);
    };

    makeBtn(
      swapLabel,
      105,
      swapColor,
      swapTextColor,
      () => {
        const loadout = this.gameEngine?.playerLoadout;
        if (!loadout) return;
        const cost = Math.max(0, delta);
        const refund = Math.max(0, -delta);
        player.credits = player.credits - cost + refund;
        if (listing.gear.kind === GearKind.HULL) {
          // Gear that no longer fits a smaller hull returns to the inventory bag
          // rather than being destroyed.
          const dropped = loadout.setHull(listing.gear.id);
          for (const gearId of dropped) {
            const g = gearById(gearId);
            if (g) player.inventory.addItem(gearToModule(g));
          }
          // Project the new hull's HP pool + class label onto the live ship from
          // the canonical loadout so combat/repair reflect it immediately.
          applyLoadoutHullToShip(player.ship, loadout);
        } else {
          loadout.remove(currentId);
          loadout.install(listing.gear.id);
        }
        this.mainContainer!.removeChild(overlay);
        overlay.destroy({ children: true });
        this.showToast(`Установлено: ${listing.gear.name}`, 0x44ff88);
        this.render();
      },
      canSwap,
    );

    makeBtn(
      `Купить в запас (${listing.price} ₡)`,
      148,
      0x111822,
      0x88ccff,
      () => {
        this.mainContainer!.removeChild(overlay);
        overlay.destroy({ children: true });
        this.buyItem(listing);
      },
    );

    makeBtn("Отмена", 185, 0x0a0a0a, 0xb4b4b4, () => {
      this.mainContainer!.removeChild(overlay);
      overlay.destroy({ children: true });
    });

    this.mainContainer!.addChild(overlay);
  }

  // ── micromodule shop sub-view ──────────────────────────────────────────────

  private renderMicromoduleShop(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const player = this.gameEngine?.player;

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    this.mainContainer!.addChild(bg);

    const PW = Math.min(620, sw - 40);
    const PH = Math.min(560, sh - 60);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x0a1018, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x443322, width: 1 });
    this.mainContainer!.addChild(panel);

    const title = new Text({
      text: "[ МИКРОМОДУЛИ ]",
      style: { fontSize: 17, fill: 0xffaa22, fontFamily: "monospace" },
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 12;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    const playerCredits = player?.credits ?? 0;
    const credText = new Text({
      text: `${playerCredits.toLocaleString("ru")} ₡`,
      style: { fontSize: 13, fill: 0xffcc44, fontFamily: "monospace" },
    });
    credText.anchor.set(1, 0);
    credText.x = PX + PW - 14;
    credText.y = PY + 14;
    credText.eventMode = "none";
    this.mainContainer!.addChild(credText);

    const ROW = 46;
    let rowY = PY + 50;
    const TIER_BONUS = ["", "+20%", "+12%", "+6%"] as const;
    const TIER_PRICE = [0, 3200, 1800, 800] as const;

    for (const mm of this.micromoduleListings) {
      if (rowY + ROW > PY + PH - 50) break;

      const price = TIER_PRICE[mm.bonusTier];
      const canAfford = playerCredits >= price;
      const alreadyOwned = (player?.inventory.micromodules ?? []).some(
        (m) => m.id === mm.id,
      );

      const rowBg = new Graphics();
      rowBg
        .rect(PX + 14, rowY + 2, PW - 28, ROW - 4)
        .fill({ color: 0x0d1820, alpha: 1 });
      this.mainContainer!.addChild(rowBg);

      const tierColor =
        mm.bonusTier === 1
          ? 0xffcc44
          : mm.bonusTier === 2
            ? 0x88ccff
            : 0xb4b4b4;
      const tierBadge = new Text({
        text: `Ур.${mm.bonusTier}  ${TIER_BONUS[mm.bonusTier]}`,
        style: { fontSize: 11, fill: tierColor, fontFamily: "monospace" },
      });
      tierBadge.x = PX + 20;
      tierBadge.y = rowY + 6;
      tierBadge.eventMode = "none";
      this.mainContainer!.addChild(tierBadge);

      const nameText = new Text({
        text: mm.name,
        style: { fontSize: 13, fill: 0xddeeff, fontFamily: "monospace" },
      });
      nameText.x = PX + 20;
      nameText.y = rowY + 24;
      nameText.eventMode = "none";
      this.mainContainer!.addChild(nameText);

      const catText = new Text({
        text: mm.targetCategory,
        style: { fontSize: 11, fill: 0x557788, fontFamily: "monospace" },
      });
      catText.x = PX + 180;
      catText.y = rowY + 24;
      catText.eventMode = "none";
      this.mainContainer!.addChild(catText);

      const priceText = new Text({
        text: `${price} ₡`,
        style: {
          fontSize: 13,
          fill: canAfford ? 0xffcc44 : 0x664433,
          fontFamily: "monospace",
        },
      });
      priceText.anchor.set(1, 0.5);
      priceText.x = PX + PW - 110;
      priceText.y = rowY + ROW / 2;
      priceText.eventMode = "none";
      this.mainContainer!.addChild(priceText);

      const buyLabel = alreadyOwned ? "Есть" : canAfford ? "[Купить]" : "Мало₡";
      const buyColor = alreadyOwned
        ? 0x448844
        : canAfford
          ? 0x44ff88
          : 0x554433;
      const buyBtn = new Text({
        text: buyLabel,
        style: { fontSize: 13, fill: buyColor, fontFamily: "monospace" },
      });
      buyBtn.anchor.set(1, 0.5);
      buyBtn.x = PX + PW - 14;
      buyBtn.y = rowY + ROW / 2;
      if (!alreadyOwned && canAfford && player) {
        buyBtn.eventMode = "static";
        buyBtn.cursor = "pointer";
        buyBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          player.credits -= price;
          player.inventory.micromodules.push(mm);
          this.showToast(`Куплено: ${mm.name}`, 0x44ff88);
          this.render();
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
      this.mainContainer!.addChild(buyBtn);

      rowY += ROW;
    }

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

  private renderMicromoduleApplyPanel(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const target = this.micromoduleApplyTarget;
    const targetGear = target ? gearById(target.gearId) : undefined;
    if (!player || !loadout || !target || !targetGear) {
      this.micromoduleApplyTarget = null;
      this.view = "hangar";
      this.render();
      return;
    }

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    this.mainContainer!.addChild(bg);

    const PW = Math.min(520, sw - 60);
    const PH = Math.min(480, sh - 80);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x0a1018, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x443322, width: 1 });
    this.mainContainer!.addChild(panel);

    const title = new Text({
      text: `Выбор микромодуля для: ${targetGear.name}`,
      style: { fontSize: 13, fill: 0xffaa22, fontFamily: "monospace" },
    });
    title.x = PX + 14;
    title.y = PY + 12;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    // Micromodules in inventory matching the fitted item's category
    const targetCategory = gearMicromoduleCategory(targetGear);
    const matching = player.inventory.micromodules.filter(
      (mm) => mm.targetCategory === targetCategory,
    );

    if (matching.length === 0) {
      const none = new Text({
        text: "Нет подходящих микромодулей в инвентаре",
        style: { fontSize: 12, fill: 0x445566, fontFamily: "monospace" },
      });
      none.x = PX + 20;
      none.y = PY + 60;
      none.eventMode = "none";
      this.mainContainer!.addChild(none);
    } else {
      const TIER_BONUS = ["", "+20%", "+12%", "+6%"] as const;
      let rowY = PY + 52;
      const ROW = 48;
      for (const mm of matching) {
        if (rowY + ROW > PY + PH - 50) break;

        const rowBg = new Graphics();
        rowBg.rect(PX + 14, rowY, PW - 28, ROW - 4).fill({ color: 0x0d1820 });
        this.mainContainer!.addChild(rowBg);

        const tierColor =
          mm.bonusTier === 1
            ? 0xffcc44
            : mm.bonusTier === 2
              ? 0x88ccff
              : 0xb4b4b4;
        const info = new Text({
          text: `${mm.name}  (${TIER_BONUS[mm.bonusTier]} ${mm.bonusType})`,
          style: { fontSize: 12, fill: tierColor, fontFamily: "monospace" },
        });
        info.x = PX + 20;
        info.y = rowY + 14;
        info.eventMode = "none";
        this.mainContainer!.addChild(info);

        const applyBtn = new Text({
          text: "[Применить]",
          style: { fontSize: 12, fill: 0x44ff88, fontFamily: "monospace" },
        });
        applyBtn.anchor.set(1, 0.5);
        applyBtn.x = PX + PW - 14;
        applyBtn.y = rowY + ROW / 2 - 2;
        applyBtn.eventMode = "static";
        applyBtn.cursor = "pointer";
        applyBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          // Canonical apply (dual-hull Task 3): the micromodule lands on the
          // exact fitted slot (by index, so the clicked copy is targeted with
          // duplicate gear), consuming it from the inventory bag.
          const applied = loadout.applyMicromoduleAt(target.slotIndex, mm.id);
          if (applied) {
            const idx = player.inventory.micromodules.indexOf(mm);
            if (idx >= 0) player.inventory.micromodules.splice(idx, 1);
            logger.info(
              `Applied micromodule ${mm.id} to loadout gear ${target.gearId}`,
            );
            this.showToast(`Применён: ${mm.name}`, 0x44ff88);
          } else {
            this.showToast("Не удалось применить микромодуль", 0xff8844);
          }
          this.micromoduleApplyTarget = null;
          this.view = "hangar";
          this.render();
        });
        applyBtn.on("pointerover", () => {
          applyBtn.alpha = 0.7;
        });
        applyBtn.on("pointerout", () => {
          applyBtn.alpha = 1;
        });
        this.mainContainer!.addChild(applyBtn);

        rowY += ROW;
      }
    }

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
      this.micromoduleApplyTarget = null;
      this.view = "hangar";
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

  // ── research upgrade sub-view ─────────────────────────────────────────────

  private renderResearch(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    if (!this.gameEngine) return;

    if (!this.researchPanel) {
      this.researchPanel = new ResearchUpgradePanel(
        this.gameEngine,
        () => {
          this.view = "main";
          this.render();
        },
        (msg, color) => this.showToast(msg, color),
      );
    }
    this.researchPanel.render(this.mainContainer!, sw, sh);
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

  private renderHangar(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const player = this.gameEngine?.player;
    if (!player) return;

    const PW = Math.min(540, sw - 80);
    const PH = Math.min(560, sh - 80);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.88 });
    bg.eventMode = "static";
    this.mainContainer!.addChild(bg);

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x0a1420, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x223344, width: 1 });
    panel.eventMode = "none";
    this.mainContainer!.addChild(panel);

    const title = new Text({
      text: "АНГАР — ОСНАСТКА КОРАБЛЯ",
      style: { fontSize: 14, fill: 0x88ddaa, fontFamily: "monospace" },
    });
    title.x = PX + 20;
    title.y = PY + 16;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    // Slots section
    const slotsLabel = new Text({
      text: "Установленные модули:",
      style: { fontSize: 12, fill: 0x6688aa, fontFamily: "monospace" },
    });
    slotsLabel.x = PX + 20;
    slotsLabel.y = PY + 48;
    slotsLabel.eventMode = "none";
    this.mainContainer!.addChild(slotsLabel);

    // Slots render the canonical loadout (dual-hull Task 3): one row per hull
    // slot, occupied rows drawn from the installed gear.
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const slots = loadout?.installedSlots() ?? [];
    const slotsTotal = loadout?.hull.slots ?? 0;
    for (let i = 0; i < slotsTotal; i++) {
      const slot = slots[i];
      const gear = slot ? gearById(slot.gearId) : undefined;
      const slotY = PY + 70 + i * 44;

      const slotBg = new Graphics();
      slotBg
        .rect(PX + 20, slotY, PW - 40, 36)
        .fill({ color: gear ? 0x0d2030 : 0x081018, alpha: 1 });
      slotBg
        .rect(PX + 20, slotY, PW - 40, 36)
        .stroke({ color: gear ? 0x336655 : 0x1a2a3a, width: 1 });
      slotBg.eventMode = "none";
      this.mainContainer!.addChild(slotBg);

      const slotText = new Text({
        text: gear
          ? `[Слот ${i + 1}]  ${gear.name}  (T${gear.techLevel})`
          : `[Слот ${i + 1}]  — пусто —`,
        style: {
          fontSize: 12,
          fill: gear ? 0x88ddaa : 0x445566,
          fontFamily: "monospace",
        },
      });
      slotText.x = PX + 30;
      slotText.y = slotY + 10;
      slotText.eventMode = "none";
      this.mainContainer!.addChild(slotText);

      if (gear && slot && loadout) {
        const unBtn = new Text({
          text: "[снять]",
          style: { fontSize: 11, fill: 0xff8844, fontFamily: "monospace" },
        });
        unBtn.anchor.set(1, 0.5);
        unBtn.x = PX + PW - 26;
        unBtn.y = slotY + 18;
        unBtn.eventMode = "static";
        unBtn.cursor = "pointer";
        unBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          // Remove the exact clicked slot (by index, not first id-match) so the
          // right copy is removed when two identical items are fitted. Returning
          // it to the legacy inventory bag keeps it from being lost — there's no
          // canonical uninstalled-gear store yet. Carry the applied micromodule
          // AND artifact-upgrade count onto the bagged item so re-installing
          // restores both (slotToBagModule is the single slot→bag projection).
          if (loadout.removeAt(i)) {
            player.inventory.addItem(slotToBagModule(gear, slot));
          }
          this.render();
        });
        this.mainContainer!.addChild(unBtn);

        // Micromodule controls — one per item, cannot be removed.
        const mmCategory = gearMicromoduleCategory(gear);
        if (!slot.micromoduleId) {
          const hasMatchingMm =
            mmCategory !== null &&
            player.inventory.micromodules.some(
              (mm) => mm.targetCategory === mmCategory,
            );
          const mmBtn = new Text({
            text: "[+ микромодуль]",
            style: {
              fontSize: 10,
              fill: hasMatchingMm ? 0xffaa22 : 0x445566,
              fontFamily: "monospace",
            },
          });
          mmBtn.anchor.set(1, 0.5);
          mmBtn.x = PX + PW - 26;
          mmBtn.y = slotY + 30;
          if (hasMatchingMm) {
            mmBtn.eventMode = "static";
            mmBtn.cursor = "pointer";
            mmBtn.on("pointerdown", (e) => {
              e.stopPropagation();
              this.micromoduleApplyTarget = { slotIndex: i, gearId: gear.id };
              this.view = "micromodule_apply";
              this.render();
            });
            mmBtn.on("pointerover", () => {
              mmBtn.alpha = 0.7;
            });
            mmBtn.on("pointerout", () => {
              mmBtn.alpha = 1;
            });
          } else {
            mmBtn.eventMode = "none";
          }
          this.mainContainer!.addChild(mmBtn);
        } else {
          const mmLabel =
            microModuleById(slot.micromoduleId)?.name ?? slot.micromoduleId;
          const mmTag = new Text({
            text: `[мм: ${mmLabel}]`,
            style: { fontSize: 10, fill: 0xffcc44, fontFamily: "monospace" },
          });
          mmTag.anchor.set(1, 0.5);
          mmTag.x = PX + PW - 26;
          mmTag.y = slotY + 30;
          mmTag.eventMode = "none";
          this.mainContainer!.addChild(mmTag);
        }
      }
    }

    // Inventory section — the legacy bag of owned-but-uninstalled gear. Items
    // install into a free loadout slot; the bag itself is retired in Task 5.
    const invY = PY + 70 + slotsTotal * 44 + 12;
    const invLabel = new Text({
      text: "Инвентарь:",
      style: { fontSize: 12, fill: 0x6688aa, fontFamily: "monospace" },
    });
    invLabel.x = PX + 20;
    invLabel.y = invY;
    invLabel.eventMode = "none";
    this.mainContainer!.addChild(invLabel);

    const invMods = player.inventory.modules;
    if (invMods.length === 0) {
      const empty = new Text({
        text: "Нет модулей в инвентаре",
        style: { fontSize: 12, fill: 0x334455, fontFamily: "monospace" },
      });
      empty.x = PX + 20;
      empty.y = invY + 22;
      empty.eventMode = "none";
      this.mainContainer!.addChild(empty);
    } else {
      const hasFreeSlot =
        !!loadout && loadout.installedGearIds().length < loadout.hull.slots;
      invMods.forEach((mod, idx) => {
        const iy = invY + 22 + idx * 44;
        if (iy + 40 > PY + PH - 60) return; // clip to panel

        const invBg = new Graphics();
        invBg
          .rect(PX + 20, iy, PW - 40, 36)
          .fill({ color: 0x0d1a28, alpha: 1 });
        invBg
          .rect(PX + 20, iy, PW - 40, 36)
          .stroke({ color: 0x223344, width: 1 });
        invBg.eventMode = "none";
        this.mainContainer!.addChild(invBg);

        const invText = new Text({
          text: `${mod.name}  (ур. ${mod.level})`,
          style: { fontSize: 12, fill: 0xaaccee, fontFamily: "monospace" },
        });
        invText.x = PX + 30;
        invText.y = iy + 10;
        invText.eventMode = "none";
        this.mainContainer!.addChild(invText);

        // Install into a free loadout slot (only for catalog gear — legacy
        // modules with no catalog id stay in the bag until the Task 4 migration).
        const catalogGear = gearById(mod.id);
        const installable =
          hasFreeSlot && !!catalogGear && catalogGear.kind !== GearKind.HULL;
        if (installable && loadout) {
          const eqBtn = new Text({
            text: "[надеть]",
            style: { fontSize: 11, fill: 0x44ddaa, fontFamily: "monospace" },
          });
          eqBtn.anchor.set(1, 0.5);
          eqBtn.x = PX + PW - 26;
          eqBtn.y = iy + 18;
          eqBtn.eventMode = "static";
          eqBtn.cursor = "pointer";
          eqBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            if (this.equipment.installGear(loadout, mod.id)) {
              // Restore the micromodule AND artifact-upgrade count carried on a
              // previously-removed item onto the freshly-filled slot (installGear
              // appends to the end).
              const lastSlot = loadout.installedGearIds().length - 1;
              if (mod.micromoduleId) {
                loadout.applyMicromoduleAt(lastSlot, mod.micromoduleId);
              }
              if (mod.upgrades) {
                loadout.setSlotUpgrades(lastSlot, mod.upgrades);
              }
              player.inventory.modules.splice(idx, 1);
            }
            this.render();
          });
          this.mainContainer!.addChild(eqBtn);
        }
      });
    }

    // Back button
    const backBtn = new Text({
      text: "[ ← Назад ]",
      style: { fontSize: 14, fill: 0x6688aa, fontFamily: "monospace" },
    });
    backBtn.anchor.set(0.5, 1);
    backBtn.x = PX + PW / 2;
    backBtn.y = PY + PH - 16;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.view = "main";
      this.render();
    });
    this.mainContainer!.addChild(backBtn);
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
      if (this.view === "micromodule_apply") {
        this.micromoduleApplyTarget = null;
        this.view = "hangar";
        this.render();
      } else if (
        this.view === "shop" ||
        this.view === "hangar" ||
        this.view === "micromodules" ||
        this.view === "research"
      ) {
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
