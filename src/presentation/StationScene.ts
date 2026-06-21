import {
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import { scaledText } from "./ui/scaledText";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { SceneType, StationType, type MicroModule } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import {
  GearKind,
  gearById,
  microModuleById,
  slotCategoryFor,
  type SlotCategory,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import {
  micromoduleShopCatalog,
  micromodulePrice,
  buyMicromodule,
} from "@/systems/equipment/micromoduleShop";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  slotToBagModule,
  gearToModule,
  gearMicromoduleCategory,
  acquireUninstalledGear,
  ownedUninstalledGear,
  installOwnedGear,
  gearFit,
  KIND_LABEL,
  KIND_COLOR,
  applyLoadoutHullToShip,
  evaluateMicromoduleDrop,
  applyMicromoduleDrop,
  micromoduleDropHint,
  type MicromoduleDropTarget,
} from "@/systems/equipment/GearBridge";
import {
  sellGearPrice,
  sellUninstalledGear,
} from "@/systems/equipment/sellGear";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import { logger } from "@/utils/logger";
import { RANK_THRESHOLDS, RANK_LABELS } from "@/config/balance";
import { ResearchUpgradePanel } from "./ResearchUpgradePanel";
import { attachWheelScroll } from "./ui/WheelScroll";

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
    "bank",
    "repair",
    "refuel",
    "leave",
  ],
  [StationType.REPAIR_DOCK]: ["hangar", "repair", "refuel", "leave"],
  [StationType.MILITARY_BASE]: [
    "quests",
    "rankPromotion",
    "infoCenter",
    "bank",
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

// ── Hangar (SR-canon categorized fitting) ────────────────────────────────────

/** Display label for each fitting bank (canon §11.3). */
const CATEGORY_LABEL: Record<SlotCategory, string> = {
  weapon: "ОРУЖИЕ",
  engine: "ДВИГАТЕЛЬ",
  radar: "РАДАР",
  equipment: "ОБОРУДОВАНИЕ",
};

/** Order the four banks render in: weapons row, engine, radar, equipment. */
const HANGAR_BANKS: readonly SlotCategory[] = [
  "weapon",
  "engine",
  "radar",
  "equipment",
];

/** Russian goods names for the cargo hold (ТРЮМ) read-out. */
const RESOURCE_LABEL: Record<string, string> = {
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

/** Computed geometry shared across the hangar's column renderers. */
interface HangarLayout {
  readonly leftX: number;
  readonly leftW: number;
  readonly rightX: number;
  readonly rightW: number;
  readonly contentTop: number;
  readonly contentBottom: number;
}

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
  private micromoduleScroll = 0;
  /** Rows the micromodule list can show at once — set by its render, read by the
   *  scroll clamp so the full catalog (gear + hull families) is reachable. */
  private micromoduleVisibleRows = 0;
  private readonly ROW_H = 50;
  private readonly VISIBLE_ROWS = 9;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private detachWheel: (() => void) | null = null;
  private toast: Text | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Bribe paid this docking — gates are lifted for the duration of the visit. */
  private bribed = false;
  /**
   * Drop zones registered while the hangar renders (Task 6 drag-drop fitting):
   * each fitted gear slot and each hull micromodule slot, in screen coords. A
   * dropped micromodule chip hit-tests against these to find its target.
   */
  private dropZones: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    target: MicromoduleDropTarget;
  }> = [];
  /** In-flight micromodule drag — the chip's module + the ghost following the pointer. */
  private dragMicromodule: {
    mm: MicroModule;
    ghost: Container;
    /** Ghost border/fill, re-tinted to signal a valid (green) / invalid (red) hover. */
    bg: Graphics;
    w: number;
    h: number;
  } | null = null;
  private dragMoveHandler: ((e: FederatedPointerEvent) => void) | null = null;
  private dragEndHandler: ((e: FederatedPointerEvent) => void) | null = null;
  /** Screen rects of the draggable tray chips (drag *source*), for E2E. */
  private chipRects: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];

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
    // Mouse-wheel scrolls the shop list (matches the ArrowUp/Down keys); only
    // the shop view is scrollable, so other views ignore the wheel.
    this.detachWheel = attachWheelScroll((dir) => {
      if (this.view === "shop") this.scrollShop(dir);
      else if (this.view === "micromodules") this.scrollMicromodules(dir);
    });

    logger.info(`StationScene: docked at ${this.station?.name}`);
  }

  update(_dt: number): void {}

  destroy(): void {
    this.cancelMicromoduleDrag();
    this.dropZones = [];
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
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
    // Offer the full catalog at craft centers: the 12 gear micromodules plus the
    // hull micromodule family (defense / cargo / energy-redirect).
    this.micromoduleListings = micromoduleShopCatalog();
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
      const errMsg = scaledText("Ошибка: станция недоступна", 18, 0xff4444, {
        rawColor: true,
        fontFamily: "monospace",
      });
      errMsg.anchor.set(0.5, 0.5);
      errMsg.x = sw / 2;
      errMsg.y = sh / 2 - 30;
      errMsg.eventMode = "none";
      this.mainContainer!.addChild(errMsg);

      const backBtn = scaledText("[ Назад ]", 16, 0x88ccff, {
        rawColor: true,
        fontFamily: "monospace",
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

    const typeLabel = scaledText(TYPE_LABEL[stationType], 11, color, {
      rawColor: true,
      fontFamily: "monospace",
    });
    typeLabel.x = PX + 34;
    typeLabel.y = PY + 14;
    typeLabel.eventMode = "none";
    this.mainContainer!.addChild(typeLabel);

    // Station name
    const title = scaledText(this.station?.name ?? "Станция", 20, 0xeeeeff, {
      rawColor: true,
      fontFamily: "monospace",
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
      const btn = scaledText(
        `[ ${label} ]`,
        15,
        blocked ? 0x445566 : btnColor,
        { rawColor: true, fontFamily: "monospace" },
      );
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
      const brBtn = scaledText(
        `[ Дать взятку (${STATION_BRIBE_COST} ₡) ]`,
        14,
        0xffaa44,
        { rawColor: true, fontFamily: "monospace" },
      );
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

    const statsText = scaledText(
      `Корпус: ${hullPct}%   Топливо: ${fuelPct}%`,
      12,
      0x6688aa,
      { rawColor: true, fontFamily: "monospace" },
    );
    statsText.x = px + 20;
    statsText.y = y;
    statsText.eventMode = "none";
    this.mainContainer!.addChild(statsText);

    const credText = scaledText(
      `${credits.toLocaleString("ru")} ₡`,
      12,
      0xffcc44,
      { rawColor: true, fontFamily: "monospace" },
    );
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
      case "bank":
        return { label: "Банк", color: 0xffd24a };
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
      case "bank":
        if (this.gameEngine && this.station) {
          await this.gameEngine.transitionTo(SceneType.BANK, {
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
        this.micromoduleScroll = 0;
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
    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -cost,
      GL_COUNTERPARTY.SERVICES,
      "Ремонт корпуса",
    );
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
    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -cost,
      GL_COUNTERPARTY.SERVICES,
      "Заправка",
    );
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
    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -STATION_BRIBE_COST,
      GL_COUNTERPARTY.BRIBES,
      "Взятка персоналу станции",
    );
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
    const title = scaledText("[ МАГАЗИН СНАРЯЖЕНИЯ ]", 18, 0x44ddff, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 12;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    const playerCredits = this.gameEngine?.player?.credits ?? 0;
    const credits = scaledText(
      `${playerCredits.toLocaleString("ru")} ₡`,
      13,
      0xffcc44,
      { rawColor: true, fontFamily: "monospace" },
    );
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

    // "Owned" = in the bag OR installed in the canonical loadout. Since a
    // purchase now installs straight into the loadout (dual-hull Task 3), the
    // bag alone misses installed gear — without the loadout ids the shop would
    // keep offering [Купить] for an item already fitted, letting the player
    // re-buy duplicates. Mirrors EquipmentShopScene's installed-id guard.
    const ownedIds = [
      ...(this.gameEngine?.player?.inventory.modules.map((m) => m.id) ?? []),
      ...(this.gameEngine?.playerLoadout?.installedGearIds() ?? []),
    ];

    for (const [i, listing] of visible.entries()) {
      const y = LIST_Y + i * this.ROW_H;
      const isOwned = ownedIds.includes(listing.gear.id);
      const canAfford = playerCredits >= listing.price;

      const rowBg = new Graphics();
      rowBg.rect(PX + PAD, y + 2, PW - PAD * 2, this.ROW_H - 4);
      rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
      listContainer.addChild(rowBg);

      // Kind badge
      const kindBadge = scaledText(
        KIND_LABEL[listing.gear.kind],
        11,
        KIND_COLOR[listing.gear.kind],
        { rawColor: true, fontFamily: "monospace" },
      );
      kindBadge.x = PX + PAD + 6;
      kindBadge.y = y + 8;
      kindBadge.eventMode = "none";
      listContainer.addChild(kindBadge);

      // Tech level
      const tech = scaledText(`T${listing.gear.techLevel}`, 11, 0x556677, {
        rawColor: true,
        fontFamily: "monospace",
      });
      tech.x = PX + PAD + 74;
      tech.y = y + 8;
      tech.eventMode = "none";
      listContainer.addChild(tech);

      // Name
      const name = scaledText(listing.gear.name, 13, 0xddeeff, {
        rawColor: true,
        fontFamily: "monospace",
      });
      name.x = PX + PAD + 6;
      name.y = y + 26;
      name.eventMode = "none";
      listContainer.addChild(name);

      // Price
      const price = scaledText(
        `${listing.price} ₡`,
        13,
        canAfford ? 0xffcc44 : 0x664433,
        { rawColor: true, fontFamily: "monospace" },
      );
      price.anchor.set(1, 0);
      price.x = PX + PW - PAD - 110;
      price.y = y + 16;
      price.eventMode = "none";
      listContainer.addChild(price);

      // Buy button
      const buyLabel = isOwned ? "Есть" : canAfford ? "[Купить]" : "Мало₡";
      const buyColor = isOwned ? 0x448844 : canAfford ? 0x44ff88 : 0x554433;
      const buyBtn = scaledText(buyLabel, 13, buyColor, {
        rawColor: true,
        fontFamily: "monospace",
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
    const back = scaledText("[ ← Назад ]", 14, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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
    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -listing.price,
      GL_COUNTERPARTY.EQUIPMENT,
      `Покупка: ${listing.gear.name}`,
    );
    // Canonical path (dual-hull Task 3): a purchase lands directly in the
    // loadout when a slot is free; the legacy inventory bag is only a fallback
    // for a full (or absent) loadout until it is retired in Task 5.
    const loadout = this.gameEngine?.playerLoadout ?? null;
    // An engine/radar buy replaces the fitted single-slot part; capture it first
    // so the swapped-out part is re-stocked, not destroyed.
    const displaced = loadout ? loadout.displacedBy(listing.gear.id) : null;
    const installed = loadout
      ? this.equipment.installGear(loadout, listing.gear.id)
      : false;
    if (!installed) {
      // No free slot: park the purchase in the canonical owned-uninstalled
      // store (shown in the hangar ТРЮМ, sellable from there).
      acquireUninstalledGear(player, listing.gear.id);
    } else if (displaced) {
      acquireUninstalledGear(player, displaced);
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
      const t = scaledText(text, size, color, {
        rawColor: true,
        fontFamily: "monospace",
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

      const lbl = scaledText(label, 13, textColor, {
        rawColor: true,
        fontFamily: "monospace",
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
        // A weapon swap removes the traded-in weapon then installs the new one;
        // the mass budget can reject a heavier replacement even though the slot
        // is free. Verify it fits *before* charging/removing, otherwise the
        // player would be billed and lose the old weapon for nothing.
        if (listing.gear.kind !== GearKind.HULL) {
          const stats = loadout.derivedStats();
          const oldMass = gearById(currentId)?.mass ?? 0;
          if (
            stats.massUsed - oldMass + listing.gear.mass >
            stats.massCapacity
          ) {
            this.mainContainer!.removeChild(overlay);
            overlay.destroy({ children: true });
            this.showToast(
              `Перегруз: ${listing.gear.name} не помещается`,
              0xff6644,
            );
            return;
          }
        }
        const cost = Math.max(0, delta);
        const refund = Math.max(0, -delta);
        // Net signed change is `refund - cost` (== -delta): a positive delta
        // charges the upgrade, a negative one refunds a downgrade.
        adjustPlayerCredits(
          this.gameEngine?.bank,
          player,
          refund - cost,
          GL_COUNTERPARTY.EQUIPMENT,
          `Замена: ${listing.gear.name}`,
        );
        if (listing.gear.kind === GearKind.HULL) {
          // Gear that no longer fits a smaller hull returns to the inventory bag
          // rather than being destroyed; slotToBagModule preserves each dropped
          // slot's micromodule + artifact-upgrade count (lossless re-bag).
          const dropped = loadout.swapHull(listing.gear.id);
          for (const slot of dropped) {
            const g = gearById(slot.gearId);
            if (g) player.inventory.addItem(slotToBagModule(g, slot));
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

    const title = scaledText("[ МИКРОМОДУЛИ ]", 17, 0xffaa22, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 12;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    const playerCredits = player?.credits ?? 0;
    const credText = scaledText(
      `${playerCredits.toLocaleString("ru")} ₡`,
      13,
      0xffcc44,
      { rawColor: true, fontFamily: "monospace" },
    );
    credText.anchor.set(1, 0);
    credText.x = PX + PW - 14;
    credText.y = PY + 14;
    credText.eventMode = "none";
    this.mainContainer!.addChild(credText);

    const ROW = 46;
    let rowY = PY + 50;
    const TIER_BONUS = ["", "+20%", "+12%", "+6%"] as const;

    // The full catalog (21 entries) overflows the panel — slice from the scroll
    // offset so every micromodule is reachable at a single station.
    const visibleRows = Math.max(1, Math.floor((PH - 96 - 50) / ROW) + 1);
    this.micromoduleVisibleRows = visibleRows;
    this.micromoduleScroll = Math.max(
      0,
      Math.min(
        this.micromoduleScroll,
        Math.max(0, this.micromoduleListings.length - visibleRows),
      ),
    );
    const visibleMicromodules = this.micromoduleListings.slice(
      this.micromoduleScroll,
      this.micromoduleScroll + visibleRows,
    );

    for (const mm of visibleMicromodules) {
      if (rowY + ROW > PY + PH - 50) break;

      const price = micromodulePrice(mm);
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
      const tierBadge = scaledText(
        `Ур.${mm.bonusTier}  ${TIER_BONUS[mm.bonusTier]}`,
        11,
        tierColor,
        { rawColor: true, fontFamily: "monospace" },
      );
      tierBadge.x = PX + 20;
      tierBadge.y = rowY + 6;
      tierBadge.eventMode = "none";
      this.mainContainer!.addChild(tierBadge);

      const nameText = scaledText(mm.name, 13, 0xddeeff, {
        rawColor: true,
        fontFamily: "monospace",
      });
      nameText.x = PX + 20;
      nameText.y = rowY + 24;
      nameText.eventMode = "none";
      this.mainContainer!.addChild(nameText);

      const catText = scaledText(mm.targetCategory, 11, 0x557788, {
        rawColor: true,
        fontFamily: "monospace",
      });
      catText.x = PX + 180;
      catText.y = rowY + 24;
      catText.eventMode = "none";
      this.mainContainer!.addChild(catText);

      const priceText = scaledText(
        `${price} ₡`,
        13,
        canAfford ? 0xffcc44 : 0x664433,
        { rawColor: true, fontFamily: "monospace" },
      );
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
      const buyBtn = scaledText(buyLabel, 13, buyColor, {
        rawColor: true,
        fontFamily: "monospace",
      });
      buyBtn.anchor.set(1, 0.5);
      buyBtn.x = PX + PW - 14;
      buyBtn.y = rowY + ROW / 2;
      if (!alreadyOwned && canAfford && player) {
        buyBtn.eventMode = "static";
        buyBtn.cursor = "pointer";
        buyBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          const result = buyMicromodule(this.gameEngine?.bank, player, mm);
          if (result.ok) {
            this.showToast(`Куплено: ${mm.name}`, 0x44ff88);
          } else {
            this.showToast(
              result.reason === "already-owned"
                ? "Уже куплено"
                : "Недостаточно кредитов",
              0xff8844,
            );
          }
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

    if (this.micromoduleListings.length > visibleRows) {
      const shown = Math.min(
        this.micromoduleScroll + visibleRows,
        this.micromoduleListings.length,
      );
      const scrollHint = scaledText(
        `▲▼ ${this.micromoduleScroll + 1}–${shown} из ${this.micromoduleListings.length}`,
        11,
        0x668899,
        { rawColor: true, fontFamily: "monospace" },
      );
      scrollHint.anchor.set(0, 1);
      scrollHint.x = PX + 16;
      scrollHint.y = PY + PH - 10;
      scrollHint.eventMode = "none";
      this.mainContainer!.addChild(scrollHint);
    }

    const back = scaledText("[ ← Назад ]", 14, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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

    const title = scaledText(
      `Выбор микромодуля для: ${targetGear.name}`,
      13,
      0xffaa22,
      { rawColor: true, fontFamily: "monospace" },
    );
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
      const none = scaledText(
        "Нет подходящих микромодулей в инвентаре",
        12,
        0x445566,
        { rawColor: true, fontFamily: "monospace" },
      );
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
        const info = scaledText(
          `${mm.name}  (${TIER_BONUS[mm.bonusTier]} ${mm.bonusType})`,
          12,
          tierColor,
          { rawColor: true, fontFamily: "monospace" },
        );
        info.x = PX + 20;
        info.y = rowY + 14;
        info.eventMode = "none";
        this.mainContainer!.addChild(info);

        const applyBtn = scaledText("[Применить]", 12, 0x44ff88, {
          rawColor: true,
          fontFamily: "monospace",
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

    const back = scaledText("[ ← Назад ]", 14, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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
    const toast = scaledText("", 13, 0x44ff88, {
      rawColor: true,
      fontFamily: "monospace",
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

    const PW = Math.min(900, sw - 60);
    const PH = Math.min(620, sh - 60);
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

    const loadout = this.gameEngine?.playerLoadout ?? null;

    const title = scaledText("АНГАР — ОСНАСТКА КОРАБЛЯ", 14, 0x88ddaa, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.x = PX + 20;
    title.y = PY + 14;
    title.eventMode = "none";
    this.mainContainer!.addChild(title);

    // Hull is the ship itself (canon §11.3), shown as a centred banner rather
    // than occupying a slot.
    const hullBanner = scaledText(
      loadout ? `Корпус: ${loadout.hull.name}` : "Корпус: —",
      12,
      0xb4c4d4,
      { rawColor: true, fontFamily: "monospace" },
    );
    hullBanner.anchor.set(0.5, 0);
    hullBanner.x = PX + PW / 2;
    hullBanner.y = PY + 14;
    hullBanner.eventMode = "none";
    this.mainContainer!.addChild(hullBanner);

    this.renderHangarStats(loadout, PX, PY, PW);

    // The drag-drop fitting board (Task 6) re-registers its drop zones + chip
    // source rects each render.
    this.dropZones = [];
    this.chipRects = [];

    const CW = PW - 36;
    const gap = 18;
    const leftW = Math.round((CW - gap) * 0.55);
    // Reserve a strip along the bottom for the draggable micromodule tray, above
    // the [Назад] button. The two columns clip to `contentBottom` as before.
    const trayH = 64;
    const trayY = PY + PH - 38 - trayH;
    const layout: HangarLayout = {
      leftX: PX + 18,
      leftW,
      rightX: PX + 18 + leftW + gap,
      rightW: CW - leftW - gap,
      contentTop: PY + 84,
      contentBottom: trayY - 8,
    };

    // Hull micromodule bank sits atop the left column; the fitting banks flow
    // below the y it consumes.
    const banksTop = this.renderHullMicromoduleBank(layout, loadout);
    this.renderFittingBanks(
      { ...layout, contentTop: banksTop },
      loadout,
      player,
    );
    this.renderWarehouseAndCargo(layout, loadout, player);
    this.renderMicromoduleTray(PX + 18, trayY, PW - 36, trayH, player, loadout);

    // Toast slot so drag-drop fit hints (and sell/unequip messages) show here.
    this.addToastSlot(PX, PY, PW, PH);

    // Back button
    const backBtn = scaledText("[ ← Назад ]", 14, 0xb4c4d4, {
      rawColor: true,
      fontFamily: "monospace",
    });
    backBtn.anchor.set(0.5, 1);
    backBtn.x = PX + PW / 2;
    backBtn.y = PY + PH - 14;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.view = "main";
      this.render();
    });
    this.mainContainer!.addChild(backBtn);
  }

  /** МАССА / СВОБОДНО / СКОРОСТЬ / ЗАЩИТА strip under the title. */
  private renderHangarStats(
    loadout: ShipLoadout | null,
    PX: number,
    PY: number,
    PW: number,
  ): void {
    const stats = loadout?.derivedStats() ?? null;
    const massUsed = stats?.massUsed ?? 0;
    const massCap = stats?.massCapacity ?? 0;
    const massFree = stats?.massFree ?? 0;
    const speed = stats ? stats.speed.toFixed(2) : "0.00";
    const shields = stats?.shields ?? 0;

    const segs: Array<{ text: string; fill: number }> = [
      { text: `МАССА ${massUsed}/${massCap}`, fill: 0xffcc66 },
      {
        text: `СВОБОДНО ${massFree}`,
        fill: massFree > 0 ? 0x66dd88 : 0xff6644,
      },
      { text: `СКОРОСТЬ ${speed}`, fill: 0x88ccff },
      { text: `ЗАЩИТА ${shields}`, fill: 0x88ffcc },
    ];
    const colW = (PW - 40) / segs.length;
    segs.forEach((s, i) => {
      const t = scaledText(s.text, 12, s.fill, {
        rawColor: true,
        fontFamily: "monospace",
      });
      t.x = PX + 20 + i * colW;
      t.y = PY + 54;
      t.eventMode = "none";
      this.mainContainer!.addChild(t);
    });
  }

  /**
   * The four categorized fitting banks (weapons / engine / radar / equipment) in
   * the left column: a header per bank showing `used/total` from the hull, the
   * filled slots (with [снять] + micromodule controls), then the remaining empty
   * slots. Rendering clips to the column; an overflow row marks any spill-over.
   */
  private renderFittingBanks(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
  ): void {
    const { leftX, leftW, contentTop, contentBottom } = layout;
    const stats = loadout?.derivedStats() ?? null;
    const installed = loadout?.installedSlots() ?? [];
    // Flat slot index of each installed item, grouped by category — the index is
    // needed so [снять]/micromodule target the exact clicked copy.
    const byCat = (cat: SlotCategory) =>
      installed
        .map((slot, idx) => ({ slot, idx, gear: gearById(slot.gearId) }))
        .filter((e) => e.gear && slotCategoryFor(e.gear) === cat);

    let y = contentTop;
    let clipped = false;
    for (const cat of HANGAR_BANKS) {
      if (clipped) break;
      const c = stats?.categories[cat] ?? { used: 0, total: 0 };

      const header = scaledText(
        `${CATEGORY_LABEL[cat]}  ${c.used}/${c.total}`,
        12,
        c.used < c.total ? 0x88ccaa : 0xddaa66,
        { rawColor: true, fontFamily: "monospace" },
      );
      header.x = leftX;
      header.y = y;
      header.eventMode = "none";
      this.mainContainer!.addChild(header);
      y += 22;

      const entries = byCat(cat);
      for (const e of entries) {
        if (y + 34 > contentBottom) {
          clipped = true;
          break;
        }
        this.renderFilledSlot(layout, loadout!, player, e, y);
        y += 38;
      }
      if (clipped) break;

      const empties = Math.max(0, c.total - entries.length);
      for (let k = 0; k < empties; k++) {
        if (y + 26 > contentBottom) {
          clipped = true;
          break;
        }
        const slotBg = new Graphics();
        slotBg.rect(leftX, y, leftW, 24).fill({ color: 0x0a1218, alpha: 1 });
        slotBg.rect(leftX, y, leftW, 24).stroke({ color: 0x1a2a3a, width: 1 });
        slotBg.eventMode = "none";
        this.mainContainer!.addChild(slotBg);
        const txt = scaledText("— свободно —", 11, 0xb4bcc4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        txt.x = leftX + 8;
        txt.y = y + 6;
        txt.eventMode = "none";
        this.mainContainer!.addChild(txt);
        y += 28;
      }
      y += 8;
    }
    if (clipped) {
      const more = scaledText("…ещё слоты ниже", 10, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      more.x = leftX;
      more.y = contentBottom + 2;
      more.eventMode = "none";
      this.mainContainer!.addChild(more);
    }
  }

  /** One occupied fitting slot: name, [снять], and micromodule control. */
  private renderFilledSlot(
    layout: HangarLayout,
    loadout: ShipLoadout,
    player: Player,
    entry: {
      slot: { gearId: string; micromoduleId?: string; upgrades: number };
      idx: number;
      gear: Gear | undefined;
    },
    y: number,
  ): void {
    const { leftX, leftW } = layout;
    const gear = entry.gear!;
    const slot = entry.slot;
    const idx = entry.idx;

    const slotBg = new Graphics();
    slotBg.rect(leftX, y, leftW, 34).fill({ color: 0x0d2030, alpha: 1 });
    slotBg.rect(leftX, y, leftW, 34).stroke({ color: 0x336655, width: 1 });
    slotBg.eventMode = "none";
    this.mainContainer!.addChild(slotBg);

    // Drop target: a dragged micromodule released over this fitted item lands on
    // its exact slot index (Task 6). Only empty slots accept one (one per item);
    // a filled-slot drop is rejected with a hint by applyMicromoduleDrop.
    this.dropZones.push({
      x: leftX,
      y,
      w: leftW,
      h: 34,
      target: { kind: "gear", slotIndex: idx },
    });

    const name = scaledText(`${gear.name} (T${gear.techLevel})`, 11, 0xb8e6c8, {
      rawColor: true,
      fontFamily: "monospace",
    });
    name.x = leftX + 8;
    name.y = y + 4;
    name.eventMode = "none";
    this.mainContainer!.addChild(name);

    const unBtn = scaledText("[снять]", 11, 0xff8844, {
      rawColor: true,
      fontFamily: "monospace",
    });
    unBtn.anchor.set(1, 0.5);
    unBtn.x = leftX + leftW - 8;
    unBtn.y = y + 11;
    unBtn.eventMode = "static";
    unBtn.cursor = "pointer";
    unBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      // Remove the exact clicked slot by index (not first id-match) so the right
      // copy is removed with two identical items fitted. slotToBagModule carries
      // the applied micromodule AND artifact-upgrade count onto the bagged item
      // so re-installing restores both.
      if (loadout.removeAt(idx)) {
        player.inventory.addItem(slotToBagModule(gear, slot));
      }
      this.render();
    });
    this.mainContainer!.addChild(unBtn);

    // Micromodule control — one per item, never removed.
    const mmCategory = gearMicromoduleCategory(gear);
    if (slot.micromoduleId) {
      const mmLabel =
        microModuleById(slot.micromoduleId)?.name ?? slot.micromoduleId;
      const mmTag = scaledText(`мм: ${mmLabel}`, 10, 0xffcc44, {
        rawColor: true,
        fontFamily: "monospace",
      });
      mmTag.x = leftX + 8;
      mmTag.y = y + 20;
      mmTag.eventMode = "none";
      this.mainContainer!.addChild(mmTag);
    } else {
      const hasMatchingMm =
        mmCategory !== null &&
        player.inventory.micromodules.some(
          (mm) => mm.targetCategory === mmCategory,
        );
      // Explicit label: spell out the action when a compatible micromodule is on
      // hand, and *why* it's disabled otherwise — the old "[+ микромодуль]" never
      // said it slots an upgrade chip nor that you needed to own a matching one.
      const mmBtn = scaledText(
        hasMatchingMm ? "[установить микромодуль]" : "[нет микромодулей]",
        10,
        hasMatchingMm ? 0xffaa22 : 0xb4bcc4,
        { rawColor: true, fontFamily: "monospace" },
      );
      mmBtn.anchor.set(1, 0.5);
      mmBtn.x = leftX + leftW - 8;
      mmBtn.y = y + 26;
      if (hasMatchingMm) {
        mmBtn.eventMode = "static";
        mmBtn.cursor = "pointer";
        mmBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.micromoduleApplyTarget = { slotIndex: idx, gearId: gear.id };
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
    }
  }

  // ── micromodule drag-drop fitting (Task 6) ──────────────────────────────────

  /**
   * The hull's own micromodule bank, rendered atop the left column as the drop
   * target for hull micromodules (defense/cargo/energy-redirect). Shows each of
   * the hull's 1–4 slots — fitted module name or "— свободно —" — and registers
   * the whole bank as a single `{kind:"hull"}` drop zone. Returns the y below it
   * so the fitting banks flow underneath. A null loadout renders nothing.
   */
  private renderHullMicromoduleBank(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
  ): number {
    const { leftX, leftW, contentTop } = layout;
    if (!loadout) return contentTop;
    const slots = loadout.hullMicromoduleSlots();
    const fitted = loadout.hullMicromodules();

    const header = scaledText(
      `КОРПУС — МИКРОМОДУЛИ  ${fitted.length}/${slots}`,
      12,
      fitted.length < slots ? 0x88ccaa : 0xddaa66,
      { rawColor: true, fontFamily: "monospace" },
    );
    header.x = leftX;
    header.y = contentTop;
    header.eventMode = "none";
    this.mainContainer!.addChild(header);

    const rowY = contentTop + 20;
    const chipH = 22;
    const gap = 6;
    const chipW = Math.floor((leftW - gap * (slots - 1)) / Math.max(1, slots));
    for (let i = 0; i < slots; i++) {
      const x = leftX + i * (chipW + gap);
      const id = fitted[i];
      const filled = !!id;
      const chip = new Graphics();
      chip
        .rect(x, rowY, chipW, chipH)
        .fill({ color: filled ? 0x1a2630 : 0x0a1218, alpha: 1 });
      chip
        .rect(x, rowY, chipW, chipH)
        .stroke({ color: filled ? 0xffaa22 : 0x33557a, width: 1 });
      chip.eventMode = "none";
      this.mainContainer!.addChild(chip);

      const label = scaledText(
        filled ? (microModuleById(id)?.name ?? id) : "— свободно —",
        9,
        filled ? 0xffcc44 : 0x8aa0b4,
        { rawColor: true, fontFamily: "monospace" },
      );
      label.anchor.set(0.5, 0.5);
      label.x = x + chipW / 2;
      label.y = rowY + chipH / 2;
      label.eventMode = "none";
      this.mainContainer!.addChild(label);
    }

    // One drop zone spanning the bank: applyMicromoduleDrop routes a HULL module
    // into the next free slot (or rejects with "hull-full" when all are taken).
    this.dropZones.push({
      x: leftX,
      y: rowY,
      w: leftW,
      h: chipH,
      target: { kind: "hull" },
    });

    return rowY + chipH + 12;
  }

  /**
   * The draggable owned-micromodule tray along the bottom of the hangar. Each
   * owned micromodule is a chip the player drags onto a fitted item or the hull
   * bank. Empty → a hint to buy them at a Центр крафта.
   */
  private renderMicromoduleTray(
    px: number,
    py: number,
    pw: number,
    ph: number,
    player: Player,
    loadout: ShipLoadout | null,
  ): void {
    const tray = new Graphics();
    tray.rect(px, py, pw, ph).fill({ color: 0x070d14, alpha: 1 });
    tray.rect(px, py, pw, ph).stroke({ color: 0x223344, width: 1 });
    tray.eventMode = "none";
    this.mainContainer!.addChild(tray);

    const owned = player.inventory.micromodules;
    const label = scaledText(
      owned.length > 0
        ? "МИКРОМОДУЛИ — перетащите на модуль или корпус:"
        : "МИКРОМОДУЛИ — нет в наличии (купите в Центре крафта)",
      11,
      owned.length > 0 ? 0xffaa22 : 0x8aa0b4,
      { rawColor: true, fontFamily: "monospace" },
    );
    label.x = px + 8;
    label.y = py + 6;
    label.eventMode = "none";
    this.mainContainer!.addChild(label);

    if (owned.length === 0 || !loadout) return;

    const chipY = py + 28;
    const chipH = 26;
    const gap = 8;
    let x = px + 8;
    for (let i = 0; i < owned.length; i++) {
      const mm = owned[i];
      const text = `${mm.name}`;
      const w = Math.min(220, 14 + text.length * 6.2);
      if (x + w > px + pw - 8) {
        // No more horizontal room — flag the overflow rather than clip silently.
        const more = scaledText(`…+${owned.length - i}`, 11, 0x8aa0b4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        more.x = x;
        more.y = chipY + 6;
        more.eventMode = "none";
        this.mainContainer!.addChild(more);
        break;
      }
      this.renderMicromoduleChip(mm, x, chipY, w, chipH);
      x += w + gap;
    }
  }

  /** One draggable micromodule chip in the tray. */
  private renderMicromoduleChip(
    mm: MicroModule,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const chip = new Container();
    chip.x = x;
    chip.y = y;
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill({ color: 0x14202c, alpha: 1 });
    bg.rect(0, 0, w, h).stroke({ color: 0xffaa22, width: 1 });
    chip.addChild(bg);
    const t = scaledText(mm.name, 10, 0xffcc44, {
      rawColor: true,
      fontFamily: "monospace",
    });
    t.anchor.set(0.5, 0.5);
    t.x = w / 2;
    t.y = h / 2;
    t.eventMode = "none";
    chip.addChild(t);

    chip.eventMode = "static";
    chip.cursor = "grab";
    // hitArea so the all-`none` children don't prune the event boundary.
    chip.hitArea = new Rectangle(0, 0, w, h);
    chip.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.beginMicromoduleDrag(mm, e);
    });
    this.mainContainer!.addChild(chip);
    this.chipRects.push({ id: mm.id, x, y, w, h });
  }

  /** Begin dragging a micromodule chip: a ghost follows the pointer until release. */
  private beginMicromoduleDrag(
    mm: MicroModule,
    e: FederatedPointerEvent,
  ): void {
    if (this.dragMicromodule) return;

    const ghost = new Container();
    const gw = Math.min(220, 14 + mm.name.length * 6.2);
    const gh = 24;
    const gbg = new Graphics();
    gbg.rect(0, 0, gw, gh).fill({ color: 0x1a2a3a, alpha: 0.95 });
    gbg.rect(0, 0, gw, gh).stroke({ color: 0xffcc44, width: 1 });
    ghost.addChild(gbg);
    const gt = scaledText(mm.name, 10, 0xffdd66, {
      rawColor: true,
      fontFamily: "monospace",
    });
    gt.anchor.set(0.5, 0.5);
    gt.x = gw / 2;
    gt.y = gh / 2;
    ghost.addChild(gt);
    ghost.eventMode = "none";
    ghost.x = e.global.x - gw / 2;
    ghost.y = e.global.y - gh / 2;
    // The ghost lives on the uiLayer, above mainContainer, so it floats over the
    // board while dragging.
    this.renderer.uiLayer.addChild(ghost);

    this.dragMicromodule = { mm, ghost, bg: gbg, w: gw, h: gh };

    this.dragMoveHandler = (ev: FederatedPointerEvent) =>
      this.updateMicromoduleDrag(ev);
    this.dragEndHandler = (ev: FederatedPointerEvent) =>
      this.endMicromoduleDrag(ev);
    const stage = this.renderer.app.stage;
    stage.eventMode = "static";
    stage.on("globalpointermove", this.dragMoveHandler);
    stage.on("pointerup", this.dragEndHandler);
    stage.on("pointerupoutside", this.dragEndHandler);
  }

  /** Move the drag ghost; tint it by whether the hovered zone would accept the drop. */
  private updateMicromoduleDrag(e: FederatedPointerEvent): void {
    const drag = this.dragMicromodule;
    if (!drag) return;
    drag.ghost.x = e.global.x - drag.w / 2;
    drag.ghost.y = e.global.y - drag.h / 2;

    const loadout = this.gameEngine?.playerLoadout ?? null;
    const zone = this.dropZoneAt(e.global.x, e.global.y);
    let tint = 0xffffff; // neutral (no multiply)
    if (zone && loadout) {
      tint =
        evaluateMicromoduleDrop(loadout, zone.target, drag.mm.id) === "ok"
          ? 0x44ff88
          : 0xff6644;
    }
    drag.bg.tint = tint;
  }

  /** Release the drag: apply onto the hovered zone (or no-op) and refresh. */
  private endMicromoduleDrag(e: FederatedPointerEvent): void {
    const drag = this.dragMicromodule;
    if (!drag) return;
    const dropX = e.global.x;
    const dropY = e.global.y;
    this.cancelMicromoduleDrag();

    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const zone = this.dropZoneAt(dropX, dropY);
    if (!player || !loadout || !zone) {
      // Released over empty space — silently cancelled.
      this.render();
      return;
    }

    const outcome = applyMicromoduleDrop(loadout, zone.target, drag.mm.id);
    if (outcome === "ok") {
      const idx = player.inventory.micromodules.indexOf(drag.mm);
      if (idx >= 0) player.inventory.micromodules.splice(idx, 1);
      logger.info(
        `Drag-applied micromodule ${drag.mm.id} → ${zone.target.kind}`,
      );
    }
    this.render();
    this.showToast(
      micromoduleDropHint(outcome),
      outcome === "ok" ? 0x44ff88 : 0xff8844,
    );
  }

  /** Tear down an in-flight drag: remove the ghost and detach stage listeners. */
  private cancelMicromoduleDrag(): void {
    if (this.dragMicromodule) {
      this.renderer.uiLayer.removeChild(this.dragMicromodule.ghost);
      this.dragMicromodule.ghost.destroy({ children: true });
      this.dragMicromodule = null;
    }
    const stage = this.renderer.app.stage;
    if (this.dragMoveHandler) {
      stage.off("globalpointermove", this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragEndHandler) {
      stage.off("pointerup", this.dragEndHandler);
      stage.off("pointerupoutside", this.dragEndHandler);
      this.dragEndHandler = null;
    }
  }

  /** The registered drop zone containing the screen point, if any. */
  private dropZoneAt(
    gx: number,
    gy: number,
  ): { target: MicromoduleDropTarget } | null {
    for (const z of this.dropZones) {
      if (gx >= z.x && gx <= z.x + z.w && gy >= z.y && gy <= z.y + z.h) {
        return z;
      }
    }
    return null;
  }

  /**
   * E2E hook (Task 6): resolve a drag-drop by screen point without a real pointer
   * gesture — drives `applyMicromoduleDrop` through the same path the release
   * handler uses, so a test can buy a micromodule and "drop" it on a slot.
   * Returns the outcome string.
   */
  e2eDropMicromoduleAt(micromoduleId: string, gx: number, gy: number): string {
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const zone = this.dropZoneAt(gx, gy);
    if (!player || !loadout || !zone) return "no-target";
    const mm = player.inventory.micromodules.find(
      (m) => m.id === micromoduleId,
    );
    if (!mm) return "unknown";
    const outcome = applyMicromoduleDrop(loadout, zone.target, mm.id);
    if (outcome === "ok") {
      const idx = player.inventory.micromodules.indexOf(mm);
      if (idx >= 0) player.inventory.micromodules.splice(idx, 1);
    }
    this.render();
    this.showToast(
      micromoduleDropHint(outcome),
      outcome === "ok" ? 0x44ff88 : 0xff8844,
    );
    return outcome;
  }

  /** Screen-coord drop zones for the current hangar render (read-only, for E2E). */
  e2eDropZones(): ReadonlyArray<{
    x: number;
    y: number;
    w: number;
    h: number;
    target: MicromoduleDropTarget;
  }> {
    return this.dropZones;
  }

  /** Screen-coord drag-source chip rects for the current hangar render (E2E). */
  e2eMicromoduleChips(): ReadonlyArray<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> {
    return this.chipRects;
  }

  /** Open the hangar fitting board (navigation hook for E2E; not the interaction). */
  e2eOpenHangar(): void {
    this.view = "hangar";
    this.render();
  }

  /**
   * Right column: the СКЛАД warehouse (owned-but-uninstalled gear + the legacy
   * bag, each installable into its matching category or sellable) above the ТРЮМ
   * cargo hold (goods, read-only). Installing routes through the loadout's
   * category+mass rules; a blocked install shows a toast explaining why.
   */
  private renderWarehouseAndCargo(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
  ): void {
    const { rightX, rightW, contentTop, contentBottom } = layout;
    // СКЛАД occupies the top ~60 % of the column; ТРЮМ the rest.
    const splitY = Math.round(contentTop + (contentBottom - contentTop) * 0.6);

    const sklLabel = scaledText("СКЛАД (снаряжение):", 12, 0x88aa44, {
      rawColor: true,
      fontFamily: "monospace",
    });
    sklLabel.x = rightX;
    sklLabel.y = contentTop;
    sklLabel.eventMode = "none";
    this.mainContainer!.addChild(sklLabel);

    // Warehouse rows: canonical owned-uninstalled gear first (sellable), then the
    // legacy inventory bag (install-only until the bag is retired). Both install
    // into the matching category bank.
    const ownedIds = ownedUninstalledGear(player, loadout);
    const legacy = player.inventory.modules;
    type Row =
      | { kind: "owned"; gearId: string }
      | { kind: "legacy"; index: number };
    const rows: Row[] = [
      ...ownedIds.map((gearId) => ({ kind: "owned", gearId }) as Row),
      ...legacy.map((_, index) => ({ kind: "legacy", index }) as Row),
    ];

    let y = contentTop + 22;
    if (rows.length === 0) {
      const empty = scaledText("Склад пуст", 12, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      empty.x = rightX;
      empty.y = y;
      empty.eventMode = "none";
      this.mainContainer!.addChild(empty);
    }
    for (const row of rows) {
      if (y + 34 > splitY - 6) break; // clip to the СКЛАД region
      const gearId =
        row.kind === "owned" ? row.gearId : (legacy[row.index]?.id ?? "");
      const gear = gearById(gearId);
      const name =
        row.kind === "owned"
          ? (gear?.name ?? gearId)
          : (legacy[row.index]?.name ?? gearId);

      const rowBg = new Graphics();
      rowBg.rect(rightX, y, rightW, 30).fill({ color: 0x14160a, alpha: 1 });
      rowBg.rect(rightX, y, rightW, 30).stroke({ color: 0x30401a, width: 1 });
      rowBg.eventMode = "none";
      this.mainContainer!.addChild(rowBg);

      const rowText = scaledText(
        gear ? `${name} (T${gear.techLevel})` : name,
        11,
        0xccddaa,
        { rawColor: true, fontFamily: "monospace" },
      );
      rowText.x = rightX + 8;
      rowText.y = y + 3;
      rowText.eventMode = "none";
      this.mainContainer!.addChild(rowText);

      const btnRight = rightX + rightW - 8;

      // Sell — only the canonical owned store is sellable.
      if (row.kind === "owned" && gear) {
        const sellBtn = scaledText(
          `[Продать ${sellGearPrice(gear)}₡]`,
          11,
          0x44ff88,
          { rawColor: true, fontFamily: "monospace" },
        );
        sellBtn.anchor.set(1, 0.5);
        sellBtn.x = btnRight;
        sellBtn.y = y + 21;
        sellBtn.eventMode = "static";
        sellBtn.cursor = "pointer";
        sellBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          const refund = sellUninstalledGear(
            player,
            gearId,
            this.gameEngine?.bank,
          );
          if (refund > 0) {
            this.showToast(`Продано: ${gear.name} (+${refund} ₡)`, 0x44ff88);
          }
          this.render();
        });
        this.mainContainer!.addChild(sellBtn);
      }

      // Install into the matching category — catalog non-hull gear only.
      const installable = !!gear && gear.kind !== GearKind.HULL && !!loadout;
      if (installable && loadout) {
        const eqBtn = scaledText("[Установить]", 11, 0x44ddaa, {
          rawColor: true,
          fontFamily: "monospace",
        });
        eqBtn.anchor.set(1, 0.5);
        eqBtn.x = btnRight;
        eqBtn.y = y + 8;
        eqBtn.eventMode = "static";
        eqBtn.cursor = "pointer";
        eqBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.installFromWarehouse(loadout, player, row);
        });
        eqBtn.on("pointerover", () => {
          eqBtn.alpha = 0.7;
        });
        eqBtn.on("pointerout", () => {
          eqBtn.alpha = 1;
        });
        this.mainContainer!.addChild(eqBtn);
      }
      y += 38;
    }

    // ── ТРЮМ — cargo hold (goods), separate read-only panel. ──
    const stats = loadout?.derivedStats() ?? null;
    const resources = player.inventory.resources.filter((r) => r.amount > 0);
    const usedCargo = resources.reduce((n, r) => n + r.amount, 0);
    const holdLabel = scaledText(
      `ТРЮМ ${usedCargo}/${stats?.cargo ?? 0}:`,
      12,
      0x88ccff,
      { rawColor: true, fontFamily: "monospace" },
    );
    holdLabel.x = rightX;
    holdLabel.y = splitY;
    holdLabel.eventMode = "none";
    this.mainContainer!.addChild(holdLabel);

    let cy = splitY + 22;
    if (resources.length === 0) {
      const empty = scaledText("Трюм пуст", 12, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      empty.x = rightX;
      empty.y = cy;
      empty.eventMode = "none";
      this.mainContainer!.addChild(empty);
    } else {
      for (const r of resources) {
        if (cy + 18 > contentBottom) break;
        const label = RESOURCE_LABEL[r.type] ?? r.type;
        const line = scaledText(`${label} ×${r.amount}`, 11, 0xb4c4d4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        line.x = rightX + 6;
        line.y = cy;
        line.eventMode = "none";
        this.mainContainer!.addChild(line);
        cy += 18;
      }
    }
  }

  /**
   * Install a warehouse row into the loadout, routing it to its category bank.
   * Blocks with an explanatory toast when the category is full or the install
   * would exceed the hull's mass budget (even with a free slot elsewhere).
   */
  private installFromWarehouse(
    loadout: ShipLoadout,
    player: Player,
    row: { kind: "owned"; gearId: string } | { kind: "legacy"; index: number },
  ): void {
    const mod =
      row.kind === "legacy" ? player.inventory.modules[row.index] : null;
    const gearId = row.kind === "owned" ? row.gearId : (mod?.id ?? "");
    const blocked = this.explainInstallBlock(loadout, gearId);
    if (blocked) {
      this.showToast(blocked, 0xff6644);
      return;
    }
    if (row.kind === "owned") {
      installOwnedGear(player, loadout, gearId);
    } else if (mod) {
      // An engine/radar install replaces the fitted single-slot part; capture it
      // first so the displaced item is re-bagged, not destroyed (the owned/buy/
      // loot paths all re-home it — this legacy path must too).
      const displaced = loadout.displacedBy(mod.id);
      if (this.equipment.installGear(loadout, mod.id)) {
        // Restore the micromodule + artifact-upgrade count carried on a
        // previously-removed item onto the freshly-filled slot (install appends).
        const lastSlot = loadout.installedGearIds().length - 1;
        if (mod.micromoduleId) {
          loadout.applyMicromoduleAt(lastSlot, mod.micromoduleId);
        }
        if (mod.upgrades) {
          loadout.setSlotUpgrades(lastSlot, mod.upgrades);
        }
        player.inventory.modules.splice(row.index, 1);
        if (displaced) {
          const dg = gearById(displaced);
          if (dg) player.inventory.addItem(gearToModule(dg));
        }
      }
    }
    this.render();
  }

  /**
   * Why an install is blocked, or null when it would succeed. Engine/radar are
   * single slots that *replace* the current fitting, so they only fail on mass;
   * the weapon/equipment banks also fail when full.
   */
  private explainInstallBlock(
    loadout: ShipLoadout,
    gearId: string,
  ): string | null {
    // One source of truth for the fit decision — gearFit (also used by the
    // equipment-shop per-listing hint) — so the toast can never drift from it.
    const fit = gearFit(loadout, gearId);
    switch (fit.status) {
      case "fits":
        return null;
      case "n/a":
        return "Нельзя установить";
      case "no-slot":
        return `Нет слота: ${CATEGORY_LABEL[fit.category]} (${fit.used}/${fit.total})`;
      case "over-mass":
        return `Перегруз: масса ${fit.mass} > свободно ${fit.massFree}`;
    }
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
    } else if (this.view === "micromodules") {
      if (e.key === "ArrowUp") this.scrollMicromodules(-1);
      if (e.key === "ArrowDown") this.scrollMicromodules(1);
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

  private scrollMicromodules(delta: number): void {
    this.micromoduleScroll = Math.max(
      0,
      Math.min(
        this.micromoduleScroll + delta,
        Math.max(
          0,
          this.micromoduleListings.length - this.micromoduleVisibleRows,
        ),
      ),
    );
    this.render();
  }
}
