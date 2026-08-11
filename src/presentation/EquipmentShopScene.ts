import { Container, Graphics, Text } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import { lineStepFor, clampLabelToWidth } from "./ui/questCardLayout";
import { scaledFont } from "@/utils/fontScale";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType, PlanetType } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import {
  GearKind,
  gearById,
  type Gear,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  acquireUninstalledGear,
  ownedUninstalledGear,
  gearFit,
  type GearFit,
  KIND_LABEL,
  KIND_COLOR,
} from "@/systems/equipment/GearBridge";
import { shopRowAction } from "./equipment/shopRowAction";
import { HangarPanel } from "./ui/HangarPanel";
import { mountGearIcon } from "./ui/gearIcon";
import { wireGearTooltip } from "./ui/gearTooltip";
import { MicromoduleApplyPanel } from "./ui/MicromoduleApplyPanel";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { SlotCategory } from "@/systems/equipment/GearCatalog";
import {
  sellGearPrice,
  sellUninstalledGear,
} from "@/systems/equipment/sellGear";
import {
  hullTradeInPrice,
  buyHullWithTradeIn,
} from "@/systems/equipment/sellHull";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { attachWheelScroll } from "./ui/WheelScroll";
import { logger } from "@/utils/logger";
import {
  gearStatLine,
  installedSameClass,
  gearComparisonSuffix,
} from "@/systems/equipment/gearDisplay";

interface ShopContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

type ShopTab = "gear" | "hull" | "hangar";

interface MicromoduleApplyTarget {
  slotIndex: number;
  gearId: string;
}

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

export { clampLabelToWidth };
export { gearStatLine, installedSameClass, gearComparisonSuffix };

const BANK_LABEL: Record<SlotCategory, string> = {
  weapon: "ОРУЖИЕ",
  engine: "ДВИГАТЕЛЬ",
  radar: "РАДАР",
  equipment: "ОБОРУДОВАНИЕ",
};

function fitIndicator(fit: GearFit): { text: string; color: number } | null {
  switch (fit.status) {
    case "fits":
      return { text: "✓ Влезет", color: 0x66dd99 };
    case "no-slot":
      return {
        text: `Нет слота: ${BANK_LABEL[fit.category]}`,
        color: 0xffb454,
      };
    case "over-mass":
      return {
        text: `Перегруз +${fit.mass - fit.massFree}`,
        color: 0xff7755,
      };
    case "n/a":
      return null;
  }
}

