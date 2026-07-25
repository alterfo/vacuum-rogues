import { Container, Graphics, Text } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import { lineStepFor } from "./ui/questCardLayout";
import { scaledFont } from "@/utils/fontScale";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { HangarPanel, explainInstallBlock } from "./ui/HangarPanel";
import { MicromoduleApplyPanel } from "./ui/MicromoduleApplyPanel";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { launchDenialReason } from "@/systems/equipment/launchDenial";
import { SceneType, StationType, QuestType, type MicroModule } from "@/types";
import { JobBoardPanel } from "./JobBoardPanel";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { GearKind } from "@/systems/equipment/GearCatalog";
import {
  micromoduleShopCatalog,
  micromodulePrice,
  buyMicromodule,
} from "@/systems/equipment/micromoduleShop";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  acquireUninstalledGear,
  KIND_LABEL,
  KIND_COLOR,
} from "@/systems/equipment/GearBridge";
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
  /** Teardown for the contextual-help layer (first-time hint + «?» button). */
  private helpTeardown: (() => void) | null = null;
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
  private readonly VISIBLE_ROWS = 9;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private detachWheel: (() => void) | null = null;
  private toast: Text | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Bribe paid this docking — gates are lifted for the duration of the visit. */
  private bribed = false;
  /** The shared slot-fitting hangar, mounted into mainContainer when the hangar
   *  view is active (same component the equipment shop embeds). */
  private readonly hangarPanel: HangarPanel;
  /** The shared micromodule-apply modal, opened from the hangar's per-slot
   *  "[установить микромодуль]" control (same component the equipment shop uses). */
  private readonly micromoduleApplyPanel: MicromoduleApplyPanel;
  /** The military-base quest board overlay (same panel planets use). Non-null
   *  only while the «Задания» surface is open at a MILITARY_BASE. */
  private jobBoardPanel: JobBoardPanel | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
    this.hangarPanel = new HangarPanel(renderer);
    this.micromoduleApplyPanel = new MicromoduleApplyPanel(renderer);
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

    // Claim rewards for any return-requiring quests this station issued and the
    // player has now satisfied (re-docked here). Without this, station-issued
    // BOUNTY/ESCORT/etc. quests stay stuck in pending-return forever.
    this.checkReturnQuestCompletion();

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);
    // Mouse-wheel scrolls the shop list (matches the ArrowUp/Down keys); only
    // the shop view is scrollable, so other views ignore the wheel.
    this.detachWheel = attachWheelScroll((dir) => {
      if (this.view === "shop") this.scrollShop(dir);
      else if (this.view === "micromodules") this.scrollMicromodules(dir);
    });

    this.mountHelp();

    logger.info(`StationScene: docked at ${this.station?.name}`);
  }

  /**
   * Wire contextual help (first-time auto-hint + always-available «?» reopen),
   * mounted on `renderer.stage` so it survives the per-view UI rebuilds.
   */
  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "STATION",
      { firstTimeKey: "refuel" },
    );
  }

  update(_dt: number): void {}

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    this.hangarPanel.dispose();
    this.closeJobBoard();
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

    // Hull market + trade-in is planet-only specialization (Task 1 audit). The
    // in-space shop has no hull tab and `buyItem` warehouses every purchase, so a
    // hull listed here would land in the owned-uninstalled store where it can
    // never be fitted (the hangar has no hull bank). Exclude hulls so a station
    // shop only ever sells gear it can actually fit.
    this.shopListings = generateShop({
      systemId: station.id,
      planetId: station.id,
      seed: galaxy.id,
      day: galaxy.gameDays,
      priceFactor,
      maxTechLevel,
    }).filter((l) => l.gear.kind !== GearKind.HULL);
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
        if (this.station?.type === StationType.MILITARY_BASE) {
          this.openJobBoard();
        } else {
          this.showToast("Задания выдаются только на военных базах", 0xffcc44);
        }
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

  // ── military-base quest board ────────────────────────────────────────────────

  /** Open the military-base job board — the same `JobBoardPanel` planets use,
   *  keyed by the station id so each base keeps its own (deduped) board. */
  private openJobBoard(): void {
    if (!this.gameEngine || !this.station) return;
    this.closeJobBoard();
    const quests = this.gameEngine.getQuestBoard(this.station.id);
    const { width, height } = this.renderer.app.screen;
    const activeQuests = this.gameEngine.questManager.getActiveQuests();
    const currentDay = this.gameEngine.galaxy?.gameDays ?? 0;
    const acceptedIds = new Set<string>([
      ...activeQuests.map((q) => q.id),
      ...this.gameEngine.questManager.getCompletedQuestIds(),
      // Pending-return quests are still "taken" — keep them off the board.
      ...this.gameEngine.questManager.getPendingReturnQuests().map((q) => q.id),
    ]);
    this.jobBoardPanel = new JobBoardPanel(
      quests,
      width,
      height,
      {
        onAccept: (q) => this.acceptJob(q),
        onClose: () => this.closeJobBoard(),
      },
      activeQuests.length,
      acceptedIds,
      activeQuests,
      currentDay,
      this.gameEngine.player?.rank ?? 0,
    );
    this.renderer.uiLayer.addChild(this.jobBoardPanel.container);
  }

  private acceptJob(q: GeneratedQuest): void {
    if (!this.gameEngine || !this.station) return;
    const accepted = this.gameEngine.acceptBoardQuest(q, this.station.id);
    if (!accepted) {
      this.showToast("Не удалось принять задание", 0xffaa00);
      return;
    }
    if (q.template.type === QuestType.TEXT_ADVENTURE) {
      const scriptId = q.template.targetObjectId ?? q.template.id;
      this.closeJobBoard();
      this.gameEngine
        .startTextQuest(
          scriptId,
          undefined,
          SceneType.STATION,
          { gameEngine: this.gameEngine, station: this.station },
          accepted.id,
        )
        .catch((e) =>
          logger.error("StationScene: text quest transition failed", e),
        );
      return;
    }
    this.showToast(`Задание принято: ${q.template.title}`, 0x00ff88);
    this.openJobBoard(); // refresh — the accepted quest drops off the board
  }

  private closeJobBoard(): void {
    const panel = this.jobBoardPanel;
    this.jobBoardPanel = null;
    if (panel) {
      this.renderer?.uiLayer?.removeChild(panel.container);
      panel.destroy();
    }
  }

  /**
   * On docking, claim rewards for any pending-return quests issued at THIS
   * station (`quest.planetId === this.station.id`). A military base issues
   * return-requiring quests (BOUNTY/ESCORT/EXPLORATION/DEFENSE/DIPLOMACY) tagged
   * with the station id; `PlanetScene.checkReturnQuestCompletion` only claims
   * *planet*-issued ones, so without a station-side equivalent these would be
   * stuck in pending-return permanently (and silently dropped off the board).
   * Mirrors PlanetScene.checkReturnQuestCompletion (toast instead of message).
   */
  private checkReturnQuestCompletion(): void {
    if (!this.gameEngine?.player || !this.station) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    if (!questManager) return;
    for (const quest of questManager.getPendingReturnQuests()) {
      if (quest.planetId !== this.station.id) continue;
      const claimed = questManager.claimReturnReward(quest.id, player);
      if (claimed) {
        this.gameEngine.audio.playSfx("reward").catch(() => {});
        this.showToast(
          `Награда получена: +${quest.reward.credits} ₡`,
          0xffdd44,
        );
        logger.info(
          `Return reward claimed at station: ${quest.title} +${quest.reward.credits} cr`,
        );
      }
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
    this.gameEngine?.audio.playSfx("rankup").catch(() => {});
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
      this.showToast(
        launchDenialReason(loadoutStats) === "fuel"
          ? "Нет топливного бака — отстыковка невозможна"
          : "Нет двигателя — отстыковка невозможна",
        0xff4444,
      );
      return;
    }
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      // Spawn beside the station we just left, not at the distant edge (Task 9).
      fromStationId: this.station?.id,
    });
  }

  // ── shop sub-view ─────────────────────────────────────────────────────────

  /**
   * Gear-listing row height. Historically a fixed 50 px, sized for the "M"
   * scale's kind-badge + name two-line stack — at "L" scale the taller badge
   * line bled into the name line beneath it (Task 3,
   * `docs/plans/20260708-font-scale-and-faction-bugs.md`). Grows with the
   * current font scale, floored at the historical 50 px.
   */
  private get ROW_H(): number {
    const badgeStep = lineStepFor(scaledFont(11));
    const nameStep = lineStepFor(scaledFont(13));
    return Math.max(50, 8 + badgeStep + nameStep + 4);
  }

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

    // "Owned" = in the canonical owned-uninstalled warehouse OR the legacy bag
    // OR installed in the loadout. A purchase warehouses into `ownedGearIds`
    // (screen-consistency Task 4, never auto-installs), so the warehouse set must
    // be included — otherwise the shop keeps offering [Купить] for an item just
    // bought, letting the player re-buy duplicates. Mirrors EquipmentShopScene's
    // owned set (canonical warehouse ∪ bag ∪ installed) so the badge reads the
    // same at both entry points.
    const ownedIds = [
      ...(this.gameEngine?.player?.inventory.ownedGearIds ?? []),
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
      const kindBadgeTop = y + 8;
      kindBadge.y = kindBadgeTop;
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
      // Stacked below the kind badge — steps by the badge's own font-scale
      // line height so the two never overlap at "L" (Task 3: the fixed +26
      // offset assumed the "M"-scale ~14 px badge-line height).
      name.y = kindBadgeTop + lineStepFor(scaledFont(11));
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

    // Toast slot so purchases in the gear shop confirm on screen (mirrors
    // renderMain). Without it `this.toast` is null and `showToast` no-ops.
    this.addToastSlot(PX, PY, PW, PH);
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
    // SR-canon (screen-consistency Task 4): a purchase ALWAYS lands in the
    // warehouse — the canonical owned-uninstalled store (shown in the hangar
    // ТРЮМ, sellable from there) — identical to the planet Верфь gear tab. The
    // shop never auto-installs; fitting is a separate hangar action, so the same
    // «buy this gear» action lands in the same place regardless of where it was
    // bought (planet vs. station). Spares the current hull can't yet hold are
    // stocked and fitted later (by category + mass) in the hangar.
    acquireUninstalledGear(player, listing.gear.id);
    this.gameEngine?.audio.playSfx("buy").catch(() => {});
    // Re-render first (rebuilds the toast slot), THEN toast — the re-render
    // wipes any toast set before it, so a pre-render message never paints.
    this.render();
    this.showToast(`Куплено: ${listing.gear.name}`, 0x44ff88);
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

    // Historically a fixed 46 px, sized for the "M" scale's tier-badge + name
    // two-line stack — at "L" scale the taller badge line bled into the name
    // line beneath it (Task 3). Grows with the current font scale, floored at
    // the historical 46 px.
    const ROW = Math.max(
      46,
      6 + lineStepFor(scaledFont(11)) + lineStepFor(scaledFont(13)) + 6,
    );
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
      const tierBadgeTop = rowY + 6;
      tierBadge.y = tierBadgeTop;
      tierBadge.eventMode = "none";
      this.mainContainer!.addChild(tierBadge);

      // Stacked below the tier badge — steps by the badge's own font-scale
      // line height so the two never overlap at "L" (Task 3: the fixed +24
      // offset assumed the "M"-scale ~14 px badge-line height).
      const nameTop = tierBadgeTop + lineStepFor(scaledFont(11));
      const nameText = scaledText(mm.name, 13, 0xddeeff, {
        rawColor: true,
        fontFamily: "monospace",
      });
      nameText.x = PX + 20;
      nameText.y = nameTop;
      nameText.eventMode = "none";
      this.mainContainer!.addChild(nameText);

      const catText = scaledText(mm.targetCategory, 11, 0x557788, {
        rawColor: true,
        fontFamily: "monospace",
      });
      catText.x = PX + 180;
      catText.y = nameTop;
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
          // Re-render first (rebuilds the toast slot), THEN toast — the
          // re-render wipes any toast set before it.
          this.render();
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

    // Toast slot so micromodule purchases confirm on screen (mirrors
    // renderMain). Without it `this.toast` is null and `showToast` no-ops.
    this.addToastSlot(PX, PY, PW, PH);
  }

  private renderMicromoduleApplyPanel(): void {
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const target = this.micromoduleApplyTarget;
    if (!player || !loadout || !target || !this.mainContainer) {
      this.micromoduleApplyTarget = null;
      this.view = "hangar";
      this.render();
      return;
    }
    // The shared modal mutates the canonical loadout + owned micromodules; the
    // scene supplies toast + the "back to hangar" close (same component the
    // equipment shop mounts, so the apply flow is identical wherever it opens).
    this.micromoduleApplyPanel.render({
      container: this.mainContainer,
      player,
      loadout,
      target,
      showToast: (msg, color) => this.showToast(msg, color),
      onClose: () => {
        this.micromoduleApplyTarget = null;
        this.view = "hangar";
        this.render();
      },
    });
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
        (px, py, pw, ph) => this.addToastSlot(px, py, pw, ph),
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
    const player = this.gameEngine?.player;
    if (!player || !this.mainContainer) return;
    // The shared hangar component draws the full fitting board; the scene wires
    // in its canonical model (player + loadout) and the scene-owned concerns
    // (toast, navigation, re-render) so fitting behaves identically wherever the
    // panel is mounted (here and in the equipment shop).
    this.hangarPanel.render({
      container: this.mainContainer,
      player,
      loadout: this.gameEngine?.playerLoadout ?? null,
      bank: this.gameEngine?.bank ?? null,
      equipment: this.equipment,
      // Match this station's own "Ремонт" pricing (REPAIR_DISCOUNT) so the
      // hangar tab's СЕРВИСНЫЙ ЦЕНТР can't undercut the same station's
      // discounted rate with the planet Верфь's flat 2 cr/HP baseline.
      repairRatePerHp:
        8 * (this.station ? REPAIR_DISCOUNT[this.station.type] : 1.0),
      presets: this.gameEngine?.playerLoadoutPresets ?? [],
      mutatePresets: (next) => {
        if (this.gameEngine) this.gameEngine.playerLoadoutPresets = next;
      },
      showToast: (msg, color) => this.showToast(msg, color),
      addToastSlot: (px, py, pw, ph) => this.addToastSlot(px, py, pw, ph),
      rerender: () => this.render(),
      back: () => {
        this.view = "main";
        this.render();
      },
      openMicromoduleApply: (slotIndex, gearId) => {
        this.micromoduleApplyTarget = { slotIndex, gearId };
        this.view = "micromodule_apply";
        this.render();
      },
    });
  }

  /** Screen-coord drop zones for the current hangar render (read-only, for E2E). */
  e2eDropZones(): ReturnType<HangarPanel["getDropZones"]> {
    return this.hangarPanel.getDropZones();
  }

  /** Screen-coord drag-source chip rects for the current hangar render (E2E). */
  e2eMicromoduleChips(): ReturnType<HangarPanel["getChipRects"]> {
    return this.hangarPanel.getChipRects();
  }

  /** Open the hangar fitting board (navigation hook for E2E; not the interaction). */
  e2eOpenHangar(): void {
    this.view = "hangar";
    this.render();
  }

  /**
   * Why an install is blocked, or null when it would succeed — delegates to the
   * shared {@link explainInstallBlock} helper (one source of truth with the
   * hangar warehouse install path and the equipment-shop per-listing hint).
   * Public so the hangar-layout test can assert the block reason directly.
   */
  explainInstallBlock(loadout: ShipLoadout, gearId: string): string | null {
    return explainInstallBlock(loadout, gearId);
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
