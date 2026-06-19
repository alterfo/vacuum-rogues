import { Container, Graphics, Text } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType, PlanetType } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import {
  GearKind,
  gearById,
  type Gear,
  type HullSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import {
  slotToBagModule,
  acquireUninstalledGear,
  ownedUninstalledGear,
  gearFit,
  type GearFit,
  KIND_LABEL,
  KIND_COLOR,
  applyLoadoutHullToShip,
} from "@/systems/equipment/GearBridge";
import type { SlotCategory } from "@/systems/equipment/GearCatalog";
import {
  sellGearPrice,
  sellUninstalledGear,
} from "@/systems/equipment/sellGear";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { attachWheelScroll } from "./ui/WheelScroll";
import { logger } from "@/utils/logger";

interface ShopContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

type ShopTab = "gear" | "hull";

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

/** Bank labels for the per-listing fit indicator (mirrors the hangar's banks). */
const BANK_LABEL: Record<SlotCategory, string> = {
  weapon: "ОРУЖИЕ",
  engine: "ДВИГАТЕЛЬ",
  radar: "РАДАР",
  equipment: "ОБОРУДОВАНИЕ",
};

/**
 * Render the per-listing fit hint: whether the item will fit the current hull
 * (by category + mass) once the player goes to install it from the warehouse.
 * Returns null for gear with no slot (a hull) so the row shows no indicator.
 * Colours stay ≥0xb4b4b4 readable: green «Влезет», amber «Нет слота», red «Перегруз».
 */
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
  private holdContainer: Container | null = null;
  private holdPos: { x: number; y: number; w: number } | null = null;
  private creditsText: Text | null = null;
  private listings: GearListing[] = [];
  private scrollOffset = 0;
  private activeTab: ShopTab = "gear";
  private readonly ROW_H = 52;
  private readonly VISIBLE_ROWS = 7;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private detachWheel: (() => void) | null = null;

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
    this.detachWheel = attachWheelScroll((dir) => this.scroll(dir));

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
      `${credits.toLocaleString("ru")} ₡`,
      14,
      0xffee55,
      { rawColor: true, fontWeight: "bold" },
    );
    this.creditsText.eventMode = "none";
    this.creditsText.anchor.set(1, 0);
    this.creditsText.x = PX + PW - 14;
    this.creditsText.y = PY + 14;
    this.mainContainer.addChild(this.creditsText);

    // Tab switcher
    this.renderTabs(PX, PY + 44, PW);

    if (this.activeTab === "gear") {
      // Column headers
      this.renderColumnHeaders(PX, PY + 76, PW);

      // Scrollable item list — mask must be a child of the clipped container
      // (PixiJS 8 rule: mask must be addChild()'d to the masked object)
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

      // Scroll buttons (outside clip so they're always visible)
      this.addScrollButtons(PX + PW - 28, PY + 96, listH);

      // Current loadout strip (installed gear), then the ТРЮМ strip (owned but
      // uninstalled gear, each with a sell action) below it.
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

    // Back button
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
    // Mouse-wheel scroll is handled by a window-level listener (attached in
    // initialize via attachWheelScroll); a federated `backdrop.on("wheel")`
    // never fires because the list rows on top swallow the event.
  }

  private renderTabs(x: number, y: number, w: number): void {
    const tabs: { label: string; tab: ShopTab }[] = [
      { label: "[ СНАРЯЖЕНИЕ ]", tab: "gear" },
      { label: "[ КОРПУС ]", tab: "hull" },
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
    // Hold size comes from the canonical loadout (single source of truth).
    const cargo = this.gameEngine?.playerLoadout?.derivedStats().cargo ?? "—";
    const infoText = scaledText(
      `Текущий корпус: ${currentClass}  HP: ${player?.ship.maxHull ?? "—"}  Трюм: ${cargo}`,
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

    const ROW = 70;
    for (let i = 0; i < hullListings.length; i++) {
      const listing = hullListings[i];
      const hull = listing.gear as HullSpec;
      const rowY = y + 34 + i * ROW;
      const playerCredits = player?.credits ?? 0;
      const canAfford = playerCredits >= listing.price;
      const isCurrent = player?.ship.hullClass === hull.hullClass;

      const rowBg = new Graphics();
      rowBg.rect(x + 4, rowY, w - 36, ROW - 4);
      rowBg.fill({
        color: isCurrent ? 0x0a1f30 : i % 2 === 0 ? 0x060e18 : 0x050b14,
      });
      if (isCurrent) rowBg.stroke({ width: 1, color: 0x1a4060 });
      this.mainContainer.addChild(rowBg);

      const nameText = scaledText(
        hull.name,
        13,
        isCurrent ? 0x44aaff : canAfford ? 0xddeeff : 0x667788,
        { rawColor: true, fontWeight: "bold" },
      );
      nameText.eventMode = "none";
      nameText.x = x + 14;
      nameText.y = rowY + 6;
      this.mainContainer.addChild(nameText);

      const specText = scaledText(
        `HP: ${hull.hp}  Оружие: ${hull.weaponSlots}  Снаряж: ${hull.equipmentSlots}  Трюм: ${hull.cargo}  T${hull.techLevel}`,
        11,
        0x445566,
        { rawColor: true },
      );
      specText.eventMode = "none";
      specText.x = x + 14;
      specText.y = rowY + 26;
      this.mainContainer.addChild(specText);

      const priceText = scaledText(
        `${listing.price.toLocaleString("ru")}₡`,
        12,
        canAfford ? 0xffee55 : 0x556655,
        { rawColor: true },
      );
      priceText.eventMode = "none";
      priceText.x = x + w * 0.7;
      priceText.y = rowY + 16;
      this.mainContainer.addChild(priceText);

      if (isCurrent) {
        const currentBadge = scaledText("Установлен", 12, 0x44aaff, {
          rawColor: true,
        });
        currentBadge.eventMode = "none";
        currentBadge.x = x + w * 0.85;
        currentBadge.y = rowY + 16;
        this.mainContainer.addChild(currentBadge);
      } else {
        const btnLabel = canAfford ? "[Установить]" : "Мало₡";
        const buyBtn = scaledText(
          btnLabel,
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
    if (player.credits < listing.price) return;

    // The canonical loadout is the single source of truth: swap the hull there
    // (it drops any slotted gear that no longer fits), then project the new
    // hull's HP pool + class label onto the live ship from the loadout. Gear
    // that no longer fits a smaller hull returns to the inventory bag rather than
    // being destroyed.
    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -listing.price,
      GL_COUNTERPARTY.EQUIPMENT,
      `Покупка: ${hull.name}`,
    );
    // Re-bag dropped gear losslessly: slotToBagModule carries the slot's
    // micromodule + artifact-upgrade count so a hull downsize never destroys
    // the resources the player spent on them.
    const dropped = loadout.swapHull(hull.id);
    for (const slot of dropped) {
      const g = gearById(slot.gearId);
      if (g) player.inventory.addItem(slotToBagModule(g, slot));
    }
    applyLoadoutHullToShip(player.ship, loadout);

    logger.info(
      `Installed hull ${hull.name} (${hull.hullClass}) for ${listing.price} credits.`,
    );

    this.rebuild();
  }

  private rebuild(): void {
    if (!this.mainContainer) return;
    this.mainContainer.destroy({ children: true });
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);
    this.listContainer = null;
    this.creditsText = null;
    // `holdContainer` was a child of the destroyed `mainContainer`, so it is now
    // destroyed too. Null it (and its layout) so `render()` re-creates and
    // re-parents it instead of calling `renderHold()` on a dead container.
    this.holdContainer = null;
    this.holdPos = null;
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

  /** Gear IDs currently installed in the canonical loadout. */
  private installedGearIds(): Set<string> {
    return new Set(this.gameEngine?.playerLoadout?.installedGearIds() ?? []);
  }

  /**
   * For an equipment item, find the currently installed gear of the same class
   * (used to show "→ Заменит X" in the comparison column).
   */
  private installedOfSameClass(gear: Gear): EquipmentSpec | null {
    if (gear.kind !== GearKind.EQUIPMENT) return null;
    const shopItem = gear as EquipmentSpec;
    const loadout = this.gameEngine?.playerLoadout;
    if (!loadout) return null;
    for (const id of loadout.installedGearIds()) {
      const installed = gearById(id);
      if (
        installed &&
        installed.kind === GearKind.EQUIPMENT &&
        (installed as EquipmentSpec).equipmentClass === shopItem.equipmentClass
      ) {
        return installed as EquipmentSpec;
      }
    }
    return null;
  }

  private renderRows(startX: number, startY: number, w: number): void {
    if (!this.listContainer) return;
    this.listContainer.removeChildren();

    const playerCredits = this.gameEngine?.player?.credits ?? 0;
    const ownedIds = new Set(
      this.gameEngine?.player?.inventory.modules.map((m) => m.id) ?? [],
    );
    const installedIds = this.installedGearIds();
    const loadout = this.gameEngine?.playerLoadout ?? null;

    for (let i = 0; i < this.listings.length; i++) {
      const listing = this.listings[i];
      const gear = listing.gear;
      const rowY = startY + i * this.ROW_H - this.scrollOffset * this.ROW_H;
      const canAfford = playerCredits >= listing.price;
      const alreadyOwned = ownedIds.has(gear.id);
      const isInstalled = installedIds.has(gear.id);

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
      this.listContainer.addChild(rowBg);

      // Name + stat line
      const nameColor = isInstalled
        ? 0x44ff88
        : alreadyOwned
          ? 0x447744
          : canAfford
            ? 0xddeeff
            : 0x667788;
      const nameText = scaledText(
        isInstalled ? `★ ${gear.name}` : gear.name,
        13,
        nameColor,
        { rawColor: true, fontWeight: "bold" },
      );
      nameText.eventMode = "none";
      nameText.x = startX + w * 0.01;
      nameText.y = rowY + 6;
      this.listContainer.addChild(nameText);

      // Stat line — show comparison delta if this item replaces an installed one
      let statLine = gearStatLine(gear);
      if (replacing && !isInstalled) {
        const shopPotency = (gear as EquipmentSpec).potency;
        const curPotency = replacing.potency;
        const delta = shopPotency - curPotency;
        const sign = delta >= 0 ? "+" : "";
        statLine += `  (${sign}${delta} vs ${replacing.name})`;
      }
      const statText = scaledText(
        statLine,
        10,
        replacing && !isInstalled ? 0x88aacc : 0x445566,
        { rawColor: true },
      );
      statText.eventMode = "none";
      statText.x = startX + w * 0.01;
      statText.y = rowY + 25;
      this.listContainer.addChild(statText);

      // Kind badge
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

      // Tech level
      const techText = scaledText(`T${gear.techLevel}`, 12, 0x8899aa, {
        rawColor: true,
      });
      techText.eventMode = "none";
      techText.x = startX + w * 0.68;
      techText.y = rowY + 16;
      this.listContainer.addChild(techText);

      // Price
      const priceText = scaledText(
        `${listing.price.toLocaleString("ru")}₡`,
        12,
        canAfford ? 0xffee55 : 0x556655,
        { rawColor: true },
      );
      priceText.eventMode = "none";
      priceText.x = startX + w * 0.78;
      priceText.y = rowY + 16;
      this.listContainer.addChild(priceText);

      // Buy button
      const btnLabel = isInstalled
        ? "Установлен"
        : alreadyOwned
          ? "Есть"
          : canAfford
            ? "[Купить]"
            : "Мало₡";
      const buyBtn = scaledText(
        btnLabel,
        12,
        isInstalled
          ? 0x44ff88
          : alreadyOwned
            ? 0x447744
            : canAfford
              ? 0x00ff88
              : 0x445544,
        { rawColor: true, fontWeight: "bold" },
      );
      buyBtn.x = startX + w * 0.89;
      buyBtn.y = rowY + 16;

      if (canAfford && !alreadyOwned && !isInstalled) {
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

      // Per-listing fit hint: does this gear fit the current hull (by category +
      // mass) once installed from the warehouse? Hulls have no slot → no hint.
      const fit = loadout ? fitIndicator(gearFit(loadout, gear.id)) : null;
      if (fit) {
        const fitText = scaledText(fit.text, 10, fit.color, { rawColor: true });
        fitText.eventMode = "none";
        fitText.x = startX + w * 0.78;
        fitText.y = rowY + 34;
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

  /**
   * Render a compact strip showing what's currently installed in the loadout.
   * Gives the player at-a-glance comparison without leaving the shop.
   */
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
      const chip = scaledText(
        `[${gear.name} T${gear.techLevel}]`,
        10,
        KIND_COLOR[gear.kind] ?? 0x88aacc,
        { rawColor: true },
      );
      chip.eventMode = "none";
      chip.x = tx;
      chip.y = y + 6;
      this.mainContainer.addChild(chip);
      tx += chip.width + 10;
      if (tx > x + w - 40) break; // prevent overflow
    }
  }

  /**
   * ТРЮМ (hold) strip: gear the player owns but hasn't installed — the canonical
   * `ownedUninstalledGear` store — each with a «Продать» action at the trade-in
   * rate. Rendered into its own container so a sell rebuilds just this strip
   * (the rest of the shop is built once in `render`).
   */
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

  private sellHoldItem(gearId: string): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    const refund = sellUninstalledGear(player, gearId, this.gameEngine?.bank);
    if (refund <= 0) return;
    this.gameEngine?.audio.playSfx("buy").catch(() => {});
    if (this.creditsText) {
      this.creditsText.text = `${player.credits.toLocaleString("ru")} ₡`;
    }
    this.renderHold();
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
    // SR-canon (Task 4): a purchase always lands in the warehouse (the canonical
    // owned-uninstalled store, shown in the ТРЮМ strip and sellable from there).
    // Fitting gear is a separate hangar action — the shop never auto-installs, so
    // the player can stock spares the current hull can't yet hold and decide what
    // to fit (by category + mass) in the hangar.
    acquireUninstalledGear(player, listing.gear.id);
    this.gameEngine?.audio.playSfx("buy").catch(() => {});

    logger.info(
      `Bought ${listing.gear.name} for ${listing.price} credits ` +
        `(to warehouse, balance: ${player.credits})`,
    );

    // Update credits display and re-render rows so affordability badges update.
    if (this.creditsText) {
      this.creditsText.text = `${player.credits.toLocaleString("ru")} ₡`;
    }
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const PW = Math.min(820, sw - 40);
    const PY = (sh - Math.min(580, sh - 40)) / 2;
    this.renderRows((sw - PW) / 2, PY + 96, PW);
    // A purchase with no free slot lands in the ТРЮМ — refresh that strip too.
    this.renderHold();
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