export class EquipmentShopScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private mainContainer: Container | null = null;
  private listContainer: Container | null = null;
  private holdContainer: Container | null = null;
  private holdPos: { x: number; y: number; w: number } | null = null;
  private creditsText: Text | null = null;
  private listings: GearListing[] = [];
  private scrollOffset = 0;
  private activeTab: ShopTab = "gear";
  private readonly VISIBLE_ROWS = 7;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private detachWheel: (() => void) | null = null;
  private readonly hangarPanel: HangarPanel;
  private readonly micromoduleApplyPanel: MicromoduleApplyPanel;
  private readonly equipment = new EquipmentSystem();
  private micromoduleApplyTarget: MicromoduleApplyTarget | null = null;
  private toast: Text | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
    this.hangarPanel = new HangarPanel(renderer);
    this.micromoduleApplyPanel = new MicromoduleApplyPanel(renderer);
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
    this.detachWheel = attachWheelScroll((dir) => this.scroll(dir));

    this.mountHelp();

    logger.info(
      `EquipmentShopScene: ${this.listings.length} items at ${this.planet?.name}`,
    );
  }

  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "EQUIPMENT_SHOP",
    );
  }

  update(_deltaTime: number): void {}

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    this.hangarPanel.dispose();
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = null;
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
    }
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.listContainer = null;
    this.holdContainer = null;
    this.holdPos = null;
    this.creditsText = null;
    this.toast = null;
    this.micromoduleApplyTarget = null;
    this.gameEngine = null;
    this.planet = null;
  }

  e2eOpenHangar(): void {
    this.activeTab = "hangar";
    this.render();
  }

  private buildShopInventory(): void {
    if (!this.gameEngine?.galaxy || !this.planet) return;
    const system = this.gameEngine.galaxy.systems.find(
      (s) => s.id === this.gameEngine!.player?.currentSystemId,
    );
    const maxTechLevel = techLevelWithUplift(
      system?.techLevel ?? 1,
      this.gameEngine.galaxy.gameDays,
    );
    this.listings = generateShop({
      systemId: system?.id ?? "unknown",
      planetId: this.planet.id,
      seed: this.gameEngine.galaxy.id,
      day: this.gameEngine.galaxy.gameDays,
      priceFactor: techLevelForPlanet(this.planet.type) >= 4 ? 0.9 : 1.0,
      maxTechLevel,
    });
  }

  private gearListings(): GearListing[] {
    const installedIds = this.installedGearIds();
    return this.listings.filter(
      (l) => l.gear.kind !== GearKind.HULL && !installedIds.has(l.gear.id),
    );
  }

  private render(): void {
    if (!this.mainContainer) return;
    if (this.activeTab === "hangar") {
      if (this.micromoduleApplyTarget) this.renderMicromoduleApplyPanel();
      else this.renderHangar();
      return;
    }
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

    const header = new Graphics();
    header.rect(PX, PY, PW, 44);
    header.fill({ color: 0x081828 });
    this.mainContainer.addChild(header);

    const title = scaledText(
      `МАГАЗИН СНАРЯЖЕНИЯ — ${this.planet?.name ?? ""}`,
      14,
      0x00ccff,
      { rawColor: true, fontWeight: "bold" },
    );
    title.eventMode = "none";
    title.x = PX + 14;
    title.y = PY + 14;
    this.mainContainer.addChild(title);

    const credits = this.gameEngine?.player?.credits ?? 0;
    this.creditsText = scaledText(
      `${credits.toLocaleString("ru")}₡`,
      14,
      0xffee55,
      { rawColor: true, fontWeight: "bold" },
    );
    this.creditsText.eventMode = "none";
    this.creditsText.anchor.set(1, 0);
    this.creditsText.x = PX + PW - 14;
    this.creditsText.y = PY + 14;
    this.mainContainer.addChild(this.creditsText);

    this.renderTabs(PX, PY + 44, PW);

    if (this.activeTab === "gear") {
      this.renderColumnHeaders(PX, PY + 76, PW);

      const listH = this.VISIBLE_ROWS * this.ROW_H;
      const listClip = new Container();
      this.mainContainer.addChild(listClip);
      const listMask = new Graphics();
      listMask.rect(PX, PY + 96, PW - 30, listH);
      listMask.fill({ color: 0xffffff });
      listClip.addChild(listMask);
      listClip.mask = listMask;

      this.listContainer = new Container();
      listClip.addChild(this.listContainer);

      this.renderRows(PX, PY + 96, PW);

      this.addScrollButtons(PX + PW - 28, PY + 96, listH);

      const stripY = PY + 96 + listH + 4;
      this.renderLoadoutStrip(PX, stripY, PW, 28);
      if (!this.holdContainer) {
        this.holdContainer = new Container();
        this.mainContainer.addChild(this.holdContainer);
      }
      this.holdPos = { x: PX, y: stripY + 32, w: PW };
      this.renderHold();
    } else {
      this.renderHullPanel(PX, PY + 76, PW, PH - 76 - 44);
    }

    const back = scaledText("[ НАЗАД ]", 14, 0xaaaaaa, {
      rawColor: true,
      fontWeight: "bold",
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

    this.addToastSlot(PX, PY, PW, PH);
  }

  private renderTabs(x: number, y: number, w: number): void {
    const tabs: { label: string; tab: ShopTab }[] = [
      { label: "[ СНАРЯЖЕНИЕ ]", tab: "gear" },
      { label: "[ КОРПУС ]", tab: "hull" },
      { label: "[ АНГАР ]", tab: "hangar" },
    ];
    let tabX = x + 14;
    for (const { label, tab } of tabs) {
      const isActive = this.activeTab === tab;
      const tabBtn = scaledText(label, 13, isActive ? 0x00ccff : 0x446688, {
        rawColor: true,
        fontWeight: isActive ? "bold" : "normal",
      });
      tabBtn.eventMode = "none";
      tabBtn.x = tabX;
      tabBtn.y = y + 6;
      this.mainContainer!.addChild(tabBtn);

      if (!isActive) {
        tabBtn.eventMode = "static";
        tabBtn.cursor = "pointer";
        tabBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.activeTab = tab;
          this.scrollOffset = 0;
          this.rebuild();
        });
        tabBtn.on("pointerover", () => {
          tabBtn.alpha = 0.7;
        });
        tabBtn.on("pointerout", () => {
          tabBtn.alpha = 1;
        });
      }

      tabX += tabBtn.width + 20;
    }

    const divider = new Graphics();
    divider.rect(x, y + 28, w, 1);
    divider.fill({ color: 0x1a3050 });
    this.mainContainer!.addChild(divider);
  }

  private renderHullPanel(x: number, y: number, w: number, _h: number): void {
    if (!this.mainContainer) return;
    const player = this.gameEngine?.player;
    const hullListings = this.listings.filter(
      (l) => l.gear.kind === GearKind.HULL,
    );

    const currentClass = player?.ship.hullClass ?? "CORVETTE";
    const derived = this.gameEngine?.playerLoadout?.derivedStats();
    const cargo = derived?.cargo ?? "—";
    const maxHull = derived?.maxHull ?? player?.ship.maxHull;
    const hp =
      player && maxHull !== undefined
        ? `${player.ship.hullHP}/${maxHull}`
        : "—";
    const infoText = scaledText(
      `Текущий корпус: ${currentClass}  HP: ${hp}  Трюм: ${cargo}`,
      12,
      0x8899aa,
      { rawColor: true },
    );
    infoText.eventMode = "none";
    infoText.x = x + 14;
    infoText.y = y + 8;
    this.mainContainer.addChild(infoText);

    if (hullListings.length === 0) {
      const noHulls = scaledText(
        "Корпуса не доступны в этом магазине",
        13,
        0x446688,
        { rawColor: true },
      );
      noHulls.eventMode = "none";
      noHulls.x = x + 14;
      noHulls.y = y + 40;
      this.mainContainer.addChild(noHulls);
      return;
    }

    const currentHull = this.gameEngine?.playerLoadout?.hull;
    const ROW = 70;
    for (let i = 0; i < hullListings.length; i++) {
      const listing = hullListings[i];
      const hull = listing.gear as HullSpec;
      const rowY = y + 34 + i * ROW;
      const playerCredits = player?.credits ?? 0;
      const isCurrent = player?.ship.hullClass === hull.hullClass;
      const tradeIn =
        currentHull && currentHull.id !== hull.id
          ? hullTradeInPrice(
              currentHull,
              player?.ship.hullHP,
              player?.ship.maxHull,
            )
          : 0;
      const netPrice = Math.max(0, listing.price - tradeIn);
      const canAfford = playerCredits >= netPrice;

      const rowBg = new Graphics();
      rowBg.rect(x + 4, rowY, w - 36, ROW - 4);
      rowBg.fill({
        color: isCurrent ? 0x0a1f30 : i % 2 === 0 ? 0x060e18 : 0x050b14,
      });
      if (isCurrent) rowBg.stroke({ width: 1, color: 0x1a4060 });
      rowBg.eventMode = "static";
      this.mainContainer.addChild(rowBg);
      wireGearTooltip(rowBg, this.mainContainer, hull, x + w * 0.35, rowY, {
        screenW: this.renderer.app.screen.width,
        screenH: this.renderer.app.screen.height,
      });

      const hullLabelBudgetPx = Math.max(20, w * 0.7 - 22);
      const nameText = scaledText(
        clampLabelToWidth(hull.name, 13, hullLabelBudgetPx),
        13,
        isCurrent ? 0x44aaff : canAfford ? 0xddeeff : 0x667788,
        { rawColor: true, fontWeight: "bold" },
      );
      nameText.eventMode = "none";
      nameText.x = x + 14;
      nameText.y = rowY + 6;
      this.mainContainer.addChild(nameText);

      const specText = scaledText(
        clampLabelToWidth(
          `HP: ${hull.hp}  Оружие: ${hull.weaponSlots}  Снаряж: ${hull.equipmentSlots}  Трюм: ${hull.cargo}  T${hull.techLevel}`,
          11,
          hullLabelBudgetPx,
        ),
        11,
        0x445566,
        { rawColor: true },
      );
      specText.eventMode = "none";
      specText.x = x + 14;
      specText.y = rowY + 26;
      this.mainContainer.addChild(specText);

      const priceColBudgetPx = Math.max(20, w * 0.15 - 8);
      const priceText = scaledText(
        clampLabelToWidth(
          `${listing.price.toLocaleString("ru")}₡`,
          12,
          priceColBudgetPx,
        ),
        12,
        canAfford ? 0xffee55 : 0x556655,
        { rawColor: true },
      );
      priceText.eventMode = "none";
      priceText.x = x + w * 0.7;
      priceText.y = rowY + 16;
      this.mainContainer.addChild(priceText);

      if (tradeIn > 0) {
        const tradeInText = scaledText(
          clampLabelToWidth(
            `сдача +${tradeIn.toLocaleString("ru")}₡`,
            10,
            priceColBudgetPx,
          ),
          10,
          0x55cc88,
          { rawColor: true },
        );
        tradeInText.eventMode = "none";
        tradeInText.x = x + w * 0.7;
        tradeInText.y = rowY + 36;
        this.mainContainer.addChild(tradeInText);
      }

      const badgeColBudgetPx = Math.max(20, w * 0.15 - 44);
      if (isCurrent) {
        const currentBadge = scaledText(
          clampLabelToWidth("Установлен", 12, badgeColBudgetPx),
          12,
          0x44aaff,
          { rawColor: true },
        );
        currentBadge.eventMode = "none";
        currentBadge.x = x + w * 0.85;
        currentBadge.y = rowY + 16;
        this.mainContainer.addChild(currentBadge);
      } else {
        const btnLabel = canAfford ? "[Установить]" : "Мало₡";
        const buyBtn = scaledText(
          clampLabelToWidth(btnLabel, 12, badgeColBudgetPx),
          12,
          canAfford ? 0x00ff88 : 0x445544,
          { rawColor: true, fontWeight: "bold" },
        );
        buyBtn.x = x + w * 0.85;
        buyBtn.y = rowY + 16;

        if (canAfford) {
          buyBtn.eventMode = "static";
          buyBtn.cursor = "pointer";
          buyBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            this.buyHull(listing, hull);
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
        this.mainContainer.addChild(buyBtn);
      }
    }
  }

  private buyHull(listing: GearListing, hull: HullSpec): void {
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout;
    if (!player || !loadout) return;
    const tradeIn =
      loadout.hull.id === hull.id ? 0 : hullTradeInPrice(loadout.hull);
    const netPrice = Math.max(0, listing.price - tradeIn);
    if (player.credits < netPrice) return;

    const result = buyHullWithTradeIn(
      this.gameEngine?.bank,
      player,
      loadout,
      hull,
      listing.price,
    );

    this.gameEngine?.audio.playSfx("buy").catch(() => {});

    logger.info(
      `Installed hull ${hull.name} (${hull.hullClass}) for ${listing.price} credits` +
        (result.tradeIn > 0
          ? ` (traded in old hull for ${result.tradeIn})`
          : "") +
        ".",
    );

    this.rebuild();
    this.showToast(`Установлен корпус: ${hull.name}`, 0x44ff88);
  }

  private rebuild(): void {
    if (!this.mainContainer) return;
    this.mainContainer.destroy({ children: true });
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);
    this.listContainer = null;
    this.creditsText = null;
    this.holdContainer = null;
    this.holdPos = null;
    this.toast = null;
    this.render();
  }

  private renderColumnHeaders(x: number, y: number, w: number): void {
    const cols = [
      { text: "ПРЕДМЕТ", relX: 0.01 },
      { text: "ТИП", relX: 0.52 },
      { text: "Т.ЛВЛ", relX: 0.68 },
      { text: "ЦЕНА", relX: 0.78 },
    ];
    for (const col of cols) {
      const t = scaledText(col.text, 11, 0x446688, { rawColor: true });
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

  private installedGearIds(): Set<string> {
    return new Set(this.gameEngine?.playerLoadout?.installedGearIds() ?? []);
  }

  private installedOfSameClass(gear: Gear): Gear | null {
    const loadout = this.gameEngine?.playerLoadout;
    if (!loadout) return null;
    return installedSameClass(loadout.installedGearIds(), gear);
  }

  private get ROW_H(): number {
    const nameStep = lineStepFor(scaledFont(13));
    const statStep = lineStepFor(scaledFont(10));
    return Math.max(52, 6 + nameStep + statStep + 6);
  }

  private renderRows(startX: number, startY: number, w: number): void {
    if (!this.listContainer) return;
    this.listContainer.removeChildren();

    const player = this.gameEngine?.player ?? null;
    const playerCredits = player?.credits ?? 0;
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const canonicalOwned = new Set(
      player ? ownedUninstalledGear(player, loadout) : [],
    );
    const ownedIds = new Set<string>([
      ...canonicalOwned,
      ...(player?.inventory.modules.map((m) => m.id) ?? []),
    ]);
    const installedIds = this.installedGearIds();

    const gearListings = this.gearListings();
    for (let i = 0; i < gearListings.length; i++) {
      const listing = gearListings[i];
      const gear = listing.gear;
      const rowY = startY + i * this.ROW_H - this.scrollOffset * this.ROW_H;
      const canAfford = playerCredits >= listing.price;
      const alreadyOwned = ownedIds.has(gear.id);
      const isInstalled = installedIds.has(gear.id);
      const fitResult = loadout ? gearFit(loadout, gear.id) : null;

      const replacing = this.installedOfSameClass(gear);
      const rowColor = isInstalled
        ? 0x0a1f10
        : i % 2 === 0
          ? 0x060e18
          : 0x050b14;
      const rowBg = new Graphics();
      rowBg.rect(startX, rowY, w - 30, this.ROW_H - 2);
      rowBg.fill({ color: rowColor });
      if (isInstalled) rowBg.stroke({ width: 1, color: 0x226622 });
      rowBg.eventMode = "static";
      this.listContainer.addChild(rowBg);
      wireGearTooltip(
        rowBg,
        this.mainContainer!,
        gear,
        startX + w * 0.3,
        rowY,
        {
          replacing: replacing && !isInstalled ? replacing : null,
          screenW: this.renderer.app.screen.width,
          screenH: this.renderer.app.screen.height,
        },
      );

      const iconSize = 16;
      const iconOffset = mountGearIcon(
        this.listContainer,
        gear,
        startX + w * 0.01,
        rowY + 6 + iconSize / 2,
        iconSize,
      );

      const nameColor = isInstalled
        ? 0x44ff88
        : alreadyOwned
          ? 0x447744
          : canAfford
            ? 0xddeeff
            : 0x667788;
      const nameBudgetPx = Math.max(20, w * 0.51 - iconOffset - 8);
      const nameText = scaledText(
        clampLabelToWidth(
          isInstalled ? `★ ${gear.name}` : gear.name,
          13,
          nameBudgetPx,
        ),
        13,
        nameColor,
        { rawColor: true, fontWeight: "bold" },
      );
      nameText.eventMode = "none";
      nameText.x = startX + w * 0.01 + iconOffset;
      const nameTop = rowY + 6;
      nameText.y = nameTop;
      this.listContainer.addChild(nameText);

      let statLine = gearStatLine(gear);
      if (replacing && !isInstalled) {
        statLine += gearComparisonSuffix(gear, replacing);
      }
      const statText = scaledText(
        clampLabelToWidth(statLine, 10, nameBudgetPx),
        10,
        replacing && !isInstalled ? 0x88aacc : 0x445566,
        { rawColor: true },
      );
      statText.eventMode = "none";
      statText.x = startX + w * 0.01 + iconOffset;
      statText.y = nameTop + lineStepFor(scaledFont(13));
      this.listContainer.addChild(statText);

      const kindText = scaledText(
        KIND_LABEL[gear.kind],
        12,
        KIND_COLOR[gear.kind],
        { rawColor: true },
      );
      kindText.eventMode = "none";
      kindText.x = startX + w * 0.52;
      kindText.y = rowY + 16;
      this.listContainer.addChild(kindText);

      const techText = scaledText(`T${gear.techLevel}`, 12, 0x8899aa, {
        rawColor: true,
      });
      techText.eventMode = "none";
      techText.x = startX + w * 0.68;
      techText.y = rowY + 16;
      this.listContainer.addChild(techText);

      const priceText = scaledText(
        `${listing.price.toLocaleString("ru")}₡`,
        12,
        canAfford ? 0xffee55 : 0x556655,
        { rawColor: true },
      );
      priceText.eventMode = "none";
      priceText.x = startX + w * 0.78;
      const priceTop = rowY + 16;
      priceText.y = priceTop;
      this.listContainer.addChild(priceText);

      const rowAction = shopRowAction({
        isInstalled,
        owned: alreadyOwned,
        installable: false,
        canAfford,
      });
      const buyBtn = scaledText(rowAction.label, 12, rowAction.color, {
        rawColor: true,
        fontWeight: "bold",
      });
      buyBtn.anchor.set(1, 0);
      buyBtn.x = startX + w - 30 - 6;
      buyBtn.y = rowY + 16;

      if (rowAction.actionable) {
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

      const fit = fitResult ? fitIndicator(fitResult) : null;
      if (fit) {
        const fitText = scaledText(fit.text, 10, fit.color, { rawColor: true });
        fitText.eventMode = "none";
        fitText.x = startX + w * 0.78;
        fitText.y = priceTop + lineStepFor(scaledFont(12));
        this.listContainer.addChild(fitText);
      }
    }
  }

  private addScrollButtons(x: number, y: number, totalH: number): void {
    const upBtn = scaledText("▲", 16, 0x446688, { rawColor: true });
    upBtn.x = x;
    upBtn.y = y;
    upBtn.eventMode = "static";
    upBtn.cursor = "pointer";
    upBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.scroll(-1);
    });
    this.mainContainer!.addChild(upBtn);

    const downBtn = scaledText("▼", 16, 0x446688, { rawColor: true });
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

  private renderLoadoutStrip(x: number, y: number, w: number, h: number): void {
    if (!this.mainContainer || h < 24) return;
    const loadout = this.gameEngine?.playerLoadout;

    const stripBg = new Graphics();
    stripBg.rect(x, y, w - 30, Math.max(h, 28));
    stripBg.fill({ color: 0x040c14, alpha: 0.8 });
    stripBg.stroke({ width: 1, color: 0x1a3050 });
    this.mainContainer.addChild(stripBg);

    const label = scaledText("УСТАНОВЛЕНО:", 10, 0x446688, { rawColor: true });
    label.eventMode = "none";
    label.x = x + 8;
    label.y = y + 6;
    this.mainContainer.addChild(label);

    if (!loadout) {
      const none = scaledText("нет данных", 10, 0x334455, { rawColor: true });
      none.eventMode = "none";
      none.x = x + 110;
      none.y = y + 6;
      this.mainContainer.addChild(none);
      return;
    }

    const ids = loadout.installedGearIds();
    if (ids.length === 0) {
      const none = scaledText("слоты пусты", 10, 0x334455, { rawColor: true });
      none.eventMode = "none";
      none.x = x + 110;
      none.y = y + 6;
      this.mainContainer.addChild(none);
      return;
    }

    let tx = x + 110;
    for (const gearId of ids) {
      const gear = gearById(gearId);
      if (!gear) continue;
      if (tx > x + w - 60) break; // prevent overflow off the strip
      const chip = scaledText(
        `[${gear.name} T${gear.techLevel}]`,
        10,
        KIND_COLOR[gear.kind] ?? 0x88aacc,
        { rawColor: true },
      );
      chip.eventMode = "none";
      chip.x = tx;
      chip.y = y + 6;
      this.mainContainer!.addChild(chip);
      tx += chip.width + 12;
    }
  }

  private renderHold(): void {
    const hold = this.holdContainer;
    const pos = this.holdPos;
    const player = this.gameEngine?.player;
    if (!hold || !pos || !player) return;
    hold.removeChildren();

    const { x, y, w } = pos;
    const stripBg = new Graphics();
    stripBg.rect(x, y, w - 30, 28);
    stripBg.fill({ color: 0x0a0a04, alpha: 0.8 });
    stripBg.stroke({ width: 1, color: 0x30401a });
    hold.addChild(stripBg);

    const label = scaledText("ТРЮМ:", 10, 0x88aa44, { rawColor: true });
    label.eventMode = "none";
    label.x = x + 8;
    label.y = y + 8;
    hold.addChild(label);

    const loadout = this.gameEngine?.playerLoadout ?? null;
    const ids = ownedUninstalledGear(player, loadout);
    if (ids.length === 0) {
      const none = scaledText("пусто", 10, 0x334455, { rawColor: true });
      none.eventMode = "none";
      none.x = x + 70;
      none.y = y + 8;
      hold.addChild(none);
      return;
    }

    let tx = x + 70;
    for (const gearId of ids) {
      const gear = gearById(gearId);
      if (!gear) continue;
      const chip = scaledText(
        `[${gear.name}]`,
        10,
        KIND_COLOR[gear.kind] ?? 0x88aacc,
        { rawColor: true },
      );
      chip.eventMode = "none";
      chip.x = tx;
      chip.y = y + 8;
      hold.addChild(chip);
      tx += chip.width + 4;

      const sellBtn = scaledText(
        `Продать ${sellGearPrice(gear)}₡`,
        10,
        0x44ff88,
        { rawColor: true },
      );
      sellBtn.eventMode = "static";
      sellBtn.cursor = "pointer";
      sellBtn.x = tx;
      sellBtn.y = y + 8;
      sellBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        this.sellHoldItem(gearId);
      });
      sellBtn.on("pointerover", () => {
        sellBtn.alpha = 0.7;
      });
      sellBtn.on("pointerout", () => {
        sellBtn.alpha = 1;
      });
      hold.addChild(sellBtn);
      tx += sellBtn.width + 14;
      if (tx > x + w - 60) break; // prevent overflow off the strip
    }
  }

  private renderHangar(): void {
    const player = this.gameEngine?.player;
    if (!player || !this.mainContainer) return;
    this.hangarPanel.render({
      container: this.mainContainer,
      player,
      loadout: this.gameEngine?.playerLoadout ?? null,
      bank: this.gameEngine?.bank ?? null,
      equipment: this.equipment,
      repairRatePerHp: 2,
      presets: this.gameEngine?.playerLoadoutPresets ?? [],
      mutatePresets: (next) => {
        if (this.gameEngine) this.gameEngine.playerLoadoutPresets = next;
      },
      showToast: (msg, color) => this.showToast(msg, color),
      playSfx: (key) => {
        this.gameEngine?.audio.playSfx(key).catch(() => {});
      },
      addToastSlot: (px, py, pw, ph) => this.addToastSlot(px, py, pw, ph),
      rerender: () => this.rebuild(),
      back: () => {
        this.activeTab = "gear";
        this.rebuild();
      },
      openMicromoduleApply: (slotIndex, gearId) => {
        this.micromoduleApplyTarget = { slotIndex, gearId };
        this.rebuild();
      },
    });
  }

  private renderMicromoduleApplyPanel(): void {
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout ?? null;
    const target = this.micromoduleApplyTarget;
    if (!player || !loadout || !target || !this.mainContainer) {
      this.micromoduleApplyTarget = null;
      this.rebuild();
      return;
    }
    this.micromoduleApplyPanel.render({
      container: this.mainContainer,
      player,
      loadout,
      target,
      showToast: (msg, color) => this.showToast(msg, color),
      onClose: () => {
        this.micromoduleApplyTarget = null;
        this.rebuild();
      },
    });
  }

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

  private sellHoldItem(gearId: string): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    const refund = sellUninstalledGear(player, gearId, this.gameEngine?.bank);
    if (refund <= 0) return;
    this.gameEngine?.audio.playSfx("sell").catch(() => {});
    if (this.creditsText) {
      this.creditsText.text = `${player.credits.toLocaleString("ru")}₡`;
    }
    this.renderHold();
    const soldName = gearById(gearId)?.name ?? "предмет";
    this.showToast(`Продано: ${soldName} (+${refund}₡)`, 0xffcc44);
  }

  private scroll(dir: number): void {
    if (this.activeTab !== "gear") return;
    const maxScroll = Math.max(
      0,
      this.gearListings().length - this.VISIBLE_ROWS,
    );
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
    this.renderRows(PX, PY + 96, PW);
  }

  private buyItem(listing: GearListing): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    if (player.credits < listing.price) return;

    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -listing.price,
      GL_COUNTERPARTY.EQUIPMENT,
      `Покупка: ${listing.gear.name}`,
    );
    acquireUninstalledGear(player, listing.gear.id);
    this.gameEngine?.audio.playSfx("buy").catch(() => {});

    logger.info(
      `Bought ${listing.gear.name} for ${listing.price} credits ` +
        `(to warehouse, balance: ${player.credits})`,
    );

    if (this.creditsText) {
      this.creditsText.text = `${player.credits.toLocaleString("ru")}₡`;
    }
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const PW = Math.min(820, sw - 40);
    const PY = (sh - Math.min(580, sh - 40)) / 2;
    this.renderRows((sw - PW) / 2, PY + 96, PW);
    this.renderHold();
    this.showToast(`Куплено: ${listing.gear.name}`, 0x44ff88);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.activeTab === "hangar") {
      if (e.key === "Escape") {
        if (this.micromoduleApplyTarget) this.micromoduleApplyTarget = null;
        else this.activeTab = "gear";
        this.rebuild();
      }
      return;
    }
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
